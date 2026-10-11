import test from 'node:test';
import assert from 'node:assert/strict';
import {cdrCallCategory,createDaySummary,validDaySummary} from '../connector/ucm-day-summary.mjs';
import {flattenCdrPayload} from '../connector/ucm-cdr-format.mjs';
import {dayReportsToKpi} from '../ucm-day-report.js';
test('directions are separate; queue routing overlaps without inflating totals',()=>{
  const day='2026-10-10',summary=createDaySummary(day,{extensions:['116']});
  const rows=[{userfield:'Inbound',action_type:'QUEUE'},{userfield:'Outbound'},{userfield:'Internal'},{}].map((row,i)=>({...row,session:'call-'+i,AcctId:i+1,channel_ext:'116',start:day+' 10:00:00',billsec:20,disposition:'ANSWERED'}));
  summary.add(rows);const result=summary.finish();assert.equal(validDaySummary(result,day),true);assert.equal(result.agents[0].total,4);assert.deepEqual(result.agents[0].categories,{inbound:1,outbound:1,internal:1,unknown:1,queue:1});
  const report=dayReportsToKpi([result])[0];assert.equal(report.inbound_calls,1);assert.equal(report.queue_calls,1);assert.equal(report.total_calls,4);
});
test('context is not mistaken for outbound and queue route survives detailed legs',()=>{
  assert.equal(cdrCallCategory({dcontext:'from-internal'}).direction,'unknown');assert.equal(cdrCallCategory({dcontext:'ext-did-1'}).direction,'inbound');assert.equal(cdrCallCategory({dst_trunk_name:'Carrier'}).direction,'outbound');
  const [leg]=flattenCdrPayload({cdr_root:[{cdr:'one',main_cdr:{action_type:'QUEUE',dst:'600'},sub_cdr_1:{action_type:'DIAL',userfield:'Inbound'}}]});assert.equal(cdrCallCategory(leg).queue,true);
});
test('older reader data shows unavailable direction numbers, not invented zeros',()=>{
  const summary=createDaySummary('2026-10-10',{extensions:['116']});summary.add([{session:'old',AcctId:1,channel_ext:'116',start:'2026-10-10 10:00:00'}]);const result=summary.finish();delete result.agents[0].categories;
  assert.equal(dayReportsToKpi([result])[0].inbound_calls,null);assert.equal(validDaySummary(result,result.day),false);
});
