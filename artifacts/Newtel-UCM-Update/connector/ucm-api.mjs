import crypto from "node:crypto";
import fs from "node:fs";
import https from "node:https";
import {createPinnedUcmAgent} from './ucm-tls.mjs';
import {cdrGroups,flattenCdrPayload} from './ucm-cdr-format.mjs';
export {flattenCdrPayload} from './ucm-cdr-format.mjs';

const md5=value=>crypto.createHash("md5").update(String(value)).digest("hex");
const transaction=()=>crypto.randomUUID().replaceAll("-","");
const parseJson=text=>{try{return JSON.parse(text)}catch{throw new Error("UCM returned invalid JSON")}};
export function parseDigestChallenge(header=""){
  const values={};String(header).replace(/^Digest\s+/i,"").replace(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g,(_m,key,quoted,plain)=>(values[key]=quoted??plain,""));return values;
}
function digestHeader({challenge,method,url,username,password,nc=1}){
  const uri=new URL(url).pathname+new URL(url).search,cnonce=crypto.randomBytes(8).toString("hex"),qop=(challenge.qop||"auth").split(",")[0].trim(),ncText=String(nc).padStart(8,"0"),ha1=md5(`${username}:${challenge.realm}:${password}`),ha2=md5(`${method}:${uri}`),response=qop?md5(`${ha1}:${challenge.nonce}:${ncText}:${cnonce}:${qop}:${ha2}`):md5(`${ha1}:${challenge.nonce}:${ha2}`);return `Digest username="${username}", realm="${challenge.realm}", nonce="${challenge.nonce}", uri="${uri}", response="${response}", algorithm=MD5${qop?`, qop=${qop}, nc=${ncText}, cnonce="${cnonce}"`:""}${challenge.opaque?`, opaque="${challenge.opaque}"`:""}`;
}
export function createNodeTransport({caFile,allowSelfSignedDev=false,pinEndpoint,fingerprint}={}){
  if(allowSelfSignedDev&&process.env.NODE_ENV==="production")throw new Error("Self-signed TLS bypass is forbidden in production");
  const ca=caFile?fs.readFileSync(caFile):undefined;
  const agent=fingerprint?createPinnedUcmAgent(pinEndpoint,fingerprint):undefined;
  const once=({url,method="GET",headers={},body})=>new Promise((resolve,reject)=>{const target=new URL(url),request=https.request(target,{method,headers,agent,ca,rejectUnauthorized:!allowSelfSignedDev},response=>{const chunks=[];response.on("data",chunk=>chunks.push(chunk));response.on("error",reject);response.on("end",()=>resolve({status:response.statusCode||0,headers:response.headers,text:Buffer.concat(chunks).toString("utf8")}))});request.setTimeout(20000,()=>request.destroy(Object.assign(new Error('UCM request timed out'),{code:'UCM_API_TIMEOUT'})));request.on("error",reject);if(body)request.write(body);request.end()});
  return async options=>{let response=await once(options);if(response.status===401&&options.digest){const challenge=parseDigestChallenge(response.headers["www-authenticate"]);if(!challenge.nonce)throw new Error("UCM digest challenge is missing");response=await once({...options,headers:{...(options.headers||{}),Authorization:digestHeader({challenge,method:options.method||"GET",url:options.url,...options.digest})}})}return response};
}
export function queueEventsFromStatus(packet,states=new Map(),occurredAt=new Date().toISOString()){
  const messages=Array.isArray(packet?.message)?packet.message:[packet?.message||packet],events=[];
  for(const message of messages){
    if(message?.eventname!=="CallQueueStatus")continue;
    for(const queue of message.eventbody||[])for(const member of queue.member||[]){
      const queueName=String(queue.extension||""),extension=String(member.member_extension||"");if(!extension||!queueName)continue;
      const key=`${queueName}|${extension}`,previous=states.get(key)||{logged:null,paused:null,login_at:null};
      // Partial notifications must not turn an omitted login field into a logout.
      const hasLogin=Object.hasOwn(member,'logintime'),stamp=String(member.logintime||''),valid=/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(stamp)&&Number.isFinite(Date.parse(stamp));
      const logged=hasLogin?(valid?true:stamp==='--'?false:null):previous.logged,login_at=logged===true?(hasLogin?stamp:previous.login_at):null;
      const paused=member.status==null?previous.paused:String(member.status).toLowerCase()==='paused';
      if(logged===true&&(previous.logged!==true||previous.login_at!==login_at))events.push({event_id:`${key}|login|${login_at}`,event_type:'login',agent_extension:extension,queue_name:queueName,occurred_at:login_at});
      if(paused&&!previous.paused)events.push({event_id:`${key}|pause|${member.pausetime||occurredAt}`,event_type:'pause',agent_extension:extension,queue_name:queueName,reason:member.pause_reason||null,occurred_at:member.pausetime||occurredAt});
      if(!paused&&previous.paused)events.push({event_id:`${key}|unpause|${occurredAt}`,event_type:'unpause',agent_extension:extension,queue_name:queueName,occurred_at:occurredAt});
      if(logged===false&&previous.logged===true)events.push({event_id:`${key}|logout|${occurredAt}`,event_type:'logout',agent_extension:extension,queue_name:queueName,occurred_at:occurredAt});
      states.set(key,{logged,paused,login_at,last_checked_at:occurredAt,extension,queue:queueName,membership:String(member.membership??previous.membership??'unknown').slice(0,20),login_required:queue.enable_agent_login==='yes'?true:queue.enable_agent_login==='no'?false:previous.login_required??null});
    }
  }
  return events;
}
export class UcmClient{
  constructor({apiBaseUrl,cdrBaseUrl,username,password,cdrUsername=username,cdrPassword=password,cdrMode="auto",transport}){this.apiBaseUrl=String(apiBaseUrl||"").replace(/\/$/,"");this.cdrBaseUrl=String(cdrBaseUrl||"").replace(/\/$/,"");this.username=username;this.password=password;this.cdrUsername=cdrUsername;this.cdrPassword=cdrPassword;this.cdrMode=cdrMode;this.transport=transport;this.cookie="";this.lastCdrMode=null}
  async api(body){const response=await this.transport({url:`${this.apiBaseUrl}/api`,method:"POST",headers:{"Content-Type":"application/json;charset=UTF-8",...(this.cookie?{Cookie:this.cookie}:{})},body:JSON.stringify({request:body})});if(response.status>=400)throw new Error(`UCM API returned ${response.status}`);return parseJson(response.text)}
  async login(){const challengeResult=await this.api({action:"challenge",user:this.username,version:"1.0"}),challenge=challengeResult?.response?.challenge;if(!challenge)throw new Error("UCM challenge was not returned");const token=md5(challenge+this.password),loginResult=await this.api({action:"login",user:this.username,token,transactionid:transaction()});if(Number(loginResult?.status)!==0)throw new Error(`UCM login failed (${loginResult?.status??"unknown"})`);this.cookie=loginResult?.response?.cookie||loginResult?.cookie||"";return {cookie:this.cookie}}
  async authenticatedApi(body){if(!this.cookie)await this.login();try{return await this.api({...body,cookie:body.cookie||this.cookie})}catch(error){if(!/401/.test(error.message))throw error;this.cookie="";await this.login();return this.api({...body,cookie:this.cookie})}}
  async legacyCdrPage({start,end,offset=0,limit=1000}){if(!this.cdrBaseUrl)throw new Error("Legacy CDR URL is not configured");const url=new URL(`${this.cdrBaseUrl}/cdrapi`);url.searchParams.set("format","JSON");url.searchParams.set("startTime",start);url.searchParams.set("endTime",end);url.searchParams.set("numRecords",String(Math.min(1000,limit)));url.searchParams.set("offset",String(offset));const response=await this.transport({url:url.href,method:"GET",digest:{username:this.cdrUsername,password:this.cdrPassword}});if(response.status>=400)throw new Error(`Legacy CDR API returned ${response.status}`);this.lastCdrMode="legacy";const payload=parseJson(response.text);this.lastCdrPageCount=cdrGroups(payload).length;return flattenCdrPayload(payload)}
  async sessionCdrPage({start,end,offset=0,limit=1000}){const result=await this.authenticatedApi({action:"cdrapi",format:"json",startTime:start,endTime:end,numRecords:Math.min(1000,limit),offset});if(result?.status!=null&&Number(result.status)!==0)throw new Error(`UCM CDR API rejected (${result.status})`);this.lastCdrMode="session";this.lastCdrPageCount=cdrGroups(result).length;return flattenCdrPayload(result)}
  async cdrPage(options){if(this.cdrMode==="legacy")return this.legacyCdrPage(options);if(this.cdrMode==="session")return this.sessionCdrPage(options);try{return await this.legacyCdrPage(options)}catch(error){if(!/Legacy CDR|fetch|connect|ECONN|timeout|certificate|TLS/i.test(error.message))throw error;return this.sessionCdrPage(options)}}
}
export async function backfillCdr({client,start,end,sendBatch,pageSize=1000,batchSize=100,onProgress=()=>{}}){let offset=0,total=0,previous=null;for(;;){const rows=await client.cdrPage({start,end,offset,limit:pageSize});const hash=crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex');if(offset&&rows.length&&hash===previous)throw Object.assign(new Error('UCM ignored CDR pagination'),{code:'UCM_CDR_PAGINATION_STALLED'});previous=hash;for(let index=0;index<rows.length;index+=batchSize)await sendBatch(rows.slice(index,index+batchSize));total+=rows.length;onProgress({offset,received:rows.length,total});const groups=Number.isFinite(client.lastCdrPageCount)?client.lastCdrPageCount:rows.length;if(Math.max(groups,rows.length)<pageSize)break;offset+=groups;if(offset>1000000)throw new Error('UCM_CDR_PAGE_LIMIT')}return total}
