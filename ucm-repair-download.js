import {ucmBodyHash} from './ucm-ingest-auth.js';
const hidden=()=>new Response('Not found',{status:404,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
// Short-lived capability download. The credential-bearing archive is a Worker
// secret, never repository content. Its URL must be treated as private.
export async function ucmRepairDownload(request,env,now=Date.now()){
  if(request.method!=='GET'||!env.UCM_REPAIR_DOWNLOAD)return hidden();
  try{
    const token=new URL(request.url).searchParams.get('token')||'',bundle=JSON.parse(env.UCM_REPAIR_DOWNLOAD);
    if(!/^[a-f0-9]{64}$/.test(token)||! /^[a-f0-9]{64}$/.test(bundle.token_hash||''))return hidden();
    if(!Number.isFinite(bundle.created_at)||!Number.isFinite(bundle.expires_at)||now<bundle.created_at||now>=bundle.expires_at||bundle.expires_at-bundle.created_at>3600000)return hidden();
    const hash=await ucmBodyHash(token);let different=0;for(let i=0;i<64;i++)different|=hash.charCodeAt(i)^bundle.token_hash.charCodeAt(i);if(different)return hidden();
    const data=atob(bundle.zip_base64);if(data.length>100000||!data.startsWith('PK'))return hidden();
    return new Response(Uint8Array.from(data,c=>c.charCodeAt(0)),{headers:{'Content-Type':'application/zip','Content-Disposition':'attachment; filename="Newtel-UCM-Receiver-Fix.zip"','Cache-Control':'private, no-store, max-age=0','Referrer-Policy':'no-referrer','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'}});
  }catch{return hidden()}
}
