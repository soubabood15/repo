import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import {hrDay,hrDateOffset,hrShiftWindow,hrShiftValue,hrAttendanceStatus,hrPresence,canManageHr} from '../hr-core.js';
import {createHrHandler} from '../hr-service.js';

function fixture(){
  const directory=mkdtempSync(join(tmpdir(),'newtel-hr-test-')),file=join(directory,'fixture.sqlite');
  const quote=value=>value===null?'NULL':typeof value==='number'?String(value):"'"+String(value).replaceAll("'","''")+"'";
  const sql=text=>JSON.parse(execFileSync('sqlite3',['-json',file,text],{encoding:'utf8'})||'[]');
  const db={prepare(text){return {args:[],bind(...args){this.args=args;return this},compile(){let index=0;return text.replace(/\?/g,()=>quote(this.args[index++]))},async all(){return {results:sql(this.compile())}},async first(){return sql(this.compile())[0]||null},async run(){sql(this.compile());return {success:true}}}},async batch(statements){sql('BEGIN;'+statements.map(item=>item.compile()+';').join('')+'COMMIT;');return statements.map(()=>({success:true}))}};
  sql(`CREATE TABLE app_control(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);CREATE TABLE trainer_users(username TEXT PRIMARY KEY,full_name TEXT,role TEXT,active INTEGER);CREATE TABLE admin_live_pings(username TEXT,status TEXT,last_ping_at TEXT,project_name TEXT);INSERT INTO trainer_users VALUES('agent-one','Agent One','agent',1),('agent-two','Agent Two','agent',1);`);
  sql(readFileSync(new URL('../migrations/0005_hr_attendance.sql',import.meta.url),'utf8'));
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
