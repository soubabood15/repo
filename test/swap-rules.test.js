import test from 'node:test';
import assert from 'node:assert/strict';
import {swapScheduleError} from '../worker.js';
import fs from 'node:fs';
import vm from 'node:vm';

const swap={requester_username:'101',target_username:'102',swap_date:'2026-10-08'};
function db(shifts){return {prepare:()=>({bind:key=>({first:async()=>key in shifts?{value:shifts[key]}:null})})}}
test('server rejects either OFF shift and missing schedules',async()=>{
  for(const off of ['OFF',' off ','Day Off','أوف']){
    assert.match(await swapScheduleError(db({'shift_101_2026-10-08':off,'shift_102_thu':'12:00 - 21:00'}),swap),/OFF/);
  }
  assert.match(await swapScheduleError(db({}),swap),/saved shifts/);
  assert.equal(await swapScheduleError(db({'shift_101_2026-10-08':'09:00 - 18:00','shift_102_thu':'12:00 - 21:00'}),swap),null);
});

const html=fs.readFileSync(new URL('../kb_admin.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('async function deleteSwapRequest(id){'),html.indexOf('async function approveSwapRequest(id){'));
function deletion(confirmed=true){
  const calls=[],button={disabled:false};
  const ctx=vm.createContext({swapRequestCache:[{id:'1',status:'approved'},{id:'2',status:'pending_agent'}],confirm:()=>confirmed,$:()=>button,showMsg(){},loadSwapRequests:async()=>{},db:{from:table=>({delete:()=>({eq:async(key,value)=>{calls.push({table,key,value});return {}},in:async(key,values)=>{calls.push({table,key,values});return {}}})})}});
  vm.runInContext(source,ctx);return {ctx,calls,button};
}
test('history deletion targets completed states only, not schedules',async()=>{
  const {ctx,calls,button}=deletion();await ctx.deleteSwapHistory();
  assert.equal(calls[0].table,'shift_swap_requests');
  assert.deepEqual(Array.from(calls[0].values),['approved','rejected','agent_rejected']);
  assert.equal(button.disabled,false);
});
test('single deletion uses exact request id and cancellation does not write',async()=>{
  const {ctx,calls}=deletion();await ctx.deleteSwapRequest('2');
  assert.deepEqual(calls,[{table:'shift_swap_requests',key:'id',value:'2'}]);
  const canceled=deletion(false);await canceled.ctx.deleteSwapRequest('1');await canceled.ctx.deleteSwapHistory();
  assert.equal(canceled.calls.length,0);
});
