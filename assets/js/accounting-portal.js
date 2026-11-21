// eBook shares its sign-in screen, not its general-administrator token.
globalThis.AccountingPortal=(()=>{
 const auth=globalThis.AccountingAuth,prefs=auth.preferences;
 const read=k=>{try{return JSON.parse(prefs.getItem(k)||'null');}catch{return null;}};
 function commit(session){if(auth.usesEbookLogin?.()&&auth.canShareSession&&!auth.canShareSession())throw Error('المتصفح يمنع تخزين جلسة الدخول. اسمح بتخزين الموقع ثم حاول مجدداً.');const u=session?.user;if(!u?.id||!u.username||!['accounting_admin','accountant'].includes(u.role))throw Error('استجابة حساب المحاسبة غير مكتملة');
  for(const k of ['ebookAuthSession','newtel-admin-auth','ebookProjectLaunch','knowledgeAgentName','knowledgeAgentUsername','knowledgeAgentRole','knowledgeAttendanceStatus','knowledgeAttendanceLastTick'])prefs.removeItem(k);
  for(const k of ['kb_admin_user_new','kb_admin_user'])auth.viewState.removeItem(k);
  const user={id:u.id,username:u.username,full_name:u.full_name||u.username,role:u.role,auth_source:'accounting'};
  prefs.setItem('ebookUser',JSON.stringify(user));prefs.setItem('ebookPermissions',JSON.stringify(['accounting']));return user;
 }
 async function signIn(username,password){const result=await auth.login(username,password);try{return commit(result);}catch(error){try{await auth.logout();}catch{auth.clear();}throw error;}}
 async function restore(){const old=read('ebookUser');if(read('ebookAuthSession')?.access_token&&old?.auth_source!=='accounting')return null;if(!auth.hasSession()){if(old?.auth_source==='accounting')auth.clear();return null;}try{return commit(await auth.session());}catch(error){auth.clear();if(error.status===401||error.status===403)return null;throw error;}}
 return Object.freeze({signIn,restore});
})();
