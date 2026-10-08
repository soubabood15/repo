const encoder=new TextEncoder();
const hex=bytes=>[...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join('');
export async function ucmBodyHash(body){return hex(await crypto.subtle.digest('SHA-256',encoder.encode(body)))}
export async function ucmSignature(secret,value){const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign']);return hex(await crypto.subtle.sign('HMAC',key,encoder.encode(value)))}
function equal(a,b){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0}
export async function authorizeUcmIngest(request,env,body,kind,now=Date.now(),{claimNonce=true}={}){
  const auth=request.headers.get('Authorization')||'';let basic=false;
  if(auth.startsWith('Basic ')&&env.UCM_INGEST_USERNAME&&env.UCM_INGEST_PASSWORD){try{const value=atob(auth.slice(6)),separator=value.indexOf(':');basic=separator>=0&&equal(value.slice(0,separator),env.UCM_INGEST_USERNAME)&&equal(value.slice(separator+1),env.UCM_INGEST_PASSWORD)}catch{}}
  const timestamp=request.headers.get('X-UCM-Timestamp')||'',nonce=request.headers.get('X-UCM-Nonce')||'',signature=(request.headers.get('X-UCM-Signature')||'').replace(/^sha256=/,'');
  // Native CDR output supports Basic, while our connector supports nonce HMAC.
  if(kind==='cdr'&&basic)return {ok:true};
  if(kind==='queue'&&!basic)return {ok:false,status:401,reason:'INGEST_CREDENTIALS_REJECTED'};
  if(!/^\d{13}$/.test(timestamp)||Math.abs(now-Number(timestamp))>300000)return {ok:false,status:401,reason:'DELIVERY_TIMESTAMP_REJECTED'};
  if(!/^\w[\w-]{15,127}$/.test(nonce)||! /^[a-f0-9]{64}$/.test(signature))return {ok:false,status:401,reason:'DELIVERY_HEADERS_REJECTED'};
  const secret=kind==='queue'&&basic?env.UCM_INGEST_PASSWORD:env.UCM_WEBHOOK_SECRET;
  if(!secret||(kind==='queue'&&!basic))return {ok:false,status:401};
  if(!equal(signature,await ucmSignature(secret,`${timestamp}.${nonce}.${body}`)))return {ok:false,status:401,reason:'DELIVERY_SIGNATURE_REJECTED'};
  if(!claimNonce)return {ok:true};
  const receipt=await env.trainer_kb.prepare('INSERT INTO ucm_ingest_receipts(receipt_id,expires_at) VALUES(?,?) ON CONFLICT DO NOTHING RETURNING receipt_id').bind(`nonce:${kind}:${nonce}`,new Date(now+600000).toISOString()).first();
  return receipt?{ok:true}:{ok:false,status:409};
}
