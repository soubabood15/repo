import {hrDay,hrDateOffset,hrShiftValue,hrShiftWindow,hrAttendanceStatus,hrWorkSummary,validHrDay} from './hr-core.js';
const all=async s=>(await s.all()).results||[];
export const validHrMonth=month=>/^\d{4}-(0[1-9]|1[0-2])$/.test(month);
export async function hrAttendanceReport(db,month,{username=null,controlsFor,grace=0,now=Date.now()}={}){
  const start=month+'-01',end=hrDateOffset(new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)).toISOString().slice(0,10),-1),dates=[];
  for(let day=start;day<=end;day=hrDateOffset(day,1))dates.push(day);
  const where=username?' AND username=?':'',args=username?[username]:[];
  const [people,controls,punches,leaves,requests]=await Promise.all([
    all(db.prepare("SELECT username,full_name,role FROM trainer_users WHERE active=1 AND role IN ('agent','quality','trainer')"+where+' ORDER BY full_name').bind(...args)),controlsFor(db,dates),
    all(db.prepare('SELECT * FROM hr_attendance WHERE day>=? AND day<=?'+where).bind(start,end,...args)),
    all(db.prepare("SELECT * FROM hr_sick_leaves WHERE status='approved' AND start_date<=? AND end_date>=?"+where).bind(end,start,...args)),
    all(db.prepare("SELECT * FROM hr_employee_requests WHERE status='approved' AND start_date<=? AND end_date>=?"+where).bind(end,start,...args))
  ]);
  const punchIndex=new Map(punches.map(p=>[p.username+':'+p.day,p])),controlIndex=new Map(controls.map(c=>[c.key,c])),currentDay=hrDay(now);
  const byUser=rows=>{const index=new Map();for(const row of rows){const list=index.get(row.username)||[];list.push(row);index.set(row.username,list)}return index},requestIndex=byUser(requests),leaveIndex=byUser(leaves);
  const rows=people.flatMap(user=>dates.map(day=>{
    const attendance=punchIndex.get(user.username+':'+day)||null,dated=controlIndex.get(`shift_${user.username}_${day}`),shift=dated?.value||attendance?.scheduled_shift||(day>=currentDay?hrShiftValue(controls,user.username,day):''),window=hrShiftWindow(day,shift),own=requestIndex.get(user.username)||[],leave=(leaveIndex.get(user.username)||[]).find(l=>l.start_date<=day&&l.end_date>=day),completed=!!window&&window.end<=now;
    const status=hrAttendanceStatus({day,shift,attendance,leave,requests:own,grace,now});
    return {...user,day,shift,attendance,...status,late_minutes:attendance?.punch_in?status.late_minutes:0,...hrWorkSummary({day,shift,attendance,leave,requests:own,now}),completed,missing_check_out:completed&&!!attendance?.punch_in&&!attendance?.punch_out};
  }));
  return {month,rows,server_now:new Date(now).toISOString(),basis:'Saved dated shifts and attendance snapshots. Historical days without either are not assumed absent. Times use Asia/Amman. Missing punches are not invented.'};
}
export function hrCorrection(body,shift,now=Date.now()){
  const day=String(body.day||''),window=hrShiftWindow(day,shift);
  if(!validHrDay(day)||day>hrDay(now)||!window)return {error:'Choose a saved working shift on today or a past day.'};
  const parse=value=>typeof value==='string'&&validHrDay(value.slice(0,10))&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)?Date.parse(value):NaN;
  const start=parse(body.punch_in),end=body.punch_out?parse(body.punch_out):null;
  if(!Number.isFinite(start)||!(hrDay(start)===day||hrDay(start)===hrDateOffset(day,1)&&start>=window.start&&start<=window.end)||start>now||end!==null&&(!Number.isFinite(end)||end<start||end>now||end-start>36*3600000))return {error:'Enter valid check-in/out times, in order, not in the future. Check-in must belong to the selected shift date.'};
  if(start<window.start-12*3600000||start>window.end)return {error:'Check-in is outside the selected shift day.'};
  return {day,punch_in:new Date(start).toISOString(),punch_out:end===null?null:new Date(end).toISOString()};
}
