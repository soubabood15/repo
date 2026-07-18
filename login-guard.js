(function(global){
  "use strict";
  const PREFIX="newtel_login_guard_v1_";
  const read=scope=>{try{return JSON.parse(localStorage.getItem(PREFIX+scope))||{failures:0,locks:0,lockedUntil:0}}catch(error){return {failures:0,locks:0,lockedUntil:0}}};
  const write=(scope,state)=>localStorage.setItem(PREFIX+scope,JSON.stringify(state));
  const waitText=milliseconds=>{const minutes=Math.max(1,Math.ceil(milliseconds/60000));return minutes>=60?"ساعة":minutes+" دقيقة"};
  global.NewTelLoginGuard={
    canAttempt(scope){const state=read(scope);const remaining=Number(state.lockedUntil||0)-Date.now();if(remaining>0)return {allowed:false,message:"تم إيقاف المحاولات مؤقتًا. حاول بعد "+waitText(remaining)+"."};if(state.lockedUntil){state.lockedUntil=0;state.failures=0;write(scope,state)}return {allowed:true,message:""}},
    registerFailure(scope){const state=read(scope);state.failures=Number(state.failures||0)+1;const threshold=Number(state.locks||0)>0?5:10;if(state.failures>=threshold){state.locks=Number(state.locks||0)+1;state.failures=0;const duration=state.locks===1?15*60*1000:60*60*1000;state.lockedUntil=Date.now()+duration;write(scope,state);return {locked:true,message:"محاولات كثيرة. تم إيقاف تسجيل الدخول لمدة "+(duration===15*60*1000?"ربع ساعة":"ساعة")+"."}}write(scope,state);if(state.locks===0&&state.failures===5)return {locked:false,message:"تنبيه: بقي لديك 5 محاولات قبل إيقاف تسجيل الدخول مؤقتًا."};return {locked:false,message:""}},
    reset(scope){localStorage.removeItem(PREFIX+scope)}
  };
})(window);
