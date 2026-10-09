import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import {hrDay,hrDateOffset,hrShiftWindow,hrShiftValue,hrAttendanceStatus,hrPresence,canManageHr,hrLeaveWindow,hrWorkSummary,hrNextWeek} from '../hr-core.js';
import {createHrHandler,cleanupHrFiles} from '../hr-service.js';
import {HR_RESOURCES,defaultHrPermissions} from '../hr-permissions.js';
import {attendanceExportRows,downloadAttendanceExcel} from '../hr-export.js';

function fixture(){
  const directory=mkdtempSync(join(tmpdir(),'newtel-hr-test-')),file=join(directory,'fixture.sqlite');
  const quote=value=>value===null?'NULL':typeof value==='number'?String(value):"'"+String(value).replaceAll("'","''")+"'";
  const sql=text=>JSON.parse(execFileSync('sqlite3',['-json',file],{input:text,encoding:'utf8'})||'[]');
  const db={prepare(text){return {args:[],bind(...args){this.args=args;return this},compile(){let index=0;return text.replace(/\?/g,()=>quote(this.args[index++]))},async all(){return {results:sql(this.compile())}},async first(){return sql(this.compile())[0]||null},async run(){sql(this.compile());return {success:true}}}},async batch(statements){sql('BEGIN;'+statements.map(item=>item.compile()+';').join('')+'COMMIT;');return statements.map(()=>({success:true}))}};
  sql(`CREATE TABLE app_control(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);CREATE TABLE trainer_users(username TEXT PRIMARY KEY,full_name TEXT,role TEXT,active INTEGER);CREATE TABLE admin_live_pings(username TEXT,status TEXT,last_ping_at TEXT,project_name TEXT);INSERT INTO trainer_users VALUES('agent-one','Agent One','agent',1),('agent-two','Agent Two','agent',1);`);
  sql(readFileSync(new URL('../migrations/0005_hr_attendance.sql',import.meta.url),'utf8'));
  sql(readFileSync(new URL('../migrations/0006_hr_live_updates.sql',import.meta.url),'utf8'));
  sql('CREATE TABLE agent_kpi_monthly(id TEXT PRIMARY KEY,username TEXT,period_start TEXT,period_end TEXT,kpi_score REAL,quality_score REAL,data_from TEXT,data_to TEXT,updated_at TEXT,details TEXT,total_calls INTEGER);');
  sql(readFileSync(new URL('../migrations/0007_hr_requests.sql',import.meta.url),'utf8'));
  sql(readFileSync(new URL('../migrations/0008_hr_permissions.sql',import.meta.url),'utf8'));
  sql('ALTER TABLE trainer_users ADD COLUMN id TEXT;ALTER TABLE trainer_users ADD COLUMN auth_user_id TEXT;ALTER TABLE trainer_users ADD COLUMN created_at TEXT;ALTER TABLE trainer_users ADD COLUMN updated_at TEXT;CREATE TABLE auth_accounts(id TEXT PRIMARY KEY,email TEXT UNIQUE,password_hash TEXT,user_metadata TEXT,created_at TEXT,active INTEGER);');
  const files=new Map(),env={UCM_ATTENDANCE_ONLY:'false',trainer_kb:db,trainer_kb_files:{async put(key,bytes,options){files.set(key,{bytes,type:options.httpMetadata.contentType})},async get(key){const item=files.get(key);return item?{body:item.bytes}:null},async delete(key){files.delete(key)}}};
  let profile={username:'agent-one',role:'agent',full_name:'Agent One'};
  const route=createHrHandler({hashPassword:async()=> 'fixture-hash-not-a-credential',authenticate:async()=>profile?{profile}:null,json:(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json',...headers}})});
  return {db,sql,files,env,setProfile(value){profile=value},async request(path,method='GET',body){const url=new URL('https://fixture.invalid/functions/v1/hr'+path),form=body instanceof FormData;return route(new Request(url,{method,headers:body&&!form?{'Content-Type':'application/json'}:{},body:body?form?body:JSON.stringify(body):undefined}),env,url)},close(){rmSync(directory,{recursive:true,force:true})}};
}

test('queue-login attendance mode forbids manual check-in but retains manual checkout',async()=>{
  const f=fixture();try{
    delete f.env.UCM_ATTENDANCE_ONLY;
    const response=await f.request('/punch','POST',{action:'in'});assert.equal(response.status,409);assert.match((await response.json()).message,/first queue login/);
    const day=hrDay();f.sql(`INSERT INTO hr_attendance VALUES('agent-one','${day}','${day}T05:00:00.000Z',NULL,'08:00 - 17:00','fixture','fixture');`);
    assert.equal((await f.request('/punch','POST',{action:'out'})).status,200);
    assert.ok(f.sql('SELECT punch_out FROM hr_attendance')[0].punch_out);
    assert.equal((await (await f.request('/me')).json()).attendance_mode,'queue_login');
  }finally{f.close()}
});

test('admin corrections are audited, validated, idempotent and delete only the selected daily punch',async()=>{
  const f=fixture();try{
    const day='2026-09-20';f.sql(`INSERT INTO app_control VALUES('shift_agent-one_${day}','08:00 - 17:00','fixture'),('shift_agent-two_${day}','08:00 - 17:00','fixture');`);
    const body={username:'agent-one',day,punch_in:day+'T08:05:00+03:00',punch_out:day+'T17:00:00+03:00',reason:'Correct a missed punch'};
    assert.equal((await f.request('/attendance','PATCH',body)).status,403);
    f.setProfile({username:'main-admin',role:'admin'});
    assert.equal((await f.request('/attendance','PATCH',{...body,reason:''})).status,400);
    assert.equal((await f.request('/attendance','PATCH',{...body,punch_out:day+'T07:00:00+03:00'})).status,400);
    assert.equal((await f.request('/attendance','PATCH',{...body,day:'2026-09-21'})).status,400);
    assert.equal((await f.request('/attendance','PATCH',body)).status,200);
    assert.equal((await f.request('/attendance','PATCH',body)).status,200);
    assert.equal(f.sql('SELECT * FROM hr_attendance').length,1);
    assert.equal(f.sql("SELECT * FROM hr_audit WHERE action='correct_attendance'").length,2);
    await f.request('/attendance','PATCH',{...body,username:'agent-two'});
    const revision=f.sql("SELECT value FROM app_control WHERE key='hr_revision'")[0].value;
    assert.equal((await f.request('/attendance','DELETE',{username:'agent-one',day,reason:'Remove incorrect record'})).status,200);
    assert.equal(f.sql('SELECT username FROM hr_attendance')[0].username,'agent-two');
    assert.notEqual(f.sql("SELECT value FROM app_control WHERE key='hr_revision'")[0].value,revision);
    const audit=JSON.parse(f.sql("SELECT details FROM hr_audit WHERE action='delete_attendance'")[0].details);assert.equal(audit.previous.punch_in,'2026-09-20T05:05:00.000Z');
  }finally{f.close()}
});
test('employee monthly history is private and distinguishes missing punches from unknown schedules and OFF',async()=>{
  const f=fixture();try{
    f.sql("INSERT INTO app_control VALUES('shift_agent-one_2026-09-20','08:00 - 17:00','fixture'),('shift_agent-one_2026-09-21','OFF','fixture'),('shift_agent-one_2026-09-22','08:00 - 17:00','fixture');INSERT INTO hr_attendance VALUES('agent-one','2026-09-22','2026-09-22T05:00:00Z',NULL,'08:00 - 17:00','fixture','fixture');");
    const report=await (await f.request('/me/attendance?month=2026-09&username=agent-two')).json();
    assert.equal(report.rows.length,30);assert.ok(report.rows.every(r=>r.username==='agent-one'));
    assert.equal(report.rows.find(r=>r.day==='2026-09-20').status,'absent');assert.equal(report.rows.find(r=>r.day==='2026-09-20').late_minutes,0);assert.equal(report.rows.find(r=>r.day==='2026-09-21').status,'off');assert.equal(report.rows[0].status,'not_scheduled');assert.equal(report.rows.find(r=>r.day==='2026-09-22').missing_check_out,true);
    assert.equal((await f.request('/me/attendance?month=2026-13')).status,400);assert.equal((await f.request('/export?month=2026-09')).status,403);
  }finally{f.close()}
});
test('HR permission matrix is enforced on read, write, export, attachments, analytics and dashboard payloads',async()=>{
  const f=fixture();try{
    const permissions=Object.fromEntries(HR_RESOURCES.map(k=>[k,'none']));permissions.schedule='read';permissions.performance='read';
    f.sql(`INSERT INTO hr_staff_permissions VALUES('limited','${JSON.stringify(permissions)}','admin','fixture');`);f.setProfile({username:'limited',role:'hr'});
    assert.equal((await f.request('/attendance?month=2026-09')).status,403);assert.equal((await f.request('/export?month=2026-09')).status,403);assert.equal((await f.request('/requests')).status,403);assert.equal((await f.request('/sick-leaves/private/file')).status,403);
    assert.equal((await f.request('/schedule','POST',{username:'agent-one',day:'2026-09-20',value:'08:00 - 17:00'})).status,403);
    assert.equal((await f.request('/analytics?month=2026-09')).status,403);
    const performance=await (await f.request('/analytics?month=2026-09&view=performance')).json();assert.ok(performance.roster.every(r=>!('daily' in r)&&!('action_count' in r)));
    const dashboard=await (await f.request('/dashboard')).json();assert.deepEqual(dashboard.actions,[]);assert.deepEqual(dashboard.presence,[]);assert.ok(dashboard.roster.every(r=>!('attendance' in r)&&!('requests' in r)));
    permissions.attendance='write';f.sql(`UPDATE hr_staff_permissions SET permissions_json='${JSON.stringify(permissions)}' WHERE username='limited';INSERT INTO app_control VALUES('shift_agent-one_2026-09-20','08:00 - 17:00','fixture');`);
    assert.equal((await f.request('/attendance','PATCH',{username:'agent-one',day:'2026-09-20',punch_in:'2026-09-20T08:00:00+03:00',reason:'Attendance correction'})).status,200);
    assert.equal((await f.request('/actions','POST',{username:'agent-one',message:'Not allowed'})).status,403);
  }finally{f.close()}
});
test('HR Admin creates an HR employee with hashed credentials and changes permissions without escalation',async()=>{
  const f=fixture();try{
    const permissions=defaultHrPermissions('hr'),body={username:'hr-new',full_name:'HR Fixture',password:'fixture-password-only',permissions};
    f.setProfile({username:'reader',role:'hr'});assert.equal((await f.request('/staff','POST',body)).status,403);
    f.setProfile({username:'hr-manager',role:'hr_admin'});assert.equal((await f.request('/staff','POST',body)).status,201);
    const account=f.sql('SELECT * FROM auth_accounts')[0];assert.equal(account.password_hash,'fixture-hash-not-a-credential');assert.doesNotMatch(JSON.stringify(f.sql('SELECT * FROM hr_audit')),/fixture-password-only/);
    assert.equal(f.sql("SELECT role FROM trainer_users WHERE username='hr-new'")[0].role,'hr');
    assert.equal((await f.request('/staff','POST',body)).status,409);
    permissions.schedule='write';assert.equal((await f.request('/staff/hr-new','PATCH',{permissions})).status,200);
    permissions.staff='write';assert.equal((await f.request('/staff/hr-new','PATCH',{permissions})).status,400);
    permissions.staff='none';f.setProfile({username:'hr-new',role:'hr'});assert.equal((await f.request('/staff/hr-new','PATCH',{permissions})).status,403);
  }finally{f.close()}
});
test('Excel export keeps dates numeric, identifiers literal and missing punches empty',()=>{
  const report={month:'2026-09',rows:[{username:'001',full_name:'=not-a-formula',role:'agent',day:'2026-09-20',shift:'08:00 - 17:00',status:'absent',attendance:null,late_minutes:0,work_minutes:0,required_minutes:540,approved_leave_minutes:0}]};
  const rows=attendanceExportRows(report);assert.equal(rows[0].Username,'001');assert.equal(rows[0].Employee,'=not-a-formula');assert.equal(rows[0]['Check-in (Amman)'],null);assert.equal(typeof rows[0].Date,'number');assert.equal(rows[0]['Required minutes'],540);
  let exported=false;const sheet={'!ref':'A1:M2',D2:{t:'n',v:rows[0].Date}};
  downloadAttendanceExcel(report,{utils:{json_to_sheet:()=>sheet,decode_range:()=>({e:{r:1}}),encode_cell:({r,c})=>String.fromCharCode(65+c)+(r+1),book_new:()=>({}),book_append_sheet:()=>{}},writeFile:(_,name)=>{exported=name==='NEWTEL-Attendance-2026-09.xlsx'}});
  assert.ok(exported);assert.equal(sheet.D2.z,'dd mmm yyyy');assert.ok(sheet['!cols'].length===13);
});
test('HR attendance distinguishes no schedule, OFF, absence, late punches and overnight shifts',()=>{
  const day='2026-10-05',shift='23:00 - 08:00',window=hrShiftWindow(day,shift);
  assert.equal(window.end-window.start,9*3600000);
  assert.equal(hrDay('2026-10-05T22:00:00Z'),'2026-10-06');
  assert.equal(hrDateOffset(day,-1),'2026-10-04');
  assert.equal(hrAttendanceStatus({day,shift:'',now:window.end}).status,'not_scheduled');
  assert.equal(hrAttendanceStatus({day,shift:'OFF',now:window.end}).status,'off');
  assert.equal(hrAttendanceStatus({day,shift,now:window.start-1}).status,'upcoming');
  assert.equal(hrAttendanceStatus({day,shift,now:window.start+60000}).status,'missing_login');
  assert.equal(hrAttendanceStatus({day,shift,now:window.end}).status,'absent');
  const attendance={punch_in:new Date(window.start+6*60000).toISOString()};
  assert.equal(hrAttendanceStatus({day,shift,attendance,grace:5}).late_minutes,1);
  assert.equal(hrAttendanceStatus({day,shift,attendance:{...attendance,punch_out:new Date(window.end).toISOString()}}).status,'checked_out');
  assert.equal(hrAttendanceStatus({day,shift,leave:{status:'approved'}}).status,'sick_leave');
  assert.equal(hrShiftWindow(day,'25:00 - 09:00'),null);
  assert.equal(hrShiftWindow('2026-02-30','08:00 - 17:00'),null);
  assert.equal(hrShiftValue([{key:'shift_a_mon',value:'08:00 - 17:00'},{key:'shift_a_'+day,value:'OFF'}],'a',day),'OFF');
  assert.equal(hrPresence({status:'online',last_ping_at:new Date(window.start).toISOString()},window.start+300001),'offline');
  assert.equal(canManageHr('hr'),false);assert.equal(canManageHr('hr_admin'),true);
});

test('real SQLite: first daily punch persists across reloads and duplicate in/out; old open session remains closable',async()=>{
  const f=fixture();try{
    const day=hrDay();f.sql(`INSERT INTO app_control VALUES('shift_agent-one_${day}','08:00 - 17:00','fixture');`);
    const first=await (await f.request('/punch','POST',{action:'in'})).json();
    const second=await (await f.request('/punch','POST',{action:'in',username:'agent-two',punch_in:'fake'})).json();
    assert.equal(first.attendance.punch_in,second.attendance.punch_in);
    const me=await (await f.request('/me')).json();assert.equal(me.attendance.punch_in,first.attendance.punch_in);
    const out=await (await f.request('/punch','POST',{action:'out'})).json();
    const repeated=await (await f.request('/punch','POST',{action:'out'})).json();assert.equal(repeated.attendance.punch_out,out.attendance.punch_out);
    assert.equal(f.sql('SELECT * FROM hr_attendance').length,1);
    assert.equal(f.sql("SELECT * FROM hr_attendance WHERE username='agent-two'").length,0);
    const old=hrDateOffset(day,-4);f.sql(`DELETE FROM hr_attendance;INSERT INTO hr_attendance VALUES('agent-one','${old}','${old}T05:00:00Z',NULL,'08:00 - 17:00','fixture','fixture');`);
    const oldMe=await (await f.request('/me')).json();assert.equal(oldMe.day,old);assert.equal(oldMe.shift,'08:00 - 17:00');
    assert.equal((await f.request('/punch','POST',{action:'in'})).status,409);
    assert.equal((await f.request('/punch','POST',{action:'out'})).status,200);
  }finally{f.close()}
});

test('real SQLite: HR read-only enforced on server, admin saves shared schedule and employee-only acknowledgment',async()=>{
  const f=fixture();try{
    f.setProfile(null);assert.equal((await f.request('/dashboard')).status,401);
    f.setProfile({username:'reader',role:'hr'});assert.equal((await f.request('/dashboard')).status,200);
    for(const [path,body] of [['/schedule',{username:'agent-one',day:hrDay(),value:'OFF'}],['/actions',{username:'agent-one',message:'fixture'}]])assert.equal((await f.request(path,'POST',body)).status,403);
    f.setProfile({username:'manager',role:'hr_admin'});
    const revision=f.sql("SELECT value FROM app_control WHERE key='hr_revision'")[0].value;
    assert.equal((await f.request('/schedule','POST',{username:'agent-one',day:hrDay(),value:'08:00 - 17:00'})).status,200);
    assert.notEqual(f.sql("SELECT value FROM app_control WHERE key='hr_revision'")[0].value,revision);
    const action=await (await f.request('/actions','POST',{username:'agent-one',message:'Fixture verbal notice'})).json();
    f.setProfile({username:'agent-two',role:'agent'});assert.equal((await f.request(`/actions/${action.id}/ack`,'POST')).status,404);assert.equal((await f.request('/dashboard')).status,403);
    f.setProfile({username:'agent-one',role:'agent'});
    assert.equal((await (await f.request('/me')).json()).warnings.length,1);
    assert.equal((await f.request(`/actions/${action.id}/ack`,'POST')).status,200);
    const acknowledged=f.sql('SELECT acknowledged_at FROM hr_actions')[0].acknowledged_at;
    assert.equal((await f.request(`/actions/${action.id}/ack`,'POST')).status,200);
    assert.equal(f.sql('SELECT acknowledged_at FROM hr_actions')[0].acknowledged_at,acknowledged);
    assert.equal((await (await f.request('/me')).json()).warnings.length,0);
    assert.equal(f.sql("SELECT * FROM hr_audit WHERE action='acknowledge'").length,1);
  }finally{f.close()}
});

test('HR today dashboard follows an ongoing overnight shift from yesterday',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-06T00:00:00Z')});
  const f=fixture();try{
    f.sql("INSERT INTO app_control VALUES('shift_agent-one_2026-10-05','23:00 - 08:00','fixture'),('shift_agent-one_2026-10-06','OFF','fixture');");
    f.setProfile({username:'reader',role:'hr'});
    const data=await (await f.request('/dashboard')).json(),person=data.roster.find(row=>row.username==='agent-one');
    assert.equal(person.attendance_day,'2026-10-05');assert.equal(person.status,'missing_login');assert.equal(person.late_minutes,240);
    const historical=await (await f.request('/dashboard?day=2026-10-05')).json();assert.equal(historical.roster[0].attendance_day,'2026-10-05');
  }finally{f.close();t.mock.timers.reset()}
});

test('real SQLite: sick leave upload validates actual content, private attachment restricted, review requires HR admin',async()=>{
  const f=fixture();try{
    const form=()=>{const data=new FormData();data.set('start_date',hrDay());data.set('end_date',hrDay());return data};
    const invalid=form();invalid.set('file',new Blob(['not a PDF'],{type:'application/pdf'}),'fixture.pdf');
    assert.equal((await f.request('/sick-leaves','POST',invalid)).status,400);assert.equal(f.files.size,0);
    const valid=form();valid.set('file',new Blob(['%PDF-1.7 fixture only'],{type:'application/pdf'}),'fixture.pdf');
    const response=await f.request('/sick-leaves','POST',valid);assert.equal(response.status,201);const {id}=await response.json();
    f.setProfile({username:'agent-two',role:'agent'});assert.equal((await f.request(`/sick-leaves/${id}/file`)).status,404);
    f.setProfile({username:'reader',role:'hr'});const download=await f.request(`/sick-leaves/${id}/file`);assert.equal(download.status,200);assert.equal(download.headers.get('Access-Control-Allow-Origin'),'*');assert.equal(download.headers.get('Cache-Control'),'no-store');assert.equal((await f.request(`/sick-leaves/${id}`,'PATCH',{status:'approved'})).status,403);
    f.setProfile({username:'manager',role:'hr_admin'});assert.equal((await f.request(`/sick-leaves/${id}`,'PATCH',{status:'approved'})).status,200);
    assert.equal(f.sql('SELECT status FROM hr_sick_leaves')[0].status,'approved');
    f.setProfile({username:'agent-one',role:'agent'});assert.equal((await (await f.request('/me')).json()).status,'sick_leave');
  }finally{f.close()}
});

test('HR frontend has mobile-safe navigation, employee login hook and private storage guard; all new browser scripts parse',()=>{
  const ebook=readFileSync(new URL('../ebook.html',import.meta.url),'utf8'),worker=readFileSync(new URL('../worker.js',import.meta.url),'utf8');
  assert.match(ebook,/function animateBrandWelcome\(user\)\{\s*if\(typeof loadEmployeeHr/);
  assert.match(ebook,/data-portal-view="home"[^>]*id="employeeHrCard"|id="employeeHrCard"[^>]*data-portal-view="home"/);
  assert.match(worker,/rest\.split\('\/'\)\.includes\('hr-sick-leaves'\)/);
  const css=readFileSync(new URL('../hr.css',import.meta.url),'utf8');assert.match(css,/@media\(max-width:760px\)/);assert.match(css,/safe-area-inset-bottom/);assert.match(css,/min-height:48px/);assert.match(css,/\[hidden\].*display:none!important/);
  for(const name of ['hr-auth.js','employee-hr.js'])new vm.Script(readFileSync(new URL('../'+name,import.meta.url),'utf8'));
});

test('revision-only employee checks detect warnings, acknowledgment and deletion without exposing anyone else',async()=>{
  const f=fixture();try{
    const before=await (await f.request('/me/check')).json();assert.deepEqual(Object.keys(before).sort(),['revision','server_now','today']);
    f.setProfile({username:'manager',role:'hr_admin'});const action=await (await f.request('/actions','POST',{username:'agent-one',message:'Fixture only'})).json();
    f.setProfile({username:'agent-one',role:'agent'});const after=await (await f.request('/me/check')).json();assert.notEqual(after.revision,before.revision);assert.equal((await (await f.request('/me')).json()).warnings[0].id,action.id);
    for(const profile of [{username:'agent-one',role:'agent'},{username:'reader',role:'hr'}]){f.setProfile(profile);assert.equal((await f.request('/actions/'+action.id,'DELETE')).status,403)}
    f.setProfile({username:'manager',role:'hr_admin'});assert.equal((await f.request('/actions/'+action.id,'DELETE')).status,200);assert.equal((await f.request('/actions/'+action.id,'DELETE')).status,200);
    f.setProfile({username:'agent-one',role:'agent'});assert.equal((await (await f.request('/me')).json()).warnings.length,0);assert.notEqual((await (await f.request('/me/check')).json()).revision,after.revision);
    assert.equal(f.sql("SELECT * FROM hr_audit WHERE action='delete_action'").length,1);
  }finally{f.close()}
});

test('sick-leave deletion removes the exception, audits it, and safely retries a failed private-file cleanup',async()=>{
  const f=fixture();try{
    const day=hrDay();f.sql(`INSERT INTO app_control VALUES('shift_agent-one_${day}','08:00 - 17:00','fixture');`);
    const form=new FormData();form.set('start_date',day);form.set('end_date',day);form.set('file',new Blob(['%PDF-fixture'],{type:'application/pdf'}),'fixture.pdf');
    const {id}=await (await f.request('/sick-leaves','POST',form)).json();
    f.setProfile({username:'reader',role:'hr'});assert.equal((await f.request('/sick-leaves/'+id,'DELETE')).status,403);
    f.setProfile({username:'manager',role:'hr_admin'});await f.request('/sick-leaves/'+id,'PATCH',{status:'approved'});
    const remove=f.env.trainer_kb_files.delete;f.env.trainer_kb_files.delete=async()=>{throw Error('Fixture storage unavailable')};
    const deleted=await (await f.request('/sick-leaves/'+id,'DELETE')).json();assert.equal(deleted.file_cleanup_pending,true);assert.equal(f.sql('SELECT * FROM hr_sick_leaves').length,0);assert.equal(f.sql('SELECT * FROM hr_file_cleanup').length,1);assert.equal(f.files.size,1);
    f.setProfile({username:'agent-one',role:'agent'});assert.notEqual((await (await f.request('/me')).json()).status,'sick_leave');assert.equal((await f.request('/sick-leaves/'+id+'/file')).status,404);
    f.env.trainer_kb_files.delete=remove;await cleanupHrFiles(f.env);assert.equal(f.files.size,0);assert.equal(f.sql('SELECT * FROM hr_file_cleanup').length,0);assert.equal(f.sql("SELECT * FROM hr_audit WHERE action='delete_sick_leave'").length,1);
  }finally{f.close()}
});

function browserFixture(call){
  const listeners={},intervals=[];
  const context=vm.createContext({currentUser:{username:'agent-one'},NewtelHrApi:{call},document:{hidden:false,getElementById:()=>null,addEventListener:(name,fn)=>listeners[name]=fn},addEventListener:(name,fn)=>listeners[name]=fn,setInterval:(fn,ms)=>intervals.push({fn,ms}),NewTelIdle:{isPaused:()=>false},Promise,Date});
  vm.runInContext(readFileSync(new URL('../employee-hr.js',import.meta.url),'utf8'),context);context.renderEmployeeHr=()=>{};
  return {context,listeners,intervals};
}
test('employee polls only one revision, updates on change and suspends background/idle database calls',async()=>{
  let revision='r1';const calls=[];
  const {context,intervals}=browserFixture(async path=>{calls.push(path);return path==='/me/check'?{revision,today:'2026-10-05',server_now:'2026-10-05T08:00:00Z'}:{revision,today:'2026-10-05',day:'2026-10-05',shift:'08:00 - 17:00',warnings:revision==='r2'?[{id:'new'}]:[],leaves:[]}});
  await context.loadEmployeeHr();await context.checkEmployeeHr();assert.deepEqual(calls,['/me','/me/check']);
  revision='r2';await context.checkEmployeeHr();assert.deepEqual(calls,['/me','/me/check','/me/check','/me']);assert.equal(vm.runInContext('employeeHrState.warnings[0].id',context),'new');
  context.document.hidden=true;await context.checkEmployeeHr();context.document.hidden=false;context.NewTelIdle.isPaused=()=>true;await context.checkEmployeeHr();assert.equal(calls.length,4);assert.equal(intervals[0].ms,10000);
});
test('forced post-punch refresh queues behind an old fetch and cannot replace the newer attendance response',async()=>{
  let release,reads=0,renders=0;const old=new Promise(resolve=>release=resolve);
  const {context}=browserFixture(async()=>{reads++;return reads===1?old:{revision:'new',attendance:{punch_in:'server-new'}}});context.renderEmployeeHr=()=>renders++;
  const initial=context.loadEmployeeHr();vm.runInContext('employeeHrGeneration++;employeeHrState={attendance:{punch_in:"server-new"}}',context);
  const forced=context.loadEmployeeHr({force:true});release({revision:'old',attendance:null});await Promise.all([initial,forced]);
  assert.equal(reads,2);assert.equal(renders,1);assert.equal(vm.runInContext('employeeHrState.attendance.punch_in',context),'server-new');
});
test('HR automatic refresh retains dirty form/cell nodes and mobile file inputs remain attached',()=>{
  const source=readFileSync(new URL('../hr.js',import.meta.url),'utf8');
  assert.match(source,/NewtelLiveDom\.html\(holder/);assert.doesNotMatch(source,/dirtyForm\.remove|cells\.forEach\(node=>node\.remove/);
  const employee=readFileSync(new URL('../employee-hr.js',import.meta.url),'utf8');assert.match(employee,/setAttribute\('data-live-preserve'/);assert.doesNotMatch(employee,/retained.*\.remove\(\)/);assert.match(employee,/employeeHrState=\{\.\.\.employeeHrState,\.\.\.result\}/);
});

test('hourly leave adjusts required work and lateness without inventing hours; overnight and overlaps are handled',()=>{
  const day='2026-10-05',shift='23:00 - 08:00',window=hrShiftWindow(day,shift);
  assert.equal(hrLeaveWindow(day,shift,'01:00','03:00').minutes,120);
  assert.equal(hrLeaveWindow(day,shift,'20:00','21:00'),null);
  const request={status:'approved',request_type:'short_leave',start_date:day,end_date:day,start_time:'23:00',end_time:'01:00'};
  const attendance={punch_in:new Date(window.start+120*60000).toISOString(),punch_out:new Date(window.end).toISOString()};
  const summary=hrWorkSummary({day,shift,attendance,requests:[request]});
  assert.deepEqual(summary,{scheduled_minutes:540,approved_leave_minutes:120,required_minutes:420,recorded_minutes:420,work_minutes:420,remaining_minutes:0});
  assert.equal(hrAttendanceStatus({day,shift,attendance,requests:[request]}).late_minutes,0);
  assert.equal(hrWorkSummary({day,shift,requests:[request]}).work_minutes,0);
  const overlap={...request,start_time:'00:00',end_time:'02:00'};
  assert.equal(hrWorkSummary({day,shift,requests:[request,overlap]}).approved_leave_minutes,180);
  assert.equal(hrWorkSummary({day,shift,attendance:{punch_in:new Date(window.start).toISOString(),punch_out:new Date(window.end).toISOString()},requests:[request]}).work_minutes,420);
  assert.equal(hrWorkSummary({day,shift,attendance,requests:[{...request,request_type:'annual'}]}).required_minutes,0);
});

test('real SQLite: hourly request, role enforcement, approval, owner notification and review idempotency',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-05T09:00:00Z')});
  const f=fixture();try{
    const day=hrDay();f.sql(`INSERT INTO app_control VALUES('shift_agent-one_${day}','08:00 - 17:00','fixture');`);
    assert.equal((await f.request('/requests','POST',{request_type:'short_leave',start_date:day,start_time:'07:00',end_time:'09:00'})).status,400);
    const body={request_type:'short_leave',start_date:day,start_time:'08:00',end_time:'10:00',username:'agent-two'};
    const response=await f.request('/requests','POST',body);assert.equal(response.status,201);const {id}=await response.json();
    assert.equal((await (await f.request('/requests','POST',body)).json()).id,id);assert.equal(f.sql('SELECT * FROM hr_employee_requests').length,1);
    assert.equal(f.sql('SELECT username FROM hr_employee_requests')[0].username,'agent-one');
    f.setProfile({username:'reader',role:'hr'});assert.equal((await f.request('/requests/'+id,'PATCH',{status:'approved'})).status,403);
    f.setProfile({username:'manager',role:'hr_admin'});assert.equal((await f.request('/requests/'+id,'PATCH',{status:'approved'})).status,200);
    assert.equal((await f.request('/requests/'+id,'PATCH',{status:'approved'})).status,200);assert.equal(f.sql("SELECT * FROM hr_audit WHERE action='request_review'").length,1);
    f.setProfile({username:'agent-two',role:'agent'});assert.equal((await f.request('/requests/'+id+'/seen','POST')).status,404);assert.equal((await (await f.request('/me')).json()).requests.length,0);
    f.setProfile({username:'agent-one',role:'agent'});const me=await (await f.request('/me')).json();assert.equal(me.notifications[0].id,id);assert.equal(me.work_summary.required_minutes,420);assert.equal(me.work_summary.work_minutes,0);
    await f.request('/requests/'+id+'/seen','POST');assert.equal((await (await f.request('/me')).json()).notifications.length,0);
    f.setProfile({username:'manager',role:'hr_admin'});await f.request('/requests/'+id,'DELETE');assert.equal(f.sql('SELECT * FROM hr_employee_requests').length,0);
  }finally{f.close();t.mock.timers.reset()}
});

test('next-week preferences do not modify shifts until HR explicitly approves and applies the week',async()=>{
  const f=fixture();try{
    const dates=hrNextWeek(),body={request_type:'schedule_preference',start_date:dates[0],end_date:dates[6],week:[{day:dates[0],value:'OFF'},{day:dates[1],value:'09:00 - 18:00'}]};
    assert.equal((await f.request('/requests','POST',{...body,week:[{day:hrDay(),value:'OFF'}]})).status,400);
    const {id}=await (await f.request('/requests','POST',body)).json();assert.equal(f.sql("SELECT * FROM app_control WHERE key LIKE 'shift_%'").length,0);
    f.setProfile({username:'manager',role:'hr_admin'});await f.request('/requests/'+id,'PATCH',{status:'approved',apply_schedule:true});
    assert.equal(f.sql(`SELECT value FROM app_control WHERE key='shift_agent-one_${dates[0]}'`)[0].value,'OFF');
    assert.equal(f.sql(`SELECT value FROM app_control WHERE key='shift_agent-one_${dates[1]}'`)[0].value,'09:00 - 18:00');
    assert.equal((await f.request('/requests/'+id,'PATCH',{status:'rejected'})).status,409);
  }finally{f.close()}
});

test('approval validates current shifts and prevents overlapping approved leave',async()=>{
  const f=fixture();try{
    const day=hrDay();f.sql(`INSERT INTO app_control VALUES('shift_agent-one_${day}','08:00 - 17:00','fixture');`);
    const {id}=await (await f.request('/requests','POST',{request_type:'short_leave',start_date:day,start_time:'08:00',end_time:'10:00'})).json();
    const second=await (await f.request('/requests','POST',{request_type:'annual',start_date:day,end_date:day})).json();
    f.setProfile({username:'manager',role:'hr_admin'});f.sql(`UPDATE app_control SET value='OFF' WHERE key='shift_agent-one_${day}';`);assert.equal((await f.request('/requests/'+id,'PATCH',{status:'approved'})).status,409);
    f.sql(`UPDATE app_control SET value='08:00 - 17:00' WHERE key='shift_agent-one_${day}';`);await f.request('/requests/'+id,'PATCH',{status:'approved'});
    assert.equal((await f.request('/requests/'+second.id,'PATCH',{status:'approved'})).status,409);
  }finally{f.close()}
});

test('monthly analysis uses Agent360 data and real late punches, never invents KPI or old schedules',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-05T18:00:00Z')});const f=fixture();try{
    f.sql(`INSERT INTO app_control VALUES('shift_agent-one_2026-10-01','08:00 - 17:00','fixture'),('shift_agent-two_mon','08:00 - 17:00','fixture');INSERT INTO hr_attendance VALUES('agent-one','2026-10-01','2026-10-01T05:15:00Z','2026-10-01T14:00:00Z','08:00 - 17:00','fixture','fixture');INSERT INTO agent_kpi_monthly VALUES('fixture','agent-one','2026-10-01','2026-10-31',91.5,NULL,'2026-10-01','2026-10-05','fixture','{"source":"ucm_api"}',10);INSERT INTO hr_actions VALUES('fixture','agent-one','2026-10-01','verbal','Fixture only','manager','fixture',NULL);`);
    f.setProfile({username:'agent-one',role:'agent'});assert.equal((await f.request('/analytics?month=2026-10')).status,403);
    f.setProfile({username:'reader',role:'hr'});assert.equal((await f.request('/analytics?month=2026-99')).status,400);
    const data=await (await f.request('/analytics?month=2026-10')).json(),one=data.roster.find(p=>p.username==='agent-one'),two=data.roster.find(p=>p.username==='agent-two');
    assert.equal(one.kpi.kpi_score,91.5);assert.equal(one.kpi.quality_score,null);assert.equal(one.late_days,1);assert.equal(one.late_minutes,15);assert.equal(one.action_count,1);assert.equal(one.worked_minutes,525);assert.equal(two.kpi,null);assert.equal(two.daily.find(d=>d.day==='2026-10-04').status,'not_scheduled');
    const before=(await (await f.request('/check')).json()).revision;f.sql("UPDATE agent_kpi_monthly SET kpi_score=92 WHERE id='fixture';");assert.notEqual((await (await f.request('/check')).json()).revision,before);
  }finally{f.close();t.mock.timers.reset()}
});

test('HR interfaces are English, dedicated profile requests and animated right navigation remain accessible',()=>{
  for(const name of ['hr.html','hr.js','employee-hr.js','hr-auth.js'])assert.doesNotMatch(readFileSync(new URL('../'+name,import.meta.url),'utf8'),/[\u0600-\u06ff]/);
  const html=readFileSync(new URL('../hr.html',import.meta.url),'utf8'),css=readFileSync(new URL('../hr.css',import.meta.url),'utf8'),ebook=readFileSync(new URL('../ebook.html',import.meta.url),'utf8');
  assert.match(html,/aria-controls="hrSidebar"/);assert.match(html,/data-view="performance"/);assert.match(html,/data-view="lateness"/);assert.match(css,/prefers-reduced-motion/);assert.match(css,/\.hr-sidebar\{[^}]*right:0/);assert.match(ebook,/id="employeeHrProfile"/);
});
