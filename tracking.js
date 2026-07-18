(function(){
  "use strict";

  const SUPABASE_URL = "https://estyiinuotsygtrgtezz.supabase.co";
  const SUPABASE_ANON_KEY = "sb_publishable_NB_aYGgJ7o8RB1ddYWSIOA_Gwj39mfs";
  const PING_MS = 10000;
  const RETRY_MS = 2000;
  const LOG_MS = 60000;
  const USER_KEY = "ebookUser";
  const DEVICE_KEY = "newtel_admin_live_device";
  const ACTIVE_PROJECT_KEY = "newtel_admin_live_active_project";

  let pingTimer = null;
  let retryTimer = null;
  let lastLogAt = 0;
  let sessionLoginAt = null;

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
    if(document.visibilityState === "visible") ping("visibility",true);
  });
  window.addEventListener("focus",() => ping("focus",true));

  window.LiveTracking = {
    start,
    stop,
    ping,
    logout
  };

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded",start,{once:true});
  }else{
    start();
  }
})();
