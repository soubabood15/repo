import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
function setup(shifts={}){
  const nodes={shiftMsg:{},scheduleWeekDate:{value:'2026-10-04'},plannerDraftCount:{},plannerSaveAll:{}};
  const users=[{username:'a',role:'agent'},{username:'b',role:'agent'}];
  const ctx=vm.createContext({window:{addEventListener(){}},$:(id)=>nodes[id],getAppControlValue:key=>shifts[key]||'',WEEKDAY_BY_DATE:['sun','mon','tue','wed','thu','fri','sat'],getScheduleUsers:()=>users,getWeekDates:()=>Array.from({length:7},(_,i)=>({value:`2026-10-${String(4+i).padStart(2,'0')}`})),confirm:()=>true,showMsg:()=>{}});
  vm.runInContext(fs.readFileSync(new URL('../schedule-role-groups.js',import.meta.url),'utf8'),ctx);
  vm.runInContext(fs.readFileSync(new URL('../shift-planner.js',import.meta.url),'utf8'),ctx);
  vm.runInContext('renderShiftPlanner=()=>{}',ctx);
  return {ctx,users,nodes};
}
test('coverage distinguishes lone shifts, nearby colleagues and full overlap',()=>{
  const {ctx,users}=setup({'shift_a_2026-10-04':'08:00 - 17:00'});
  assert.equal(ctx.plannerCoverage('a','2026-10-04',users).level,'red');
  ctx.plannerSet('b','2026-10-04','09:00 - 18:00');
  assert.equal(ctx.plannerCoverage('a','2026-10-04',users).level,'yellow');
  ctx.plannerSet('b','2026-10-04','08:00 - 17:00');
  assert.equal(ctx.plannerCoverage('a','2026-10-04',users).level,'green');
  ctx.plannerSet('b','2026-10-04','10:00 - 19:00');
  assert.equal(ctx.plannerCoverage('a','2026-10-04',users).level,'red');
  ctx.plannerSet('a','2026-10-04','OFF');assert.equal(ctx.plannerCoverage('a','2026-10-04',users),null);
});
test('overnight coverage includes previous and next dated shifts, not own other shifts',()=>{
  const {ctx,users}=setup({'shift_a_2026-10-04':'00:00 - 08:00','shift_b_2026-10-03':'23:00 - 08:00'});
  assert.equal(ctx.plannerCoverage('a','2026-10-04',users).level,'green');
  ctx.plannerSet('a','2026-10-04','23:00 - 08:00');
  ctx.plannerSet('b','2026-10-04','23:00 - 00:00');ctx.plannerSet('b','2026-10-05','00:00 - 08:00');
  assert.equal(ctx.plannerCoverage('a','2026-10-04',users).level,'green');
});
test('copy previous week creates drafts only, crosses month boundaries, preserves missing days and respects cancellation',()=>{
  const {ctx}=setup({'shift_a_2026-09-27':'08:00 - 17:00','shift_b_2026-09-27':'OFF','shift_a_2026-10-05':'12:00 - 21:00'});
  ctx.confirm=()=>false;ctx.copyPlannerPreviousWeek();assert.equal(ctx.plannerValue('a','2026-10-04'),'');
  ctx.confirm=()=>true;ctx.copyPlannerPreviousWeek();
  assert.equal(ctx.plannerValue('a','2026-10-04'),'08:00 - 17:00');
  assert.equal(ctx.plannerValue('b','2026-10-04'),'OFF');
  assert.equal(ctx.plannerValue('a','2026-10-05'),'12:00 - 21:00');
  assert.equal(ctx.plannerSavedShift('a','2026-10-04'),'');
});
