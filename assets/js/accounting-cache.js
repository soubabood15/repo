// Private, per-login tab cache. Revisions are checked without downloading full lists.
globalThis.AccountingCache={create({storage,scope,readRevision,now=()=>Date.now()}){
 let pending,checked=0,epoch=0;const requests=new Map();
 const key=()=> 'ac-data-cache:'+scope();
 const read=()=>{try{return JSON.parse(storage.getItem(key())||'null')||{revision:null,entries:{}};}catch{return {revision:null,entries:{}};}};
 let state=read();
 const save=()=>storage.setItem(key(),JSON.stringify(state));
 function invalidate(){epoch++;state.entries={};checked=0;save();}
 async function validate(force=false){if(!force&&checked&&now()-checked<5000)return false;if(pending)return pending;pending=(async()=>{const revision=String(await readRevision());const changed=state.revision!==revision;if(changed){epoch++;state={revision,entries:{}};save();}checked=now();return changed;})().finally(()=>pending=null);return pending;}
 async function get(path,fetcher){if(Object.hasOwn(state.entries,path))return structuredClone(state.entries[path]);const generation=epoch,requestKey=generation+":"+path;if(!requests.has(requestKey))requests.set(requestKey,Promise.resolve().then(fetcher).then(data=>{if(generation===epoch){state.entries[path]=data;const keys=Object.keys(state.entries);while(keys.length>40)delete state.entries[keys.shift()];save();}return data;}).finally(()=>requests.delete(requestKey)));return structuredClone(await requests.get(requestKey));}

 return {validate,get,invalidate};
}};
