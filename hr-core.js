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
export function hrAttendanceStatus({day,shift,attendance,leave,requests=[],now=Date.now(),grace=0}){
  const window=hrShiftWindow(day,shift);
  if(leave?.status==='approved')return {status:'sick_leave',late_minutes:0};
  if(/^off$/i.test(String(shift).trim()))return {status:'off',late_minutes:0};
  if(!window)return {status:'not_scheduled',late_minutes:0};
  if(requests.some(r=>r.status==='approved'&&r.request_type==='annual'&&r.start_date<=day&&r.end_date>=day))return {status:'annual_leave',late_minutes:0};
  const segments=hrLeaveSegments(day,shift,requests);
  let expected=window.start;
  for(const segment of segments){if(segment.start>expected)break;expected=Math.max(expected,segment.end)}
  if(expected>=window.end)return {status:'approved_leave',late_minutes:0};
  const threshold=expected+Math.max(0,Number(grace)||0)*60000;
  if(attendance?.punch_in){const late=Math.max(0,Math.ceil((Date.parse(attendance.punch_in)-threshold)/60000));return {status:attendance.punch_out?'checked_out':late?'late':'present',late_minutes:late}}
  return {status:now<expected?'upcoming':now>=window.end?'absent':'missing_login',late_minutes:now>threshold?Math.ceil((now-threshold)/60000):0};
}
export function hrLeaveWindow(day,shift,startTime,endTime){
  const window=hrShiftWindow(day,shift);
  if(!window||!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime||'')||!/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime||''))return null;
  let start=Date.parse(`${day}T${startTime}:00+03:00`),end=Date.parse(`${day}T${endTime}:00+03:00`);
  if(start<window.start)start+=86400000;if(end<=start)end+=86400000;
  return start>=window.start&&end<=window.end&&end>start?{start,end,minutes:(end-start)/60000}:null;
}
export function hrLeaveSegments(day,shift,requests=[]){
  const segments=requests.filter(r=>r.status==='approved'&&r.request_type==='short_leave'&&r.start_date===day).map(r=>hrLeaveWindow(day,shift,r.start_time,r.end_time)).filter(Boolean).sort((a,b)=>a.start-b.start),merged=[];
  for(const segment of segments){const last=merged.at(-1);if(last&&segment.start<=last.end)last.end=Math.max(last.end,segment.end);else merged.push({...segment})}return merged;
}
export function hrWorkSummary({day,shift,attendance,leave,requests=[],now=Date.now()}){
  const window=hrShiftWindow(day,shift);if(!window)return {scheduled_minutes:0,approved_leave_minutes:0,required_minutes:0,recorded_minutes:0,work_minutes:0,remaining_minutes:0};
  const scheduled=(window.end-window.start)/60000,full=leave?.status==='approved'||requests.some(r=>r.status==='approved'&&r.request_type==='annual'&&r.start_date<=day&&r.end_date>=day);
  const segments=full?[window]:hrLeaveSegments(day,shift,requests),approved=segments.reduce((sum,s)=>sum+(s.end-s.start)/60000,0);
  const start=Math.max(window.start,Date.parse(attendance?.punch_in||'')),end=Math.min(window.end,attendance?.punch_out?Date.parse(attendance.punch_out):now);
  const recorded=Number.isFinite(start)&&Number.isFinite(end)?Math.max(0,(end-start)/60000):0;
  const overlap=recorded?segments.reduce((sum,s)=>sum+Math.max(0,Math.min(end,s.end)-Math.max(start,s.start))/60000,0):0;
  const required=Math.max(0,scheduled-approved),work=Math.max(0,recorded-overlap);
  return {scheduled_minutes:scheduled,approved_leave_minutes:approved,required_minutes:required,recorded_minutes:Math.floor(recorded),work_minutes:Math.floor(work),remaining_minutes:Math.max(0,Math.ceil(required-work))};
}
export function hrNextWeek(day=hrDay()){const start=hrDateOffset(day,7-new Date(day+'T12:00:00Z').getUTCDay());return Array.from({length:7},(_,i)=>hrDateOffset(start,i))}
export function hrPresence(row,now=Date.now()){
  if(!row)return 'offline';
  const age=now-Date.parse(row.last_ping_at||row.updated_at||'');
  return Number.isFinite(age)&&age>=-60000&&age<=300000&&String(row.status||'').toLowerCase()==='online'?'online':'offline';
}
