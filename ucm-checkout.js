import {loadUcmMappings} from './ucm-mapping.js';

// Attendance checkout is server-enforced; a browser cannot assert PBX logout.
export async function verifyQueueLogout(db,username,now=Date.now()){
  const [{mappings},state]=await Promise.all([loadUcmMappings(db),db.prepare("SELECT value FROM ucm_sync_state WHERE key='queue-live'").first()]);
  const extensions=mappings.filter(row=>row.username===username).map(row=>row.extension);
  const unavailable={ok:false,code:'UCM_QUEUE_STATUS_UNAVAILABLE',message:'Cannot verify your queue logout. You remain checked in. Keep the UCM connector running and try again once live status is available.'};
  if(!extensions.length)return {...unavailable,message:'Your UCM extension is not linked. You remain checked in. Contact HR to review the extension mapping.'};
  let snapshot;try{snapshot=JSON.parse(state?.value||'null')}catch{return unavailable}
  const stamp=Date.parse(snapshot?.observed_at);
  if(!Number.isFinite(stamp)||now-stamp>180000||stamp-now>30000||!Array.isArray(snapshot?.members))return unavailable;
  const members=snapshot.members.filter(row=>extensions.includes(row.extension));
  const logged=members.filter(row=>row.logged_in===true);
  if(logged.length){const queues=[...new Set(logged.map(row=>String(row.queue)))];return {ok:false,code:'UCM_QUEUE_LOGGED_IN',queues,message:`You are still logged in to queue(s) ${queues.join(', ')}. Log out of every call queue in Wave, then try Check out again. You remain checked in.`}}
  if(extensions.some(extension=>!members.some(row=>row.extension===extension))||members.some(row=>row.logged_in!==false))return unavailable;
  return {ok:true};
}
