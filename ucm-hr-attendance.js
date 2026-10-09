import {hrDay,hrDateOffset,hrShiftWindow} from './hr-core.js';

// Trusted queue events, not browser time or Wave-session status, create check-in.
export async function recordFirstQueueLogin(db,event,username,getShift){
  if(event.event_type!=='login'||!username)return;
  const employee=await db.prepare("SELECT username FROM trainer_users WHERE username=? AND active=1 AND role IN ('agent','quality','trainer')").bind(username).first();
  if(!employee)return;
  let day=hrDay(event.occurred_at),shift=await getShift(username,day);
  const previous=hrDateOffset(day,-1),priorShift=await getShift(username,previous),prior=hrShiftWindow(previous,priorShift),stamp=Date.parse(event.occurred_at);
  if(prior&&hrDay(new Date(prior.end-1))!==previous&&stamp>=prior.start&&stamp<prior.end){day=previous;shift=priorShift;}
  if(await db.prepare('SELECT username FROM hr_attendance WHERE username=? AND day=?').bind(username,day).first())return;
  // An explicit HR deletion is an override, not a missing connector record.
  if(await db.prepare("SELECT id FROM hr_audit WHERE target=? AND action='delete_attendance' AND json_extract(details,'$.day')=? LIMIT 1").bind(username,day).first())return;
  const from=new Date(day+'T00:00:00+03:00').toISOString(),window=hrShiftWindow(day,shift),to=new Date(Math.max(Date.parse(from)+86400000,window?.end||0)).toISOString();
  const first=await db.prepare("SELECT MIN(occurred_at) occurred_at FROM ucm_queue_events WHERE username=? AND event_type='login' AND occurred_at>=? AND occurred_at<?").bind(username,from,to).first();
  const punch=first?.occurred_at||event.occurred_at,now=new Date().toISOString();
  await db.batch([
    db.prepare("INSERT INTO hr_audit(id,actor,action,target,details,created_at) SELECT ?,'ucm_connector','queue_check_in',?,?,? WHERE NOT EXISTS(SELECT 1 FROM hr_attendance WHERE username=? AND day=?)").bind(crypto.randomUUID(),username,JSON.stringify({day,source:'first_queue_login',extension:event.agent_extension,queue:event.queue_name,punch_in:punch}),now,username,day),
    db.prepare('INSERT INTO hr_attendance(username,day,punch_in,scheduled_shift,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(username,day) DO NOTHING').bind(username,day,punch,shift||'',now,now)
  ]);
}
