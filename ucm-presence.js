import {loadUcmMappings} from './ucm-mapping.js';
import {ammanDateKey} from './ucm-core.js';
const cache=new WeakMap();
// A read-only, shared five-second cache. Portal activity is never UCM presence.
export async function ucmPresence(db,day=ammanDateKey(),now=Date.now()){
  let saved=cache.get(db);
  if(!saved||saved.day!==day||now-saved.at>5000){
    const [state,people,events]=await Promise.all([
      db.prepare("SELECT value FROM ucm_sync_state WHERE key='queue-live'").first(),loadUcmMappings(db),
      db.prepare("SELECT agent_extension,queue_name,event_type,occurred_at FROM ucm_queue_events WHERE event_type IN ('login','logout') AND occurred_at>=? AND occurred_at<? ORDER BY occurred_at,event_type DESC").bind(new Date(Date.parse(day+'T00:00:00+03:00')-86400000).toISOString(),new Date(Date.parse(day+'T00:00:00+03:00')+86400000).toISOString()).all()
    ]);
    let snapshot=null;try{snapshot=JSON.parse(state?.value||'null')}catch{}
    // Stored event timestamps are UTC; use UTC bounds for lexical comparison.
    saved={day,at:now,snapshot,people,events:events.results||[]};cache.set(db,saved);
  }
  const {snapshot,people,events}=saved,stamp=Date.parse(snapshot?.observed_at),stale=!Number.isFinite(stamp)||now-stamp>180000||stamp>now+30000;
  const roster=people.employees.map(person=>{
    const extensions=people.mappings.filter(m=>m.username===person.username).map(m=>m.extension),members=(snapshot?.members||[]).filter(m=>extensions.includes(m.extension));
    let sessions=[];const open=new Map();
    for(const event of events.filter(e=>extensions.includes(e.agent_extension))){
      const key=event.agent_extension+'|'+event.queue_name;
      if(event.event_type==='login'){
        const previous=open.get(key);
        if(previous&&previous.login_at===event.occurred_at)continue;
        if(previous)previous.end_unknown=true;
        const row={extension:event.agent_extension,queue:event.queue_name,login_at:event.occurred_at,logout_at:null};sessions.push(row);open.set(key,row);
      }else if(open.has(key)){open.get(key).logout_at=event.occurred_at;open.delete(key)}
      else sessions.push({extension:event.agent_extension,queue:event.queue_name,login_at:null,logout_at:event.occurred_at});
    }
    for(const member of members){
      if(member.logged_in===true&&member.login_at&&(ammanDateKey(member.login_at)===day||day===ammanDateKey(now))&&!sessions.some(s=>s.extension===member.extension&&s.queue===member.queue&&s.login_at===member.login_at)){const old=open.get(member.extension+'|'+member.queue);if(old)old.end_unknown=true;sessions.push({extension:member.extension,queue:member.queue,login_at:member.login_at,logout_at:null})}
    }
    sessions=sessions.filter(s=>s.login_at&&ammanDateKey(s.login_at)===day||s.logout_at&&ammanDateKey(s.logout_at)===day||day===ammanDateKey(now)&&members.some(m=>m.logged_in===true&&m.queue===s.queue&&m.extension===s.extension&&m.login_at===s.login_at));
    const lastChecked=members.map(m=>m.last_checked_at).filter(Boolean).sort().at(-1)||null;
    const pauses=(snapshot?.pauses||[]).filter(p=>extensions.includes(p.extension)&&p.day===day);
    const paused=stale||!members.length||members.some(m=>m.logged_in===true&&m.paused==null)?null:members.some(m=>m.logged_in===true&&m.paused===true);
    const pauseSeconds=pauses.length?pauses.reduce((n,p)=>n+Number(p.seconds||0),0):null;
    return {username:person.username,extensions,stale,last_checked_at:lastChecked,received_at:snapshot?.observed_at||null,logged_in:stale||!members.length?null:members.some(m=>m.logged_in===true)?true:members.every(m=>m.logged_in===false)?false:null,paused,pause_seconds:pauseSeconds,pause_coverage:pauses.length?'observed_only':'unavailable',sessions,members:members.map(m=>({...m,logged_in:stale?null:m.logged_in,paused:stale?null:m.paused}))};
  });
  return {day,stale,observed_at:snapshot?.observed_at||null,roster};
}
export function invalidateUcmPresence(db){cache.delete(db)}
