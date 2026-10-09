import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {recentDays,monthDays,startCdrSync} from '../connector/ucm-cdr-sync.mjs';
test('automatic history spans previous and current month in Amman across year boundaries',()=>{
  const days=recentDays(Date.parse('2026-01-02T22:30:00Z'));assert.equal(days[0],'2025-12-01');assert.equal(days.at(-1),'2026-01-02');assert.equal(days.length,33);
  assert.equal(monthDays('2024-02').length,29);assert.throws(()=>monthDays('2026-13'),/INVALID/);
});
test('automatic CDR sync saves checkpoints only after successful delivery and resumes without reimporting completed days',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ucm-sync-')),file=path.join(dir,'cdr.json'),ranges=[],config={UCM_WS_URL:'wss://fixture:8089/websockify',CLOUDFLARE_QUEUE_ENDPOINT:'https://receiver.invalid/integrations/ucm/queue-events',UCM_CDR_STATE_FILE:file,UCM_INGEST_USERNAME:'fixture',UCM_INGEST_PASSWORD:'fixture'};
  let fail=true,sync;
  const options={intervalMs:1000000,now:()=>Date.parse('2026-10-09T08:00:00Z'),client:{async cdrPage(range){ranges.push(range);return [{session:'fixture'}]}},log:()=>{},fetcher:async url=>{if(fail)throw new Error('fixture outage');return {ok:true,json:async()=>url.endsWith('history-jobs')?{months:[]}:({ok:true})}}};
  try{
    sync=startCdrSync(config,options);await sync.tick();assert.equal(JSON.parse(fs.readFileSync(file)).last,null);fail=false;await sync.tick();sync.stop();
    const state=JSON.parse(fs.readFileSync(file));assert.equal(state.days['2026-09-01'],true);assert.equal(state.last,'2026-10-09T11:00:00');
    assert.equal(state.days['2026-09-30'],true);assert.equal(state.syncDay,'2026-10-09');
    const count=ranges.length;sync=startCdrSync(config,options);await sync.tick();sync.stop();assert.equal(ranges.length,count,'daily checkpoint survives a restart without another UCM query');
  }finally{sync?.stop();fs.rmSync(dir,{recursive:true,force:true})}
});
