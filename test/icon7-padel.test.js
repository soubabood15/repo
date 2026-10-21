import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createPadelHandler,validPadelQuery,ammanDay,publicPadelJob} from '../icon7-padel-service.js';
import {clock24,parseAvailableTitle,detailsMatch} from '../connector/icon7-padel/provider.mjs';
import {Journal,processJob,reportPending} from '../connector/icon7-padel/runtime.mjs';
function fixture() {
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(fs.readFileSync(new URL('../migrations/0016_icon7_padel.sql',import.meta.url),'utf8'));
  sqlite.exec("CREATE TABLE trainer_users(username TEXT,role TEXT,active INTEGER); INSERT INTO trainer_users VALUES('one','agent',1),('two','agent',1); CREATE TABLE ebook_permissions(agent_name TEXT,project_id TEXT,is_allowed INTEGER,expires_at TEXT); INSERT INTO ebook_permissions VALUES('one','icon7',1,NULL),('two','icon7',1,NULL);");
  const db={prepare(sql){const stmt=sqlite.prepare(sql);return {args:[],bind(...args){this.args=args;return this},async first(){return stmt.get(...this.args)||null},async all(){return {results:stmt.all(...this.args)}},async run(){stmt.run(...this.args);return {success:true}}}}};
  let profile={username:'one',role:'agent'};
  const env={trainer_kb:db,ICON7_CONNECTOR_SECRET:'fixture-connector-secret-32-characters'};
  const handler=createPadelHandler({json:(data,status=200,headers={})=>Response.json(data,{status,headers}),authenticate:async()=>profile?{profile}:null});
  const request=async(route,body,connector=false,secret=env.ICON7_CONNECTOR_SECRET)=>{
    const url=new URL('https://fixture.invalid'+(connector?'/integrations/icon7-padel':'/functions/v1/icon7-padel')+route);
    return handler(new Request(url,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(connector?{Authorization:'Bearer '+secret}:{})},...(body?{body:JSON.stringify(body)}:{})}),env,url);
  };
  return {sqlite,env,request,setProfile(value){profile=value},async poll(ready=true){return (await request('/poll',{ready},true)).json()},async schedule(){await this.poll();const response=await request('/availability',{...query(),request_key:crypto.randomUUID()});assert.equal(response.status,202);const job=await response.json();const {job:claim}=await this.poll();const result=await request('/result',{id:claim.id,claim_token:claim.claim_token,status:'confirmed',result:{slots:[slot()]}},true);assert.equal(result.status,200);return job.id},close(){sqlite.close()}};
}
const query=()=>({date:ammanDay(Date.now()+86400000),duration:60});
const slot=()=>({court:'Court A',start:'17:00',duration:60,price:40});
const booking=(availability_id,key=crypto.randomUUID())=>({...query(),...slot(),availability_id,request_key:key,customer:'Test Customer',phone:'0790000000',notes:''});
test('validates Amman dates, impossible dates and supported durations',()=>{
  assert.equal(ammanDay(Date.parse('2026-10-20T22:00:00Z')),'2026-10-21');
  for(const q of [{date:'garbage',duration:60},{date:'2026-99-30',duration:60},{date:'2026-02-30',duration:60},{...query(),duration:45}])assert.throws(()=>validPadelQuery(q));
  assert.deepEqual(validPadelQuery(query()),query());
});
test('requires authentication, ICON7 permission and connector secret',async()=>{
  const f=fixture();try{
    f.setProfile(null);assert.equal((await f.request('/status')).status,401);
    f.setProfile({username:'none',role:'agent'});assert.equal((await f.request('/status')).status,403);
    assert.equal((await f.request('/poll',{ready:true},true,'wrong')).status,401);
    assert.equal((await f.request('/poll',{ready:true},true)).status,200);
    f.setProfile({username:'one',role:'agent'});const response=await f.request('/status');assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal((await response.json()).ready,true);
  }finally{f.close()}
});
test('rejects offline requests, stale quotes and manipulated prices',async()=>{
  const f=fixture();try{
    assert.equal((await f.request('/availability',{...query(),request_key:crypto.randomUUID()})).status,503);
    const id=await f.schedule();
    assert.equal((await f.request('/bookings',{...booking(id),price:1})).status,400);
    f.sqlite.prepare('UPDATE icon7_padel_jobs SET updated_at=? WHERE id=?').run(Date.now()-130000,id);
    assert.equal((await f.request('/bookings',booking(id))).status,400);
  }finally{f.close()}
});
test('idempotency, slot contention, ownership and one-use begin permission',async()=>{
  const f=fixture();try{
    const availability=await f.schedule(),body=booking(availability);
    const response=await f.request('/bookings',body);assert.equal(response.status,202);const created=await response.json();
    const retry=await (await f.request('/bookings',body)).json();assert.equal(created.id,retry.id);
    assert.equal((await f.request('/bookings',booking(availability))).status,400);
    f.setProfile({username:'two',role:'agent'});assert.equal((await f.request('/jobs/'+created.id)).status,404);assert.deepEqual((await (await f.request('/bookings')).json()).jobs,[]);
    f.setProfile({username:'one',role:'agent'});
    const {job}=await f.poll();assert.equal(job.id,created.id);assert.equal((await f.poll()).job,null);
    const claim={id:job.id,claim_token:job.claim_token};
    assert.equal((await f.request('/result',{...claim,status:'confirmed',result:{provider_id:'123'}},true)).status,400);
    assert.equal((await f.request('/begin',claim,true)).status,200);
    assert.equal((await f.request('/begin',claim,true)).status,409);
    assert.equal((await f.request('/result',{...claim,status:'confirmed',result:{provider_id:'123'}},true)).status,200);
    assert.equal((await (await f.request('/jobs/'+created.id)).json()).result.provider_id,'123');
    assert.equal((await f.request('/result',{...claim,status:'failed'},true)).status,409,'terminal results cannot be overwritten');
  }finally{f.close()}
});
test('revoked permissions block final submission and old processing jobs are never reclaimed',async()=>{
  const f=fixture();try{
    const id=await f.schedule(),created=await (await f.request('/bookings',booking(id))).json(),{job}=await f.poll();
    f.sqlite.exec("UPDATE ebook_permissions SET is_allowed=0 WHERE agent_name='one'");
    assert.equal((await f.request('/begin',{id:job.id,claim_token:job.claim_token},true)).status,409);
    f.sqlite.prepare('UPDATE icon7_padel_jobs SET updated_at=? WHERE id=?').run(Date.now()-190000,created.id);
    assert.equal((await f.poll()).job,null);
    const row=f.sqlite.prepare('SELECT * FROM icon7_padel_jobs WHERE id=?').get(created.id);
    assert.equal(publicPadelJob(row).status,'unknown');
  }finally{f.close()}
});
test('expired queue jobs fail without being executed',async()=>{
  const f=fixture();try{
    await f.poll();const created=await (await f.request('/availability',{...query(),request_key:crypto.randomUUID()})).json();
    f.sqlite.prepare('UPDATE icon7_padel_jobs SET expires_at=? WHERE id=?').run(Date.now()-1,created.id);
    assert.equal((await f.poll()).job,null);
    assert.equal((await (await f.request('/jobs/'+created.id)).json()).status,'failed');
  }finally{f.close()}
});
test('parses provider schedule across midnight and verifies exact returned customer/time/price/ID',()=>{
  assert.equal(clock24('12:00 AM'),'00:00');assert.equal(clock24('12:00 PM'),'12:00');assert.equal(clock24('1:30 PM'),'13:30');
  const title='Available! 11:00 PM - 12:00 AM (60 minutes) Price: 40 JOD Click to book with flexible start time';
  assert.deepEqual(parseAvailableTitle(title,'Court A',60),{...slot(),start:'23:00'});
  assert.equal(parseAvailableTitle(title,'Court A',90),null);
  const job={payload:{...slot(),start:'23:00',customer:'A. Test',phone:'0790000000'}};
  const text='Name: A. Test Phone: 0790000000 Court Information Court: Court A Time: 23:00:00 - 00:00:00 Duration: 60 minutes Final Price: 40.00 JOD Booking ID: #1234';
  assert.deepEqual(detailsMatch(text,job),{provider_id:'1234'});
  for(const wrong of [text.replace('A. Test','A. Test Other'),text.replace('0790000000','0791111111'),text.replace('40.00','41.00'),text.replace('Court A','Court B'),text.replace('#1234','N/A')])assert.equal(detailsMatch(wrong,job),null);
});
test('journal prevents resubmission after ambiguous provider response or restart',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'icon7-padel-'));
  try{
    const journal=new Journal(dir),job={id:crypto.randomUUID(),claim_token:crypto.randomUUID(),kind:'booking',payload:{},expires_at:Date.now()+120000};let clicks=0,begins=0;
    const provider={async book(_job,{beforeSubmit}){await beforeSubmit();clicks++;throw new Error('Lost response after click')}};
    const api=async route=>{if(route==='/begin')begins++};
    const result=await processJob(job,{journal,provider,api,maySubmit:true});assert.equal(result.status,'unknown');
    await processJob(job,{journal:new Journal(dir),provider,api,maySubmit:true});assert.equal(clicks,1);assert.equal(begins,1);
    await assert.rejects(reportPending(journal,async()=>{throw new Error('offline')}));assert.equal(journal.pending().length,1);
    await reportPending(journal,async()=>({ok:true}));assert.equal(journal.pending().length,0);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('failure before submission is safe; dry-run never authorizes a click',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'icon7-dry-'));
  try{
    const journal=new Journal(dir);let begins=0;
    const result=await processJob({id:crypto.randomUUID(),claim_token:'test',kind:'booking',payload:{},expires_at:Date.now()+120000},{journal,api:async()=>{begins++},provider:{async book(_job,{maySubmit}){assert.equal(maySubmit,false);throw new Error('Dry run')}},maySubmit:false});
    assert.equal(result.status,'failed');assert.equal(begins,0);
  }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test('administrator pairs a Windows device once; token is stored only as a hash',async()=>{
  const f=fixture();try{
    f.env.ICON7_CONNECTOR_SECRET=undefined;
    assert.equal((await f.request('/pair-code',{})).status,403);
    f.setProfile({username:'admin',role:'admin'});
    const {code}=await (await f.request('/pair-code',{})).json();assert.match(code,/^[a-f0-9]{32}$/);
    const secret='fixture-new-device-secret-32-characters';
    assert.equal((await f.request('/pair',{code:'0'.repeat(32),secret},true)).status,403);
    assert.equal((await f.request('/pair',{code,secret},true)).status,200);
    assert.equal((await f.request('/pair',{code,secret},true)).status,403);
    assert.equal((await f.request('/poll',{ready:true},true,secret)).status,200);
    const saved=f.sqlite.prepare('SELECT * FROM icon7_padel_pairing WHERE id=1').get();
    assert.notEqual(saved.secret_hash,secret);assert.equal(saved.pairing_hash,null);
    const next=await (await f.request('/pair-code',{})).json();
    f.sqlite.exec('UPDATE icon7_padel_pairing SET pairing_expires=1');
    assert.equal((await f.request('/pair',{code:next.code,secret},true)).status,403);
  }finally{f.close()}
});
test('only a server-authenticated administrator receives the original admin interface',async()=>{
  const f=fixture();try{
    f.setProfile(null);assert.equal((await f.request('/admin-interface')).status,401);
    f.setProfile({username:'one',role:'agent'});assert.equal((await f.request('/admin-interface')).status,403);
    f.setProfile({username:'admin',role:'admin'});
    const response=await f.request('/admin-interface');assert.equal(response.status,200);
    assert.match(response.headers.get('Content-Type'),/text\/html/);assert.equal(response.headers.get('Cache-Control'),'no-store');
    const {padelAdminTemplate}=await import('../icon7-padel-admin-template.js');assert.equal(await response.text(),padelAdminTemplate);
    assert.equal(fs.existsSync(new URL('../icon7-padel/admin.html',import.meta.url)),false);
    const user=fs.readFileSync(new URL('../icon7-padel/user.html',import.meta.url),'utf8');assert.doesNotMatch(user,/href="admin\.html"/);
  }finally{f.close()}
});
