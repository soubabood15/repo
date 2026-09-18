(function(){
  "use strict";
  const IDLE_MS=60*60*1000;
  const CHECK_MS=30*1000;
  const ACTIVITY_KEY="newtel_last_activity_at";
  const LOGOUT_KEY="newtel_idle_logout_at";
  let lastWrite=0;

  function recordActivity(){
    const now=Date.now();
    if(now-lastWrite<15000)return;
    lastWrite=now;
    localStorage.setItem(ACTIVITY_KEY,String(now));
  }

  function clearSessions(){
    const exact=["ebookUser","currentUser","ebookCurrentUser","newtelCurrentUser","knowledgeCurrentUser","projectUser","ebookAuthSession","newtel-quality-request"];
    exact.forEach(key=>{localStorage.removeItem(key);sessionStorage.removeItem(key)});
    for(let index=localStorage.length-1;index>=0;index--){
      const key=localStorage.key(index)||"";
      if((key.startsWith("sb-")&&key.includes("auth-token"))||/newtel-(?:admin|quality)-auth/i.test(key))localStorage.removeItem(key);
    }
    sessionStorage.clear();
  }

  function hasSession(){
    const exact=["ebookUser","currentUser","ebookCurrentUser","newtelCurrentUser","knowledgeCurrentUser","projectUser","ebookAuthSession","newtel-quality-request"];
    if(exact.some(key=>localStorage.getItem(key)||sessionStorage.getItem(key)))return true;
    for(let index=0;index<localStorage.length;index++){
      const key=localStorage.key(index)||"";
      if((key.startsWith("sb-")&&key.includes("auth-token"))||/newtel-(?:admin|quality)-auth/i.test(key))return true;
    }
    return false;
  }

  function logoutForIdle(){
    const now=Date.now();
    if(now-Number(localStorage.getItem(LOGOUT_KEY)||0)<10000)return;
    localStorage.setItem(LOGOUT_KEY,String(now));
    clearSessions();
    location.replace("ebook.html?idle=1");
  }

  function checkIdle(){
    const last=Number(localStorage.getItem(ACTIVITY_KEY)||Date.now());
    if(Date.now()-last>=IDLE_MS){if(hasSession())logoutForIdle();else recordActivity()}
  }

  ["pointerdown","keydown","touchstart","scroll"].forEach(type=>addEventListener(type,recordActivity,{passive:true}));
  addEventListener("storage",event=>{if(event.key===LOGOUT_KEY&&Date.now()-Number(event.newValue||0)<10000){clearSessions();location.replace("ebook.html?idle=1")}});
  if(!localStorage.getItem(ACTIVITY_KEY))recordActivity();
  setInterval(checkIdle,CHECK_MS);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)checkIdle()});
})();
