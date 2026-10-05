import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import {hrDay,hrDateOffset,hrShiftWindow,hrShiftValue,hrAttendanceStatus,hrPresence,canManageHr} from '../hr-core.js';
import {createHrHandler,cleanupHrFiles} from '../hr-service.js';

function fixture(){
  const directory=mkdtempSync(join(tmpdir(),'newtel-hr-test-')),file=join(directory,'fixture.sqlite');
  const quote=value=>value===null?'NULL':typeof value==='number'?String(value):"'"+String(value).replaceAll("'","''")+"'";
  const sql=text=>JSON.parse(execFileSync('sqlite3',['-json',file],{input:text,encoding:'utf8'})||'[]');
  const db={prepare(text){return {args:[],bind(...args){this.args=args;return this},compile(){let index=0;return text.replace(/\?/g,()=>quote(this.args[index++]))},async all(){return {results:sql(this.compile())}},async first(){return sql(this.compile())[0]||null},async run(){sql(this.compile());return {success:true}}}},async batch(statements){sql('BEGIN;'+statements.map(item=>item.compile()+';').join('')+'COMMIT;');return statements.map(()=>({success:true}))}};
  sql(`CREATE TABLE app_control(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);CREATE TABLE trainer_users(username TEXT PRIMARY KEY,full_name TEXT,role TEXT,active INTEGER);CREATE TABLE admin_live_pings(username TEXT,status TEXT,last_ping_at TEXT,project_name TEXT);INSERT INTO trainer_users VALUES('agent-one','Agent One','agent',1),('agent-two','Agent Two','agent',1);`);
  sql(readFileSync(new URL('../migrations/0005_hr_attendance.sql',import.meta.url),'utf8'));
  sql(readFileSync(new URL('../migrations/0006_hr_live_updates.sql',import.meta.url),'utf8'));
  const files=new Map(),env={trainer_kb:db,trainer_kb_files:{async put(key,bytes,options){files.set(key,{bytes,type:options.httpMetadata.contentType})},async get(key){const item=files.get(key);return item?{body:item.bytes}:null},async delete(key){files.delete(key)}}};
  let profile={username:'agent-one',role:'agent',full_name:'Agent One'};
  const route=createHrHandler({authenticate:async()=>profile?{profile}:null,json:(body,status=200,headers={})=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json',...headers}})});
  return {db,sql,files,env,setProfile(value){profile=value},async request(path,method='GET',body){const url=new URL('https://fixture.invalid/functions/v1/hr'+path),form=body instanceof FormData;return route(new Request(url,{method,headers:body&&!form?{'Content-Type':'application/json'}:{},body:body?form?body:JSON.stringify(body):undefined}),env,url)},close(){rmSync(directory,{recursive:true,force:true})}};
}

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
  const form={dataset:{dirty:'1'},remove(){}},cell={dataset:{scheduleUser:'agent-one',scheduleDay:'2026-10-05'},remove(){}},open={dataset:{schedulePerson:'agent-one'}};
  let keptForm=null,keptCell=null;const replacementForm={replaceWith:value=>keptForm=value},replacementCell={dataset:cell.dataset,replaceWith:value=>keptCell=value},newDetails={dataset:open.dataset,open:false};let rendered=false;
  const holder={querySelectorAll:selector=>selector==='[data-schedule-day][data-dirty="1"]'?[cell]:selector==='[data-schedule-person][open]'?[open]:selector==='[data-schedule-day]'?[replacementCell]:[newDetails]};
  const ctx=vm.createContext({$:id=>id==='hrView'?holder:rendered?replacementForm:form,render:()=>rendered=true});vm.runInContext(source.slice(source.indexOf('function renderPreservingDrafts(){'),source.indexOf('async function deleteHrRecord(')),ctx);ctx.renderPreservingDrafts();assert.equal(keptForm,form);assert.equal(keptCell,cell);assert.equal(newDetails.open,true);
  const employee=readFileSync(new URL('../employee-hr.js',import.meta.url),'utf8');assert.match(employee,/replaceWith\(retainedLeave\)/);assert.match(employee,/employeeHrState=\{\.\.\.employeeHrState,\.\.\.result\}/);
});
