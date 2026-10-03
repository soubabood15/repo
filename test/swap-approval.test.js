import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync(new URL('../kb_admin.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('async function approveSwapRequest(id){'),html.indexOf('async function rejectSwapRequest(id){'));
function setup(shifts,updateError=null){
  const writes=[],messages=[];
  const context=vm.createContext({
    swapRequestCache:[{id:'request1',status:'agent_approved',requester_username:'101',target_username:'102',swap_date:'2026-10-08'}],
    currentAdmin:{username:'admin'},WEEKDAY_BY_DATE:['sun','mon','tue','wed','thu','fri','sat'],SHIFT_DAYS:[{key:'thu',label:'Thursday'}],
    loadAppControl:async()=>{},loadSwapRequests:async()=>{},getAppControlValue:key=>shifts[key]||'',
    isOffShift:value=>String(value).trim().toUpperCase()==='OFF',
    $:id=>id,showMsg:(element,message)=>messages.push(message),
    db:{from:table=>({upsert:async payload=>{writes.push({table,payload});return {error:null}},update:payload=>({eq:async()=>{writes.push({table,payload});return {error:updateError}}})})}
  });
  vm.runInContext(source,context);
  return {context,writes,messages};
}
test('approval reads dated Thursday shifts and only changes the requested date',async()=>{
  const {context,writes}=setup({'shift_101_2026-10-08':'15:00 - 00:00','shift_102_2026-10-08':'12:00 - 21:00','shift_101_thu':'old shift'});
  await context.approveSwapRequest('request1');
  assert.equal(writes[0].payload[0].key,'shift_101_2026-10-08');
  assert.equal(writes[0].payload[0].value,'12:00 - 21:00');
  assert.equal(writes[0].payload[1].value,'15:00 - 00:00');
  assert.equal(writes[1].payload.status,'approved');
  assert.equal(writes[1].payload.requester_shift_before,'15:00 - 00:00');
});
test('legacy weekly shifts are read but swapped into dated overrides',async()=>{
  const {context,writes}=setup({'shift_101_thu':'09:00 - 18:00','shift_102_thu':'12:00 - 21:00'});
  await context.approveSwapRequest('request1');
  assert.equal(writes[0].payload[0].value,'12:00 - 21:00');
  assert.equal(writes[0].payload[0].key,'shift_101_2026-10-08');
});
test('missing schedule blocks approval without assuming OFF',async()=>{
  const {context,writes,messages}=setup({'shift_101_2026-10-08':'OFF'});
  await context.approveSwapRequest('request1');
  assert.equal(writes.length,0);
  assert.match(messages[0],/No saved shift/);
});
test('failed approval status restores original shifts for safe retry',async()=>{
  const {context,writes,messages}=setup({'shift_101_2026-10-08':'09:00 - 18:00','shift_102_2026-10-08':'12:00 - 21:00'},{message:'Failed'});
  await context.approveSwapRequest('request1');
  assert.equal(writes[2].payload[0].value,'09:00 - 18:00');
  assert.equal(writes[2].payload[1].value,'12:00 - 21:00');
  assert.match(messages[0],/Original shifts restored/);
});
test('admin cannot approve an OFF swap',async()=>{
  const {context,writes,messages}=setup({'shift_101_2026-10-08':'OFF','shift_102_2026-10-08':'12:00 - 21:00'});
  await context.approveSwapRequest('request1');
  assert.equal(writes.length,0);
  assert.match(messages[0],/OFF days cannot be swapped/);
});
