export function ucmMonthWindow(now=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Amman',year:'numeric',month:'2-digit'}).formatToParts(now);
  const current=parts.find(p=>p.type==='year').value+'-'+parts.find(p=>p.type==='month').value;
  const date=new Date(current+'-01T00:00:00Z');date.setUTCMonth(date.getUTCMonth()-1);
  const previous=date.toISOString().slice(0,7),day=previous+'-01';
  return {current,previous,day,cutoff:new Date(day+'T00:00:00+03:00').toISOString()};
}
// Rotate UCM operational data once per month after a successful daily sync.
// Historical Analyzer reports are separate and must not be purged here.
export async function finishDailyUcmSync(db,now=new Date()){
  const window=ucmMonthWindow(now),stamp=now.toISOString();
  if(await db.prepare("SELECT key FROM ucm_sync_state WHERE key=? AND status='complete'").bind('retention:'+window.current).first())return {retained_from:window.day,rotated:false};
  const gate=" AND NOT EXISTS(SELECT 1 FROM ucm_sync_state WHERE key=? AND status='complete')",marker='retention:'+window.current;
  await db.batch([
    db.prepare('DELETE FROM ucm_cdr WHERE started_at < ?'+gate).bind(window.cutoff,marker),
    db.prepare('DELETE FROM ucm_queue_events WHERE occurred_at < ?'+gate).bind(window.cutoff,marker),
    db.prepare('DELETE FROM ucm_agent_daily WHERE day < ?'+gate).bind(window.day,marker),
    db.prepare("DELETE FROM agent_kpi_monthly WHERE period_start < ? AND json_extract(details,'$.source')='ucm_api'"+gate).bind(window.day,marker),
    db.prepare("UPDATE ucm_sync_state SET status='expired',updated_at=? WHERE key LIKE 'history:%' AND substr(key,9) < ? AND status='complete'"+gate).bind(stamp,window.previous,marker),
    db.prepare("UPDATE ucm_sync_state SET status='expired',updated_at=? WHERE key LIKE 'day:%' AND substr(key,5) < ? AND status='complete'"+gate).bind(stamp,window.day,marker),
    db.prepare("INSERT INTO ucm_sync_state(key,value,status,updated_at) VALUES(?,'current+previous','complete',?) ON CONFLICT(key) DO UPDATE SET status='complete',updated_at=excluded.updated_at").bind('retention:'+window.current,stamp)
  ]);
  return {retained_from:window.day,rotated:true};
}
