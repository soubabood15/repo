import {loadUcmMappings} from './ucm-mapping.js';

// Only a fresh connector snapshot can authorize undoing an accidental checkout.
// Browser login and Wave registration are not call-queue presence.
export async function verifyQueueRecheckin(db,username,now=Date.now()){
  const [{mappings},state]=await Promise.all([loadUcmMappings(db),db.prepare("SELECT value FROM ucm_sync_state WHERE key='queue-live'").first()]);
  const extensions=mappings.filter(row=>row.username===username).map(row=>row.extension);
  const unavailable={ok:false,code:'UCM_QUEUE_STATUS_UNAVAILABLE',message:'Live queue status is unavailable. Keep the connector running and try again. Your check-out has not been changed.'};
  if(!extensions.length)return {...unavailable,message:'Your UCM extension is not linked. Contact HR. Your check-out has not been changed.'};
  let snapshot;try{snapshot=JSON.parse(state?.value||'null')}catch{return unavailable}
  const stamp=Date.parse(snapshot?.observed_at);
  if(!Number.isFinite(stamp)||now-stamp>180000||stamp-now>30000||!Array.isArray(snapshot?.members))return unavailable;
  const members=snapshot.members.filter(row=>extensions.includes(row.extension)),logged=members.filter(row=>row.logged_in===true);
  if(!logged.length)return {ok:false,code:'UCM_QUEUE_LOGIN_REQUIRED',message:'Log in to a call queue before checking in again. Your check-out has not been changed.'};
  if(logged.some(row=>row.paused===true))return {ok:false,code:'UCM_QUEUE_PAUSED',message:'You are paused. Unpause your call queues before checking in again. Your check-out has not been changed.'};
  if(logged.some(row=>row.paused!==false)||members.some(row=>typeof row.logged_in!=='boolean'))return unavailable;
  return {ok:true,observed_at:snapshot.observed_at,queues:[...new Set(logged.map(row=>String(row.queue)))],extensions:[...new Set(logged.map(row=>row.extension))]};
}
