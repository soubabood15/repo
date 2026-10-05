/* Per-account, per-month cache. Never expires historical data just for its age. */
globalThis.QualityCache=(()=>{
  let scope='',entries={},versions={},checkedAt=0,pending=null,generation=0;
  function configure(account){
    const next='newtel-quality-cache-v1:'+String(account||'');if(next===scope)return;
    scope=next;entries={};versions={};checkedAt=0;pending=null;generation++;
    try{const saved=JSON.parse(localStorage.getItem(scope)||'{}');if(saved&&typeof saved==='object'&&!Array.isArray(saved))entries=saved}catch{}
  }
  function persist(){
    const keys=Object.keys(entries).sort((a,b)=>entries[b].at-entries[a].at);
    for(const key of keys.slice(16))delete entries[key];
    try{localStorage.setItem(scope,JSON.stringify(entries))}catch{}
  }
  async function check(client,account,force=false){
    configure(account);
    if(pending)return pending;
    if(!force&&checkedAt&&Date.now()-checkedAt<60000)return [];
    const token=generation;
    pending=(async()=>{
      const {data:{session}}=await client.auth.getSession();if(!session?.access_token)throw Error('Admin session unavailable');
      const response=await fetch(client.supabaseUrl+'/functions/v1/quality-revisions',{headers:{Authorization:'Bearer '+session.access_token},cache:'no-store'});
      const data=await response.json();if(!response.ok)throw Error(data.message||'Quality change check failed');
      if(token!==generation)return [];
      const next=data.months||{},changed=[...new Set([...Object.keys(versions),...Object.keys(next)])].filter(month=>(versions[month]||'initial')!==(next[month]||'initial'));
      versions=next;checkedAt=Date.now();return changed;
    })().finally(()=>{if(token===generation)pending=null});
    return pending;
  }
  async function get(client,account,kind,month,loader){
    await check(client,account);
    const key=kind+':'+month,revision=versions[month]||'initial',token=generation;
    if(entries[key]?.revision===revision)return entries[key].data;
    const data=await loader();
    if(token===generation){entries[key]={revision,month,data,at:Date.now()};persist()}
    return data;
  }
  function invalidate(month){
    generation++;pending=null;checkedAt=0;
    for(const [key,entry] of Object.entries(entries))if(!month||entry.month===month)delete entries[key];
    persist();
  }
  function clear(){try{if(scope)localStorage.removeItem(scope)}catch{}scope='';entries={};versions={};checkedAt=0;pending=null;generation++}
  function isCurrent(kind,month){return entries[kind+':'+month]?.revision===(versions[month]||'initial')}
  return Object.freeze({check,get,invalidate,clear,isCurrent});
})();
