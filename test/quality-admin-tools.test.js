import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../quality-admin-tools.js',import.meta.url),'utf8');
function setup(answer='DELETE 2026-09',fail=false){
  const nodes={qualityDeleteMonth:{value:'2026-09'},qualityDeleteMonthBtn:{},qualityCallMsg:{},qualityBrowseMonth:{value:'2026-09'},qualityCallEmployeeFilter:{value:'all'},qualityEmployeeAverages:{querySelectorAll:()=>[]}};
  const writes=[],removed=[],messages=[],queries=[];
  const target=[{id:'one',call_date:'2026-09-05',audio_path:'shared.mp3'},{id:'two',call_date:'2026-09-05',audio_path:'only.mp3'}];
  const authDb={from:table=>{const query={table,filters:[]};queries.push(query);return {select(){return this},delete(){return this},gte(k,v){query.filters.push([k,v]);return this},lt(k,v){query.filters.push([k,v]);return this},is(){query.legacy=true;return this},order(){return this},range:async()=>({data:query.legacy?[]:target}),in:async(k,ids)=>{writes.push(ids);return fail?{error:{message:'Denied'}}:{error:null}},eq(k,v){query.path=v;return this},limit:async()=>({data:query.path==='shared.mp3'?[{id:'other-month'}]:[]})}},storage:{from:()=>({remove:async paths=>{removed.push(...paths);return {error:null}}})}};
  const ctx=vm.createContext({$:id=>nodes[id],authDb,prompt:()=>answer,showMsg:(node,text)=>messages.push(text),loadAdminQualityCalls:async()=>{},QualityCache:{invalidate(){}},qualityScoreChannel:{postMessage(){}},usersCache:[{username:'110',full_name:'Agent One',role:'agent'}],qualityCallsCache:[{id:'a',agent_username:'110',score:0,status:'evaluated',call_date:'2026-09-05'}],esc:v=>String(v),getTodayIsoDate:()=> '2026-09-05',renderAdminQualityCalls:()=>{}});
  vm.runInContext(source,ctx);return {ctx,nodes,writes,removed,messages,queries};
}
test('month deletion requires exact confirmation and deletes only fetched ids',async()=>{
  const cancelled=setup(null);await cancelled.ctx.deleteQualityMonth();assert.equal(cancelled.writes.length,0);assert.equal(cancelled.removed.length,0);
  const run=setup();await run.ctx.deleteQualityMonth();assert.deepEqual(Array.from(run.writes[0]),['one','two']);assert.deepEqual(run.removed,['only.mp3']);assert.equal(run.nodes.qualityDeleteMonthBtn.disabled,false);
  assert.ok(run.queries.some(q=>q.filters.some(([k,v])=>k==='call_date'&&v==='2026-09-01')));
  assert.ok(run.queries.some(q=>q.filters.some(([k,v])=>k==='call_date'&&v==='2026-10-01')));
});
test('invalid months and failed record deletion never remove audio',async()=>{
  const invalid=setup();invalid.nodes.qualityDeleteMonth.value='2026-13';await invalid.ctx.deleteQualityMonth();assert.equal(invalid.writes.length,0);assert.equal(invalid.queries.length,0);
  const failed=setup('DELETE 2026-09',true);await failed.ctx.deleteQualityMonth();assert.equal(failed.removed.length,0);assert.match(failed.messages.at(-1),/Denied/);
});
test('agent tiles reflect selected month and show zero evaluation correctly',()=>{
  const {ctx,nodes}=setup();ctx.renderQualityAgentTiles();assert.match(nodes.qualityEmployeeAverages.innerHTML,/0.00 \/ 100/);assert.match(nodes.qualityEmployeeAverages.innerHTML,/data-quality-agent="110"/);
  nodes.qualityBrowseMonth.value='2026-10';ctx.renderQualityAgentTiles();assert.match(nodes.qualityEmployeeAverages.innerHTML,/No score/);
  ctx.chooseQualityAgent('110');assert.equal(nodes.qualityCallEmployeeFilter.value,'110');
});
test('quality deletion is admin protected and existing pages parse',()=>{
  const worker=fs.readFileSync(new URL('../worker.js',import.meta.url),'utf8');
  assert.ok(worker.includes('table==="quality_calls"&&method==="DELETE"&&!(await requireAdmin(request,env))'));
  const html=fs.readFileSync(new URL('../kb_admin.html',import.meta.url),'utf8');for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(match[1].trim())new vm.Script(match[1]);
  assert.match(html,/if\(selectedMonth\)rows=rows.filter/);
});
