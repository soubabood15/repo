// One atomic coordination row, never call records or KPI results.
const key='ucm-day-request-lock';
const ttl=15*60000;
export const busyDayRequest={code:409,error:'UCM_REQUEST_BUSY',message:'Another UCM day request is loading. Only one request is allowed at a time. Wait for it to finish, then try again.'};
export async function reserveDayRequest(db,{request_id,owner,day}){
  const now=Date.now(),value=JSON.stringify({request_id,owner,day,expires_at:now+ttl});
  const reserved=await db.prepare("INSERT INTO ucm_sync_state(key,value,status,updated_at) VALUES(?,?,'pending',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,status='pending',updated_at=excluded.updated_at WHERE ucm_sync_state.status='idle' OR COALESCE(json_extract(ucm_sync_state.value,'$.expires_at'),0)<=? RETURNING value").bind(key,value,new Date(now).toISOString(),now).first();
  if(reserved)return true;
  const existing=await db.prepare('SELECT value FROM ucm_sync_state WHERE key=?').bind(key).first();
  if(!existing)return false;
  const slot=JSON.parse(existing.value);
  return slot.request_id===request_id&&slot.owner===owner;
}
export async function claimDayRequest(db){
  const now=Date.now();
  const claimed=await db.prepare("UPDATE ucm_sync_state SET status='running',updated_at=? WHERE key=? AND status='pending' AND json_extract(value,'$.expires_at')>? RETURNING value").bind(new Date(now).toISOString(),key,now).first();
  return claimed?JSON.parse(claimed.value):null;
}
export async function finishDayRequest(db,request_id){
  await db.prepare("UPDATE ucm_sync_state SET value='{}',status='idle',updated_at=? WHERE key=? AND json_extract(value,'$.request_id')=? AND status IN ('pending','running')").bind(new Date().toISOString(),key,request_id).run();
}
