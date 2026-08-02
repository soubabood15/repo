(function(){
  "use strict";

  const SUPABASE_URL = "https://estyiinuotsygtrgtezz.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_NB_aYGgJ7o8RB1ddYWSIOA_Gwj39mfs";
  const PING_MS = 10000;
  const LOGOUT_CHECK_MS = 2000;
  const RETRY_MS = 2000;
  const LOG_MS = 60000;
  const AUTO_ANSWER_CHECK_MS = 5000;
  const USER_KEY = "ebookUser";
  const DEVICE_KEY = "newtel_admin_live_device";
  const ACTIVE_PROJECT_KEY = "newtel_admin_live_active_project";
  const LOGOUT_WATCH_STARTED_AT = Date.now();

  let pingTimer = null;
  let logoutCheckTimer = null;
  let logoutCheckBusy = false;
  let retryTimer = null;
  let lastLogAt = 0;
  let sessionLoginAt = null;
  let autoAnswerTimer = null;
  let activeAutoAnswerId = "";
  let currentAutoAnswerContext = null;

  function headers(prefer){
    const value = {
      apikey: SUPABASE_ANON_KEY,
      Authorization: "Bearer " + SUPABASE_ANON_KEY,
      "Content-Type": "application/json"
    };
    if(prefer) value.Prefer = prefer;
    return value;
  }

  function readUser(key){
    try{
      const raw = localStorage.getItem(key) || sessionStorage.getItem(key);
      if(!raw) return null;
      return normalizeUser(JSON.parse(raw));
    }catch(error){
      return null;
    }
  }

  function normalizeUser(value){
    if(!value || typeof value !== "object") return null;
    const username = String(value.username || value.agent_name || value.agentName || value.name || "").trim();
    if(!username) return null;
    return {
      username,
      full_name: value.full_name || value.fullName || value.name || username
    };
  }

  function getUser(){
    const direct = normalizeUser(window.currentUser);
    if(direct){
      localStorage.setItem(USER_KEY,JSON.stringify(direct));
      return direct;
    }

    const keys = [
      USER_KEY,
      "currentUser",
      "ebookCurrentUser",
      "newtelCurrentUser",
      "knowledgeCurrentUser",
      "projectUser"
    ];

    for(const key of keys){
      const user = readUser(key);
      if(user){
        localStorage.setItem(USER_KEY,JSON.stringify(user));
        return user;
      }
    }

    const username = String(
      localStorage.getItem("knowledgeAgentName") ||
      localStorage.getItem("agentName") ||
      sessionStorage.getItem("agentName") ||
      ""
    ).trim();

    return username ? {username, full_name: username} : null;
  }

  function localDateValue(){
    const date=new Date();
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;
  }

  function localTimeValue(){
    const date=new Date();
    return `${String(date.getHours()).padStart(2,"0")}:${String(date.getMinutes()).padStart(2,"0")}`;
  }

  function displayTime(value){
    const parts=String(value||"").split(":").map(Number);
    if(parts.length!==2||parts.some(Number.isNaN)) return value||"--";
    return new Date(2000,0,1,parts[0],parts[1]).toLocaleTimeString("en-US",{hour:"numeric",minute:"2-digit"});
  }

  function ensureAutoAnswerPopup(){
    if(document.getElementById("newtelAutoAnswerPopup")) return;
    const style=document.createElement("style");
    style.textContent=`
      #newtelAutoAnswerPopup{position:fixed;inset:0;z-index:2147483000;display:grid;place-items:center;padding:18px;background:rgba(4,18,35,.64);backdrop-filter:blur(7px);opacity:0;visibility:hidden;pointer-events:none;transition:opacity .28s ease,visibility 0s linear .28s}
      #newtelAutoAnswerPopup.show{opacity:1;visibility:visible;pointer-events:auto;transition:opacity .28s ease}
      .newtel-auto-card{position:relative;width:min(470px,100%);overflow:hidden;padding:30px;border:1px solid rgba(255,255,255,.18);border-radius:25px;color:#fff;background:linear-gradient(145deg,#073b36,#087f5b 56%,#0ea77a);box-shadow:0 35px 90px rgba(0,0,0,.38);font-family:Arial,sans-serif;text-align:left;transform:translateY(28px) scale(.94);transition:transform .42s cubic-bezier(.2,.85,.25,1)}
      #newtelAutoAnswerPopup.show .newtel-auto-card{transform:none}.newtel-auto-card:before{content:"";position:absolute;width:230px;height:230px;right:-105px;top:-115px;border:1px solid rgba(255,255,255,.14);border-radius:50%;box-shadow:0 0 0 32px rgba(255,255,255,.035),0 0 0 68px rgba(255,255,255,.025)}
      .newtel-auto-icon{position:relative;width:58px;height:58px;display:grid;place-items:center;margin-bottom:20px;border-radius:18px;background:rgba(255,255,255,.15);font-size:27px;animation:newtelAutoRing 1.25s ease-in-out infinite}
      .newtel-auto-card small,.newtel-auto-card h2,.newtel-auto-card p,.newtel-auto-period,.newtel-auto-ok{position:relative;z-index:1}.newtel-auto-card small{font-size:10px;font-weight:900;letter-spacing:1.5px;text-transform:uppercase;color:#9ff4d5}.newtel-auto-card h2{margin:8px 0 10px;color:#fff;font-size:27px;line-height:1.15}.newtel-auto-card p{margin:0;color:rgba(255,255,255,.78);font-size:13px;line-height:1.65}.newtel-auto-period{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:20px;padding:13px 15px;border:1px solid rgba(255,255,255,.17);border-radius:13px;background:rgba(255,255,255,.1)}.newtel-auto-period span{font-size:11px;font-weight:800}.newtel-auto-period strong{font-size:14px;direction:ltr}.newtel-auto-ok{width:100%;min-height:47px;margin-top:16px;border:0;border-radius:13px;color:#087f5b;background:#fff;font-size:12px;font-weight:900;cursor:pointer}.newtel-auto-ok:hover{background:#eafff6}
      #newtelAutoAnswerIndicator{position:fixed;right:18px;bottom:18px;z-index:2147482000;font-family:Arial,sans-serif}.newtel-auto-indicator-button{position:relative;width:58px;height:58px;display:grid;place-items:center;margin-left:auto;padding:0;border:4px solid #fff;border-radius:50%;color:#fff;background:#16a34a;box-shadow:0 10px 28px rgba(15,23,42,.28);cursor:pointer;transition:transform .2s ease,background .25s ease}.newtel-auto-indicator-button:hover{transform:translateY(-3px) scale(1.04)}.newtel-auto-indicator-button.active{background:#dc2626;animation:newtelAutoLive 1.5s ease-in-out infinite}.newtel-auto-indicator-button span{font-size:21px}.newtel-auto-indicator-button:after{content:"";position:absolute;right:1px;top:1px;width:10px;height:10px;border:2px solid #fff;border-radius:50%;background:#bbf7d0}.newtel-auto-indicator-button.active:after{background:#fecaca}.newtel-auto-indicator-panel{position:absolute;right:0;bottom:70px;width:min(330px,calc(100vw - 36px));overflow:hidden;border:1px solid #dce3ec;border-radius:16px;color:#172033;background:#fff;box-shadow:0 20px 55px rgba(15,23,42,.25);opacity:0;visibility:hidden;transform:translateY(10px) scale(.97);transform-origin:bottom right;transition:.22s ease}.newtel-auto-indicator-panel.show{opacity:1;visibility:visible;transform:none}.newtel-auto-indicator-head{padding:14px 15px;color:#fff;background:#166534}.newtel-auto-indicator-head.active{background:#b91c1c}.newtel-auto-indicator-head strong,.newtel-auto-indicator-head small{display:block}.newtel-auto-indicator-head strong{font-size:13px}.newtel-auto-indicator-head small{margin-top:4px;color:rgba(255,255,255,.75);font-size:9px}.newtel-auto-indicator-list{display:grid;gap:6px;max-height:260px;padding:10px;overflow:auto}.newtel-auto-indicator-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px;border-radius:10px;color:#475569;background:#f8fafc;font-size:10px}.newtel-auto-indicator-row strong{direction:ltr;color:#172033}.newtel-auto-indicator-row.active{color:#b91c1c;background:#fef2f2;font-weight:900}.newtel-auto-indicator-empty{padding:18px;color:#64748b;text-align:center;font-size:10px}
      @keyframes newtelAutoRing{0%,100%{transform:rotate(-5deg)}50%{transform:rotate(7deg) scale(1.06)}}@media(max-width:520px){.newtel-auto-card{padding:24px 20px;border-radius:21px}.newtel-auto-card h2{font-size:23px}}@media(prefers-reduced-motion:reduce){.newtel-auto-card,.newtel-auto-icon{transition:none;animation:none}}
      @keyframes newtelAutoLive{0%,100%{box-shadow:0 10px 28px rgba(220,38,38,.28),0 0 0 0 rgba(220,38,38,.28)}50%{box-shadow:0 10px 28px rgba(220,38,38,.35),0 0 0 9px rgba(220,38,38,0)}}@media(max-width:520px){#newtelAutoAnswerIndicator{right:12px;bottom:12px}.newtel-auto-indicator-button{width:54px;height:54px}.newtel-auto-indicator-panel{bottom:65px}}
    `;
    document.head.appendChild(style);
    const popup=document.createElement("div");
    popup.id="newtelAutoAnswerPopup";
    popup.setAttribute("role","dialog");
    popup.setAttribute("aria-modal","true");
    popup.innerHTML='<div class="newtel-auto-card"><div class="newtel-auto-icon">☎</div><small>Auto Answer is active</small><h2>You are now in Auto Answer time</h2><p id="newtelAutoAnswerMessage">Please be ready to receive calls automatically.</p><div class="newtel-auto-period"><span>Current period</span><strong id="newtelAutoAnswerPeriod">--</strong></div><button class="newtel-auto-ok" type="button">Got it</button></div>';
    popup.querySelector(".newtel-auto-ok").addEventListener("click",acknowledgeAutoAnswer);
    document.body.appendChild(popup);
  }

  function ensureAutoAnswerIndicator(){
    if(document.getElementById("newtelAutoAnswerIndicator")) return;
    ensureAutoAnswerPopup();
    const indicator=document.createElement("div");
    indicator.id="newtelAutoAnswerIndicator";
    indicator.innerHTML='<div class="newtel-auto-indicator-panel" id="newtelAutoIndicatorPanel"><div class="newtel-auto-indicator-head" id="newtelAutoIndicatorHead"><strong>Auto Answer status</strong><small id="newtelAutoIndicatorStatus">Not active right now</small></div><div class="newtel-auto-indicator-list" id="newtelAutoIndicatorList"><div class="newtel-auto-indicator-empty">No upcoming times today.</div></div></div><button class="newtel-auto-indicator-button" id="newtelAutoIndicatorButton" type="button" aria-label="Show Auto Answer times" aria-expanded="false"><span>☎</span></button>';
    const button=indicator.querySelector("#newtelAutoIndicatorButton");
    const panel=indicator.querySelector("#newtelAutoIndicatorPanel");
    button.addEventListener("click",event=>{event.stopPropagation();const open=!panel.classList.contains("show");panel.classList.toggle("show",open);button.setAttribute("aria-expanded",String(open))});
    panel.addEventListener("click",event=>event.stopPropagation());
    document.addEventListener("click",()=>{panel.classList.remove("show");button.setAttribute("aria-expanded","false")});
    document.body.appendChild(indicator);
  }

  function updateAutoAnswerIndicator(config,now){
    ensureAutoAnswerIndicator();
    const periods=Array.isArray(config?.periods)?config.periods:[];
    const activeIndex=config?.enabled===false?-1:periods.findIndex(period=>now>=period.start&&now<period.end);
    const isActive=activeIndex>=0;
    const button=document.getElementById("newtelAutoIndicatorButton");
    const head=document.getElementById("newtelAutoIndicatorHead");
    button?.classList.toggle("active",isActive);
    head?.classList.toggle("active",isActive);
    const status=document.getElementById("newtelAutoIndicatorStatus");
    if(status) status.textContent=isActive?`Active now until ${displayTime(periods[activeIndex].end)}`:"Not active right now";
    const remaining=periods.map((period,index)=>({...period,index})).filter(period=>period.end>now);
    const list=document.getElementById("newtelAutoIndicatorList");
    if(list) list.innerHTML=remaining.length?remaining.map(period=>`<div class="newtel-auto-indicator-row${period.index===activeIndex?' active':''}"><span>${period.index===activeIndex?'Active now':'Upcoming'}</span><strong>${displayTime(period.start)} — ${displayTime(period.end)}</strong></div>`).join(""):'<div class="newtel-auto-indicator-empty">No more Auto Answer times today.</div>';
  }

  function showAutoAnswerPopup(config,period,periodId){
    ensureAutoAnswerPopup();
    const popup=document.getElementById("newtelAutoAnswerPopup");
    popup.querySelector("#newtelAutoAnswerMessage").textContent=config.message||"Please be ready to receive calls automatically.";
    popup.querySelector("#newtelAutoAnswerPeriod").textContent=`${displayTime(period.start)} — ${displayTime(period.end)}`;
    activeAutoAnswerId=periodId;
    currentAutoAnswerContext={id:periodId,date:config.date||localDateValue(),message:config.message||"Please be ready to receive calls automatically.",start:period.start,end:period.end};
    localStorage.setItem("newtel_auto_answer_pending",JSON.stringify(currentAutoAnswerContext));
    requestAnimationFrame(()=>popup.classList.add("show"));
  }

  async function acknowledgeAutoAnswer(){
    const context=currentAutoAnswerContext;
    const user=getUser();
    const popup=document.getElementById("newtelAutoAnswerPopup");
    const button=popup?.querySelector(".newtel-auto-ok");
    if(!context||!user||!button) return;
    button.disabled=true;
    button.textContent="Confirming...";
    const activeProject=getActiveProject();
    const now=new Date().toISOString();
    try{
      const response=await fetch(SUPABASE_URL+"/rest/v1/admin_live_daily_logs",{
        method:"POST",
        headers:headers("return=minimal"),
        body:JSON.stringify({username:user.username,full_name:user.full_name,project_id:activeProject.id,project_name:activeProject.name,page_path:activeProject.page_path,device_id:getDeviceId(),status:"online",reason:`auto_answer_ack|${context.date}|${context.start}|${context.end}|${context.id}`,pinged_at:now})
      });
      if(!response.ok) throw new Error(await response.text()||"Acknowledgement could not be saved");
      localStorage.setItem("newtel_auto_answer_ack",context.id);
      localStorage.removeItem("newtel_auto_answer_pending");
      currentAutoAnswerContext=null;
      activeAutoAnswerId="";
      popup.classList.remove("show");
    }catch(error){
      console.warn("Auto Answer acknowledgement failed:",error);
      button.textContent="Try again — confirmation not saved";
      window.setTimeout(()=>{button.textContent="Got it";button.disabled=false},2200);
      return;
    }
    button.textContent="Got it";
    button.disabled=false;
  }

  async function checkAutoAnswerSchedule(){
    if(!getUser()) return;
    ensureAutoAnswerIndicator();
    const today=localDateValue();
    try{
      const pendingRaw=localStorage.getItem("newtel_auto_answer_pending");
      let pending=null;
      try{if(pendingRaw) pending=JSON.parse(pendingRaw)}catch(_error){}
      const hasPending=Boolean(pending?.id&&localStorage.getItem("newtel_auto_answer_ack")!==pending.id);
      if(hasPending){
        if(activeAutoAnswerId!==pending.id) showAutoAnswerPopup({date:pending.date,message:pending.message},{start:pending.start,end:pending.end},pending.id);
      }
      const response=await fetch(`${SUPABASE_URL}/rest/v1/app_control?select=value,updated_at&key=eq.auto_answer_schedule_${today}`,{headers:headers()});
      if(!response.ok) throw new Error("Auto Answer schedule check failed");
      const row=(await response.json())?.[0];
      let config=null;
      try{if(row?.value) config=JSON.parse(row.value)}catch(_error){}
      const now=localTimeValue();
      const periods=Array.isArray(config?.periods)?config.periods:[];
      updateAutoAnswerIndicator(config,now);
      const period=config?.enabled===false?null:periods.find(item=>now>=item.start&&now<item.end);
      if(!period){
        if(!hasPending) activeAutoAnswerId="";
        return;
      }
      const periodId=`${today}|${period.start}|${period.end}|${row.updated_at||config.updated_at||""}`;
      if(!hasPending&&periodId!==activeAutoAnswerId&&localStorage.getItem("newtel_auto_answer_ack")!==periodId) showAutoAnswerPopup(config,period,periodId);
      else if(!hasPending) activeAutoAnswerId=periodId;
    }catch(error){
      console.warn("Auto Answer check failed:",error);
    }
  }

  function startAutoAnswerWatcher(){
    if(autoAnswerTimer) return;
    checkAutoAnswerSchedule();
    autoAnswerTimer=setInterval(checkAutoAnswerSchedule,AUTO_ANSWER_CHECK_MS);
  }

  function getDeviceId(){
    let id = localStorage.getItem(DEVICE_KEY);
    if(!id){
      id = window.crypto?.randomUUID?.() || String(Date.now()) + "_" + Math.random().toString(36).slice(2);
      localStorage.setItem(DEVICE_KEY,id);
    }
    return id;
  }

  function getProjectId(){
    if(window.TRACKING_PROJECT) return String(window.TRACKING_PROJECT).trim();
    const file = (location.pathname.split("/").pop() || "ebook").replace(/\.html?$/i,"");
    return {
      ebook: "ebook_portal",
      index: "himma",
      "saraya-waterpark": "saraya",
      icon7: "icon7",
      trainerkb: "trainerkb"
    }[file] || file || "unknown";
  }

  function getProjectName(projectId){
    return {
      ebook_portal: "eBook Portal",
      himma: "Himma Page",
      saraya: "Saraya Aqaba Waterpark",
      icon7: "ICON7",
      trainerkb: "Trainer KB Designer"
    }[projectId] || projectId;
  }

  function getActiveProject(){
    const pageProjectId = getProjectId();

    const savedActiveProject = localStorage.getItem(ACTIVE_PROJECT_KEY);
    if(document.visibilityState !== "hidden" && (document.hasFocus() || !savedActiveProject)){
      const activeProject = {
        id: pageProjectId,
        name: getProjectName(pageProjectId),
        page_path: location.pathname
      };
      localStorage.setItem(ACTIVE_PROJECT_KEY,JSON.stringify(activeProject));
      return activeProject;
    }

    try{
      const savedProject = JSON.parse(savedActiveProject);
      if(savedProject?.id) return savedProject;
    }catch(error){
      // Fall back to this page when no shared active project is available.
    }

    return {
      id: pageProjectId,
      name: getProjectName(pageProjectId),
      page_path: location.pathname
    };
  }

  function scheduleRetry(){
    if(retryTimer) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      start();
    },RETRY_MS);
  }

  async function writeDailyLog(payload, now, reason, force){
    if(!force && Date.now() - lastLogAt < LOG_MS) return;
    lastLogAt = Date.now();

    try{
      await fetch(SUPABASE_URL + "/rest/v1/admin_live_daily_logs",{
        method: "POST",
        headers: headers("return=minimal"),
        body: JSON.stringify({
          username: payload.username,
          full_name: payload.full_name,
          project_id: payload.project_id,
          project_name: payload.project_name,
          page_path: payload.page_path,
          device_id: payload.device_id,
          status: payload.status,
          reason: reason || payload.last_reason || "ping",
          pinged_at: now
        })
      });
    }catch(error){
      console.warn("Admin live daily log failed:",error);
    }
  }

  async function writePresence(payload,keepalive){
    const url = SUPABASE_URL + "/rest/v1/admin_live_pings?on_conflict=presence_key";
    const request = body => fetch(url,{
      method: "POST",
      headers: headers("resolution=merge-duplicates,return=minimal"),
      body: JSON.stringify(body),
      keepalive:Boolean(keepalive)
    });

    let response = await request(payload);
    if(response.ok) return response;

    const errorText = await response.text();
    if(response.status === 400 && /login_at|logout_at|last_seen/i.test(errorText)){
      const legacyPayload = {...payload};
      delete legacyPayload.login_at;
      delete legacyPayload.logout_at;
      delete legacyPayload.last_seen;
      response = await request(legacyPayload);
      if(response.ok) return response;
    }

    throw new Error(errorText || "Admin live presence update failed");
  }

  async function ping(reason, forceLog){
    const user = getUser();
    if(!user){
      scheduleRetry();
      return false;
    }

    const activeProject = getActiveProject();
    const now = new Date().toISOString();
    if(!sessionLoginAt) sessionLoginAt = now;
    const payload = {
      presence_key: user.username.toLowerCase(),
      username: user.username,
      full_name: user.full_name,
      project_id: activeProject.id,
      project_name: activeProject.name,
      page_path: activeProject.page_path,
      device_id: getDeviceId(),
      status: "online",
      login_at: sessionLoginAt,
      logout_at: null,
      last_seen: now,
      last_ping_at: now,
      last_reason: reason || "ping",
      updated_at: now
    };

    try{
      await writePresence(payload,false);

      writeDailyLog(payload,now,reason,Boolean(forceLog));
      localStorage.setItem("admin_live_last_ok",now + " " + payload.presence_key);
      return true;
    }catch(error){
      localStorage.setItem("admin_live_last_error",String(error.message || error));
      console.error("Admin live ping failed:",error);
      return false;
    }
  }

  function start(){
    if(pingTimer) return;

    if(!getUser()){
      scheduleRetry();
      return;
    }

    ping("open",true);
    pingTimer = setInterval(() => ping("minute"),PING_MS);
  }

  function stop(){
    if(pingTimer){
      clearInterval(pingTimer);
      pingTimer = null;
    }
  }

  function clearPortalSession(){
    [
      "ebookUser","ebookPermissions","ebookProjectLaunch","currentUser",
      "ebookCurrentUser","newtelCurrentUser","knowledgeCurrentUser","projectUser",
      "knowledgeAgentName","knowledgeAgentUsername","knowledgeAgentRole",
      "knowledgeAttendanceStatus","knowledgeAttendanceLastTick"
    ].forEach(key => localStorage.removeItem(key));

    [
      "ebookUser","ebookPermissions","ebookProjectLaunch","currentUser",
      "knowledgeCurrentUser","projectUser","knowledgeAttendanceSessionId",
      "knowledgeAttendanceLoginTime"
    ].forEach(key => sessionStorage.removeItem(key));
  }

  function redirectToPortalLogin(){
    const loginUrl = new URL("ebook.html",window.location.href);
    loginUrl.searchParams.set("forced_logout",String(Date.now()));
    window.location.replace(loginUrl.href);
  }

  async function checkForcedLogout(){
    if(logoutCheckBusy) return;
    const user = getUser();
    if(!user?.username) return;

    logoutCheckBusy = true;
    const storageKey = "newtel_logout_signal_" + user.username.toLowerCase();

    try{
      const response = await fetch(
        SUPABASE_URL + "/rest/v1/app_control?select=value&key=eq." + encodeURIComponent("logout_user_" + user.username),
        {headers:headers(),cache:"no-store"}
      );
      if(!response.ok) return;

      const rows = await response.json();
      const signal = String(rows?.[0]?.value || "");
      if(!signal) return;

      const previousSignal = localStorage.getItem(storageKey);
      if(!previousSignal){
        localStorage.setItem(storageKey,signal);
        if(Number(signal) < LOGOUT_WATCH_STARTED_AT) return;
      }

      if(!previousSignal || previousSignal !== signal){
        localStorage.setItem(storageKey,signal);
        logout("admin_single_logout");
        clearPortalSession();
        window.setTimeout(redirectToPortalLogin,120);
      }
    }catch(error){
      console.warn("Single user logout check failed:",error);
    }finally{
      logoutCheckBusy = false;
    }
  }

  function startLogoutWatcher(){
    if(logoutCheckTimer) return;
    checkForcedLogout();
    logoutCheckTimer = setInterval(checkForcedLogout,LOGOUT_CHECK_MS);
  }

  function logout(reason){
    const user = getUser();
    if(!user) return;

    stop();
    const activeProject = getActiveProject();
    const now = new Date().toISOString();
    const payload = {
      presence_key: user.username.toLowerCase(),
      username: user.username,
      full_name: user.full_name,
      project_id: activeProject.id,
      project_name: activeProject.name,
      page_path: activeProject.page_path,
      device_id: getDeviceId(),
      status: "offline",
      login_at: sessionLoginAt || now,
      logout_at: now,
      last_seen: now,
      last_ping_at: now,
      last_reason: reason || "logout",
      updated_at: now
    };

    writePresence(payload,true)
      .catch(error => console.warn("Admin live logout failed:",error));

    writeDailyLog(payload,now,reason || "logout",true);
    sessionLoginAt = null;
    scheduleRetry();
  }

  document.addEventListener("visibilitychange",() => {
    if(document.visibilityState === "visible"){
      ping("visibility",true);
      checkAutoAnswerSchedule();
    }
  });
  window.addEventListener("focus",()=>{
    ping("focus",true);
    checkAutoAnswerSchedule();
  });

  window.LiveTracking = {
    start,
    stop,
    ping,
    logout
  };

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded",()=>{start();startLogoutWatcher();startAutoAnswerWatcher()},{once:true});
  }else{
    start();
    startLogoutWatcher();
    startAutoAnswerWatcher();
  }
})();
