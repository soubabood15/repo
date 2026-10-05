import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('../kb_admin.html',import.meta.url),'utf8');
test('admin inline scripts parse and the account form preserves its existing unique IDs',()=>{
  for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))if(match[1].trim())new vm.Script(match[1]);
  for(const id of ['trFullName','trUsername','trPassword','trRole','addTrainerBtn','trainersTable','userRoleFilter','userSearch'])assert.equal((html.match(new RegExp(`id="${id}"`,'g'))||[]).length,1,id);
  assert.match(html,/href="admin-pages.css\?v=\d+"/);
});
test('directory search and role filter render safely without changing accounts',()=>{
  const users=[{id:'1',username:'110',full_name:'Agent One',role:'agent',active:true},{id:'2',username:'1200',full_name:'Quality Two',role:'quality',active:false}];
  const nodes={userRoleFilter:{value:'all'},userSearch:{value:''},userSummary:{},usersRoleStats:{},trainersTable:{}};
  const ctx=vm.createContext({$:id=>nodes[id],usersCache:users,UNDELETABLE_USERNAMES:['110'],esc:value=>String(value).replaceAll('<','&lt;').replaceAll('"','&quot;')});
  vm.runInContext(html.slice(html.indexOf('function renderUsersTable(){'),html.indexOf('async function changeUserRole(')),ctx);
  ctx.renderUsersTable();assert.match(nodes.trainersTable.innerHTML,/Agent One/);assert.match(nodes.trainersTable.innerHTML,/Quality Two/);assert.match(nodes.trainersTable.innerHTML,/Protected/);
  nodes.userSearch.value='1200';ctx.renderUsersTable();assert.doesNotMatch(nodes.trainersTable.innerHTML,/Agent One/);assert.match(nodes.userSummary.textContent,/1 of 2/);
  nodes.userRoleFilter.value='agent';ctx.renderUsersTable();assert.match(nodes.trainersTable.innerHTML,/No users found/);
  nodes.userSearch.value='';ctx.renderUsersTable();assert.match(nodes.trainersTable.innerHTML,/changePass|Password/);assert.match(nodes.trainersTable.innerHTML,/logoutSingleUser/);assert.match(nodes.trainersTable.innerHTML,/toggleTrainer/);
  assert.equal(users.length,2);assert.equal(users[1].active,false);
});
test('entry animation supports reduced motion and users become mobile cards',()=>{
  const css=fs.readFileSync(new URL('../admin-pages.css',import.meta.url),'utf8');
  assert.match(css,/@keyframes adminPageEnter/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
  assert.match(css,/animation:none!important/);
  assert.match(css,/content:attr\(data-label\)/);
});
test('side menu toggle updates visibility, keyboard access and persisted state',()=>{
  const classes=new Set(),saved={},attrs={},menu={setAttribute:(key,value)=>attrs['menu_'+key]=value};
  const button={setAttribute:(key,value)=>attrs[key]=value};
  const ctx=vm.createContext({document:{body:{classList:{toggle:(key,value)=>value?classes.add(key):classes.delete(key)}}},$:id=>id==='adminSideMenu'?menu:null,adminSidebarToggle:button,localStorage:{setItem:(key,value)=>saved[key]=value}});
  vm.runInContext(html.slice(html.indexOf('function setAdminSidebarHidden(hidden){'),html.indexOf('if(adminSidebarToggle){\n  let hidden=')),ctx);
  ctx.setAdminSidebarHidden(true);
  assert.equal(classes.has('admin-sidebar-hidden'),true);assert.equal(menu.inert,true);assert.equal(attrs['aria-expanded'],'false');assert.equal(saved.newtelAdminSidebarHidden,'1');
  ctx.setAdminSidebarHidden(false);
  assert.equal(classes.has('admin-sidebar-hidden'),false);assert.equal(menu.inert,false);assert.equal(attrs['menu_aria-hidden'],'false');assert.equal(attrs['aria-expanded'],'true');
  ctx.localStorage.setItem=()=>{throw Error('Storage unavailable')};assert.doesNotThrow(()=>ctx.setAdminSidebarHidden(true));
  assert.match(html,/id="adminSidebarToggle"/);assert.match(html,/id="adminMenuBackdrop"/);
});
