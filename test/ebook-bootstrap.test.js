import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../ebook.html',import.meta.url),'utf8');
const script=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(match=>match[1]).find(code=>code.includes('const SUPABASE_URL'));
test('eBook history bootstrap resolves its DOM helper before registering events and cannot stop login initialization',()=>{
  const helper=script.match(/const \$\s*=.*?;/)?.[0];assert.ok(helper,'DOM helper must be declared');
  assert.ok(script.indexOf(helper)<script.indexOf("$('ucmHistoryForm').addEventListener"));
  const events=[],form={addEventListener:(name,callback)=>events.push({name,callback})};
  const start=script.indexOf("$('ucmHistoryForm').addEventListener"),end=script.indexOf('\nfunction startAgentUcmStatus',start);
  assert.ok(end>start);
  vm.runInNewContext(helper+'\n'+script.slice(start,end),{document:{getElementById:id=>id==='ucmHistoryForm'?form:null}});
  assert.equal(events.length,1);assert.equal(events[0].name,'submit');
  assert.ok(script.includes('loginBtn.addEventListener("click",login)'));
});
