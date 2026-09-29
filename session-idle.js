(function(){
  "use strict";
  const IDLE_MS=60*60*1000,CHECK_MS=30*1000;
  const ACTIVITY_KEY="newtel_last_activity_at",PAUSED_KEY="newtel_idle_paused";
  let lastWrite=0;
  function isPaused(){return localStorage.getItem(PAUSED_KEY)==="1"}
  function recordActivity(force=false){if(isPaused()&&!force)return;const now=Date.now();if(!force&&now-lastWrite<15000)return;lastWrite=now;localStorage.setItem(ACTIVITY_KEY,String(now))}
  function ensurePrompt(){
    let overlay=document.getElementById("newtelIdlePrompt");if(overlay)return overlay;
    overlay=document.createElement("div");overlay.id="newtelIdlePrompt";
    overlay.innerHTML='<div class="newtel-idle-card"><span class="newtel-idle-icon">?</span><small>SESSION PAUSED</small><h2>Are you still here?</h2><p>Database activity has been paused to save usage. Your page and loaded data are still here.</p><button type="button" id="newtelIdleContinue">Yes, continue working</button><em>This message will stay open and no database requests will run until you continue.</em></div>';
    const style=document.createElement("style");style.textContent='#newtelIdlePrompt{position:fixed;inset:0;z-index:2147483647;display:none;place-items:center;padding:20px;background:rgba(15,23,42,.7);backdrop-filter:blur(7px);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}#newtelIdlePrompt.show{display:grid}.newtel-idle-card{width:min(430px,100%);padding:30px;border:1px solid #dbeafe;border-radius:20px;color:#172033;background:#fff;box-shadow:0 30px 90px rgba(15,23,42,.3);text-align:center}.newtel-idle-icon{width:54px;height:54px;display:grid;place-items:center;margin:0 auto 15px;border-radius:15px;color:#fff;background:#2563eb;font-size:25px;font-weight:900}.newtel-idle-card small{display:block;color:#2563eb;font-size:9px;font-weight:900;letter-spacing:1.4px}.newtel-idle-card h2{margin:8px 0;color:#172033;font-size:25px}.newtel-idle-card p{margin:0;color:#64748b;font-size:12px;line-height:1.7}.newtel-idle-card button{width:100%;min-height:47px;margin:20px 0 12px;border:0;border-radius:11px;color:#fff;background:#2563eb;font-size:12px;font-weight:850;cursor:pointer}.newtel-idle-card em{display:block;color:#94a3b8;font-size:9px;font-style:normal;line-height:1.6}';
    document.head.appendChild(style);document.body.appendChild(overlay);overlay.querySelector("#newtelIdleContinue").onclick=resume;return overlay;
  }
  function pause(){if(isPaused())return;localStorage.setItem(PAUSED_KEY,"1");ensurePrompt().classList.add("show");window.dispatchEvent(new CustomEvent("newtel:idle-pause"))}
  function resume(){localStorage.removeItem(PAUSED_KEY);recordActivity(true);document.getElementById("newtelIdlePrompt")?.classList.remove("show");window.dispatchEvent(new CustomEvent("newtel:idle-resume"))}
  function checkIdle(){if(isPaused()){ensurePrompt().classList.add("show");return}const last=Number(localStorage.getItem(ACTIVITY_KEY)||Date.now());if(Date.now()-last>=IDLE_MS)pause()}
  window.NewTelIdle={isPaused,pause,resume};
  ["pointerdown","keydown","touchstart","scroll"].forEach(type=>addEventListener(type,()=>recordActivity(),{passive:true}));
  addEventListener("storage",event=>{if(event.key===PAUSED_KEY){event.newValue==="1"?ensurePrompt().classList.add("show"):resume()}});
  if(!localStorage.getItem(ACTIVITY_KEY))recordActivity(true);
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",checkIdle,{once:true});else checkIdle();
  setInterval(checkIdle,CHECK_MS);document.addEventListener("visibilitychange",()=>{if(!document.hidden)checkIdle()});
})();
