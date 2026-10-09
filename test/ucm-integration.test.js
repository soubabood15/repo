import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import worker from '../worker.js';
import {connectorHeaders,startQueueConnector} from '../connector/ucm-queue-runtime.mjs';
import {UcmOutbox} from '../connector/ucm-outbox.mjs';
import {ucmKpiScores} from '../ucm-kpi.js';
import {ucmTimestamp} from '../ucm-core.js';
import {finishDailyUcmSync,ucmMonthWindow} from '../ucm-retention.js';
import {recordFirstQueueLogin} from '../ucm-hr-attendance.js';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('production default accepts login/logout only, acknowledges obsolete traffic without writes and creates no KPI',async()=>{
  const f=fixture();try{
    delete f.env.UCM_ATTENDANCE_ONLY;
    const send=payload=>f.request('/integrations/ucm/queue-events',{method:'POST',...connectorHeaders(payload,f.env.UCM_INGEST_USERNAME,f.env.UCM_INGEST_PASSWORD)});
    const cdr=await f.request('/integrations/ucm/cdr',{method:'POST',headers:{Authorization:f.basic},body:JSON.stringify({session:'disabled-call'})});
    assert.equal(cdr.status,202);assert.equal((await cdr.json()).disabled,true);
    assert.equal((await send({event_id:'ignored-pause',agent_extension:'101',event_type:'pause',occurred_at:'2026-10-09 09:00:00'})).status,202);
    for(const table of ['ucm_cdr','ucm_queue_events','ucm_ingest_receipts','agent_kpi_monthly'])assert.equal(f.sql(`SELECT COUNT(*) n FROM ${table}`)[0].n,0);
    const login={event_id:'attendance-login',agent_extension:'101',event_type:'login',occurred_at:'2026-10-09 08:00:00'},signed={method:'POST',...connectorHeaders(login,f.env.UCM_INGEST_USERNAME,f.env.UCM_INGEST_PASSWORD)};
    assert.equal((await f.request('/integrations/ucm/queue-events',signed)).status,202);
    assert.equal((await f.request('/integrations/ucm/queue-events',signed)).status,409);
    assert.equal((await send({event_id:'attendance-logout',agent_extension:'101',event_type:'logout',occurred_at:'2026-10-09 17:00:00'})).status,202);
    const daily=f.sql('SELECT * FROM ucm_agent_daily')[0];assert.equal(daily.work_seconds,9*3600);assert.equal(daily.break_seconds,0);assert.equal(daily.total_calls,0);
    const attendance=f.sql('SELECT * FROM hr_attendance')[0];assert.equal(attendance.punch_in,'2026-10-09T05:00:00.000Z');assert.equal(attendance.punch_out,null);
    const revision=f.sql("SELECT value FROM app_control WHERE key='hr_revision'")[0].value;
    await send({event_id:'second-queue-login',agent_extension:'101',queue_name:'another-queue',event_type:'login',occurred_at:'2026-10-09 12:00:00'});
    assert.equal(f.sql('SELECT punch_in FROM hr_attendance')[0].punch_in,attendance.punch_in);
    assert.equal(f.sql("SELECT value FROM app_control WHERE key='hr_revision'")[0].value,revision,'repeat queue login does not rewrite the first punch');
    assert.equal(f.sql("SELECT COUNT(*) n FROM hr_audit WHERE action='queue_check_in'")[0].n,1);
    assert.equal(f.sql('SELECT COUNT(*) n FROM agent_kpi_monthly')[0].n,0);
    assert.equal((await f.request('/integrations/ucm/history',{method:'POST',headers:{Authorization:'Bearer '+f.token},body:'{"day":"2026-09-02"}'})).status,409);
  }finally{f.close()}
});
test('first queue login after midnight belongs to its overnight shift and preserves HR corrections',async()=>{
  const f=fixture();try{
    const event={event_type:'login',agent_extension:'101',queue_name:'night',occurred_at:'2026-10-09T21:30:00.000Z'};
    await recordFirstQueueLogin(f.env.trainer_kb,event,'fixture-agent',async(_user,day)=>day==='2026-10-09'?'23:00 - 08:00':'OFF');
    const row=f.sql('SELECT * FROM hr_attendance')[0];assert.equal(row.day,'2026-10-09');assert.equal(row.punch_in,event.occurred_at);assert.equal(row.scheduled_shift,'23:00 - 08:00');
    f.sql("UPDATE hr_attendance SET punch_in='2026-10-09T20:00:00.000Z';");
    await recordFirstQueueLogin(f.env.trainer_kb,event,'fixture-agent',async()=> '23:00 - 08:00');
    assert.equal(f.sql('SELECT punch_in FROM hr_attendance')[0].punch_in,'2026-10-09T20:00:00.000Z');
    f.sql("DELETE FROM hr_attendance; INSERT INTO hr_audit(id,actor,action,target,details,created_at) VALUES('deleted-override','admin','delete_attendance','fixture-agent','{\"day\":\"2026-10-09\"}','fixture');");
    await recordFirstQueueLogin(f.env.trainer_kb,event,'fixture-agent',async()=> '23:00 - 08:00');
    assert.equal(f.sql('SELECT COUNT(*) n FROM hr_attendance')[0].n,0,'HR deletion remains effective across queue relogins');
  }finally{f.close()}
});
test('current-month KPI can be uploaded manually in attendance-only mode',async()=>{
  const f=fixture();try{
    delete f.env.UCM_ATTENDANCE_ONLY;f.sql('CREATE UNIQUE INDEX app_control_key ON app_control(key);');
    const row={username:'fixture-agent',period_start:ucmMonthWindow().current+'-01',total_calls:12,response_score:80,handling_score:90,details:{daily:[]}};
    const result=await f.request('/rest/v1/agent_kpi_monthly',{method:'POST',headers:{Authorization:'Bearer '+f.token,'Content-Type':'application/json'},body:JSON.stringify([row])});assert.equal(result.status,201);
    const visible=await (await f.request('/rest/v1/agent_kpi_monthly',{headers:{Authorization:'Bearer '+f.token}})).json();assert.equal(visible[0].details.source,'kpi_analyzer');
  }finally{f.close()}
});
test('connector forwards login/logout transitions and suppresses pause/unpause before networking',async()=>{
  class Socket extends EventEmitter{static OPEN=1;static instance;constructor(){super();this.readyState=1;Socket.instance=this}send(){}terminate(){this.emit('close')}}
  const forwarded=[],controller=startQueueConnector({UCM_WS_URL:'wss://fixture.invalid/websockify',UCM_API_USERNAME:'fixture',UCM_API_PASSWORD:'fixture',CLOUDFLARE_QUEUE_ENDPOINT:'https://fixture.invalid/events',UCM_INGEST_USERNAME:'fixture',UCM_INGEST_PASSWORD:'fixture'},{Socket,log:()=>{},fetcher:async(_url,options)=>{forwarded.push(JSON.parse(options.body));return {ok:true}}});
  try{
    const emit=message=>Socket.instance.emit('message',JSON.stringify({message}));emit({action:'login',status:0});emit({action:'subscribe',status:0});
    const status=(logged,paused)=>emit({eventname:'CallQueueStatus',eventbody:[{extension:'600',member:[{member_extension:'101',logintime:logged?'2026-10-09 08:00:00':'--',status:paused?'paused':'available',pausetime:paused?'2026-10-09 09:00:00':'--'}]}]});
    status(true,false);await pause(5);status(true,true);status(true,false);await pause(5);status(false,false);await pause(5);
    assert.deepEqual(forwarded.map(event=>event.event_type),['login','logout']);
  }finally{controller.stop()}
});
test('quota errors return Retry-After without trying to write another error record',async()=>{
  const f=fixture();try{
    let writes=0;
    f.env.trainer_kb.prepare=()=>({bind(){return this},async first(){throw new Error('D1_ERROR: exceeded maximum amount of rows written')},async run(){writes++;throw new Error('D1_ERROR: exceeded maximum amount of rows written')}});
    const response=await f.request('/integrations/ucm/cdr',{method:'POST',headers:{Authorization:f.basic},body:'{}'});
    assert.equal(response.status,429);assert.ok(Number(response.headers.get('Retry-After'))>=60);assert.equal(writes,0);
  }finally{f.close()}
});
test('new queue events cannot bypass an active receiver quota retry delay',async()=>{
  let attempts=0;
  const box=new UcmOutbox({forward:async()=>{attempts++;throw Object.assign(new Error(),{code:'CF_HTTP_429',retryMs:60000})},retryMs:1});
  try{box.enqueue([{event_id:'quota-one'}]);await pause(10);box.enqueue([{event_id:'quota-two'}]);await box.flush();await pause(10);assert.equal(attempts,1);assert.equal(box.pending.length,2)}finally{box.stop()}
});
test('historical Analyzer upload replaces only its employee-month and cannot overwrite live current-month data',async()=>{
  const f=fixture();try{
    f.sql('CREATE UNIQUE INDEX app_control_key ON app_control(key);');
    const previous=ucmMonthWindow().previous,current=ucmMonthWindow().current,next=new Date(current+'-01T00:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);
    const row={username:'fixture-agent',period_start:previous+'-01',period_end:previous+'-28',total_calls:42,answered_calls:40,abandoned_calls:2,kpi_score:90,response_score:80,handling_score:90,details:{daily:[]}};
    const upload=rows=>f.request('/rest/v1/agent_kpi_monthly',{method:'POST',headers:{Authorization:'Bearer '+f.token,'Content-Type':'application/json'},body:JSON.stringify(rows)});
    assert.equal((await upload([row,{...row,period_start:next.toISOString().slice(0,10)}])).status,400);
    assert.equal(f.sql('SELECT COUNT(*) n FROM agent_kpi_monthly')[0].n,0,'validate the complete batch before writing');
    assert.equal((await upload([row])).status,201);
    assert.equal((await upload([{...row,total_calls:43}])).status,201);
    const saved=f.sql('SELECT * FROM agent_kpi_monthly');assert.equal(saved.length,1);assert.equal(saved[0].total_calls,43);assert.equal(JSON.parse(saved[0].details).source,'kpi_analyzer');
    const visible=await (await f.request('/rest/v1/agent_kpi_monthly',{headers:{Authorization:'Bearer '+f.token}})).json();assert.equal(visible.length,1);
    const cdr={session:'manual-protection',action_owner:'101',start:previous+'-02 08:00:00',end:previous+'-02 08:01:00',billsec:60,disposition:'ANSWERED'};
    assert.equal((await f.request('/integrations/ucm/cdr',{method:'POST',headers:{Authorization:f.basic},body:JSON.stringify(cdr)})).status,202);
    assert.equal(f.sql('SELECT total_calls FROM agent_kpi_monthly')[0].total_calls,43,'day requests cannot overwrite an explicitly imported monthly report');
  }finally{f.close()}
});
test('repackaged duplicate CDR delivery performs no call, daily or KPI updates',async()=>{
  const f=fixture();try{
    f.sql('CREATE TABLE write_audit(kind TEXT); CREATE TRIGGER cdr_updates AFTER UPDATE ON ucm_cdr BEGIN INSERT INTO write_audit VALUES(\'cdr\'); END; CREATE TRIGGER daily_updates AFTER UPDATE ON ucm_agent_daily BEGIN INSERT INTO write_audit VALUES(\'daily\'); END; CREATE TRIGGER kpi_updates AFTER UPDATE ON agent_kpi_monthly BEGIN INSERT INTO write_audit VALUES(\'kpi\'); END;');
    const cdr={session:'duplicate-budget',action_owner:'101',start:'2026-10-09 08:00:00',end:'2026-10-09 08:01:00',billsec:60,wait:3,disposition:'ANSWERED'};
    const post=body=>f.request('/integrations/ucm/cdr',{method:'POST',headers:{Authorization:f.basic},body:JSON.stringify(body)});
    assert.equal((await post(cdr)).status,202);assert.equal((await post({records:[cdr]})).status,202);
    assert.equal(f.sql('SELECT COUNT(*) n FROM write_audit')[0].n,0);
  }finally{f.close()}
});
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ucm-integration-')),file=path.join(dir,'data.sqlite');
  const quote=v=>v==null?'NULL':typeof v==='number'?String(v):"'"+String(v).replaceAll("'","''")+"'";
  const sql=text=>JSON.parse(execFileSync('sqlite3',['-json',file],{input:text,encoding:'utf8'})||'[]');
  const db={prepare(text){return {args:[],bind(...args){this.args=args;return this},compile(){let i=0;return text.replace(/\?/g,()=>quote(this.args[i++]))},async first(){return sql(this.compile())[0]||null},async all(){return {results:sql(this.compile())}},async run(){sql(this.compile());return {success:true}}}}};
  sql(fs.readFileSync(new URL('../migrations/0002_ucm_integration.sql',import.meta.url),'utf8'));
  sql(fs.readFileSync(new URL('../migrations/0009_ucm_ingest_receipts.sql',import.meta.url),'utf8'));
  const source=fs.readFileSync(new URL('../worker.js',import.meta.url),'utf8'),columns=source.match(/INSERT INTO agent_kpi_monthly\((.*?)\) VALUES/)[1].split(',');
  sql(`CREATE TABLE agent_kpi_monthly(id TEXT,${columns.map(c=>`${c} ${['total_calls','kpi_score','quality_score','response_score','handling_score'].includes(c)?'NUMERIC':'TEXT'}${['response_score','handling_score'].includes(c)?' NOT NULL DEFAULT 0':''}`).join(',')});CREATE TABLE trainer_users(username TEXT,auth_user_id TEXT,full_name TEXT,active INTEGER,role TEXT);CREATE TABLE auth_accounts(id TEXT,active INTEGER);CREATE TABLE app_control(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);INSERT INTO trainer_users VALUES('fixture-agent','agent-id','Fixture Agent',1,'agent'),('fixture-admin','admin-id','Fixture Admin',1,'admin');INSERT INTO auth_accounts VALUES('admin-id',1);INSERT INTO ucm_agent_mapping(extension,username) VALUES('101','fixture-agent');`);
  sql('ALTER TABLE trainer_users ADD COLUMN id TEXT;');
  sql(fs.readFileSync(new URL('../migrations/0005_hr_attendance.sql',import.meta.url),'utf8'));
  db.batch=async statements=>{sql('BEGIN;'+statements.map(statement=>statement.compile()+';').join('')+'COMMIT;');return statements.map(()=>({success:true}))};
  sql(fs.readFileSync(new URL('../migrations/0010_ucm_monthly_kpi_unique.sql',import.meta.url),'utf8'));
  // Explicit full-sync compatibility fixture; production defaults to attendance only.
  const env={trainer_kb:db,UCM_ATTENDANCE_ONLY:'false',UCM_INGEST_USERNAME:'fixture-ingest',UCM_INGEST_PASSWORD:'fixture-ingest-password',AUTH_JWT_SECRET:'fixture-jwt-not-production'};
  const basic='Basic '+Buffer.from(`${env.UCM_INGEST_USERNAME}:${env.UCM_INGEST_PASSWORD}`).toString('base64');
  const header=Buffer.from(JSON.stringify({alg:'HS256'})).toString('base64url'),payload=Buffer.from(JSON.stringify({sub:'admin-id',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),token=`${header}.${payload}.${crypto.createHmac('sha256',env.AUTH_JWT_SECRET).update(`${header}.${payload}`).digest('base64url')}`;
  return {dir,sql,env,basic,token,close(){fs.rmSync(dir,{recursive:true,force:true})},async request(route,options={}){return worker.fetch(new Request('https://fixture.invalid'+route,options),env,{waitUntil(){}})}};
}
test('day requests require portal login and signed completion; whole-month user requests are rejected',async()=>{
  const f=fixture();try{
    const route='/integrations/ucm/history',body=JSON.stringify({day:'2025-01-02'}),options={method:'POST',headers:{Authorization:'Bearer '+f.token},body};
    assert.equal((await f.request(route,{method:'POST',body})).status,401);
    assert.equal((await f.request(route,options)).status,200);
    const jobs=payload=>f.request('/integrations/ucm/history-jobs',{method:'POST',...connectorHeaders(payload,f.env.UCM_INGEST_USERNAME,f.env.UCM_INGEST_PASSWORD)});
    assert.deepEqual((await (await jobs({action:'list'})).json()).days,['2025-01-02']);
    assert.equal((await f.request('/integrations/ucm/history-jobs',{method:'POST',body:'{}'})).status,401);
    await jobs({action:'complete',day:'2025-01-02'});
    assert.equal((await (await f.request(route,options)).json()).status,'complete');
    assert.deepEqual((await (await jobs({action:'list'})).json()).days,[]);
    assert.equal((await f.request(route,{...options,body:JSON.stringify({month:'2025-01'})})).status,400);
    assert.equal((await f.request(route,{...options,body:JSON.stringify({day:'2025-02-30'})})).status,400);
  }finally{f.close()}
});
test('legacy NOT NULL score schema accepts real CDR with unknown metrics while the API returns null, not zero',async()=>{
  const f=fixture();try{
    const cdr={session:'fixture-unknown-metrics',action_owner:'101',start:'2026-10-09 08:00:00',end:'2026-10-09 08:01:00',disposition:'ANSWERED'};
    const response=await f.request('/integrations/ucm/cdr',{method:'POST',headers:{Authorization:f.basic,'Content-Type':'application/json'},body:JSON.stringify(cdr)});
    assert.equal(response.status,202);
    const rows=await (await f.request('/rest/v1/agent_kpi_monthly',{headers:{Authorization:'Bearer '+f.token}})).json();
    assert.equal(rows.length,1);assert.equal(rows[0].response_score,null);assert.equal(rows[0].handling_score,null);assert.equal(rows[0].total_calls,1);
  }finally{f.close()}
});
test('UCM monthly rotation retains current and previous month, preserves manual KPI, and runs only after delivery once per month',async()=>{
  const f=fixture();try{
    assert.deepEqual(ucmMonthWindow(new Date('2025-12-31T22:00:00Z')),{current:'2026-01',previous:'2025-12',day:'2025-12-01',cutoff:'2025-11-30T21:00:00.000Z'});
    for(const month of ['2026-08','2026-09','2026-10']){
      const cdr={session:'retention-'+month,action_owner:'101',start:month+'-01 08:00:00',end:month+'-01 08:01:00',billsec:60,disposition:'ANSWERED'};
      assert.equal((await f.request('/integrations/ucm/cdr',{method:'POST',headers:{Authorization:f.basic},body:JSON.stringify(cdr)})).status,202);
    }
    f.sql("INSERT INTO agent_kpi_monthly(username,period_start,details) VALUES('legacy-manual','2026-08-01','{}');INSERT INTO ucm_sync_state(key,status,updated_at) VALUES('history:2026-08','complete','2026-09-01');");
    const result=await finishDailyUcmSync(f.env.trainer_kb,new Date('2026-10-01T00:00:00Z'));
    assert.equal(result.rotated,true);assert.equal(f.sql('SELECT COUNT(*) n FROM ucm_cdr')[0].n,2);
    assert.equal(f.sql("SELECT COUNT(*) n FROM agent_kpi_monthly WHERE username='legacy-manual'")[0].n,1);
    assert.equal(f.sql("SELECT status FROM ucm_sync_state WHERE key='history:2026-08'")[0].status,'expired');
    assert.equal((await finishDailyUcmSync(f.env.trainer_kb,new Date('2026-10-02T00:00:00Z'))).rotated,false);
    const request={method:'POST',headers:{Authorization:'Bearer '+f.token},body:JSON.stringify({day:'2026-08-02'})};
    assert.equal((await (await f.request('/integrations/ucm/history',request)).json()).status,'pending');
    await finishDailyUcmSync(f.env.trainer_kb,new Date('2026-11-01T00:00:00Z'));
    assert.equal(f.sql('SELECT COUNT(*) n FROM ucm_cdr')[0].n,1);
  }finally{f.close()}
});
test('real SQLite ingestion: signed queue events reject replay, normalize Amman time, and never fabricate call KPI',async()=>{
  const f=fixture();try{
    const event={event_id:'fixture-login',event_type:'login',agent_extension:'101',occurred_at:'2026-10-09 08:00:00'};
    const signed=()=>({method:'POST',...connectorHeaders(event,f.env.UCM_INGEST_USERNAME,f.env.UCM_INGEST_PASSWORD)});
    assert.equal((await f.request('/integrations/ucm/queue-events',{method:'POST',headers:{Authorization:f.basic,'Content-Type':'application/json'},body:JSON.stringify(event)})).status,401);
    const request=signed();assert.equal((await f.request('/integrations/ucm/queue-events',request)).status,202);
    assert.equal((await f.request('/integrations/ucm/queue-events',request)).status,409);
    const duplicate=await (await f.request('/integrations/ucm/queue-events',signed())).json();assert.equal(duplicate.duplicate,true);
    assert.equal(f.sql('SELECT COUNT(*) n FROM ucm_queue_events')[0].n,1);
    assert.equal(f.sql('SELECT occurred_at FROM ucm_queue_events')[0].occurred_at,'2026-10-09T05:00:00.000Z');
    assert.equal(f.sql('SELECT COUNT(*) n FROM agent_kpi_monthly')[0].n,0);
    const cdr={session:'fixture-call',action_owner:'101',start:'2026-10-09 08:10:00',end:'2026-10-09 08:12:00',billsec:120,wait:5,disposition:'ANSWERED'};
    const post={method:'POST',headers:{Authorization:f.basic,'Content-Type':'application/json'},body:JSON.stringify(cdr)};
    assert.equal((await f.request('/integrations/ucm/cdr',post)).status,202);
    assert.equal((await (await f.request('/integrations/ucm/cdr',post)).json()).duplicate,true);
    const row=f.sql('SELECT * FROM agent_kpi_monthly')[0];assert.equal(JSON.parse(row.details).source,'ucm_api');assert.equal(row.total_calls,1);assert.equal(row.quality_score,null);
    assert.equal(row.data_to,'2026-10-09T05:12:00.000Z');
    f.sql("INSERT INTO agent_kpi_monthly(username,period_start,kpi_score,total_calls,details) VALUES('manual-agent','2026-09-01',99,100,'{}');");
    const rows=await (await f.request('/rest/v1/agent_kpi_monthly',{headers:{Authorization:'Bearer '+f.token}})).json();assert.equal(rows.length,1);assert.equal(rows[0].username,'fixture-agent');
    assert.equal((await f.request('/rest/v1/agent_kpi_monthly',{method:'POST',headers:{Authorization:'Bearer '+f.token,'Content-Type':'application/json'},body:'{}'})).status,400);
  }finally{f.close()}
});
test('signed delivery rejects tampering, stale timestamps and invalid timestamps without writes',async()=>{
  const f=fixture();try{
    const payload={event_id:'fixture-pause',event_type:'pause',agent_extension:'101'};
    for(const now of [Date.now()-600000]){const signed=connectorHeaders(payload,f.env.UCM_INGEST_USERNAME,f.env.UCM_INGEST_PASSWORD,now);assert.equal((await f.request('/integrations/ucm/queue-events',{method:'POST',...signed})).status,401)}
    const signed=connectorHeaders(payload,f.env.UCM_INGEST_USERNAME,f.env.UCM_INGEST_PASSWORD);
    assert.equal((await f.request('/integrations/ucm/queue-events',{method:'POST',...signed,body:'{}'})).status,401);
    assert.equal(f.sql('SELECT COUNT(*) n FROM ucm_queue_events')[0].n,0);
  }finally{f.close()}
});
test('reprocessing a real queue event after mapping repairs its owner without duplication',async()=>{
  const f=fixture();try{
    f.sql("DELETE FROM ucm_agent_mapping WHERE extension='101';");
    const event={event_id:'fixture-before-mapping',event_type:'login',agent_extension:'101',occurred_at:'2026-10-09 08:00:00'};
    const send=payload=>f.request('/integrations/ucm/queue-events',{method:'POST',...connectorHeaders(payload,f.env.UCM_INGEST_USERNAME,f.env.UCM_INGEST_PASSWORD)});
    assert.equal((await send(event)).status,202);assert.equal(f.sql('SELECT username FROM ucm_queue_events')[0].username,null);
    f.sql("INSERT INTO ucm_agent_mapping(extension,username) VALUES('101','fixture-agent');");
    assert.equal((await send({records:[event]})).status,202);
    const rows=f.sql('SELECT username FROM ucm_queue_events');assert.equal(rows.length,1);assert.equal(rows[0].username,'fixture-agent');assert.equal(f.sql('SELECT COUNT(*) n FROM ucm_agent_daily')[0].n,1);
  }finally{f.close()}
});
test('read-only receiver probe diagnoses credentials, time and signature without storing anything',async()=>{
  const f=fixture();try{
    const event={probe:'queue-auth-check'},signed=()=>connectorHeaders(event,f.env.UCM_INGEST_USERNAME,f.env.UCM_INGEST_PASSWORD);
    const send=options=>f.request('/integrations/ucm/check',{method:'POST',...options});
    const valid=signed();assert.equal((await (await send(valid)).json()).result,'INGEST_AUTH_OK');
    assert.equal((await (await send(valid)).json()).result,'INGEST_AUTH_OK');
    const wrong=connectorHeaders(event,f.env.UCM_INGEST_USERNAME,'wrong-fixture-only');assert.equal((await (await send(wrong)).json()).result,'INGEST_CREDENTIALS_REJECTED');
    const stale=connectorHeaders(event,f.env.UCM_INGEST_USERNAME,f.env.UCM_INGEST_PASSWORD,Date.now()-600000);assert.equal((await (await send(stale)).json()).result,'DELIVERY_TIMESTAMP_REJECTED');
    assert.equal((await (await send({...valid,body:'{}'})).json()).result,'DELIVERY_SIGNATURE_REJECTED');
    for(const table of ['ucm_ingest_receipts','ucm_queue_events','ucm_cdr','ucm_agent_daily','agent_kpi_monthly'])assert.equal(f.sql(`SELECT COUNT(*) n FROM ${table}`)[0].n,0);
  }finally{f.close()}
});
test('outbox persists failed deliveries, retries with no new event and serializes overlapping flushes',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ucm-outbox-')),file=path.join(dir,'pending.json');let fail=true,calls=0,active=0,max=0;
  const outbox=new UcmOutbox({file,retryMs:10,forward:async()=>{calls++;active++;max=Math.max(max,active);await pause(2);active--;if(fail)throw new Error('offline')}});
  try{outbox.enqueue([{event_id:'real-source-fixture'}]);await pause(5);assert.equal(JSON.parse(fs.readFileSync(file))[0].event_id,'real-source-fixture');fail=false;await Promise.all([outbox.flush(),outbox.flush()]);await pause(25);assert.equal(outbox.pending.length,0);assert.equal(max,1);assert.ok(calls>=2)}finally{outbox.stop();fs.rmSync(dir,{recursive:true,force:true})}
});
test('connector distinguishes login, rejected subscription and acknowledged subscription without leaking secrets',async()=>{
  class Socket extends EventEmitter{static OPEN=1;static instances=[];constructor(){super();this.readyState=1;Socket.instances.push(this)}send(value){this.sent=JSON.parse(value)}terminate(){this.emit('close')}}
  const logs=[],config={UCM_WS_URL:'wss://fixture.invalid/websockify',UCM_API_USERNAME:'fixture-user',UCM_API_PASSWORD:'DO_NOT_LOG_UCM_PASSWORD',CLOUDFLARE_QUEUE_ENDPOINT:'https://fixture.invalid/events',UCM_INGEST_USERNAME:'fixture-ingest',UCM_INGEST_PASSWORD:'DO_NOT_LOG_INGEST_PASSWORD'};
  const controller=startQueueConnector(config,{Socket,log:v=>logs.push(v),retryMs:10000,fetcher:async()=>({ok:true})});
  try{const socket=Socket.instances.at(-1);socket.emit('open');socket.emit('message',JSON.stringify({message:{action:'login',status:0}}));assert.ok(logs.some(x=>x.event==='ucm_connected'));assert.ok(!logs.some(x=>x.event==='ucm_queue_subscribed'));socket.emit('message',JSON.stringify({message:{action:'subscribe',status:-9}}));assert.ok(logs.some(x=>x.event==='ucm_subscription_rejected'));assert.doesNotMatch(JSON.stringify(logs),/DO_NOT_LOG|fixture\.invalid/)}finally{controller.stop()}
});
test('missing call measurements stay unavailable and no-call periods have no score',()=>{
  assert.equal(ucmKpiScores({total:0}),null);
  const result=ucmKpiScores({total:10,answered:0,talk:0,wait:0,activeDays:1,maxProductivity:0});assert.equal(result.scores.response,null);assert.equal(result.scores.handling,null);assert.equal(result.scores.quality,null);assert.equal(result.kpi,0);
  assert.equal(ucmTimestamp('2026-10-09 08:00:00'),'2026-10-09T05:00:00.000Z');
});
test('subscription success is logged only after authenticated acknowledgment',()=>{
  class Socket extends EventEmitter{static OPEN=1;static instance;constructor(){super();this.readyState=1;Socket.instance=this}send(){}terminate(){this.emit('close')}}
  const logs=[],controller=startQueueConnector({UCM_WS_URL:'wss://fixture.invalid/websockify',UCM_API_USERNAME:'test',UCM_API_PASSWORD:'test',CLOUDFLARE_QUEUE_ENDPOINT:'https://fixture.invalid/events',UCM_INGEST_USERNAME:'test',UCM_INGEST_PASSWORD:'test'},{Socket,log:v=>logs.push(v)});
  try{const emit=message=>Socket.instance.emit('message',JSON.stringify({message}));emit({action:'subscribe',status:0});assert.equal(logs.length,0);emit({action:'login',status:0});emit({action:'subscribe',status:0});assert.equal(logs.filter(x=>x.event==='ucm_queue_subscribed').length,1)}finally{controller.stop()}
});
test('CDR at local month boundary is included in the correct UCM monthly score',async()=>{
  const f=fixture();try{
    const cdr={session:'boundary-call',action_owner:'101',start:'2026-10-01 00:30:00',end:'2026-10-01 00:32:00',billsec:120,disposition:'ANSWERED'};
    assert.equal((await f.request('/integrations/ucm/cdr',{method:'POST',headers:{Authorization:f.basic,'Content-Type':'application/json'},body:JSON.stringify(cdr)})).status,202);
    const row=f.sql('SELECT * FROM agent_kpi_monthly')[0];assert.equal(row.period_start,'2026-10-01');assert.equal(row.data_from,'2026-09-30T21:30:00.000Z');assert.equal(row.handling_score,100);assert.ok(JSON.parse(row.details).unavailable_scores.includes('response'));
  }finally{f.close()}
});
