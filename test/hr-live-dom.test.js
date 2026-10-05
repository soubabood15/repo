import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../hr-live-dom.js',import.meta.url),'utf8');
class NodeFixture{
  constructor(doc,tag=null,attrs={},children=[],text=''){this.ownerDocument=doc;this.nodeType=tag?1:3;this.tagName=tag?.toUpperCase();this.attrs=new Map(Object.entries(attrs));this.childNodes=[];this.parentNode=null;this.nodeValue=text;this.value=attrs.value||'';for(const child of children){child.parentNode=this;this.childNodes.push(child)}}
  get id(){return this.getAttribute('id')||''}get attributes(){return [...this.attrs].map(([name,value])=>({name,value}))}get firstChild(){return this.childNodes[0]||null}get nextSibling(){return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this)+1]||null}get options(){return this.childNodes.filter(n=>n.tagName==='OPTION')}get type(){return this.getAttribute('type')||'text'}
  getAttribute(name){return this.attrs.get(name)??null}hasAttribute(name){return this.attrs.has(name)}setAttribute(name,value){this.ownerDocument.writes++;this.attrs.set(name,value)}removeAttribute(name){this.ownerDocument.writes++;this.attrs.delete(name)}
  insertBefore(node,cursor){this.ownerDocument.writes++;if(node.parentNode){const i=node.parentNode.childNodes.indexOf(node);node.parentNode.childNodes.splice(i,1)}const index=cursor?this.childNodes.indexOf(cursor):this.childNodes.length;this.childNodes.splice(index,0,node);node.parentNode=this}
  remove(){this.ownerDocument.writes++;if(this.parentNode){const nodes=this.parentNode.childNodes;nodes.splice(nodes.indexOf(this),1);this.parentNode=null}}
  cloneNode(deep){return new NodeFixture(this.ownerDocument,this.tagName,Object.fromEntries(this.attrs),deep?this.childNodes.map(n=>n.cloneNode(true)):[],this.nodeValue)}
}
function fixture(){const doc={activeElement:null,writes:0,parses:0,templates:new Map(),createElement(){return {set innerHTML(value){doc.parses++;this.content=doc.templates.get(value).cloneNode(true)}}}};const text=value=>new NodeFixture(doc,null,{},[],value),el=(tag,attrs={},children=[])=>new NodeFixture(doc,tag,attrs,children);const context=vm.createContext({WeakMap,Map,Set});vm.runInContext(source,context);return {doc,text,el,live:context.NewtelLiveDom}}
test('unchanged polls perform zero DOM writes and retain every node',()=>{
  const {doc,el,text,live}=fixture(),card=el('article',{'data-live-key':'agent:1'},[text('Present')]),root=el('section',{},[card]),next=el('section',{},[card.cloneNode(true)]);
  for(let i=0;i<20;i++)live.patchChildren(root,next);
  assert.equal(root.firstChild,card);assert.equal(doc.writes,0);
});
test('one attendance value updates in place without replacing its card or its neighbor',()=>{
  const {doc,el,text,live}=fixture(),value=text('Pending'),one=el('article',{'data-live-key':'1'},[value]),two=el('article',{'data-live-key':'2'},[text('Present')]),root=el('section',{},[one,two]);
  live.patchChildren(root,el('section',{},[el('article',{'data-live-key':'1'},[text('Approved')]),two.cloneNode(true)]));
  assert.equal(root.firstChild,one);assert.equal(root.childNodes[1],two);assert.equal(one.firstChild,value);assert.equal(value.nodeValue,'Approved');assert.equal(doc.writes,0);
});
test('new/deleted records preserve existing keyed card identities',()=>{
  const {el,text,live}=fixture(),one=el('article',{'data-live-key':'1'},[text('One')]),two=el('article',{'data-live-key':'2'},[text('Two')]),root=el('section',{},[one,two]);
  live.patchChildren(root,el('section',{},[el('article',{'data-live-key':'3'},[text('New')]),one.cloneNode(true),two.cloneNode(true)]));
  assert.equal(root.childNodes[1],one);assert.equal(root.childNodes[2],two);
  live.patchChildren(root,el('section',{},[two.cloneNode(true)]));assert.equal(root.firstChild,two);assert.equal(root.childNodes.length,1);
});
test('open details, dirty shifts, focused input and selected medical files are never detached',()=>{
  const {doc,el,text,live}=fixture(),file=el('input',{type:'file'}),selectedFile={fixture:true};file.files=[selectedFile];
  const form=el('details',{'data-request-form':'sick','data-live-preserve':'',open:''},[file]);
  const dirty=el('div',{'data-schedule-user':'1','data-schedule-day':'2026-10-05','data-dirty':'1'},[text('My draft')]);
  const input=el('input',{id:'reason',value:'Saved'});input.value='Typing';doc.activeElement=input;
  const root=el('section',{},[form,dirty,input]),next=el('section',{},[el('details',{'data-request-form':'sick'},[]),el('div',{'data-schedule-user':'1','data-schedule-day':'2026-10-05'},[text('Server')]),el('input',{id:'reason',value:'New server default'})]);
  live.patchChildren(root,next);assert.equal(form.firstChild,file);assert.equal(file.files[0],selectedFile);assert.ok(form.hasAttribute('open'));assert.equal(dirty.firstChild.nodeValue,'My draft');assert.equal(input.value,'Typing');assert.equal(doc.writes,0);
});
test('byte-identical markup is not even parsed again',()=>{
  const {doc,el,text,live}=fixture(),root=el('div');doc.templates.set('same',el('fragment',{},[el('span',{},[text('Stable')])]));
  assert.equal(live.html(root,'same'),true);const original=root.firstChild;const writes=doc.writes;assert.equal(live.html(root,'same'),false);assert.equal(doc.parses,1);assert.equal(doc.writes,writes);assert.equal(root.firstChild,original);
});
test('revision refresh does not blank loaded insights or retain navigation animations',()=>{
  const hr=readFileSync(new URL('../hr.js',import.meta.url),'utf8'),employee=readFileSync(new URL('../employee-hr.js',import.meta.url),'utf8');
  const load=hr.slice(hr.indexOf('function load('),hr.indexOf('async function check(){'));
  assert.doesNotMatch(load,/state\.analytics=null|state\.requests=null/);assert.match(hr,/animationend.*hr-entering/);assert.doesNotMatch(employee,/node\.innerHTML=/);assert.match(employee,/NewtelLiveDom\.html\(node/);
});
test('unchanged markup still restores attendance controls after a failed punch',()=>{
  const employee=readFileSync(new URL('../employee-hr.js',import.meta.url),'utf8'),buttons=[{dataset:{hrPunch:'in'},disabled:true},{dataset:{hrPunch:'out'},disabled:true}],node={querySelectorAll:()=>buttons};
  const context=vm.createContext({employeeHrState:{day:'2026-10-05',shift:'08:00 - 17:00',attendance:null},document:{getElementById:()=>node},employeeHrEsc:String,employeeHrTime:()=>'',NewtelLiveDom:{html:()=>false},updateEmployeeWork(){},renderEmployeeHrProfile(){},showEmployeeHrAction(){}});
  vm.runInContext(employee.slice(employee.indexOf('function renderEmployeeHr('),employee.indexOf('function employeeHrRequestHistory(')),context);context.renderEmployeeHr();assert.equal(buttons[0].disabled,false);assert.equal(buttons[1].disabled,true);
});
