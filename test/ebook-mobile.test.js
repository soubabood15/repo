import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const source=readFileSync(new URL('../ebook-mobile.js',import.meta.url),'utf8');
function fixture(){
  const events={},classes=new Set(['ebook-authenticated']),media={matches:true,addEventListener:(_,fn)=>events.resize=fn};
  const node=()=>({attrs:{},hidden:false,inert:false,setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]},focus(){document.activeElement=this}});
  const nav=node(),toggle=node(),close=node(),backdrop=node(),page=node(),document={activeElement:null,body:{classList:{contains:k=>classes.has(k),toggle(k,on){on?classes.add(k):classes.delete(k)}}},getElementById:id=>({portalSectionNav:nav,ebookMobileMenuToggle:toggle,ebookMobileMenuClose:close,ebookMobileBackdrop:backdrop}[id]),addEventListener:(key,fn)=>events[key]=fn};
  nav.addEventListener=(key,fn)=>events['nav:'+key]=fn;nav.querySelectorAll=()=>[close,page];
  vm.runInNewContext(source,{document,matchMedia:()=>media,MutationObserver:class{constructor(fn){events.mutation=fn}observe(){}}});
  return {events,classes,media,document,nav,toggle,close,backdrop,page};
}
test('mobile drawer opens, closes on selection and restores focus without changing desktop navigation',()=>{
  const f=fixture();assert.equal(f.nav.inert,true);assert.equal(f.backdrop.hidden,true);
  f.toggle.onclick();assert.ok(f.classes.has('ebook-mobile-menu-open'));assert.equal(f.toggle.attrs['aria-expanded'],'true');assert.equal(f.document.activeElement,f.close);
  f.events['nav:click']({target:{closest:()=>f.page}});assert.equal(f.nav.inert,true);assert.equal(f.document.activeElement,f.toggle);
  f.media.matches=false;f.events.resize();assert.equal(f.nav.inert,false);assert.equal(f.nav.attrs['aria-hidden'],undefined);f.toggle.onclick();assert.ok(!f.classes.has('ebook-mobile-menu-open'));
});
test('drawer supports Escape, focus wrapping, backdrop dismissal and closes after sign-out',()=>{
  const f=fixture();f.toggle.onclick();let prevented=0;
  f.events.keydown({key:'Tab',shiftKey:true,preventDefault:()=>prevented++});assert.equal(f.document.activeElement,f.page);
  f.events.keydown({key:'Tab',shiftKey:false,preventDefault:()=>prevented++});assert.equal(f.document.activeElement,f.close);
  f.events.keydown({key:'Escape',preventDefault:()=>prevented++});assert.equal(f.nav.inert,true);assert.equal(prevented,3);
  f.toggle.onclick();f.backdrop.onclick();assert.equal(f.backdrop.hidden,true);
  f.toggle.onclick();f.classes.delete('ebook-authenticated');f.events.mutation();assert.equal(f.nav.inert,true);
});
test('drawer styling is mobile-only and preserves reduced-motion support and touch targets',()=>{
  const css=readFileSync(new URL('../ebook-mobile.css',import.meta.url),'utf8');
  assert.match(css,/@media\(max-width:720px\)/);assert.match(css,/width:min\(290px,87vw\)/);assert.match(css,/min-height:54px!important/);assert.match(css,/prefers-reduced-motion:reduce/);
  assert.match(css,/grid-template-columns:40px minmax\(0,1fr\) auto!important/);
});
