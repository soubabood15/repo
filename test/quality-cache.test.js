import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
const source=fs.readFileSync(new URL('../quality-cache.js',import.meta.url),'utf8');
function setup(storage=new Map()){
  let time=100000,requests=0,months={};
  const ctx=vm.createContext({Date:{now:()=>time},localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},fetch:async()=>{requests++;return {ok:true,json:async()=>({months})}}});
  vm.runInContext(source,ctx);
  return {cache:ctx.QualityCache,client:{supabaseUrl:'https://example.test',auth:{getSession:async()=>({data:{session:{access_token:'test-only'}}})}},storage,setMonths:value=>months=value,tick:()=>time+=61000,requests:()=>requests};
}
test('unchanged months never reload payloads; only the changed month is invalidated',async()=>{
  const s=setup();let loads=0;const load=async()=>({value:++loads});
  s.setMonths({'2026-08':'a','2026-09':'b'});
  await s.cache.get(s.client,'admin1','qa:110','2026-08',load);
  await s.cache.get(s.client,'admin1','qa:110','2026-09',load);
  s.tick();await s.cache.get(s.client,'admin1','qa:110','2026-08',load);
  assert.equal(loads,2);assert.equal(s.requests(),2);
  s.setMonths({'2026-08':'a','2026-09':'changed'});s.tick();
  await s.cache.get(s.client,'admin1','qa:110','2026-08',load);assert.equal(loads,2);
  await s.cache.get(s.client,'admin1','qa:110','2026-09',load);assert.equal(loads,3);
});
test('historical cache survives reopening but is account-scoped and clears on logout',async()=>{
  const s=setup();let loads=0;
  await s.cache.get(s.client,'admin1','calls','2026-08',async()=>{loads++;return []});
  const reopened=setup(s.storage);await reopened.cache.get(reopened.client,'admin1','calls','2026-08',async()=>{loads++;return []});assert.equal(loads,1);
  await reopened.cache.get(reopened.client,'admin2','calls','2026-08',async()=>{loads++;return []});assert.equal(loads,2);
  reopened.cache.clear();assert.equal(s.storage.has('newtel-quality-cache-v1:admin2'),false);
  const cachedText=[...s.storage.values()].join('');assert.doesNotMatch(cachedText,/test-only|access_token/);
});
test('local writes invalidate only their month and failed loads are not cached',async()=>{
  const s=setup();let loads=0;
  for(const month of ['2026-08','2026-09'])await s.cache.get(s.client,'admin','qa:110',month,async()=>++loads);
  s.cache.invalidate('2026-09');await s.cache.get(s.client,'admin','qa:110','2026-08',async()=>++loads);assert.equal(loads,2);
  await assert.rejects(s.cache.get(s.client,'admin','qa:110','2026-09',async()=>{throw Error('offline')}));
  assert.equal(s.cache.isCurrent('qa:110','2026-09'),false);
  await s.cache.get(s.client,'admin','qa:110','2026-09',async()=>++loads);assert.equal(loads,3);
  assert.equal(s.cache.isCurrent('qa:110','2026-09'),true);
});
test('SQLite triggers track inserts, edits, moves, deletes and transaction rollback',()=>{
  const migration=fs.readFileSync(new URL('../migrations/0004_quality_month_revisions.sql',import.meta.url),'utf8');
  const sql=`CREATE TABLE app_control(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);CREATE TABLE quality_calls(id TEXT PRIMARY KEY,call_date TEXT,created_at TEXT,score REAL);
${migration}
${migration}
INSERT INTO quality_calls VALUES('a','2026-08-05','2026-09-01',80);
CREATE TEMP TABLE snapshot AS SELECT key,value FROM app_control;
UPDATE quality_calls SET call_date='2026-09-05',score=90 WHERE id='a';
SELECT (SELECT value FROM snapshot WHERE key='quality_revision_2026-08') != (SELECT value FROM app_control WHERE key='quality_revision_2026-08');
SELECT count(*) FROM app_control WHERE key IN ('quality_revision_2026-08','quality_revision_2026-09');
DELETE FROM snapshot;INSERT INTO snapshot SELECT key,value FROM app_control;
BEGIN;DELETE FROM quality_calls;ROLLBACK;
SELECT (SELECT value FROM snapshot WHERE key='quality_revision_2026-09') = (SELECT value FROM app_control WHERE key='quality_revision_2026-09');
DELETE FROM quality_calls;
SELECT (SELECT value FROM snapshot WHERE key='quality_revision_2026-09') != (SELECT value FROM app_control WHERE key='quality_revision_2026-09');
SELECT count(*) FROM sqlite_master WHERE type='trigger';`;
  assert.equal(execFileSync('sqlite3',[':memory:'],{input:sql,encoding:'utf8'}).trim(),'1\n2\n1\n1\n3');
});
