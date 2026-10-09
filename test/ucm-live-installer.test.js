import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
test('live queue installer verifies every module before stopping the task and preserves secrets',()=>{
  const script=fs.readFileSync(new URL('../connector/windows/Enable-UcmLiveQueues.ps1',import.meta.url),'utf8');
  const mirror=fs.readFileSync(new URL('../Newtel-UCM-Connector/connector/windows/Enable-UcmLiveQueues.ps1',import.meta.url),'utf8');assert.equal(script,mirror);
  const files=[...script.matchAll(/Name = "([^"]+)"; Hash = "([A-F0-9]{64})"/g)];assert.equal(files.length,6);
  for(const [,name,hash] of files){const source=fs.readFileSync(new URL('../connector/'+name,import.meta.url)),standalone=fs.readFileSync(new URL('../Newtel-UCM-Connector/connector/'+name,import.meta.url));assert.deepEqual(source,standalone);assert.equal(crypto.createHash('sha256').update(source).digest('hex').toUpperCase(),hash)}
  assert.ok(script.indexOf('Get-FileHash')<script.indexOf('Stop-ScheduledTask'));assert.match(script,/#Requires -RunAsAdministrator/);assert.match(script,/finally \{ Start-ScheduledTask/);assert.doesNotMatch(script,/Set-Content|Add-Content|Set-ExecutionPolicy|Remove-Item/);
  const launcher=fs.readFileSync(new URL('../Update-UcmLiveQueues.cmd',import.meta.url),'utf8');assert.match(launcher,new RegExp(crypto.createHash('sha256').update(script).digest('hex').toUpperCase()));assert.match(launcher,/-Verb RunAs/);
});
