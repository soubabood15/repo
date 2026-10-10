import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createUcmDayHandler} from '../ucm-day-cache.js';
import {connectorHeaders} from '../connector/ucm-queue-runtime.mjs';
import {createDaySummary,validDaySummary} from '../connector/ucm-day-summary.mjs';
import {dayReportsToKpi} from '../ucm-day-report.js';
import {createPauseTracker} from '../connector/ucm-pause-tracker.mjs';
import {ucmPresence} from '../ucm-presence.js';
import {startDaySync} from '../connector/ucm-day-sync.mjs';
import {reserveDayRequest,claimDayRequest,finishDayRequest} from '../ucm-request-lock.js';
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ucm-days-')),file=path.join(dir,'db.sqlite'),quote=v=>v===null?'NULL':typeof v==='number'?String(v):"'"+String(v).replaceAll("'","''")+"'",sql=text=>JSON.parse(execFileSync('sqlite3',['-json',file],{input:text,encoding:'utf8'})||'[]');
  const db={prepare(text){return {args:[],bind(...a){this.args=a;return this},compile(){let i=0;return text.replace(/\?/g,()=>quote(this.args[i++]))},async all(){return {results:sql(this.compile())}},async first(){return sql(this.compile())[0]||null},async run(){sql(this.compile());return {success:true}}}}};
  sql("CREATE TABLE trainer_users(username TEXT PRIMARY KEY,full_name TEXT,role TEXT,active INTEGER);INSERT INTO trainer_users VALUES('116','One','agent',1),('117','Two','agent',1),('inactive','Disabled','agent',0);CREATE TABLE ucm_agent_mapping(extension TEXT PRIMARY KEY,username TEXT,active INTEGER);CREATE TABLE hr_staff_permissions(username TEXT PRIMARY KEY,permissions_json TEXT);CREATE TABLE ucm_sync_state(key TEXT PRIMARY KEY,value TEXT,status TEXT,updated_at TEXT);CREATE TABLE ucm_queue_events(agent_extension TEXT,queue_name TEXT,event_type TEXT,occurred_at TEXT);");
  sql(fs.readFileSync(new URL('../migrations/0015_ucm_day_files.sql',import.meta.url),'utf8'));
  const objects=new Map();let puts=0;
  const env={trainer_kb:db,trainer_kb_files:{async list({prefix}){return {objects:[...objects.keys()].filter(key=>key.startsWith(prefix)).map(key=>({key}))}},async delete(key){objects.delete(key)},async get(key){const value=objects.get(key);return value?{json:async()=>JSON.parse(value)}:null},async put(key,value){puts++;objects.set(key,value)}},UCM_INGEST_USERNAME:'fixture',UCM_INGEST_PASSWORD:'fixture-only-not-a-secret'};
  let profile={username:'116',full_name:'One',role:'agent'};
  const handler=createUcmDayHandler({json:(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...headers}}),authenticate:async()=>profile?{profile}:null});
  return {sql,db,env,objects,get puts(){return puts},setProfile:p=>profile=p,async request(day,method='POST',refresh=false,id=''){const url=new URL('https://fixture.invalid/integrations/ucm/day?day='+day+(refresh?'&refresh=1':'')+(id?'&request_id='+id:''));return handler(new Request(url,{method}),env,url)},async connector(payload){const url=new URL('https://fixture.invalid/integrations/ucm/day-jobs');return handler(new Request(url,{method:'POST',...connectorHeaders(payload,env.UCM_INGEST_USERNAME,env.UCM_INGEST_PASSWORD)}),env,url)},close(){fs.rmSync(dir,{recursive:true,force:true})}};
}
const day='2026-09-01',summary=()=>{const s=createDaySummary(day);s.add([{session:'a',AcctId:'1',start:day+' 08:00:00',action_owner:'116',service:'6500',billsec:60,wait:10,disposition:'ANSWERED'},{session:'b',AcctId:'1',start:day+' 09:00:00',action_owner:'117',billsec:0,disposition:'NO ANSWER'}]);return s.finish()};
test('one global archived day job serves HR and admin, not employee previews',async()=>{
  const f=fixture();try{
    f.setProfile({username:'admin',role:'admin'});
    assert.equal((await f.request(day)).status,202);f.setProfile({username:'hr',role:'hr'});assert.equal((await f.request(day)).status,409);f.setProfile({username:'admin',role:'admin'});await f.request(day);
    assert.equal(f.sql('SELECT COUNT(*) n FROM ucm_day_jobs')[0].n,1);
    const claim=await (await f.connector({action:'claim'})).json();assert.equal(claim.job.day,day);assert.equal((await (await f.connector({action:'claim'})).json()).job,null,'parallel connector cannot claim a second job while a lease is active');
    const upload={action:'complete',...claim.job,summary:summary()};assert.equal((await f.connector(upload)).status,200);await f.connector(upload);assert.equal(f.puts,1,'repeated delivery never rewrites a completed file');
    assert.equal((await (await f.request(day)).json()).agents.length,2);
    f.setProfile({username:'116',role:'agent'});assert.equal((await f.request(day,'GET')).status,404,'employee must request a temporary day rather than use an archive');
    assert.ok(!f.sql("SELECT name FROM sqlite_master WHERE type='table'").some(row=>row.name==='ucm_cdr'));
    f.setProfile({username:'hr-limited',role:'hr'});f.sql(`INSERT INTO hr_staff_permissions VALUES('hr-limited','${JSON.stringify({attendance:'read',online:'none',schedule:'none',actions:'none',leaves:'none',performance:'none',analysis:'none',export:'none',staff:'none'})}')`);assert.equal((await f.request(day)).status,403);
    f.setProfile(null);assert.equal((await f.request(day)).status,401);
  }finally{f.close()}
});
test('job completion validates source, job ownership and summary, and preserves failed reads instead of fake empty success',async()=>{
  const f=fixture();try{
    f.setProfile({username:'admin',role:'admin'});
    await f.request(day);const {job}=await (await f.connector({action:'claim'})).json();
    assert.equal((await f.connector({action:'complete',...job,request_id:'wrong',summary:summary()})).status,409);
    assert.equal((await f.connector({action:'complete',...job,summary:{...summary(),agents:[{extension:'116',total:-1}]}})).status,400);assert.equal(f.puts,0);
    await f.connector({action:'failed',...job});assert.equal((await (await f.request(day,'GET')).json()).status,'failed');assert.equal(f.puts,0);
    assert.equal((await f.request('2026-02-31')).status,400);assert.equal((await f.request('2099-01-01')).status,400);
  }finally{f.close()}
});
test('employee day previews use no D1 job, cache for fifteen minutes without extending expiry and never expose another employee',async()=>{
  const f=fixture();try{
    const request=await (await f.request(day)).json();assert.ok(request.request_id.startsWith('transient-'));
    assert.equal(f.sql('SELECT COUNT(*) n FROM ucm_day_jobs')[0].n,0);
    assert.equal((await (await f.request(day)).json()).request_id,request.request_id);
    const {job}=await (await f.connector({action:'claim'})).json();assert.equal(job.request_id,request.request_id);
    await f.connector({action:'complete',...job,summary:summary()});
    f.setProfile({username:'117',role:'agent'});assert.equal((await f.request(day,'GET',false,request.request_id)).status,404);
    f.setProfile({username:'116',role:'agent'});const result=await (await f.request(day,'GET',false,request.request_id)).json();
    assert.equal(result.temporary,true);assert.deepEqual(result.agents.map(a=>a.username),['116']);
    assert.equal(f.objects.size,1);assert.equal(f.sql('SELECT COUNT(*) n FROM ucm_day_jobs')[0].n,0);
    assert.ok(result.expires_at>Date.now()+14*60000&&result.expires_at<=Date.now()+15*60000);
    const cached=await (await f.request(day)).json();assert.equal(cached.request_id,request.request_id);assert.equal(cached.expires_at,result.expires_at);
    const repeated=await (await f.request(day,'GET',false,request.request_id)).json();assert.equal(repeated.expires_at,result.expires_at);
    const [key,value]=[...f.objects][0];f.objects.set(key,JSON.stringify({...JSON.parse(value),expires_at:Date.now()-1}));
    assert.equal((await f.request(day,'GET',false,request.request_id)).status,410);assert.equal(f.objects.size,0);
  }finally{f.close()}
});
test('summary deduplicates pages, observes Amman date, preserves missing metrics and aggregates shared month results',()=>{
  const s=createDaySummary(day),row={session:'same',AcctId:'1',start:'2026-08-31T22:00:00Z',action_owner:'116',billsec:'00:01:00',disposition:'ANSWERED',service:'6500'};
  s.add([row,row,{...row,AcctId:'2',action_owner:'117'}]);const value=s.finish();assert.equal(value.records,2);assert.equal(value.agents[0].talk,60);assert.equal(value.agents[0].wait_known,false);assert.equal(validDaySummary(value,day),true);
  const report=dayReportsToKpi([{...value,agents:value.agents.map(a=>({...a,username:a.extension,full_name:a.extension}))}]);assert.equal(report[0].quality_score,null);assert.equal(report[0].response_score,null);assert.equal(report[0].total_calls,1);assert.equal(report[0].average_talk_seconds,60);assert.ok(report[0].details.unavailable_scores.includes('quality'));
  assert.throws(()=>s.add([{session:'bad',start:'not-a-date'}]),/time/i);
});
test('incoming CDRs include the receiving employee, not just the initiator or queue, and distinct unique IDs remain separate',()=>{
  const s=createDaySummary(day,{extensions:['116','117']});
  const base={session:'incoming',start:day+' 08:00:00',action_owner:'6500',channel_ext:'trunk-1',dstchannel_ext:'116',dst:'6500',billsec:60,disposition:'ANSWERED'};
  s.add([{...base,uniqueid:'one'},{...base,uniqueid:'two'},{...base,uniqueid:'one'}]);
  const result=s.finish();assert.equal(result.parser_version,2);assert.equal(result.records,2);assert.deepEqual(result.agents.map(a=>a.extension),['116']);assert.equal(result.agents[0].answered,2);
  const internal=createDaySummary(day,{extensions:['116','117']});internal.add([{...base,session:'internal',uniqueid:'three',action_owner:'116',dstchannel_ext:'117'}]);
  assert.deepEqual(internal.finish().agents.map(a=>a.extension),['116','117']);
});
test('pause time is a union of observed queue intervals; restart retains totals and disconnected periods are excluded',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pause-test-'));let clock=Date.parse('2026-10-09T20:59:00Z');const file=path.join(dir,'pause.json'),opts={now:()=>clock},tracker=createPauseTracker(file,opts),states=new Map([['a',{extension:'116',logged:true,paused:true}],['b',{extension:'116',logged:true,paused:true}]]);
  try{tracker.observe(states);clock+=120000;let rows=tracker.snapshot();assert.equal(rows.reduce((n,r)=>n+r.seconds,0),120);assert.equal(rows.length,2,'midnight splits the pause into Amman days');tracker.disconnect();clock+=3600000;rows=tracker.snapshot();assert.equal(rows.reduce((n,r)=>n+r.seconds,0),120);const restarted=createPauseTracker(file,opts);assert.equal(restarted.snapshot().reduce((n,r)=>n+r.seconds,0),120)}finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('presence shows genuine per-queue sessions and stale current states as unknown, never portal presence',async()=>{
  const f=fixture();try{
    const now=Date.now(),today=new Date(now+10800000).toISOString().slice(0,10),snapshot={observed_at:new Date(now-200000).toISOString(),members:[{extension:'116',queue:'6500',logged_in:true,paused:true,login_at:today+'T01:00:00.000Z',last_checked_at:new Date(now-250000).toISOString()}],pauses:[{extension:'116',day:today,seconds:90}]};
    f.sql(`INSERT INTO ucm_sync_state(key,value) VALUES('queue-live','${JSON.stringify(snapshot)}');INSERT INTO ucm_queue_events VALUES('116','6500','login','${today}T01:00:00.000Z'),('116','6500','logout','${today}T02:00:00.000Z'),('116','6501','login','${today}T03:00:00.000Z');`);
    const presence=await ucmPresence(f.db,today,now),one=presence.roster.find(p=>p.username==='116');assert.equal(one.stale,true);assert.equal(one.logged_in,null);assert.equal(one.paused,null);assert.equal(one.pause_seconds,90);assert.equal(one.sessions.length,2);assert.equal(one.sessions[0].logout_at,today+'T02:00:00.000Z');assert.equal(one.last_checked_at,snapshot.members[0].last_checked_at);
    assert.equal(presence.roster.find(p=>p.username==='117').pause_seconds,null);
  }finally{f.close()}
});
test('one atomic slot rejects parallel users and only releases the matching request',async()=>{
  const f=fixture();try{
    const slots=await Promise.all([reserveDayRequest(f.db,{request_id:'one',owner:'116',day}),reserveDayRequest(f.db,{request_id:'two',owner:'117',day})]);assert.deepEqual(slots,[true,false]);
    assert.equal(await reserveDayRequest(f.db,{request_id:'one',owner:'117',day}),false);
    const claims=await Promise.all([claimDayRequest(f.db),claimDayRequest(f.db)]);assert.equal(claims.filter(Boolean).length,1);
    await finishDayRequest(f.db,'wrong');assert.equal(await reserveDayRequest(f.db,{request_id:'two',owner:'117',day}),false);
    await finishDayRequest(f.db,'one');assert.equal(await reserveDayRequest(f.db,{request_id:'two',owner:'117',day}),true);
  }finally{f.close()}
});
test('daily connector reads only requested day, sends a compact file once and does not start automatic monthly CDR writes',async()=>{
  const ranges=[],sent=[],config={UCM_WS_URL:'wss://fixture:8089/websockify',CLOUDFLARE_QUEUE_ENDPOINT:'https://receiver.invalid/integrations/ucm/queue-events',UCM_INGEST_USERNAME:'fixture',UCM_INGEST_PASSWORD:'fixture'};let claimed=false;
  const sync=startDaySync(config,{intervalMs:1e6,client:{async cdrPage(range){ranges.push(range);return [{session:'a',start:day+' 08:00:00',action_owner:'116',billsec:60}]}},log:()=>{},fetcher:async(url,options)=>{const payload=JSON.parse(options.body);sent.push(payload);assert.ok(url.endsWith('/day-jobs'));return {ok:true,json:async()=>payload.action==='claim'&&!claimed?(claimed=true,{job:{day,request_id:'one'}}):{job:null}}}});
  try{await sync.tick();assert.equal(ranges.length,1);assert.equal(ranges[0].start,day+'T00:00:00');const complete=sent.find(p=>p.action==='complete');assert.ok(complete.summary);assert.equal(complete.records,undefined);await sync.tick();assert.equal(ranges.length,1)}finally{sync.stop()}
});
