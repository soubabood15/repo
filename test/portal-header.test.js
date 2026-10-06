import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('../ebook.html',import.meta.url),'utf8');
const css=readFileSync(new URL('../portal-header.css',import.meta.url),'utf8');
test('dedicated header stylesheet loads after legacy workspace rules',()=>{
  assert.ok(html.indexOf('portal-header.css?v=1')>html.indexOf('workspace.css?v=3'));
  const header=html.slice(html.indexOf('<div class="brand" id="workspaceHeader">'),html.indexOf('</div></nav>'));
  assert.match(header,/portal-company-wordmark/);assert.doesNotMatch(header,/newtel-name/);
  assert.match(header,/id="logoutBtn"[^>]+aria-label="Logout"/);assert.match(header,/<span>Logout<\/span>/);
});
test('hover keeps readable logout label and suppresses legacy shine and mobile replacement',()=>{
  assert.match(css,/#workspaceHeader #logoutBtn:hover\{background:#07669e!important/);
  assert.match(css,/#workspaceHeader #logoutBtn span\{[^}]*color:#fff!important[^}]*font-size:12px!important[^}]*opacity:1!important/);
  assert.match(css,/#logoutBtn span::after\{content:none!important;display:none!important/);
  assert.match(css,/#logoutBtn:focus-visible\{outline:3px solid/);
});
test('mobile header retains agent name without competing with action controls',()=>{
  assert.match(css,/grid-template-columns:minmax\(0,1fr\) auto!important/);
  assert.match(css,/portal-workspace-title\{grid-column:1\/-1!important;grid-row:2!important/);
  assert.match(css,/text-overflow:ellipsis!important/);assert.match(css,/data-theme="dark"/);
});
