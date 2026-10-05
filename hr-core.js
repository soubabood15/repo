export const HR_ROLES=['hr','hr_admin','admin'];
export const canManageHr=role=>['hr_admin','admin'].includes(String(role).toLowerCase());
export function hrDay(value=new Date()){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Amman',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(value));
  const get=key=>parts.find(part=>part.type===key)?.value;return `${get('year')}-${get('month')}-${get('day')}`;
}
export function hrDateOffset(day,offset){const date=new Date(day+'T12:00:00Z');date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10)}
export function validHrDay(day){return /^\d{4}-\d{2}-\d{2}$/.test(day)&&!Number.isNaN(Date.parse(day+'T12:00:00Z'))&&new Date(day+'T12:00:00Z').toISOString().slice(0,10)===day}
export function hrShiftWindow(day,value){
  const match=String(value||'').trim().match(/^(\d{2}):([0-5]\d)\s*-\s*(\d{2}):([0-5]\d)$/);
  if(!validHrDay(day)||!match||Number(match[1])>23||Number(match[3])>23)return null;
  const start=Date.parse(`${day}T${match[1]}:${match[2]}:00+03:00`);let end=Date.parse(`${day}T${match[3]}:${match[4]}:00+03:00`);if(end<=start)end+=86400000;
  return {start,end};
}
export function hrShiftValue(controls,username,day){
  const weekday=['sun','mon','tue','wed','thu','fri','sat'][new Date(day+'T12:00:00Z').getUTCDay()];
  const values=new Map(controls.map(row=>[row.key,String(row.value||'')]));
  return values.get(`shift_${username}_${day}`)||values.get(`shift_${username}_${weekday}`)||'';
}
export function hrAttendanceStatus({day,shift,attendance,leave,now=Date.now(),grace=0}){
  const window=hrShiftWindow(day,shift);
  if(leave?.status==='approved')return {status:'sick_leave',late_minutes:0};
  if(/^off$/i.test(String(shift).trim()))return {status:'off',late_minutes:0};
  if(!window)return {status:'not_scheduled',late_minutes:0};
  const threshold=window.start+Math.max(0,Number(grace)||0)*60000;
  if(attendance?.punch_in){const late=Math.max(0,Math.ceil((Date.parse(attendance.punch_in)-threshold)/60000));return {status:attendance.punch_out?'checked_out':late?'late':'present',late_minutes:late}}
  return {status:now<window.start?'upcoming':now>=window.end?'absent':'missing_login',late_minutes:now>threshold?Math.ceil((now-threshold)/60000):0};
}
export function hrPresence(row,now=Date.now()){
  if(!row)return 'offline';
  const age=now-Date.parse(row.last_ping_at||row.updated_at||'');
  return Number.isFinite(age)&&age>=-60000&&age<=300000&&String(row.status||'').toLowerCase()==='online'?'online':'offline';
}
