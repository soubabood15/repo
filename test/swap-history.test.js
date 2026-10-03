import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const page=fs.readFileSync(new URL('../ebook.html',import.meta.url),'utf8');
const source=page.slice(page.indexOf('async function loadMySwapRequests(){'),page.indexOf('async function updateSwapPreview(){'));
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

function setup(select){
  const context=vm.createContext({swapList:{innerHTML:''},currentUser:{username:'agent+1'},supabaseSelect:select,cleanLower:value=>String(value).toLowerCase(),kpiEscape:escape,getSwapStatusText:()=> 'Waiting',console:{error(){}}});
  vm.runInContext(source,context);
  return context;
}

test('swap history uses supported filters, merges and sorts sent/received requests',async()=>{
  const queries=[];
  const old={id:'old',requester_username:'agent+1',target_username:'agent2',swap_date:'2026-10-04',created_at:'2026-10-01',status:'pending_agent'};
  const recent={...old,id:'recent',requester_username:'agent2',target_username:'agent+1',created_at:'2026-10-03',reason:'<unsafe>'};
  const context=setup(async(table,query)=>{assert.equal(table,'shift_swap_requests');queries.push(query);return query.includes('requester_username')?[old]:[recent,old]});
  await context.loadMySwapRequests();
  assert.equal(queries.length,2);
  assert.ok(queries.every(query=>!query.includes('&or=')&&query.includes('eq.agent%2B1')));
  const html=context.swapList.innerHTML;
  assert.ok(html.indexOf('Received from')<html.indexOf('Sent to'));
  assert.equal(html.match(/Sent to/g).length,1);
  assert.ok(html.includes('&lt;unsafe&gt;'));
  assert.ok(html.includes('data-swap-decision="approve"'));
});

test('empty swap history is distinct from a failed request',async()=>{
  const empty=setup(async()=>[]);
  await empty.loadMySwapRequests();
  assert.match(empty.swapList.innerHTML,/No swap requests yet/);
  const failed=setup(async()=>{throw new Error('Offline')});
  await failed.loadMySwapRequests();
  assert.match(failed.swapList.innerHTML,/temporarily unavailable/);
  assert.match(failed.swapList.innerHTML,/data-retry-swap/);
});
