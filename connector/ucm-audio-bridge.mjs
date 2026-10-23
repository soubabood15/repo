import https from 'node:https';
import fs from 'node:fs';
import {Readable} from 'node:stream';
import WebSocket from 'ws';
import {UcmClient,createNodeTransport} from './ucm-api.mjs';
import {createPinnedUcmAgent} from './ucm-tls.mjs';
import {connectorHeaders} from './ucm-queue-runtime.mjs';
import {createQualityCalls} from './ucm-quality-calls.mjs';
const fail=code=>Object.assign(Error(code),{code});
const local=stamp=>new Date(Date.parse(stamp)+10800000).toISOString().slice(0,19);
export function recordingFiles(value){
 const list=Array.isArray(value)?value:String(value||'').split(',');
 return [...new Set(list.map(v=>String(v).trim()).filter(Boolean))].map(path=>{
  if(path.length>500||path.startsWith('/')||path.includes('\\')||path.split('/').some(part=>!part||part==='.'||part==='..'||!/^[a-zA-Z0-9_.@() -]+$/.test(part)))throw fail('RECORDING_FORMAT_UNSUPPORTED');
  const parts=path.split('/'),filedir=['monitor','queue','emergencymeetme','sca'].includes(parts[0])?parts.shift():'monitor';
  if(!/\.wav$/i.test(parts.at(-1)))throw fail('RECORDING_FORMAT_UNSUPPORTED');
  return {filedir,filename:parts.join('/')};
 });
}
export async function resolveRecording(client,call,segment=0){
 if(!call||typeof call.id!=='string'||!/^\d{2,10}$/.test(call.extension)||!Number.isFinite(Date.parse(call.start))||!Number.isFinite(Date.parse(call.end))||Date.parse(call.end)<Date.parse(call.start)||Date.parse(call.end)-Date.parse(call.start)>86400000)throw fail('CALL_NOT_FOUND');
 const from=local(new Date(Date.parse(call.start)-60000).toISOString()),to=local(new Date(Date.parse(call.start)+60000).toISOString());
 let raw;
 for(let offset=0;offset<10000;offset+=1000){
  let rows;try{rows=await client.cdrPage({start:from,end:to,offset,limit:1000})}catch(error){if(!/rejected \(-6\)|401/.test(error.message))throw error;client.cookie='';await client.login();rows=await client.cdrPage({start:from,end:to,offset,limit:1000})}
  for(const row of rows){const metadata=createQualityCalls(local(call.start).slice(0,10),[call.extension]);metadata.add([row]);if(metadata.finish().some(c=>(c.external_id===call.id||String(row.session||row.call_id||row.uniqueid||'')===call.id)&&c.started_at===call.start)){raw=row;break}}
  if(raw||rows.length<1000)break;
 }
 if(!raw)throw fail('CALL_NOT_FOUND');
 let files=raw.recordfiles||raw.record_files;
 if(!files){const id=raw.AcctId||raw.acctid;if(!id)throw fail('RECORDING_NOT_FOUND');let result=await client.authenticatedApi({action:'getRecordInfosByCall',id:String(id)});if(Number(result.status)===-6){client.cookie='';await client.login();result=await client.authenticatedApi({action:'getRecordInfosByCall',id:String(id)})}if(Number(result.status)!==0)throw fail('RECORDING_API_DENIED');files=result.response?.recordfiles}
 const recordings=recordingFiles(files);if(!recordings.length||!Number.isInteger(segment)||segment<0||segment>=recordings.length)throw fail('RECORDING_NOT_FOUND');
 return {...recordings[segment],segments:recordings.length};
}
export function openRecordingStream(config,client,file,signal){
 const endpoint=new URL('/api',config.UCM_API_BASE_URL||new URL(config.UCM_WS_URL).origin.replace('wss:','https:'));
 if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password)throw fail('RECORDING_API_DENIED');
 const agent=config.UCM_TLS_FINGERPRINT_SHA256?createPinnedUcmAgent(endpoint.href,config.UCM_TLS_FINGERPRINT_SHA256):undefined;
 const ca=config.UCM_CA_FILE?fs.readFileSync(config.UCM_CA_FILE):undefined;
 const body=JSON.stringify({request:{action:'recapi',cookie:client.cookie,filedir:file.filedir,filename:file.filename}});
 return new Promise((resolve,reject)=>{
  const request=https.request(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)},agent,ca,signal},response=>{if(response.statusCode!==200){response.destroy();reject(fail('RECORDING_API_DENIED'));return}resolve(response)});
  request.setTimeout(30000,()=>request.destroy(fail('RECORDING_API_DENIED')));request.on('error',reject);request.end(body);
 });
}
export async function wavStream(response){
 const iterator=response[Symbol.asyncIterator](),parts=[];let length=0;
 while(length<12){const item=await iterator.next();if(item.done)throw fail('RECORDING_FORMAT_UNSUPPORTED');parts.push(item.value);length+=item.value.length}
 const first=Buffer.concat(parts);
 if(first.toString('ascii',0,4)!=='RIFF'||first.toString('ascii',8,12)!=='WAVE'){response.destroy?.();throw fail('RECORDING_FORMAT_UNSUPPORTED')}
 return Readable.from((async function*(){yield first;for(;;){const item=await iterator.next();if(item.done)break;yield item.value}})());
}
export function startAudioBridge(config,{Socket=WebSocket,fetcher=fetch,log=value=>console.log(JSON.stringify(value)),client,openStream=openRecordingStream}={}){
 const receiver=new URL(config.CLOUDFLARE_QUEUE_ENDPOINT);if(receiver.protocol!=='https:')throw Error('Secure receiver required');
 const endpoint=new URL('/integrations/ucm/audio-bridge',receiver);endpoint.protocol='wss:';
 const api=config.UCM_API_BASE_URL||new URL(config.UCM_WS_URL).origin.replace('wss:','https:');
 client||=new UcmClient({apiBaseUrl:api,cdrMode:config.UCM_CDR_MODE||'session',cdrBaseUrl:config.UCM_CDR_BASE_URL||'',username:config.UCM_API_USERNAME,password:config.UCM_API_PASSWORD,transport:createNodeTransport({caFile:config.UCM_CA_FILE,pinEndpoint:api,fingerprint:config.UCM_TLS_FINGERPRINT_SHA256})});
 let stopped=false,socket,retry,heartbeat;const active=new Map();
 const send=value=>{if(socket?.readyState===1)socket.send(JSON.stringify(value))};
 async function play(job){
  if(active.size>=3||active.has(job.id))return;const abort=new AbortController();active.set(job.id,abort);
  try{
   const file=await resolveRecording(client,job.call,job.segment);if(abort.signal.aborted)return;
   if(!client.cookie)await client.login();const response=await openStream(config,client,file,abort.signal),stream=await wavStream(response);
   send({type:'metadata',id:job.id,segments:file.segments});
   const target=new URL('/functions/v1/quality-audio/upload',receiver);target.searchParams.set('id',job.id);target.searchParams.set('token',job.uploadToken);
   const result=await fetcher(target,{method:'POST',headers:{'Content-Type':'audio/wav'},body:stream,duplex:'half',signal:abort.signal,redirect:'error'});if(!result.ok)throw fail('AUDIO_UPLOAD_FAILED');await result.arrayBuffer();
  }catch(error){if(!abort.signal.aborted){send({type:'error',id:job.id,code:error.code||'UCM_RECORDING_FAILED'});log({level:'warn',event:'ucm_audio_failed',code:error.code||'UCM_RECORDING_FAILED'})}}
  finally{abort.abort();active.delete(job.id)}
 }
 function connect(){
  if(stopped)return;
  socket=new Socket(endpoint.href,{headers:connectorHeaders({action:'audio-connect'},config.UCM_INGEST_USERNAME,config.UCM_INGEST_PASSWORD).headers});
  socket.on('open',()=>{log({level:'info',event:'ucm_audio_connected'});heartbeat=setInterval(()=>{if(socket?.readyState===1)socket.ping()},30000)});
  socket.on('message',data=>{let job;try{job=JSON.parse(String(data))}catch{return}if(job.type==='cancel'){active.get(job.id)?.abort();return}if(job.type==='audio'&&typeof job.id==='string'&&typeof job.uploadToken==='string')void play(job)});
  socket.on('error',()=>{});
  socket.on('close',()=>{clearInterval(heartbeat);for(const abort of active.values())abort.abort();if(!stopped)retry=setTimeout(connect,5000)});
 }
 connect();return {stop(){stopped=true;clearTimeout(retry);clearInterval(heartbeat);for(const abort of active.values())abort.abort();socket?.close()}};
}
