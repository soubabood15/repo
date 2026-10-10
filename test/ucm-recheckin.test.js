import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyQueueRecheckin} from '../ucm-recheckin.js';

const now=Date.parse('2026-10-10T16:00:00Z');
function database(members,observed_at=new Date(now).toISOString()){
  return {prepare(sql){
    if(sql.includes('FROM ucm_agent_mapping'))return {all:async()=>({results:[]})};
    if(sql.includes('FROM trainer_users'))return {all:async()=>({results:[{username:'116',role:'agent',active:1}]})};
    if(sql.includes("key='queue-live'"))return {first:async()=>({value:JSON.stringify({observed_at,members})})};
    throw new Error('Unexpected database access: '+sql);
  }};
}
test('recheck-in accepts only a confirmed own queue login with no pause',async()=>{
  const member={extension:'116',queue:'600',logged_in:true,paused:false};
  assert.deepEqual(await verifyQueueRecheckin(database([member]),'116',now),{ok:true,observed_at:new Date(now).toISOString(),queues:['600'],extensions:['116']});
  assert.equal((await verifyQueueRecheckin(database([{...member,paused:true}]),'116',now)).code,'UCM_QUEUE_PAUSED');
  assert.equal((await verifyQueueRecheckin(database([{...member,paused:null}]),'116',now)).code,'UCM_QUEUE_STATUS_UNAVAILABLE');
  assert.equal((await verifyQueueRecheckin(database([{...member,logged_in:false},{...member,extension:'117'}]),'116',now)).code,'UCM_QUEUE_LOGIN_REQUIRED');
});
test('stale, future and unmapped queue status cannot reopen attendance',async()=>{
  const members=[{extension:'116',queue:'600',logged_in:true,paused:false}];
  for(const stamp of [new Date(now-180001).toISOString(),new Date(now+30001).toISOString(),'invalid'])assert.equal((await verifyQueueRecheckin(database(members,stamp),'116',now)).ok,false);
  assert.equal((await verifyQueueRecheckin(database(members),'unmapped',now)).ok,false);
  assert.equal((await verifyQueueRecheckin(database([...members,{...members[0],queue:'601',paused:true}]),'116',now)).code,'UCM_QUEUE_PAUSED');
});
