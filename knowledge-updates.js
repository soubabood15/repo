(function(){
  "use strict";
  const PREFIX="newtel_knowledge_seen_v1_";
  const COUNT_PREFIX="newtel_knowledge_unread_v1_";
  const user=()=>{try{return JSON.parse(localStorage.getItem("ebookUser")||"null")?.username||"guest"}catch(_){return"guest"}};
  const key=project=>PREFIX+user()+"_"+project;
  const countKey=project=>COUNT_PREFIX+user()+"_"+project;
  const signature=item=>JSON.stringify(Object.keys(item||{}).filter(k=>!["updated_at","created_at"].includes(k)).sort().reduce((out,k)=>(out[k]=item[k],out),{}));
  function read(project){try{return JSON.parse(localStorage.getItem(key(project))||"null")}catch(_){return null}}
  function write(project,value){localStorage.setItem(key(project),JSON.stringify(value))}
  function ingest(project,items){
    const rows=(items||[]).filter(item=>item&&item.id!=null),existing=read(project);
    if(!existing){const baseline={};rows.forEach(item=>baseline[item.id]=signature(item));write(project,baseline);localStorage.setItem(countKey(project),"0");return new Set()}
    const unread=new Set();rows.forEach(item=>{if(existing[item.id]!==signature(item))unread.add(String(item.id))});
    localStorage.setItem(countKey(project),String(unread.size));
    window.dispatchEvent(new CustomEvent("knowledge-unread-change",{detail:{project,count:unread.size}}));
    return unread;
  }
  function markRead(project,item){const seen=read(project)||{};seen[item.id]=signature(item);write(project,seen);const current=Math.max(0,Number(localStorage.getItem(countKey(project))||0)-1);localStorage.setItem(countKey(project),String(current));window.dispatchEvent(new CustomEvent("knowledge-unread-change",{detail:{project,count:current}}))}
  function count(project){return Number(localStorage.getItem(countKey(project))||0)}
  window.KnowledgeUpdates={ingest,markRead,count,signature};
})();
