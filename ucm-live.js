import {authorizeUcmIngest,ucmBodyHash} from './ucm-ingest-auth.js';
import {ucmTimestamp,ammanDateKey} from './ucm-core.js';
import {recordFirstQueueLogin} from './ucm-hr-attendance.js';
import {loadUcmMappings} from './ucm-mapping.js';
import {invalidateUcmPresence} from './ucm-presence.js';

const cache=new WeakMap();
export function normalizeLiveSnapshot(input,now=Date.now()){
  const stamp=Date.parse(input?.observed_at);
  if(!Number.isFinite(stamp)||Math.abs(now-stamp)>120000||!Array.isArray(input.members)||input.members.length>1000)throw new Error('Invalid or expired queue snapshot');
  const seen=new Set();
  const members=input.members.map(item=>{
    const extension=String(item.extension||''),queue=String(item.queue||''),key=`${queue}|${extension}`;
    if(!/^\d{2,10}$/.test(extension)||!/^\d{1,10}$/.test(queue)||seen.has(key)||![true,false,null].includes(item.logged_in))throw new Error('Invalid queue member');seen.add(key);
    let login_at=null;
    if(item.logged_in===true){
      if(!/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(String(item.login_at||'')))throw new Error('Queue login timestamp required');
      login_at=ucmTimestamp(item.login_at,null);
      if(!login_at||!Number.isFinite(Date.parse(login_at))||Date.parse(login_at)>now+60000)throw new Error('Invalid queue login timestamp');
    }
    const checked=Date.parse(item.last_checked_at),last_checked_at=Number.isFinite(checked)&&checked<=stamp+60000?new Date(checked).toISOString():null;
    return {extension,queue,logged_in:item.logged_in,login_at,paused:[true,false].includes(item.paused)?item.paused:null,last_checked_at,membership:String(item.membership||'unknown').slice(0,20),login_required:[true,false].includes(item.login_required)?item.login_required:null};
  }).sort((a,b)=>`${a.queue}|${a.extension}`.localeCompare(`${b.queue}|${b.extension}`));
  const pauses=(Array.isArray(input.pauses)?input.pauses:[]).slice(0,1000).map(p=>{
    if(!/^\d{2,10}$/.test(String(p.extension))||!/^\d{4}-\d{2}-\d{2}$/.test(p.day)||!Number.isFinite(p.seconds)||p.seconds<0||p.seconds>86400)throw new Error('Invalid pause summary');
    return {extension:String(p.extension),day:p.day,seconds:Math.floor(p.seconds),coverage:'observed_only'};
  });
  return {observed_at:new Date(stamp).toISOString(),members,pauses};
}
export function createUcmLiveHandler({json,requireAdmin,getShift}){
  return async function live(request,env){
    const db=env.trainer_kb,origin=request.headers.get('Origin')||'*';
    if(request.method==='POST'){
      const body=await request.text();if(body.length>160000)return json({message:'Snapshot too large'},413,{},origin);
      // Signed snapshots are monotonic and idempotent. Replaying a signed packet
      // cannot refresh its timestamp, so heartbeats need no nonce write per tick.
      const auth=await authorizeUcmIngest(request,env,body,'queue',Date.now(),{claimNonce:false});
      if(!auth.ok)return json({message:'Connector authentication required'},auth.status,{},origin);
      let snapshot;try{snapshot=normalizeLiveSnapshot(JSON.parse(body))}catch{return json({message:'Invalid or expired queue snapshot'},400,{},origin)}
      const saved=await db.prepare("INSERT INTO ucm_sync_state(key,value,status,updated_at) VALUES('queue-live',?,'ok',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,status=excluded.status,updated_at=excluded.updated_at WHERE ucm_sync_state.updated_at<excluded.updated_at RETURNING key").bind(JSON.stringify(snapshot),snapshot.observed_at).first();
      if(!saved)return json({ok:true,duplicate:true},202,{},origin);
      cache.delete(db);
      invalidateUcmPresence(db);
      // Reconcile genuine UCM login timestamps, including already-logged-in
      // members after a connector restart or an explicit extension mapping.
      const {mappings}=await loadUcmMappings(db),users=new Map(mappings.map(row=>[row.extension,row.username]));
      const earliest=new Map();for(const member of snapshot.members){const username=users.get(member.extension);if(!username||member.logged_in!==true)continue;const key=`${username}|${ammanDateKey(member.login_at)}`,prior=earliest.get(key);if(!prior||member.login_at<prior.member.login_at)earliest.set(key,{username,member})}
      for(const {username,member} of earliest.values())await recordFirstQueueLogin(db,{event_type:'login',agent_extension:member.extension,queue_name:member.queue,occurred_at:member.login_at},username,(user,day)=>getShift(env,user,day));
      return json({ok:true,members:snapshot.members.length},202,{'Cache-Control':'no-store'},origin);
    }
    if(!(await requireAdmin(request,env)))return json({message:'Administrator access required'},403,{},origin);
    // Share one short cache across viewers; authorization still happens first.
    let stored=cache.get(db);
    if(!stored||Date.now()-stored.at>=5000){
      const [state,people]=await Promise.all([
        db.prepare("SELECT value,updated_at FROM ucm_sync_state WHERE key='queue-live'").first(),
        loadUcmMappings(db)
      ]);
      stored={at:Date.now(),state,mappings:people.mappings,employees:people.employees};cache.set(db,stored);
    }
    let snapshot=null;try{snapshot=JSON.parse(stored.state?.value||'null')}catch{}
    const stale=!snapshot||Date.now()-Date.parse(snapshot.observed_at)>180000;
    const payload={snapshot,stale,mappings:stored.mappings,employees:stored.employees},etag='"'+await ucmBodyHash(JSON.stringify(payload))+'"',headers={'Cache-Control':'private, no-cache',ETag:etag};
    if(request.headers.get('If-None-Match')===etag)return new Response(null,{status:304,headers:{...headers,'Access-Control-Allow-Origin':origin,'Access-Control-Expose-Headers':'ETag'}});
    return json(payload,200,{...headers,'Access-Control-Expose-Headers':'ETag'},origin);
  };
}
