import crypto from "node:crypto";
import {queueEventsFromStatus} from "./ucm-api.mjs";

const required=name=>{const value=process.env[name];if(!value)throw new Error(`${name} is required`);return value};
const UCM_WS_URL=required("UCM_WS_URL"),UCM_API_USERNAME=required("UCM_API_USERNAME"),UCM_API_PASSWORD=required("UCM_API_PASSWORD"),CLOUDFLARE_QUEUE_ENDPOINT=required("CLOUDFLARE_QUEUE_ENDPOINT"),UCM_INGEST_USERNAME=required("UCM_INGEST_USERNAME"),UCM_INGEST_PASSWORD=required("UCM_INGEST_PASSWORD");
const RETRY_MAX_MS=60000;let retryMs=1000,heartbeat=null,ws=null,pending=[];const queueStates=new Map();
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const transaction=()=>crypto.randomUUID().replaceAll("-","");
const send=message=>ws?.readyState===WebSocket.OPEN&&ws.send(JSON.stringify({type:"request",message}));
async function forward(event){
  const response=await fetch(CLOUDFLARE_QUEUE_ENDPOINT,{method:"POST",headers:{Authorization:`Basic ${Buffer.from(`${UCM_INGEST_USERNAME}:${UCM_INGEST_PASSWORD}`).toString("base64")}`,"Content-Type":"application/json"},body:JSON.stringify(event)});
  if(!response.ok)throw new Error(`Cloudflare ingest returned ${response.status}`);
}
function queueEvent(message){
  const source=message?.event||message?.message||message||{},name=String(source.event_type||source.event||source.action||"").toLowerCase();
  if(!/(queue.*login|queue.*logout|pause|unpause|resume)/.test(name))return null;
  return {event_id:source.event_id||source.id||transaction(),event_type:name,agent_extension:source.agent_extension||source.extension||source.agent||source.member,queue_name:source.queue_name||source.queue||source.queue_extension,reason:source.reason||source.pause_reason,occurred_at:source.occurred_at||source.timestamp||new Date().toISOString()};
}
async function flush(){while(pending.length){try{await forward(pending[0]);pending.shift()}catch(error){console.error(JSON.stringify({level:"error",event:"cloudflare_forward_failed",message:error.message,queued:pending.length}));return}}}
function connect(){
  ws=new WebSocket(UCM_WS_URL);let challenge="";
  ws.addEventListener("open",()=>send({action:"challenge",username:UCM_API_USERNAME,version:"1",transactionid:transaction()}));
  ws.addEventListener("message",async({data})=>{try{const packet=JSON.parse(String(data)),message=packet.response||packet.message||packet;if(message.challenge){challenge=message.challenge;const token=crypto.createHash("md5").update(challenge+UCM_API_PASSWORD).digest("hex");send({action:"login",username:UCM_API_USERNAME,token,transactionid:transaction()});return}if(String(message.action).toLowerCase()==="login"&&String(message.status??packet.status)==="0"){retryMs=1000;clearInterval(heartbeat);heartbeat=setInterval(()=>send({action:"heartbeat",transactionid:transaction()}),25000);send({action:"subscribe",eventnames:["CallQueueStatus"],transactionid:transaction()});console.log(JSON.stringify({level:"info",event:"ucm_connected"}));return}const events=queueEventsFromStatus(packet,queueStates),direct=queueEvent(packet);if(direct?.agent_extension)events.push(direct);if(events.length){pending.push(...events);await flush()}}catch(error){console.error(JSON.stringify({level:"error",event:"ucm_message_error",message:error.message}))}});
  ws.addEventListener("close",async()=>{clearInterval(heartbeat);console.warn(JSON.stringify({level:"warn",event:"ucm_disconnected",retry_ms:retryMs}));await sleep(retryMs);retryMs=Math.min(RETRY_MAX_MS,retryMs*2);connect()});
  ws.addEventListener("error",event=>{console.error(JSON.stringify({level:"error",event:"ucm_socket_error",message:String(event?.error?.message||event?.message||"WebSocket connection failed")}));ws.close()});
}
connect();
