import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../qa-quality-sync.js',import.meta.url),'utf8');
const ctx=vm.createContext({});vm.runInContext(source,ctx);
const row=(id,score,extra={})=>({id,score,status:'evaluated',agent_username:'110',call_date:'2026-10-05',updated_at:'2026-10-05T10:00:00Z',...extra});
test('daily QA uses saved evaluation averages, preserves zero and ignores pending/invalid/other agents',()=>{
  const result=ctx.QualityDailyScores.aggregate([row('a',80),row('b',100),row('b',100),row('c',0,{call_date:'2026-10-06'}),row('p',50,{status:'pending'}),row('n',null),row('x',200),row('other',30,{agent_username:'200'}),row('old',80,{call_date:'2026-09-05'}),row('bad',80,{call_date:'2026-10-32'})],'110','2026-10');
  assert.equal(result[5].score,90);assert.equal(result[5].count,2);assert.equal(result[6].score,0);assert.equal(result[4],undefined);assert.equal(Object.keys(result).length,2);
});
test('legacy date fallback and re-evaluation are reflected without a second stored QA score',()=>{
  const legacy=row('old',70,{call_date:null,created_at:'2026-10-07T08:00:00Z'});
  assert.equal(ctx.QualityDailyScores.aggregate([legacy],'110','2026-10')[7].score,70);
  legacy.score=95;assert.equal(ctx.QualityDailyScores.aggregate([legacy],'110','2026-10')[7].score,95);
  assert.equal(Object.keys(ctx.QualityDailyScores.aggregate([],'110','2026-10')).length,0);
});
test('fetch is authenticated-client read only, filtered by employee/month and paginates',async()=>{
  const queries=[];
  const client={from:table=>{const query={table,filters:[]};queries.push(query);const builder={select(value){query.select=value;return this},eq(key,value){query.filters.push([key,value]);return this},is(key,value){query.legacy=true;query.filters.push([key,value]);return this},gte(key,value){query.filters.push([key,value]);return this},lt(key,value){query.filters.push([key,value]);return this},order(){return this},range:async(start,end)=>{query.range=[start,end];return {data:query.legacy?[]:start===0?Array.from({length:500},(_,i)=>row(String(i),80)):[row('501',100)]}}};return builder}};
  const result=await ctx.QualityDailyScores.fetch(client,'110','2026-10');
  assert.equal(result[5].count,501);assert.equal(queries.length,3);
  assert.ok(queries.every(q=>q.table==='quality_calls'&&q.filters.some(([key,value])=>key==='agent_username'&&value==='110')));
  assert.ok(queries.some(q=>q.filters.some(([key,value])=>key==='call_date'&&value==='2026-11-01')));
  assert.ok(queries.some(q=>q.range[0]===500));
});
test('query errors are not reported as empty quality scores',async()=>{
  const builder={select(){return this},eq(){return this},is(){return this},gte(){return this},lt(){return this},order(){return this},range:async()=>({error:{message:'Denied'}})};
  await assert.rejects(ctx.QualityDailyScores.fetch({from:()=>builder},'110','2026-10'));
});
test('QA UI no longer writes manual scores and visible-tab refresh is bounded',()=>{
  const admin=fs.readFileSync(new URL('../kb_admin.html',import.meta.url),'utf8');
  assert.doesNotMatch(admin,/saveQaMonth|qa_daily_scores_/);
  assert.match(admin,/readonly value=.*data-qa-day/);
  assert.match(admin,/if\(!document.hidden\)checkQualityChanges\(\)\},60000/);
  const quality=fs.readFileSync(new URL('../quality_calls.html',import.meta.url),'utf8');
  assert.match(quality,/qualityScoresNotify\?\.postMessage/);
  for(const html of [admin,quality])for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(match[1].trim())new vm.Script(match[1]);
});
