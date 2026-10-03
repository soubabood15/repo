import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=name=>fs.readFileSync(new URL('../'+name,import.meta.url),'utf8');
const helper=read('schedule-role-groups.js');
const users=[{username:'qa1',full_name:'Quality One',role:'Quality'},{username:'agent1',full_name:'Agent One',role:'Agent'},{username:'qa2',full_name:'Quality Two',role:' quality '},{username:'trainer1',role:'trainer'},{username:'default1'},{username:'admin1',role:'Admin'}];
test('groups every role separately, normalizes case, preserves users and excludes admin',()=>{
  const ctx=vm.createContext({});vm.runInContext(helper,ctx);
  const groups=ctx.ScheduleRoleGroups.group(users);
  assert.deepEqual(Array.from(groups,g=>g.role),['agent','quality','trainer']);
  assert.deepEqual(Array.from(groups[1].users,u=>u.username),['qa1','qa2']);
  assert.equal(groups[0].users[0],users[1]);
  assert.equal(users[2].role,' quality ');
  assert.equal(ctx.ScheduleRoleGroups.group([]).length,0);
});
test('both schedule renderers produce independent role tables with the same dates',()=>{
  for(const page of ['admin','live']){
    const nodes={};const $=id=>nodes[id]||(nodes[id]={value:'',innerHTML:''});
    const days=Array.from({length:7},(_,i)=>({value:`2026-10-${String(4+i).padStart(2,'0')}`,iso:`2026-10-${String(4+i).padStart(2,'0')}`,dayName:'Day'+i,label:'Day'+i}));
    const ctx=vm.createContext({$,window:{addEventListener(){}},getScheduleUsers:()=>users,getWeekDates:()=>days,getTodayIsoDate:()=>days[0].iso,SHIFT_PRESETS:{A:{start:'08:00',end:'17:00'}},getAppControlValue:()=>'',WEEKDAY_BY_DATE:['sun','mon','tue','wed','thu','fri','sat'],parseShiftValue:()=>({start:'',end:''}),getShiftCode:()=>'',esc:value=>String(value??''),state:{users,query:''},dates:()=>days,iso:()=>days[0].iso,isOff:value=>value==='OFF',shiftFor:()=> 'OFF'});
    vm.runInContext(helper,ctx);
    if(page==='admin'){vm.runInContext(read('shift-planner.js'),ctx);ctx.renderShiftPlanner()}
    else{const html=read('team-schedule.html');vm.runInContext(html.slice(html.indexOf('    function render(){'),html.indexOf('    async function load(){')),ctx);ctx.render()}
    const output=$(page==='admin'?'monthlyScheduleHolder':'tableWrap').innerHTML;
    const sections=output.split('<section ').slice(1);
    assert.equal(sections.length,3,page);
    const quality=sections.find(s=>s.includes('data-schedule-role="quality"'));
    assert.match(quality,/qa1/);assert.match(quality,/qa2/);assert.doesNotMatch(quality,/agent1|trainer1/);
    for(const section of sections){assert.equal((section.match(/<table /g)||[]).length,1);assert.match(section,/10-04/);assert.match(section,/10-10/)}
    $(page==='admin'?'plannerSearch':'unused').value='Quality One';ctx.state.query='Quality One';
    if(page==='admin')ctx.renderShiftPlanner();else ctx.render();
    const filtered=$(page==='admin'?'monthlyScheduleHolder':'tableWrap').innerHTML;
    assert.match(filtered,/qa1/);assert.doesNotMatch(filtered,/qa2|agent1/);
  }
});
