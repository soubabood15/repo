import {UcmClient,backfillCdr,createNodeTransport} from './ucm-api.mjs';
import {connectorHeaders} from './ucm-queue-runtime.mjs';
import {createDaySummary} from './ucm-day-summary.mjs';
import fs from 'node:fs';
import path from 'node:path';
export function startDaySync(config,{fetcher=fetch,log=value=>console.log(JSON.stringify(value)),intervalMs=30000,client}={}){
  const api=config.UCM_API_BASE_URL||new URL(config.UCM_WS_URL).origin.replace('wss:','https:'),endpoint=new URL('/integrations/ucm/day-jobs',config.CLOUDFLARE_QUEUE_ENDPOINT).href;
  client||=new UcmClient({apiBaseUrl:api,cdrMode:config.UCM_CDR_MODE||'session',cdrBaseUrl:config.UCM_CDR_BASE_URL||'',username:config.UCM_API_USERNAME,password:config.UCM_API_PASSWORD,transport:createNodeTransport({caFile:config.UCM_CA_FILE,pinEndpoint:api,fingerprint:config.UCM_TLS_FINGERPRINT_SHA256})});
  const file=config.UCM_DAY_PENDING_FILE||(config.UCM_OUTBOX_FILE?path.join(path.dirname(config.UCM_OUTBOX_FILE),'day-summary-pending.json'):null);
  let stopped=false,busy=false,timer,retryAt=0,pendingUpload=file&&fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;
  const save=()=>{if(!file)return;fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(pendingUpload),{mode:0o600});fs.renameSync(file+'.tmp',file)};
  const post=async payload=>{const response=await fetcher(endpoint,{method:'POST',...connectorHeaders(payload,config.UCM_INGEST_USERNAME,config.UCM_INGEST_PASSWORD),signal:AbortSignal.timeout(60000),redirect:'error'});if(!response.ok)throw Object.assign(Error('DAY_RECEIVER_ERROR'),{code:'CF_HTTP_'+response.status,retryMs:response.status===429?Math.max(300000,Number(response.headers.get('Retry-After')||3600)*1000):60000});return response.json()};
  async function tick(){
    if(stopped||busy||Date.now()<retryAt)return;clearTimeout(timer);busy=true;
    try{
      if(pendingUpload){try{await post(pendingUpload)}catch(error){if(error.code!=='CF_HTTP_409')throw error;log({level:'info',event:'ucm_day_upload_superseded',day:pendingUpload.day})}pendingUpload=null;save()}
      const {job}=await post({action:'claim'});if(!job)return;
      try{
        const summary=createDaySummary(job.day,{extensions:job.extensions}),end=new Date(Date.parse(job.day+'T00:00:00Z')+86400000).toISOString().slice(0,10)+'T00:00:00';
        log({level:'info',event:'ucm_day_import_started',day:job.day});
        await backfillCdr({client,start:job.day+'T00:00:00',end,sendBatch:rows=>{if(stopped)throw Error('CONNECTOR_STOPPED');summary.add(rows)},onProgress:value=>log({level:'info',event:'ucm_day_import_progress',day:job.day,...value})});
        pendingUpload={action:'complete',...job,summary:summary.finish()};save();await post(pendingUpload);pendingUpload=null;save();
        log({level:'info',event:'ucm_day_import_complete',day:job.day});
      }catch(error){
        if(!pendingUpload){await post({action:'failed',...job});client.cookie=''}throw error;
      }
    }catch(error){retryAt=Date.now()+(error.retryMs||60000);log({level:'warn',event:'ucm_day_import_failed',code:error.code||'UCM_DAY_READ_FAILED'})}
    finally{busy=false;if(!stopped)timer=setTimeout(tick,Math.max(intervalMs,retryAt-Date.now()))}
  }
  timer=setTimeout(tick,10000);
  return {tick,stop(){stopped=true;clearTimeout(timer)}};
}
