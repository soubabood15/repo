import fs from 'node:fs';
import path from 'node:path';
import {UcmClient,backfillCdr,createNodeTransport} from './ucm-api.mjs';
import {connectorHeaders} from './ucm-queue-runtime.mjs';

const localTime=now=>new Date(now+3*3600000).toISOString().slice(0,19);
export function recentDays(now=Date.now()){
  const today=localTime(now).slice(0,10),date=new Date(today+'T00:00:00Z');
  date.setUTCDate(1);date.setUTCMonth(date.getUTCMonth()-1);
  const days=[];while(date.toISOString().slice(0,10)<today){days.push(date.toISOString().slice(0,10));date.setUTCDate(date.getUTCDate()+1)}
  return days;
}
export function monthDays(month){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw new Error('INVALID_MONTH');
  const days=[],date=new Date(month+'-01T00:00:00Z');
  while(date.toISOString().startsWith(month)){days.push(date.toISOString().slice(0,10));date.setUTCDate(date.getUTCDate()+1)}return days;
}
export function startCdrSync(config,{fetcher=fetch,log=value=>console.log(JSON.stringify(value)),now=Date.now,intervalMs=300000,client}={}){
  const api=config.UCM_API_BASE_URL||new URL(config.UCM_WS_URL).origin.replace('wss:','https:');
  const receiver=new URL(config.CLOUDFLARE_QUEUE_ENDPOINT);
  const endpoint=config.CLOUDFLARE_CDR_ENDPOINT||receiver.origin+'/integrations/ucm/cdr';
  if(new URL(endpoint).protocol!=='https:'||new URL(endpoint).origin!==receiver.origin)throw new Error('INVALID_CDR_RECEIVER');
  const jobs=receiver.origin+'/integrations/ucm/history-jobs';
  const file=config.UCM_CDR_STATE_FILE||path.join(path.dirname(config.UCM_OUTBOX_FILE),'cdr-sync.json');
  let state={days:{},last:null},stopped=false,timer,busy=false,retryAfter=0;
  if(fs.existsSync(file)){state=JSON.parse(fs.readFileSync(file,'utf8'));if(!state.days||typeof state.days!=='object')throw new Error('INVALID_CDR_SYNC_STATE')}
  const save=()=>{fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(state),{mode:0o600});fs.renameSync(file+'.tmp',file)};
  client||=new UcmClient({apiBaseUrl:api,cdrBaseUrl:config.UCM_CDR_BASE_URL||'',cdrMode:config.UCM_CDR_MODE||'session',username:config.UCM_API_USERNAME,password:config.UCM_API_PASSWORD,transport:createNodeTransport({caFile:config.UCM_CA_FILE,pinEndpoint:api,fingerprint:config.UCM_TLS_FINGERPRINT_SHA256})});
  const post=async(url,payload,signed=false)=>{
    const options=signed?connectorHeaders(payload,config.UCM_INGEST_USERNAME,config.UCM_INGEST_PASSWORD):{headers:{Authorization:'Basic '+Buffer.from(config.UCM_INGEST_USERNAME+':'+config.UCM_INGEST_PASSWORD).toString('base64'),'Content-Type':'application/json'},body:JSON.stringify(payload)};
    const response=await fetcher(url,{method:'POST',...options,signal:AbortSignal.timeout(60000),redirect:'error'});
    if(!response.ok)throw Object.assign(new Error('Receiver rejected CDR synchronization'),{code:'CF_HTTP_'+response.status,retryMs:response.status===429?Math.max(300000,Number(response.headers?.get('Retry-After')||3600)*1000):0});return response.json();
  };
  const range=async(start,end)=>backfillCdr({client,start,end,sendBatch:records=>post(endpoint,{records}),onProgress:progress=>log({level:'info',event:'ucm_cdr_sync_progress',start,end,...progress})});
  const day=async value=>{if(state.days[value])return;const end=new Date(value+'T00:00:00Z');end.setUTCDate(end.getUTCDate()+1);await range(value+'T00:00:00',end.toISOString().slice(0,10)+'T00:00:00');state.days[value]=true;save()};
  async function tick(){
    if(stopped||busy)return;clearTimeout(timer);busy=true;
    retryAfter=0;
    try{
      const end=localTime(now()),today=end.slice(0,10);
      const recent=recentDays(now()),previous=recent[0].slice(0,7),month=today.slice(0,7);
      if(state.windowMonth!==month){
        state.days=Object.fromEntries(Object.entries(state.days).filter(([value])=>value>=recent[0]));state.windowMonth=month;save();
      }
      if(state.syncDay!==today){
        // Daily, not per-minute. Re-read two days for overnight/late-ending calls.
        const fromDate=new Date(today+'T00:00:00Z');fromDate.setUTCDate(fromDate.getUTCDate()-2);
        await range(fromDate.toISOString().slice(0,10)+'T00:00:00',end);state.last=end;save();
        await post(jobs,{action:'daily-complete',previous},true);
        state.syncDay=today;save();
        log({level:'info',event:'ucm_cdr_daily_complete',through:end,previous_month:previous});
      }
      const pending=await post(jobs,{action:'list'},true);
      const requestedDay=pending.days?.[0];
      if(requestedDay){await day(requestedDay);await post(jobs,{action:'complete',day:requestedDay},true)}
      // Historical months are uploaded by the administrator in KPI Analyzer.
      // Legacy whole-month requests must not restart a bulk backfill.
    }catch(error){retryAfter=error.retryMs||0;log({level:'error',event:'ucm_cdr_sync_failed',code:error.code||'CDR_SYNC_FAILED'});client.cookie=''}
    finally{busy=false;if(!stopped)timer=setTimeout(tick,Math.max(intervalMs,retryAfter))}
  }
  timer=setTimeout(tick,0);
  return {tick,stop(){stopped=true;clearTimeout(timer)}};
}
