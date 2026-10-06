import {hrDay,hrNextWeek,validHrDay,hrDateOffset,hrShiftValue,hrShiftWindow,hrLeaveWindow,hrAttendanceStatus,hrWorkSummary} from './hr-core.js';
const all=async statement=>(await statement.all()).results||[];
const employeeRoles=['agent','quality','trainer'];
export async function hrOwnerRequests(db,username){return all(db.prepare('SELECT * FROM hr_employee_requests WHERE username=? ORDER BY created_at DESC LIMIT 100').bind(username))}
export async function hrDayRequests(db,username,day){return all(db.prepare("SELECT * FROM hr_employee_requests WHERE username=? AND start_date<=? AND end_date>=? AND status='approved'").bind(username,day,day))}
export async function hrRequestRoute({request,url,path,profile,db,respond,hr,manage,now,audit,controlsFor,employee,canApplySchedule=true}){
  const method=request.method,today=hrDay(now);
  const seen=path.match(/^\/(requests|sick-leaves)\/([^/]+)\/seen$/);
  if(seen&&method==='POST'){
    const table=seen[1]==='requests'?'hr_employee_requests':'hr_sick_leaves';
    const row=await db.prepare(`SELECT id,status FROM ${table} WHERE id=? AND username=?`).bind(seen[2],profile.username).first();
    if(!row)return respond({message:'Request not found'},404);
    if(row.status==='pending')return respond({message:'No decision to acknowledge yet'},409);
    await db.prepare(`UPDATE ${table} SET decision_seen_at=? WHERE id=? AND username=? AND decision_seen_at IS NULL`).bind(now,row.id,profile.username).run();return respond({ok:true});
  }
  if(path==='/requests'&&method==='POST'){
    if(!employeeRoles.includes(profile.role))return respond({message:'Employee access required'},403);
    const body=await request.json(),type=body.request_type,start=String(body.start_date||''),end=String(body.end_date||start),note=String(body.note||'').trim();
    if(!['annual','short_leave','schedule_preference'].includes(type)||!validHrDay(start)||!validHrDay(end)||end<start||(Date.parse(end)-Date.parse(start))/86400000>30||note.length>1000)return respond({message:'Choose a valid request and a date range of up to 31 days.'},400);
    let minutes=0,shift=null,week=null,startTime=null,endTime=null;
    if(type==='short_leave'){
      if(start!==end)return respond({message:'Hourly leave must belong to one scheduled shift.'},400);
      shift=hrShiftValue(await controlsFor(db,[start]),profile.username,start);startTime=String(body.start_time||'');endTime=String(body.end_time||'');
      const window=hrLeaveWindow(start,shift,startTime,endTime);if(!window)return respond({message:'Hourly leave must fit inside your saved working shift, including overnight shifts.'},400);minutes=window.minutes;
    }
    if(type==='schedule_preference'){
      const dates=hrNextWeek(today);if(start!==dates[0]||end!==dates[6]||!Array.isArray(body.week)||!body.week.length||body.week.length>7)return respond({message:'Select preferences for next week only.'},400);
      week=body.week.map(item=>({day:String(item.day||''),value:String(item.value||'').trim()}));
      if(new Set(week.map(item=>item.day)).size!==week.length||week.some(item=>!dates.includes(item.day)||(item.value!=='OFF'&&!hrShiftWindow(item.day,item.value))))return respond({message:'Select a working shift or OFF for each preferred day.'},400);
    }
    const existing=await db.prepare("SELECT id FROM hr_employee_requests WHERE username=? AND request_type=? AND start_date=? AND end_date=? AND COALESCE(start_time,'')=? AND COALESCE(end_time,'')=? AND COALESCE(week_json,'')=? AND status='pending'").bind(profile.username,type,start,end,startTime||'',endTime||'',week?JSON.stringify(week):'').first();
    if(existing)return respond({id:existing.id,status:'pending',duplicate:true});
    const id=crypto.randomUUID();await db.batch([db.prepare("INSERT INTO hr_employee_requests(id,username,request_type,start_date,end_date,start_time,end_time,note,requested_minutes,shift_snapshot,week_json,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'pending',?)").bind(id,profile.username,type,start,end,startTime,endTime,note,minutes,shift,week?JSON.stringify(week):null,now),audit(db,profile,'employee_request',id,{type,start,end},now)]);return respond({id,status:'pending'},201);
  }
  if(path==='/requests'&&method==='GET'){
    const month=url.searchParams.get('month')||today.slice(0,7);if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return respond({message:'Invalid month'},400);
    const start=month+'-01',end=hrDateOffset(new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)).toISOString().slice(0,10),-1);
    const requests=hr?await all(db.prepare("SELECT * FROM hr_employee_requests WHERE status='pending' OR (start_date<=? AND end_date>=?) ORDER BY created_at DESC LIMIT 500").bind(end,start)):await hrOwnerRequests(db,profile.username);
    const leaves=hr?await all(db.prepare("SELECT id,username,start_date,end_date,note,status,created_at,reviewed_at,reviewed_by FROM hr_sick_leaves WHERE status='pending' OR (start_date<=? AND end_date>=?) ORDER BY created_at DESC LIMIT 500").bind(end,start)):[];
    return respond({requests,leaves,month,limit:500});
  }
  const itemPath=path.match(/^\/requests\/([^/]+)$/);if(!itemPath||!['PATCH','DELETE'].includes(method))return null;
  if(!manage)return respond({message:'HR Admin access required for changes'},403);
  const item=await db.prepare('SELECT * FROM hr_employee_requests WHERE id=?').bind(itemPath[1]).first();
  if(!item)return method==='DELETE'?respond({ok:true}):respond({message:'Request not found'},404);
  if(method==='DELETE'){await db.batch([db.prepare('DELETE FROM hr_employee_requests WHERE id=?').bind(item.id),audit(db,profile,'delete_request',item.id,{username:item.username},now)]);return respond({ok:true})}
  const body=await request.json();if(!['approved','rejected'].includes(body.status))return respond({message:'Invalid request decision'},400);
  if(item.status!=='pending')return item.status===body.status?respond({ok:true,duplicate:true}):respond({message:'This request was already reviewed. Delete and resubmit to change the decision.'},409);
  if(!(await employee(db,item.username)))return respond({message:'Employee is inactive or unavailable'},409);
  const statements=[];
  if(body.status==='approved'&&item.request_type!=='schedule_preference'){
    const sick=await db.prepare("SELECT id FROM hr_sick_leaves WHERE username=? AND status='approved' AND start_date<=? AND end_date>=? LIMIT 1").bind(item.username,item.end_date,item.start_date).first();
    const others=await all(db.prepare("SELECT * FROM hr_employee_requests WHERE username=? AND id<>? AND status='approved' AND request_type<>'schedule_preference' AND start_date<=? AND end_date>=?").bind(item.username,item.id,item.end_date,item.start_date));
    if(sick||others.some(row=>row.request_type==='annual'||item.request_type==='annual'))return respond({message:'This request overlaps approved time off.'},409);
    if(item.request_type==='short_leave'){
      const shift=hrShiftValue(await controlsFor(db,[item.start_date]),item.username,item.start_date),window=hrLeaveWindow(item.start_date,shift,item.start_time,item.end_time);
      if(!window)return respond({message:'The saved shift changed. Hourly leave no longer fits; reject and resubmit.'},409);
      if(others.some(row=>{const other=hrLeaveWindow(row.start_date,shift,row.start_time,row.end_time);return other&&window.start<other.end&&other.start<window.end}))return respond({message:'Hourly leave overlaps another approved request.'},409);
    }
  }
  if(body.status==='approved'&&item.request_type==='schedule_preference'&&body.apply_schedule===true){
    if(!canApplySchedule)return respond({message:'Schedule write permission is required to apply a preferred week.'},403);
    if(item.start_date<today)return respond({message:'A past preference cannot overwrite the saved schedule.'},409);
    for(const row of JSON.parse(item.week_json||'[]'))statements.push(db.prepare('INSERT INTO app_control(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind(`shift_${item.username}_${row.day}`,row.value,now));
  }
  statements.push(db.prepare("UPDATE hr_employee_requests SET status=?,reviewed_at=?,reviewed_by=?,decision_seen_at=NULL WHERE id=? AND status='pending'").bind(body.status,now,profile.username,item.id),audit(db,profile,'request_review',item.id,{status:body.status,applied_schedule:body.apply_schedule===true},now));
  await db.batch(statements);return respond({ok:true});
}
export async function hrAnalytics(db,month,{controlsFor,grace=0,now=Date.now()}={}){
  const start=month+'-01',next=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),1)).toISOString().slice(0,10),end=hrDateOffset(next,-1),dates=[];
  for(let day=start;day<=end;day=hrDateOffset(day,1))dates.push(day);
  const [employees,controls,punches,leaves,requests,actions,kpis]=await Promise.all([
    all(db.prepare("SELECT username,full_name,role FROM trainer_users WHERE active=1 AND role IN ('agent','quality','trainer') ORDER BY full_name")),controlsFor(db,dates),
    all(db.prepare('SELECT * FROM hr_attendance WHERE day>=? AND day<=?').bind(start,end)),all(db.prepare("SELECT username,start_date,end_date,status FROM hr_sick_leaves WHERE status='approved' AND start_date<=? AND end_date>=?").bind(end,start)),
    all(db.prepare('SELECT * FROM hr_employee_requests WHERE start_date<=? AND end_date>=?').bind(end,start)),all(db.prepare('SELECT * FROM hr_actions WHERE action_date>=? AND action_date<=?').bind(start,end)),all(db.prepare('SELECT * FROM agent_kpi_monthly WHERE period_start>=? AND period_start<?').bind(start,next))
  ]);
  const roster=employees.map(user=>{
    const own=requests.filter(r=>r.username===user.username),daily=dates.map(day=>{
      const attendance=punches.find(r=>r.username===user.username&&r.day===day)||null,dated=controls.find(r=>r.key===`shift_${user.username}_${day}`),shift=dated?.value||attendance?.scheduled_shift||(day>=hrDay(now)?hrShiftValue(controls,user.username,day):''),leave=leaves.find(r=>r.username===user.username&&r.start_date<=day&&r.end_date>=day),window=hrShiftWindow(day,shift);
      return {day,shift,attendance,...hrAttendanceStatus({day,shift,attendance,leave,requests:own,grace,now}),...hrWorkSummary({day,shift,attendance,leave,requests:own,now}),completed:!!window&&window.end<=now};
    });
    const recorded=daily.filter(d=>d.attendance?.punch_in),completed=daily.filter(d=>d.completed),notices=actions.filter(r=>r.username===user.username),kpi=kpis.find(r=>String(r.username)===String(user.username))||null;
    return {...user,kpi,daily,late_days:recorded.filter(d=>d.late_minutes>0).length,late_minutes:recorded.reduce((s,d)=>s+d.late_minutes,0),absent_days:daily.filter(d=>d.status==='absent').length,action_count:notices.length,acknowledged_actions:notices.filter(r=>r.acknowledged_at).length,
      sick_days:daily.filter(d=>d.scheduled_minutes>0&&d.status==='sick_leave').length,annual_days:daily.filter(d=>d.scheduled_minutes>0&&d.status==='annual_leave').length,hourly_leave_minutes:daily.filter(d=>!['sick_leave','annual_leave'].includes(d.status)).reduce((s,d)=>s+d.approved_leave_minutes,0),pending_requests:own.filter(r=>r.status==='pending').length,
      worked_minutes:completed.reduce((s,d)=>s+d.work_minutes,0),required_minutes:completed.reduce((s,d)=>s+d.required_minutes,0)};
  });return {month,roster,server_now:new Date(now).toISOString(),basis:'Dated saved shifts (or the punch-time shift snapshot), server attendance punches, approved requests and Agent360 monthly KPI records. Past days without a dated shift or snapshot are not guessed from the current weekly template. Worked time excludes approved leave; this is not payroll or physical-presence verification.'};
}
