import test from 'node:test';
import assert from 'node:assert/strict';
import {ucmRepairDownload} from '../ucm-repair-download.js';
import {ucmBodyHash} from '../ucm-ingest-auth.js';
test('private repair download requires an exact capability and expires within one hour',async()=>{
  const token='a'.repeat(64),now=Date.now(),zip='PK-fixture-not-production';
  const bundle={token_hash:await ucmBodyHash(token),created_at:now-100,expires_at:now+10000,zip_base64:btoa(zip)},env={UCM_REPAIR_DOWNLOAD:JSON.stringify(bundle)};
  const request=(value=token,method='GET')=>new Request('https://fixture.invalid/integrations/ucm/receiver-repair-download?token='+value,{method});
  const response=await ucmRepairDownload(request(),env,now);assert.equal(response.status,200);assert.equal(await response.text(),zip);assert.match(response.headers.get('Content-Disposition'),/attachment/);assert.equal(response.headers.get('Referrer-Policy'),'no-referrer');assert.match(response.headers.get('Cache-Control'),/no-store/);
  for(const value of ['', 'b'.repeat(64), token+'a'])assert.equal((await ucmRepairDownload(request(value),env,now)).status,404);
  assert.equal((await ucmRepairDownload(request(),env,bundle.expires_at)).status,404);
  assert.equal((await ucmRepairDownload(request(),env,now-1000)).status,404);
  assert.equal((await ucmRepairDownload(request(token,'POST'),env,now)).status,404);
  assert.equal((await ucmRepairDownload(request(),{},now)).status,404);
  assert.equal((await ucmRepairDownload(request(),{UCM_REPAIR_DOWNLOAD:'invalid'},now)).status,404);
  assert.equal((await ucmRepairDownload(request(),{UCM_REPAIR_DOWNLOAD:JSON.stringify({...bundle,expires_at:now+3600001})},now)).status,404);
});
