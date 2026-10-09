import crypto from 'node:crypto';
import WebSocket from 'ws';
import {queueEventsFromStatus} from './ucm-api.mjs';
import {createPinnedUcmAgent,safeConnectionError} from './ucm-tls.mjs';
import {UcmOutbox} from './ucm-outbox.mjs';
export function connectorHeaders(event,username,password,now=Date.now(),nonce=crypto.randomUUID()){
  const body=JSON.stringify(event),timestamp=String(now),signature=crypto.createHmac('sha256',password).update(`${timestamp}.${nonce}.${body}`).digest('hex');
  return {body,headers:{Authorization:`Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`,'Content-Type':'application/json','X-UCM-Timestamp':timestamp,'X-UCM-Nonce':nonce,'X-UCM-Signature':signature}};
}
export function startQueueConnector(config,{Socket=WebSocket,fetcher=fetch,log=value=>console.log(JSON.stringify(value)),phaseMs=15000,heartbeatMs=25000,retryMs=1000}={}){
  const required=name=>{if(!config[name])throw new Error(`${name} is required`);return config[name]};
  const url=required('UCM_WS_URL'),apiUser=required('UCM_API_USERNAME'),apiPassword=required('UCM_API_PASSWORD'),endpoint=required('CLOUDFLARE_QUEUE_ENDPOINT'),ingestUser=required('UCM_INGEST_USERNAME'),ingestPassword=required('UCM_INGEST_PASSWORD');
  const target=new URL(url),cloudflare=new URL(endpoint);
  if(target.protocol!=='wss:'||target.username||target.password||cloudflare.protocol!=='https:'||cloudflare.username||cloudflare.password)throw new Error('Secure endpoints are required');
  if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw new Error('Global TLS bypass is forbidden');
  const agent=config.UCM_TLS_FINGERPRINT_SHA256?createPinnedUcmAgent(url,config.UCM_TLS_FINGERPRINT_SHA256):undefined;
  const origin=config.UCM_WS_ORIGIN||target.origin.replace(/^wss:/,'https:'),states=new Map();
  const outbox=new UcmOutbox({file:config.UCM_OUTBOX_FILE,log,forward:async event=>{
    if(!['login','logout'].includes(event.event_type))return;
    const response=await fetcher(endpoint,{method:'POST',...connectorHeaders(event,ingestUser,ingestPassword),signal:AbortSignal.timeout(15000),redirect:'error'});
    if(!response.ok)throw Object.assign(new Error(),{code:`CF_HTTP_${response.status}`,retryMs:response.status===429?Math.max(300000,Number(response.headers?.get('Retry-After')||3600)*1000):0});
  }});
  let socket,reconnect,phaseTimer,heartbeat,stopped=false,delay=retryMs;
  const transaction=()=>crypto.randomUUID().replaceAll('-','');
  const send=message=>{if(socket?.readyState===Socket.OPEN)socket.send(JSON.stringify({type:'request',message:{...message,transactionid:transaction()}}))};
  const deadline=phase=>{clearTimeout(phaseTimer);phaseTimer=setTimeout(()=>{log({level:'error',event:'ucm_phase_timeout',phase});socket?.terminate()},phaseMs)};
  function connect(){
    if(stopped)return;let authenticated=false,lastPacket=Date.now();
    socket=new Socket(url,{origin,agent,followRedirects:false,handshakeTimeout:phaseMs});
    socket.on('open',()=>{send({action:'challenge',username:apiUser,version:'1'});deadline('challenge')});
    socket.on('message',data=>{
      try{
        lastPacket=Date.now();const packet=JSON.parse(String(data)),messages=Array.isArray(packet.message)?packet.message:[packet.response||packet.message||packet];
        for(const message of messages){
          const action=String(message.action||'').toLowerCase(),rawStatus=message.status??packet.status,status=rawStatus==null?NaN:Number(rawStatus);
          if(message.challenge){send({action:'login',username:apiUser,token:crypto.createHash('md5').update(message.challenge+apiPassword).digest('hex')});deadline('login');continue}
          if(action==='login'){
            if(status!==0){log({level:'error',event:'ucm_login_rejected',status:Number.isFinite(status)?status:null});socket.terminate();continue}
            authenticated=true;clearTimeout(phaseTimer);log({level:'info',event:'ucm_connected'});
            send({action:'subscribe',eventnames:['CallQueueStatus']});deadline('subscribe');
            clearInterval(heartbeat);heartbeat=setInterval(()=>{if(Date.now()-lastPacket>75000){socket.terminate();return}send({action:'heartbeat'})},heartbeatMs);continue;
          }
          if(action==='subscribe'){
            if(!authenticated)continue;
            clearTimeout(phaseTimer);
            if(status!==0){log({level:'error',event:'ucm_subscription_rejected',status:Number.isFinite(status)?status:null});socket.terminate();continue}
            delay=retryMs;log({level:'info',event:'ucm_queue_subscribed'});continue;
          }
          if(authenticated&&message.eventname==='CallQueueStatus'){
            const events=queueEventsFromStatus({message},states).filter(event=>['login','logout'].includes(event.event_type));
            log({level:'info',event:'ucm_queue_notification',events:events.length});
            if(events.length)outbox.enqueue(events);
          }
        }
      }catch(error){log({level:'error',event:'ucm_message_error',code:safeConnectionError(error)});if(error?.code==='ENOSPC')socket.terminate()}
    });
    socket.on('error',error=>log({level:'error',event:'ucm_socket_error',code:safeConnectionError(error)}));
    socket.on('close',()=>{clearTimeout(phaseTimer);clearInterval(heartbeat);if(stopped)return;log({level:'warn',event:'ucm_disconnected',retry_ms:delay});reconnect=setTimeout(connect,delay);delay=Math.min(60000,delay*2)});
  }
  void outbox.flush();connect();
  return {outbox,stop(){stopped=true;clearTimeout(reconnect);clearTimeout(phaseTimer);clearInterval(heartbeat);outbox.stop();socket?.terminate();agent?.destroy()}};
}
