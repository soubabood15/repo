(function(){
  "use strict";

  function applyPortalTheme(){
    const preference=localStorage.getItem("ebookThemeModeV2") || "auto";
    const hour=new Date().getHours();
    const systemDark=window.matchMedia?.("(prefers-color-scheme: dark)").matches;
    const automaticDark=systemDark || hour >= 18 || hour < 6;
    const isDark=preference === "dark" || ((preference === "auto" || preference === "system") && automaticDark);
    document.body?.classList.toggle("night-mode",isDark);
    document.body?.classList.toggle("light-mode",!isDark);
  }

  function getPortalUserName(){
    try{
      const user=JSON.parse(localStorage.getItem("ebookUser")||"null");
      return String(user?.full_name||user?.username||"").trim();
    }catch(error){return ""}
  }

  function applyProjectWatermark(){
    if(!document.body?.classList.contains("project-theme"))return;
    if(document.body.classList.contains("trainer-theme")||document.body.classList.contains("himma-theme"))return;
    const name=getPortalUserName();
    let layer=document.getElementById("projectAgentWatermark");
    if(!name){layer?.remove();return}
    if(!layer){
      layer=document.createElement("div");
      layer.id="projectAgentWatermark";
      layer.className="pt-agent-watermark";
      layer.setAttribute("aria-hidden","true");
      document.body.appendChild(layer);
    }
    if(layer.dataset.name===name)return;
    layer.dataset.name=name;
    layer.replaceChildren(...Array.from({length:24},()=>{const span=document.createElement("span");span.textContent=name;return span}));
  }

  const CONTROL_URL="https://estyiinuotsygtrgtezz.supabase.co/rest/v1/app_control?select=key,value&key=in.(force_refresh_all,system_status)";
  const CONTROL_KEY="newtel_global_refresh_signal_v2";
  let controlBusy=false;

  function showSystemClosed(){
    let overlay=document.getElementById("newtelSystemClosed");
    if(!overlay){
      overlay=document.createElement("div");
      overlay.id="newtelSystemClosed";
      overlay.innerHTML='<div><strong>System temporarily closed</strong><span>Please try again later.</span></div>';
      Object.assign(overlay.style,{position:"fixed",inset:"0",zIndex:"2147483647",display:"grid",placeItems:"center",padding:"24px",background:"rgba(6,17,29,.96)",color:"#fff",fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif',textAlign:"center"});
      overlay.querySelector("div").style.cssText="width:min(420px,100%);padding:34px;border:1px solid rgba(255,255,255,.14);border-radius:22px;background:#101a2a";
      overlay.querySelector("strong").style.cssText="display:block;font-size:24px;margin-bottom:9px";
      overlay.querySelector("span").style.cssText="display:block;color:#a7b6ca";
      document.body.appendChild(overlay);
    }
  }

  async function checkPortalControls(){
    if(controlBusy || document.visibilityState === "hidden") return;
    controlBusy=true;
    try{
      const response=await fetch(CONTROL_URL,{headers:{apikey:"sb_publishable_NB_aYGgJ7o8RB1ddYWSIOA_Gwj39mfs",Authorization:"Bearer sb_publishable_NB_aYGgJ7o8RB1ddYWSIOA_Gwj39mfs"},cache:"no-store"});
      if(!response.ok) return;
      const rows=await response.json();
      const refresh=rows.find(row=>row.key === "force_refresh_all")?.value || "";
      const status=String(rows.find(row=>row.key === "system_status")?.value || "open").toLowerCase();
      if(status === "closed"){showSystemClosed();return;}
      document.getElementById("newtelSystemClosed")?.remove();
      const previous=localStorage.getItem(CONTROL_KEY);
      if(refresh && previous && previous !== refresh){localStorage.setItem(CONTROL_KEY,refresh);location.reload();return;}
      if(refresh && !previous) localStorage.setItem(CONTROL_KEY,refresh);
    }catch(error){console.warn("Portal control check failed:",error)}finally{controlBusy=false}
  }

  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded",()=>{applyPortalTheme();applyProjectWatermark()},{once:true});
  else{applyPortalTheme();applyProjectWatermark()}

  window.addEventListener("storage",event=>{if(event.key === "ebookThemeModeV2") applyPortalTheme();if(event.key === "ebookUser")applyProjectWatermark()});
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState === "visible") applyPortalTheme();});
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded",checkPortalControls,{once:true});
  else checkPortalControls();
  window.setInterval(checkPortalControls,5000);
})();
