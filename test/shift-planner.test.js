import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../shift-planner.js',import.meta.url),'utf8');
test('planner is embedded in the existing admin Shifts tab with letter presets',()=>{
  const admin=fs.readFileSync(new URL('../kb_admin.html',import.meta.url),'utf8');
  assert.match(admin,/data-tab="shiftSchedule"/);
  assert.match(admin,/<section class="panel" id="shiftSchedule">/);
  assert.match(admin,/src="shift-planner.js\?v=\d+"/);
  assert.match(admin,/AA–PP \(12 hours\)/);
  assert.equal(fs.existsSync(new URL('./shift-planner-preview.html',import.meta.url)),false);
});
function setup(error=null){
  const nodes={},writes=[],messages=[];
  for(const id of ['plannerDraftCount','plannerSaveAll','shiftMsg'])nodes[id]={};
  const ctx=vm.createContext({window:{addEventListener(){}},$:(id)=>nodes[id],appControlCache:[{key:'shift_101_thu',value:'09:00 - 18:00'}],WEEKDAY_BY_DATE:['sun','mon','tue','wed','thu','fri','sat'],getAppControlValue:key=>ctx.appControlCache.find(row=>row.key===key)?.value||'',showMsg:(node,text)=>messages.push(text),db:{from:table=>({upsert:async payload=>{writes.push({table,payload});return {error}}})}});
  vm.runInContext(source,ctx);
  vm.runInContext('renderShiftPlanner=()=>updatePlannerCount()',ctx);
  return {ctx,nodes,writes,messages};
}
test('drafts do not write until saved and row save preserves other drafts',async()=>{
  const {ctx,writes,nodes}=setup();
  ctx.plannerSet('101','2026-10-08','12:00 - 21:00');
  ctx.plannerSet('102','2026-10-08','OFF');
  assert.equal(writes.length,0);
  await ctx.savePlannerDrafts('101');
  assert.equal(writes[0].table,'app_control');
  assert.equal(writes[0].payload.length,1);
  assert.equal(writes[0].payload[0].key,'shift_101_2026-10-08');
  assert.match(nodes.plannerDraftCount.textContent,/1 unsaved/);
  assert.equal(ctx.plannerValue('101','2026-10-08'),'12:00 - 21:00');
});
test('incomplete custom hours cannot save and failed writes retain drafts',async()=>{
  const incomplete=setup();incomplete.ctx.plannerSet('101','2026-10-08',' - ');
  await incomplete.ctx.savePlannerDrafts();assert.equal(incomplete.writes.length,0);
  assert.match(incomplete.messages[0],/Complete start and end/);
  const failed=setup({message:'Offline'});failed.ctx.plannerSet('101','2026-10-08','OFF');
  await failed.ctx.savePlannerDrafts();
  assert.match(failed.nodes.plannerDraftCount.textContent,/1 unsaved/);
  assert.equal(failed.nodes.plannerSaveAll.disabled,false);
});
test('reverting a draft to the saved value clears its dirty state',()=>{
  const {ctx,nodes}=setup();ctx.plannerSet('101','2026-10-08','OFF');
  ctx.plannerSet('101','2026-10-08','09:00 - 18:00');
  assert.equal(nodes.plannerDraftCount.textContent,'All changes saved');
  assert.equal(ctx.plannerValue('missing','2026-10-08'),'');
});
