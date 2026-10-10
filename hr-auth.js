/* Uses the existing login; never stores credentials or logs tokens. */
globalThis.NewtelHrApi=(()=>{
  const base='https://trainer-kb.alisoub60.workers.dev';
  let refreshPending=null;
  function session(){for(const key of ['ebookAuthSession','newtel-admin-auth']){try{const value=JSON.parse(localStorage.getItem(key)||'null');if(value?.access_token)return {key,value}}catch{}}return null}
  async function token(){
    const stored=session();if(!stored)throw Error('Sign in to eBook first.');
    if(!stored.value.expires_at||Number(stored.value.expires_at)*1000>Date.now()+30000)return stored.value.access_token;
    if(!stored.value.refresh_token)throw Error('Your session expired. Sign in again.');
    if(!refreshPending)refreshPending=(async()=>{
      const response=await fetch(base+'/auth/v1/token?grant_type=refresh_token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({refresh_token:stored.value.refresh_token})});
      const data=await response.json();if(!response.ok||!data.access_token)throw Error('Your session expired. Sign in again.');
      localStorage.setItem(stored.key,JSON.stringify({...stored.value,...data}));return data.access_token;
    })().finally(()=>refreshPending=null);
    return refreshPending;
  }
  async function call(path,{method='GET',body,file=false}={}){
    const headers={Authorization:'Bearer '+await token()};if(body&&!(body instanceof FormData))headers['Content-Type']='application/json';
    const response=await fetch(base+'/functions/v1/hr'+path,{method,headers,body:body instanceof FormData?body:body?JSON.stringify(body):undefined,cache:'no-store'});
    if(file&&response.ok)return response.blob();
    const data=await response.json().catch(()=>({}));if(!response.ok)throw Error(data.message||'The request could not be completed.');return data;
  }
  async function logout(){
    try{await fetch(base+'/auth/v1/logout',{method:'POST',headers:{Authorization:'Bearer '+await token()}})}catch{}
    for(const key of ['ebookAuthSession','newtel-admin-auth','ebookUser','ebookPermissions','ebookProjectLaunch'])localStorage.removeItem(key);
    location.href='ebook.html';
  }
  return Object.freeze({call,logout,token});
})();
