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
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ucm-integration-')),file=path.join(dir,'data.sqlite');
  const quote=v=>v==null?'NULL':typeof v==='number'?String(v):"'"+String(v).replaceAll("'","''")+"'";
  const sql=text=>JSON.parse(execFileSync('sqlite3',['-json',file],{input:text,encoding:'utf8'})||'[]');
  const db={prepare(text){return {args:[],bind(...args){this.args=args;return this},compile(){let i=0;return text.replace(/\?/g,()=>quote(this.args[i++]))},async first(){return sql(this.compile())[0]||null},async all(){return {results:sql(this.compile())}},async run(){sql(this.compile());return {success:true}}}}};
  sql(fs.readFileSync(new URL('../migrations/0002_ucm_integration.sql',import.meta.url),'utf8'));
  sql(fs.readFileSync(new URL('../migrations/0009_ucm_ingest_receipts.sql',import.meta.url),'utf8'));
  const source=fs.readFileSync(new URL('../worker.js',import.meta.url),'utf8'),columns=source.match(/INSERT INTO agent_kpi_monthly\((.*?)\) VALUES/)[1].split(',');
  sql(`CREATE TABLE agent_kpi_monthly(id TEXT,${columns.map(c=>`${c} ${['total_calls','kpi_score','quality_score','response_score','handling_score'].includes(c)?'NUMERIC':'TEXT'}${['response_score','handling_score'].includes(c)?' NOT NULL DEFAULT 0':''}`).join(',')});CREATE TABLE trainer_users(username TEXT,auth_user_id TEXT,full_name TEXT,active INTEGER,role TEXT);CREATE TABLE auth_accounts(id TEXT,active INTEGER);CREATE TABLE app_control(key TEXT,value TEXT);INSERT INTO trainer_users VALUES('fixture-agent','agent-id','Fixture Agent',1,'agent'),('fixture-admin','admin-id','Fixture Admin',1,'admin');INSERT INTO auth_accounts VALUES('admin-id',1);INSERT INTO ucm_agent_mapping(extension,username) VALUES('101','fixture-agent');`);
  sql('ALTER TABLE trainer_users ADD COLUMN id TEXT;');
  sql(fs.readFileSync(new URL('../migrations/0010_ucm_monthly_kpi_unique.sql',import.meta.url),'utf8'));
  const env={trainer_kb:db,UCM_INGEST_USERNAME:'fixture-ingest',UCM_INGEST_PASSWORD:'fixture-ingest-password',AUTH_JWT_SECRET:'fixture-jwt-not-production'};
  const basic='Basic '+Buffer.from(`${env.UCM_INGEST_USERNAME}:${env.UCM_INGEST_PASSWORD}`).toString('base64');
  const header=Buffer.from(JSON.stringify({alg:'HS256'})).toString('base64url'),payload=Buffer.from(JSON.stringify({sub:'admin-id',exp:Math.floor(Date.now()/1000)+3600})).toString('base64url'),token=`${header}.${payload}.${crypto.createHmac('sha256',env.AUTH_JWT_SECRET).update(`${header}.${payload}`).digest('base64url')}`;
  return {dir,sql,env,basic,token,close(){fs.rmSync(dir,{recursive:true,force:true})},async request(route,options={}){return worker.fetch(new Request('https://fixture.invalid'+route,options),env,{waitUntil(){}})}};
}
test('old month requests require portal login and signed connector completion; repeat requests reuse the saved month',async()=>{
  const f=fixture();try{
    const route='/integrations/ucm/history',body=JSON.stringify({month:'2025-01'}),options={method:'POST',headers:{Authorization:'Bearer '+f.token},body};
    assert.equal((await f.request(route,{method:'POST',body})).status,401);
    assert.equal((await f.request(route,options)).status,202);
    const jobs=payload=>f.request('/integrations/ucm/history-jobs',{method:'POST',...connectorHeaders(payload,f.env.UCM_INGEST_USERNAME,f.env.UCM_INGEST_PASSWORD)});
    assert.deepEqual((await (await jobs({action:'list'})).json()).months,['2025-01']);
    assert.equal((await f.request('/integrations/ucm/history-jobs',{method:'POST',body:'{}'})).status,401);
    await jobs({action:'complete',month:'2025-01'});
    assert.equal((await (await f.request(route,options)).json()).status,'complete');
    assert.deepEqual((await (await jobs({action:'list'})).json()).months,[]);
    assert.equal((await f.request(route,{...options,body:JSON.stringify({month:'2099-01'})})).status,400);
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
    assert.equal((await f.request('/rest/v1/agent_kpi_monthly',{method:'POST',headers:{Authorization:'Bearer '+f.token,'Content-Type':'application/json'},body:'{}'})).status,403);
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
