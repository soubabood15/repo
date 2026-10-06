import {HR_ROLES,canManageHr,hrDay,hrDateOffset,validHrDay,hrShiftValue,hrShiftWindow,hrAttendanceStatus,hrPresence,hrWorkSummary,hrNextWeek} from './hr-core.js';
import {hrRequestRoute,hrOwnerRequests,hrDayRequests,hrAnalytics} from './hr-requests.js';
import {hrPermissions,hrAllowed,hrRouteResource} from './hr-permissions.js';
import {hrAttendanceReport,validHrMonth,hrCorrection} from './hr-attendance.js';
import {hrStaffRoute} from './hr-staff-service.js';
const roles=['agent','quality','trainer'];
const all=async statement=>(await statement.all()).results||[];
async function controlsFor(db,dates){
  const suffixes=[...new Set([...dates,'sun','mon','tue','wed','thu','fri','sat'])];
  return all(db.prepare(`SELECT key,value FROM app_control WHERE ${suffixes.map(()=>"key LIKE ?").join(' OR ')}`).bind(...suffixes.map(day=>`shift_%_${day}`)));
}
async function employee(db,username){return db.prepare("SELECT username,full_name,role FROM trainer_users WHERE username=? AND active=1 AND role IN ('agent','quality','trainer')").bind(username).first()}
function audit(db,profile,action,target,details,now){return db.prepare('INSERT INTO hr_audit(id,actor,action,target,details,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),profile.username,action,target,JSON.stringify(details),now)}
export async function cleanupHrFiles(env){
  const rows=await all(env.trainer_kb.prepare('SELECT file_key FROM hr_file_cleanup ORDER BY queued_at LIMIT 20'));
  for(const row of rows){try{await env.trainer_kb_files.delete(row.file_key);await env.trainer_kb.prepare('DELETE FROM hr_file_cleanup WHERE file_key=?').bind(row.file_key).run()}catch{/* Retry on the next scheduled run; do not log private attachment paths. */}}
}
export function createHrHandler({authenticate,json,hashPassword}){
  return async function hrRoute(request,env,url){
    const origin=request.headers.get('Origin')||'*',identity=await authenticate(request,env);
    const respond=(body,status=200)=>json(body,status,{'Cache-Control':'no-store'},origin);
    if(!identity)return respond({message:'Valid active employee login required'},401);
    const profile=identity.profile,role=String(profile.role).toLowerCase(),hr=HR_ROLES.includes(role),manage=canManageHr(role),db=env.trainer_kb;
    const path=url.pathname.slice('/functions/v1/hr'.length),method=request.method,now=new Date().toISOString(),today=hrDay(now),grace=Math.max(0,Number(env.HR_LATE_GRACE_MINUTES)||0);
    const permissions=await hrPermissions(db,{...profile,role}),resource=hrRouteResource(path),write=!['GET','HEAD'].includes(method);
    const ownerEndpoint=path.startsWith('/me')||/^\/actions\/[^/]+\/ack$/.test(path)||/^\/(requests|sick-leaves)\/[^/]+\/seen$/.test(path);
    if(hr&&!ownerEndpoint&&resource&&!(path==='/analytics'&&method==='GET'&&url.searchParams.get('view')==='performance'?hrAllowed(permissions,'performance'):hrAllowed(permissions,resource,write)))return respond({message:'You do not have permission for this HR section.'},403);
    if(path.startsWith('/staff')){
      if(!['admin','hr_admin'].includes(role)||!hrAllowed(permissions,'staff',write))return respond({message:'HR staff administrator access required'},403);
      return hrStaffRoute({path,request,db,profile,respond,audit,now,hashPassword});
    }
    const requestResponse=await hrRequestRoute({request,url,path,profile:{...profile,role},db,respond,hr,manage:hr&&hrAllowed(permissions,'leaves',true),now,audit,controlsFor,employee,canApplySchedule:hr&&hrAllowed(permissions,'schedule',true)});
    if(requestResponse)return requestResponse;
    if(path==='/me/check'&&method==='GET'){
      const revision=await db.prepare("SELECT value FROM app_control WHERE key='hr_revision'").first();
      return respond({revision:revision?.value||'initial',today,server_now:now});
    }
    if(path==='/me/schedule'&&method==='GET'){
      const day=url.searchParams.get('day')||today;if(!validHrDay(day))return respond({message:'Invalid day'},400);
      return respond({day,shift:hrShiftValue(await controlsFor(db,[day]),profile.username,day)});
    }
    if(path==='/me/attendance'&&method==='GET'){
      const month=url.searchParams.get('month')||today.slice(0,7);if(!validHrMonth(month))return respond({message:'Invalid month'},400);
      return respond(await hrAttendanceReport(db,month,{username:profile.username,controlsFor,grace}));
    }
    if(path==='/me'&&method==='GET'){
      const revision=await db.prepare("SELECT value FROM app_control WHERE key='hr_revision'").first();
      const previous=hrDateOffset(today,-1),controls=await controlsFor(db,[today,previous]);
      const punches=await all(db.prepare('SELECT * FROM hr_attendance WHERE username=? AND day IN (?,?)').bind(profile.username,today,previous));
      const priorWindow=hrShiftWindow(previous,hrShiftValue(controls,profile.username,previous));
      const open=await db.prepare('SELECT * FROM hr_attendance WHERE username=? AND punch_out IS NULL ORDER BY day DESC LIMIT 1').bind(profile.username).first();
      const day=open?.day||(priorWindow&&Date.now()<priorWindow.end&&Date.now()>=priorWindow.start?previous:today),shift=hrShiftValue(controls,profile.username,day)||open?.scheduled_shift||'';
      const [warnings,leaves,requests,approvedRequests,actionHistory]=await Promise.all([all(db.prepare('SELECT * FROM hr_actions WHERE username=? AND acknowledged_at IS NULL ORDER BY created_at').bind(profile.username)),all(db.prepare('SELECT id,start_date,end_date,note,status,created_at,reviewed_at,decision_seen_at FROM hr_sick_leaves WHERE username=? ORDER BY created_at DESC LIMIT 100').bind(profile.username)),hrOwnerRequests(db,profile.username),hrDayRequests(db,profile.username,day),all(db.prepare('SELECT * FROM hr_actions WHERE username=? ORDER BY created_at DESC LIMIT 100').bind(profile.username))]);
      const attendance=open||punches.find(row=>row.day===day)||null,leave=leaves.find(row=>row.start_date<=day&&row.end_date>=day&&row.status==='approved');
      const activeLeave=await db.prepare("SELECT id,status FROM hr_sick_leaves WHERE username=? AND status='approved' AND start_date<=? AND end_date>=? LIMIT 1").bind(profile.username,day,day).first();
      const nextWeek=hrNextWeek(today),nextControls=await controlsFor(db,nextWeek);
      const notifications=[...requests.map(r=>({...r,kind:'requests'})),...leaves.map(r=>({...r,request_type:'sick',kind:'sick-leaves'}))].filter(r=>r.status!=='pending'&&!r.decision_seen_at);
      return respond({profile:{username:profile.username,full_name:profile.full_name,role},day,shift,attendance,warnings,leaves,requests,approved_requests:approvedRequests,action_history:actionHistory,notifications,next_week:nextWeek.map(date=>({day:date,shift:hrShiftValue(nextControls,profile.username,date)})),work_summary:hrWorkSummary({day,shift,attendance,leave:activeLeave||leave,requests:approvedRequests}),revision:revision?.value||'initial',today,server_now:now,grace,...hrAttendanceStatus({day,shift,attendance,leave:activeLeave||leave,requests:approvedRequests,grace})});
    }
    if(path==='/punch'&&method==='POST'){
      if(!roles.includes(role))return respond({message:'Employee attendance access required'},403);
      const {action}=await request.json();if(!['in','out'].includes(action))return respond({message:'Invalid punch action'},400);
      const previous=hrDateOffset(today,-1),controls=await controlsFor(db,[today,previous]);
      const previousShift=hrShiftValue(controls,profile.username,previous),previousWindow=hrShiftWindow(previous,previousShift);
      const open=await db.prepare('SELECT * FROM hr_attendance WHERE username=? AND punch_out IS NULL ORDER BY day DESC LIMIT 1').bind(profile.username).first();
      let day=previousWindow&&Date.now()>=previousWindow.start&&Date.now()<previousWindow.end?previous:today;
      if(action==='out'&&open)day=open.day;
      const shift=hrShiftValue(controls,profile.username,day),window=hrShiftWindow(day,shift);
      if(action==='in'){
        if(open&&open.day!==day)return respond({message:'Close your previous attendance session first.'},409);
        if(!window)return respond({message:'No working shift is scheduled. HR must review this day.'},409);
        await db.batch([db.prepare('INSERT INTO hr_attendance(username,day,punch_in,scheduled_shift,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(username,day) DO NOTHING').bind(profile.username,day,now,shift,now,now)]);
      }else{
        const record=await db.prepare('SELECT * FROM hr_attendance WHERE username=? AND day=?').bind(profile.username,day).first();
        if(!record)return respond({message:'Record your attendance login first.'},409);
        if(!record.punch_out)await db.prepare('UPDATE hr_attendance SET punch_out=?,updated_at=? WHERE username=? AND day=? AND punch_out IS NULL').bind(now,now,profile.username,day).run();
      }
      const attendance=await db.prepare('SELECT * FROM hr_attendance WHERE username=? AND day=?').bind(profile.username,day).first();
      const requests=await hrDayRequests(db,profile.username,day),leave=await db.prepare("SELECT status FROM hr_sick_leaves WHERE username=? AND status='approved' AND start_date<=? AND end_date>=? LIMIT 1").bind(profile.username,day,day).first();
      return respond({attendance,day,shift,server_now:now,approved_requests:requests,work_summary:hrWorkSummary({day,shift,attendance,leave,requests}),...hrAttendanceStatus({day,shift,attendance,leave,requests,grace})});
    }
    const ack=path.match(/^\/actions\/([^/]+)\/ack$/);
    if(ack&&method==='POST'){
      const item=await db.prepare('SELECT * FROM hr_actions WHERE id=? AND username=?').bind(ack[1],profile.username).first();if(!item)return respond({message:'Action not found'},404);
      if(!item.acknowledged_at)await db.batch([db.prepare('UPDATE hr_actions SET acknowledged_at=? WHERE id=? AND username=? AND acknowledged_at IS NULL').bind(now,item.id,profile.username),audit(db,profile,'acknowledge',item.id,{},now)]);
      return respond({ok:true,acknowledged_at:item.acknowledged_at||now});
    }
    if(path==='/sick-leaves'&&method==='POST'){
      if(!roles.includes(role))return respond({message:'Employee access required'},403);
      if(Number(request.headers.get('Content-Length'))>6*1024*1024)return respond({message:'Maximum attachment size is 5 MB'},413);
      const form=await request.formData(),start=String(form.get('start_date')||''),end=String(form.get('end_date')||''),note=String(form.get('note')||'').trim(),file=form.get('file');
      if(!validHrDay(start)||!validHrDay(end)||end<start||(Date.parse(end)-Date.parse(start))/86400000>30)return respond({message:'Choose a valid sick leave range of at most 31 days.'},400);
      if(!file||typeof file.arrayBuffer!=='function'||file.size<1||file.size>5*1024*1024||!['application/pdf','image/jpeg','image/png'].includes(file.type))return respond({message:'Upload a PDF, JPG or PNG, up to 5 MB.'},400);
      if(note.length>1000)return respond({message:'Note is too long'},400);
      const bytes=new Uint8Array(await file.arrayBuffer()),valid=file.type==='application/pdf'?new TextDecoder().decode(bytes.slice(0,5))==='%PDF-':file.type==='image/png'?bytes.slice(0,8).join(',')==='137,80,78,71,13,10,26,10':bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
      if(!valid)return respond({message:'Attachment content does not match the selected file type.'},400);
      const id=crypto.randomUUID(),fileKey=`hr-sick-leaves/${id}.${file.type==='application/pdf'?'pdf':file.type==='image/png'?'png':'jpg'}`;
      await env.trainer_kb_files.put(fileKey,bytes,{httpMetadata:{contentType:file.type}});
      try{await db.batch([db.prepare("INSERT INTO hr_sick_leaves(id,username,start_date,end_date,note,file_key,file_type,file_size,status,created_at) VALUES(?,?,?,?,?,?,?,?,'pending',?)").bind(id,profile.username,start,end,note,fileKey,file.type,file.size,now),audit(db,profile,'sick_leave_upload',id,{start,end},now)])}catch(error){await env.trainer_kb_files.delete(fileKey);throw error}
      return respond({id,status:'pending'},201);
    }
    const leaveFile=path.match(/^\/sick-leaves\/([^/]+)\/file$/);
    if(leaveFile&&method==='GET'){
      const item=await db.prepare('SELECT * FROM hr_sick_leaves WHERE id=?').bind(leaveFile[1]).first();
      if(!item||(!hrAllowed(permissions,'leaves')&&item.username!==profile.username))return respond({message:'Attachment not found'},404);
      const object=await env.trainer_kb_files.get(item.file_key);if(!object)return respond({message:'Attachment unavailable'},404);
      return new Response(object.body,{headers:{'Content-Type':item.file_type,'Content-Disposition':'attachment; filename="sick-leave.'+(item.file_type==='application/pdf'?'pdf':item.file_type==='image/png'?'png':'jpg')+'"','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Access-Control-Allow-Origin':origin,'Vary':'Origin'}});
    }
    if(!hr)return respond({message:'HR access required'},403);
    if((path==='/attendance'||path==='/export')&&method==='GET'){
      const month=url.searchParams.get('month')||today.slice(0,7);if(!validHrMonth(month))return respond({message:'Invalid month'},400);
      return respond(await hrAttendanceReport(db,month,{controlsFor,grace}));
    }
    if(path==='/attendance'&&['PATCH','DELETE'].includes(method)){
      const body=await request.json(),username=String(body.username||''),day=String(body.day||''),reason=String(body.reason||'').trim();
      if(!validHrDay(day)||day>today||!(await employee(db,username))||reason.length<3||reason.length>1000)return respond({message:'Choose an employee, today or a past date, and enter a correction reason.'},400);
      const previous=await db.prepare('SELECT * FROM hr_attendance WHERE username=? AND day=?').bind(username,day).first();
      if(method==='DELETE'){
        if(!previous)return respond({ok:true,duplicate:true});
        await db.batch([db.prepare('DELETE FROM hr_attendance WHERE username=? AND day=?').bind(username,day),audit(db,profile,'delete_attendance',username,{day,reason,previous},now)]);
        return respond({ok:true});
      }
      const savedControls=await controlsFor(db,[day]),dated=savedControls.find(row=>row.key===`shift_${username}_${day}`);
      const shift=dated?.value||(day===today?hrShiftValue(savedControls,username,day):'')||previous?.scheduled_shift||'',correction=hrCorrection(body,shift);
      if(correction.error)return respond({message:correction.error},400);
      if(!correction.punch_out&&await db.prepare('SELECT day FROM hr_attendance WHERE username=? AND day<>? AND punch_out IS NULL LIMIT 1').bind(username,day).first())return respond({message:'Close the other open attendance session first.'},409);
      await db.batch([db.prepare('INSERT INTO hr_attendance(username,day,punch_in,punch_out,scheduled_shift,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(username,day) DO UPDATE SET punch_in=excluded.punch_in,punch_out=excluded.punch_out,scheduled_shift=excluded.scheduled_shift,updated_at=excluded.updated_at').bind(username,day,correction.punch_in,correction.punch_out,shift,now,now),audit(db,profile,'correct_attendance',username,{day,reason,previous,punch_in:correction.punch_in,punch_out:correction.punch_out},now)]);
      return respond({ok:true});
    }
    if(path==='/check'&&method==='GET'){
      const [revision,presence]=await Promise.all([db.prepare("SELECT value FROM app_control WHERE key='hr_revision'").first(),all(db.prepare("SELECT username,status,last_ping_at,project_name FROM admin_live_pings WHERE last_ping_at>=? ORDER BY last_ping_at DESC LIMIT 300").bind(new Date(Date.now()-300000).toISOString()))]);
      return respond({revision:revision?.value||'initial',presence:hrAllowed(permissions,'online')?presence:[],server_now:now});
    }
    if(path==='/analytics'&&method==='GET'){
      const month=url.searchParams.get('month')||today.slice(0,7);if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return respond({message:'Invalid month'},400);
      const revision=await db.prepare("SELECT value FROM app_control WHERE key='hr_revision'").first();
      const report=await hrAnalytics(db,month,{controlsFor,grace});
      const performance=url.searchParams.get('view')==='performance';
      report.roster=report.roster.map(user=>performance?{username:user.username,full_name:user.full_name,role:user.role,kpi:user.kpi}:{...user,kpi:hrAllowed(permissions,'performance')?user.kpi:null});
      return respond({...report,revision:revision?.value||'initial'});
    }
    if(path==='/dashboard'&&method==='GET'){
      const day=url.searchParams.get('day')||today;if(!validHrDay(day))return respond({message:'Invalid day'},400);
      const revision=await db.prepare("SELECT value FROM app_control WHERE key='hr_revision'").first();
      const sunday=hrDateOffset(day,-new Date(day+'T12:00:00Z').getUTCDay()),dates=Array.from({length:7},(_,index)=>hrDateOffset(sunday,index));
      const [employees,controls,punches,leaves,actions,presence,requests]=await Promise.all([
        all(db.prepare("SELECT username,full_name,role FROM trainer_users WHERE active=1 AND role IN ('agent','quality','trainer') ORDER BY full_name")),controlsFor(db,[...dates,hrDateOffset(day,-1)]),
        all(db.prepare('SELECT * FROM hr_attendance WHERE day IN (?,?)').bind(day,hrDateOffset(day,-1))),all(db.prepare('SELECT id,username,start_date,end_date,note,status,created_at,reviewed_at,reviewed_by FROM hr_sick_leaves WHERE start_date<=? AND end_date>=? ORDER BY created_at DESC').bind(dates[6],hrDateOffset(dates[0],-1))),
        all(db.prepare('SELECT * FROM hr_actions WHERE action_date>=? AND action_date<=? ORDER BY created_at DESC').bind(dates[0],dates[6])),all(db.prepare('SELECT username,status,last_ping_at,project_name FROM admin_live_pings WHERE last_ping_at>=? ORDER BY last_ping_at DESC LIMIT 300').bind(new Date(Date.now()-300000).toISOString())),all(db.prepare("SELECT * FROM hr_employee_requests WHERE status='pending' OR (start_date<=? AND end_date>=?) ORDER BY created_at DESC LIMIT 500").bind(dates[6],hrDateOffset(dates[0],-1)))
      ]);
      const roster=employees.map(user=>{
        const previous=hrDateOffset(day,-1),previousWindow=hrShiftWindow(previous,hrShiftValue(controls,user.username,previous));
        const attendanceDay=day===today&&previousWindow&&Date.now()>=previousWindow.start&&Date.now()<previousWindow.end?previous:day;
        const shift=hrShiftValue(controls,user.username,attendanceDay),attendance=punches.find(row=>row.username===user.username&&row.day===attendanceDay)||null,leave=leaves.find(row=>row.username===user.username&&row.status==='approved'&&row.start_date<=attendanceDay&&row.end_date>=attendanceDay);
        const own=requests.filter(r=>r.username===user.username);
        return {...user,attendance_day:attendanceDay,shift,attendance,leave,requests:own,work_summary:hrWorkSummary({day:attendanceDay,shift,attendance,leave,requests:own}),...hrAttendanceStatus({day:attendanceDay,shift,attendance,leave,requests:own,grace}),online:presence.some(row=>row.username===user.username&&hrPresence(row)==='online')};
      });
      const visibleRoster=roster.map(row=>hrAllowed(permissions,'attendance')?{...row,online:hrAllowed(permissions,'online')?row.online:false,leave:row.leave?{status:row.leave.status,start_date:row.leave.start_date,end_date:row.leave.end_date}:null,requests:row.requests.filter(r=>r.status==='approved').map(r=>({request_type:r.request_type,status:r.status,start_date:r.start_date,end_date:r.end_date,start_time:r.start_time,end_time:r.end_time}))}:{username:row.username,full_name:row.full_name,role:row.role,shift:hrAllowed(permissions,'schedule')?row.shift:'',online:hrAllowed(permissions,'online')?row.online:false});
      return respond({profile:{username:profile.username,full_name:profile.full_name,role},can_manage:manage,permissions,day,dates,roster:visibleRoster,controls:hrAllowed(permissions,'schedule')?controls:[],leaves:hrAllowed(permissions,'leaves')?leaves:[],actions:hrAllowed(permissions,'actions')?actions:[],presence:hrAllowed(permissions,'online')?presence:[],requests:hrAllowed(permissions,'leaves')?requests:[],revision:revision?.value||'initial',server_now:now,grace});
    }
    if(!resource||!hrAllowed(permissions,resource,true))return respond({message:'Write permission required for changes'},403);
    const deletion=path.match(/^\/(actions|sick-leaves)\/([^/]+)$/);
    if(deletion&&method==='DELETE'){
      const table=deletion[1]==='actions'?'hr_actions':'hr_sick_leaves',item=await db.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(deletion[2]).first();
      if(!item)return respond({ok:true});
      const statements=[db.prepare(`DELETE FROM ${table} WHERE id=?`).bind(item.id),audit(db,profile,deletion[1]==='actions'?'delete_action':'delete_sick_leave',item.id,{username:item.username},now)];
      if(item.file_key)statements.unshift(db.prepare('INSERT INTO hr_file_cleanup(file_key,queued_at) VALUES(?,?) ON CONFLICT(file_key) DO NOTHING').bind(item.file_key,now));
      await db.batch(statements);
      let pending=false;
      if(item.file_key){try{await env.trainer_kb_files.delete(item.file_key);await db.prepare('DELETE FROM hr_file_cleanup WHERE file_key=?').bind(item.file_key).run()}catch{pending=true}}
      return respond({ok:true,file_cleanup_pending:pending});
    }
    if(path==='/schedule'&&method==='POST'){
      const body=await request.json(),username=String(body.username||''),day=String(body.day||''),value=String(body.value||'').trim();
      if(!validHrDay(day)||!(await employee(db,username))||(value!=='OFF'&&!hrShiftWindow(day,value)))return respond({message:'Invalid employee, date or shift'},400);
      const key=`shift_${username}_${day}`,previous=await db.prepare('SELECT value FROM app_control WHERE key=?').bind(key).first();
      await db.batch([db.prepare('INSERT INTO app_control(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at').bind(key,value,now),audit(db,profile,'schedule',username,{day,previous:previous?.value||null,value},now)]);
      return respond({ok:true});
    }
    if(path==='/actions'&&method==='POST'){
      const body=await request.json(),username=String(body.username||''),message=String(body.message||'').trim(),day=String(body.day||today);
      if(!(await employee(db,username))||!validHrDay(day)||message.length<3||message.length>2000)return respond({message:'Choose an employee and enter a verbal action (3–2000 characters).'},400);
      const id=crypto.randomUUID();await db.batch([db.prepare("INSERT INTO hr_actions(id,username,action_date,action_type,message,created_by,created_at) VALUES(?,?,?,'verbal',?,?,?)").bind(id,username,day,message,profile.username,now),audit(db,profile,'verbal_action',username,{id,day},now)]);
      return respond({id},201);
    }
    const review=path.match(/^\/sick-leaves\/([^/]+)$/);
    if(review&&method==='PATCH'){
      const {status}=await request.json();if(!['approved','rejected'].includes(status))return respond({message:'Invalid leave decision'},400);
      const item=await db.prepare('SELECT * FROM hr_sick_leaves WHERE id=?').bind(review[1]).first();if(!item)return respond({message:'Sick leave not found'},404);
      if(status==='approved'&&await db.prepare("SELECT id FROM hr_employee_requests WHERE username=? AND status='approved' AND request_type IN ('annual','short_leave') AND start_date<=? AND end_date>=? LIMIT 1").bind(item.username,item.end_date,item.start_date).first())return respond({message:'Sick leave overlaps approved time off.'},409);
      await db.batch([db.prepare('UPDATE hr_sick_leaves SET status=?,reviewed_at=?,reviewed_by=?,decision_seen_at=NULL WHERE id=?').bind(status,now,profile.username,item.id),audit(db,profile,'leave_review',item.id,{status},now)]);
      return respond({ok:true});
    }
    return respond({message:'HR route not found'},404);
  };
}
