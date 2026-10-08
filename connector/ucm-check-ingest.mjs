// Read-only receiver authentication probe. Never prints secrets or sends events.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const file=process.argv[2]||path.join(process.env.ProgramData||'C:\\ProgramData','Newtel','UcmConnector','ucm.env');
try{
  const config={};
  for(const line of fs.readFileSync(file,'utf8').split(/\r?\n/)){
    const value=line.trim();if(!value||value.startsWith('#'))continue;
    const separator=value.indexOf('=');if(separator<1)throw Object.assign(new Error(),{code:'INVALID_ENV_LINE'});
    config[value.slice(0,separator).trim()]=value.slice(separator+1).trim();
  }
  if(!config.UCM_INGEST_USERNAME||!config.UCM_INGEST_PASSWORD||!config.CLOUDFLARE_QUEUE_ENDPOINT)throw Object.assign(new Error(),{code:'INGEST_SETTINGS_MISSING'});
  const endpoint=new URL(config.CLOUDFLARE_QUEUE_ENDPOINT);
  if(endpoint.protocol!=='https:'||endpoint.username||endpoint.password||endpoint.pathname!=='/integrations/ucm/queue-events')throw Object.assign(new Error(),{code:'INGEST_ENDPOINT_INVALID'});
  endpoint.pathname='/integrations/ucm/check';endpoint.search='';endpoint.hash='';
  const body=JSON.stringify({probe:'queue-auth-check'}),timestamp=String(Date.now()),nonce=crypto.randomUUID();
  const signature=crypto.createHmac('sha256',config.UCM_INGEST_PASSWORD).update(`${timestamp}.${nonce}.${body}`).digest('hex');
  const response=await fetch(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:'Basic '+Buffer.from(`${config.UCM_INGEST_USERNAME}:${config.UCM_INGEST_PASSWORD}`).toString('base64'),'Content-Type':'application/json','X-UCM-Timestamp':timestamp,'X-UCM-Nonce':nonce,'X-UCM-Signature':signature},body});
  const payload=await response.json(),allowed=new Set(['INGEST_AUTH_OK','INGEST_CREDENTIALS_REJECTED','DELIVERY_TIMESTAMP_REJECTED','DELIVERY_HEADERS_REJECTED','DELIVERY_SIGNATURE_REJECTED','INGEST_AUTH_REJECTED']);
  console.log(JSON.stringify({result:allowed.has(payload.result)?payload.result:'UNEXPECTED_RECEIVER_RESPONSE',status:response.status}));
}catch(error){const code=error?.cause?.code||error?.code;console.log(JSON.stringify({result:'PROBE_FAILED',code:/^[A-Z0-9_]+$/.test(code||'')?code:'NETWORK_OR_CONFIGURATION_ERROR'}));process.exitCode=1}
