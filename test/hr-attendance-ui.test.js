import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {defaultHrPermissions,hrAllowed} from '../hr-permissions.js';
test('employee attendance history caches by owner, month and revision and never asks for another owner',async()=>{
  const source=readFileSync(new URL('../employee-hr.js',import.meta.url),'utf8'),calls=[],output={},nodes={profileSection:{classList:{contains:()=>true}},employeeAttendanceMonth:{value:'2026-09'},employeeAttendanceSummary:{id:'summary'},employeeAttendanceDays:{id:'days'}};
  const context=vm.createContext({Map,employeeHrState:{profile:{username:'fixture-one'},revision:'one'},document:{getElementById:id=>nodes[id]},employeeHrEsc:String,employeeHrTime:v=>v||'Not recorded',employeeHrMinutes:String,NewtelLiveDom:{text:(node,value)=>output[node.id]=value,html:(node,value)=>output[node.id]=value},NewtelHrApi:{async call(path){calls.push(path);return {rows:[{day:'2026-09-20',shift:'08:00 - 17:00',attendance:null,status:'absent',late_minutes:0,work_minutes:0,required_minutes:540}]}}}});
  vm.runInContext(source.slice(source.indexOf('let employeeAttendanceCache'),source.indexOf("document.addEventListener('DOMContentLoaded'")),context);
  await context.loadEmployeeAttendanceHistory();await context.loadEmployeeAttendanceHistory();assert.equal(calls.length,1);assert.match(output.summary,/1 absent days/);assert.match(output.days,/Not recorded/);
  context.employeeHrState.revision='two';await context.loadEmployeeAttendanceHistory();assert.equal(calls.length,2);
  context.employeeHrState.profile.username='fixture-two';await context.loadEmployeeAttendanceHistory();assert.equal(calls.length,3);assert.ok(calls.every(path=>path==='/me/attendance?month=2026-09'));
  nodes.profileSection.classList.contains=()=>false;context.employeeHrState.revision='three';await context.loadEmployeeAttendanceHistory();assert.equal(calls.length,3);
});
test('permission-limited performance payload renders without NaN attendance counts',()=>{
  const source=readFileSync(new URL('../hr.js',import.meta.url),'utf8'),output={},nodes=new Map();
  const node=id=>{if(!nodes.has(id))nodes.set(id,{id,hidden:false,value:'2026-09',querySelectorAll:()=>[]});return nodes.get(id)};
  const context=vm.createContext({Map,Date,hrAllowed,document:{getElementById:node,querySelectorAll:()=>[]},NewtelLiveDom:{text:(n,value)=>output[n.id]=value,html:(n,value)=>output[n.id]=value},hrAttendanceStatus:()=>({}),hrPresence:()=>false});
  vm.runInContext(source.slice(0,source.indexOf('const mobile=')).replace(/^import .*;\n/gm,''),context);
  context.permissions=defaultHrPermissions('hr');
  vm.runInContext("state.data={permissions,roster:[],grace:0};state.view='performance';state.analytics={month:'2026-09',basis:'Fixture only',roster:[{username:'one',full_name:'Employee',role:'agent',kpi:null}]};render();",context);
  assert.doesNotMatch(output.hrMetrics,/NaN|undefined/);assert.match(output.hrMetrics,/KPI records/);assert.match(output.hrView,/No Agent360 KPI data/);
});
test('English administration labels and HR-only export remain in their intended screens',()=>{
  const admin=readFileSync(new URL('../kb_admin.html',import.meta.url),'utf8'),hr=readFileSync(new URL('../hr.html',import.meta.url),'utf8');
  assert.match(admin,/data-tab="attendanceRecords"/);assert.doesNotMatch(admin,/الموارد البشرية/);assert.doesNotMatch(admin,/id="hrExport"/);assert.match(hr,/id="hrExport"/);assert.match(hr,/data-view="staff"/);
});
