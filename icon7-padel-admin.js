(()=>{
  const root='https://trainer-kb.alisoub60.workers.dev/functions/v1/icon7-padel';
  const $=id=>document.getElementById(id);
  let loaded=false,loading=false;
  async function call(route,body,html=false){
    // Use the administrator's authenticated session, never the employee profile cache.
    const {data:{session}}=await authDb.auth.getSession();
    if(!session?.access_token)throw new Error('سجّل الدخول بحساب مدير النظام أولاً.');
    const response=await fetch(root+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+session.access_token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(20000)});
    if(!response.ok){const data=await response.json().catch(()=>({}));throw new Error(data.message||'تعذر الاتصال بخادم الحجز.')}
    return html?response.text():response.json();
  }
  async function refresh(){
    const state=await call('/status');
    $('padelAdminStatus').textContent=state.ready?'جهاز الربط متصل وأيكون جاهز للحجز.':state.online?'الجهاز متصل؛ سجّل دخول أيكون بواسطة Login.cmd.':'جهاز الربط غير متصل؛ شغّل Start.cmd على جهاز Windows.';
  }
  async function load(){
    if(loading)return;loading=true;
    try{
      if(!loaded){
        // The server checks admin role before returning the design at all.
        const html=await call('/admin-interface',undefined,true);
        $('padelAdminFrame').srcdoc=html;$('padelAdminFrame').hidden=false;loaded=true;
      }
      await refresh();$('padelAdminFrame').hidden=false;
    }catch(error){$('padelAdminStatus').textContent=error.message;$('padelAdminFrame').hidden=true}
    finally{loading=false}
  }
  $('padelAdminRefresh').addEventListener('click',load);
  $('padelAdminPair').addEventListener('click',async()=>{
    const button=$('padelAdminPair');button.disabled=true;
    try{const result=await call('/pair-code',{});$('padelAdminCode').value=result.code;$('padelAdminPairing').hidden=false;$('padelAdminCode').focus();$('padelAdminCode').select()}
    catch(error){$('padelAdminStatus').textContent=error.message}
    finally{button.disabled=false}
  });
  window.Icon7PadelAdmin=Object.freeze({load});
})();
