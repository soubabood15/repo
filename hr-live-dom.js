/* Patch trusted, escaped UI markup without detaching unchanged nodes or user drafts. */
globalThis.NewtelLiveDom=(()=>{
  const markup=new WeakMap();
  function key(node){
    if(node.nodeType!==1)return '';
    if(node.id)return 'id:'+node.id;
    for(const name of ['data-live-key','data-request-form','data-schedule-person']){const value=node.getAttribute(name);if(value)return name+':'+value}
    const day=node.getAttribute('data-schedule-day');return day?'shift:'+node.getAttribute('data-schedule-user')+':'+day:'';
  }
  const compatible=(a,b)=>a&&a.nodeType===b.nodeType&&(a.nodeType!==1||a.tagName===b.tagName)&&key(a)===key(b);
  function patchNode(node,next){
    if(node.nodeType!==1){if(node.nodeValue!==next.nodeValue)node.nodeValue=next.nodeValue;return}
    if(node.hasAttribute('data-live-preserve')||node.getAttribute('data-dirty')==='1')return;
    const focused=node.ownerDocument.activeElement===node,selectValue=node.tagName==='SELECT'?node.value:null;
    for(const attr of [...node.attributes]){
      if(attr.name==='open'||focused&&['value','checked','selected'].includes(attr.name))continue;
      if(!next.hasAttribute(attr.name))node.removeAttribute(attr.name);
    }
    for(const attr of [...next.attributes]){
      if(attr.name==='open'||focused&&['value','checked','selected'].includes(attr.name))continue;
      if(node.getAttribute(attr.name)!==attr.value)node.setAttribute(attr.name,attr.value);
    }
    patchChildren(node,next);
    if(selectValue!==null&&[...node.options].some(option=>option.value===selectValue))node.value=selectValue;
    if(!focused&&node.tagName==='INPUT'&&node.type!=='file'&&next.hasAttribute('value')&&node.value!==next.value)node.value=next.value;
  }
  function patchChildren(parent,next){
    const existing=[...parent.childNodes],used=new Set(),keyed=new Map(existing.map(node=>[key(node),node]).filter(([id])=>id));
    let cursor=parent.firstChild;
    for(const candidate of [...next.childNodes]){
      const id=key(candidate);
      let node=id?keyed.get(id):compatible(cursor,candidate)&&!used.has(cursor)?cursor:existing.find(item=>!used.has(item)&&!key(item)&&compatible(item,candidate));
      if(!compatible(node,candidate))node=null;
      if(node){used.add(node);patchNode(node,candidate)}else node=candidate.cloneNode(true);
      if(node!==cursor)parent.insertBefore(node,cursor);
      cursor=node.nextSibling;
    }
    for(const node of existing)if(!used.has(node)&&node.parentNode===parent)node.remove();
  }
  function html(target,value){
    if(!target)return false;const text=String(value??'');if(markup.get(target)===text)return false;
    const template=target.ownerDocument.createElement('template');template.innerHTML=text;
    patchChildren(target,template.content);markup.set(target,text);return true;
  }
  function text(target,value){const next=String(value??'');if(target&&target.textContent!==next)target.textContent=next}
  return Object.freeze({html,text,patchChildren});
})();
