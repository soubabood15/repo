const adminQualityAudioSessions=new Map();
let adminQualityAudioGeneration=0;
function adminQualityRecordingMarkup(){return '<div class="quality-admin-player ucm-linked-player" data-admin-ucm-holder hidden><small data-ucm-audio-status role="status"></small><audio data-ucm-stream preload="none" hidden></audio><div class="quality-audio-player"><button type="button" data-ucm-toggle aria-label="Play or pause recording" disabled>▶</button><span data-ucm-clock>0:00 / 0:00</span><input type="range" data-ucm-seek min="0" max="1000" value="0" aria-label="Recording position" disabled><select data-ucm-speed aria-label="Playback speed"><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option></select></div><label data-admin-recording-label hidden>Recording <select data-admin-recording-segment></select></label></div>'}
function stopAdminQualityRecordings(){
 adminQualityAudioGeneration++;
 for(const [audio,session] of adminQualityAudioSessions){session.abort.abort();audio.onerror=null;audio.onloadedmetadata=null;audio.pause();audio.removeAttribute('src');audio.load();if(session.blobUrl)URL.revokeObjectURL(session.blobUrl);fetch(session.url+'/cancel'+session.query,{method:'POST',keepalive:true}).catch(()=>{})}
 adminQualityAudioSessions.clear();
}
async function playAdminQualityRecording(button,segment=0){
 const card=button.closest('[data-quality-call]'),row=qualityCallsCache.find(item=>String(item.id)===card?.dataset.qualityCall),holder=card?.querySelector('[data-admin-ucm-holder]'),audio=holder?.querySelector('audio');
 if(!row?.source_call_id||!audio||button.disabled)return;
 const existing=adminQualityAudioSessions.get(audio);if(existing?.blobUrl&&existing.segment===segment){audio.currentTime=0;await audio.play();return}
 stopAdminQualityRecordings();const generation=adminQualityAudioGeneration,status=holder.querySelector('[data-ucm-audio-status]');holder.hidden=false;status.textContent='Loading recording…';button.disabled=true;let session;
 const fail=error=>{
  if(session?.failure)return session.failure;
  const pending=(async()=>{
   if(generation!==adminQualityAudioGeneration)return;
   let message=error?.message||'Recording could not be played.';
   if(session){try{const result=await (await fetch(session.url+'/status'+session.query,{cache:'no-store'})).json();if(result.error)message=result.error}catch{}}
   if(generation!==adminQualityAudioGeneration)return;
   status.textContent=message;button.textContent='▶ Retry recording';
   if(session){adminQualityAudioSessions.delete(audio);session.abort.abort();audio.onerror=null;if(session.blobUrl)URL.revokeObjectURL(session.blobUrl);fetch(session.url+'/cancel'+session.query,{method:'POST'}).catch(()=>{})}
  })();if(session)session.failure=pending;return pending;
 };
 try{
  const {data:{session:login}}=await authDb.auth.getSession();if(!login?.access_token)throw Error('Sign in as administrator again.');
  const url=SUPABASE_URL+'/functions/v1/quality-audio',response=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+login.access_token,'Content-Type':'application/json'},body:JSON.stringify({evaluation_id:row.id,segment})});
  const result=await response.json();if(!response.ok)throw Error(result.message||'Could not start recording.');
  session={url,query:'?'+new URLSearchParams({id:result.id,token:result.token}),abort:new AbortController(),segment};
  if(generation!==adminQualityAudioGeneration){fetch(url+'/cancel'+session.query,{method:'POST'}).catch(()=>{});return}
  adminQualityAudioSessions.set(audio,session);const update=bindQualityRecordingPlayer(holder,audio);
  audio.onloadedmetadata=async()=>{if(adminQualityAudioSessions.get(audio)!==session)return;update();status.textContent='Ready to play';button.textContent='↻ Replay recording';
   try{const metadata=await (await fetch(url+'/status'+session.query)).json();if(metadata.segments>1){const label=holder.querySelector('[data-admin-recording-label]'),select=holder.querySelector('[data-admin-recording-segment]');label.hidden=false;select.innerHTML=Array.from({length:metadata.segments},(_,index)=>'<option value="'+index+'">'+(index+1)+'</option>').join('');select.value=String(segment);select.onchange=()=>playAdminQualityRecording(button,Number(select.value))}}catch{}
  };
  audio.onerror=()=>fail();
  const recording=await qualityRecordingBlob(await fetch(url+'/stream'+session.query,{signal:session.abort.signal,cache:'no-store'}));
  if(adminQualityAudioSessions.get(audio)!==session)return;
  session.blobUrl=URL.createObjectURL(recording);audio.src=session.blobUrl;await audio.play();
 }catch(error){await fail(error)}finally{button.disabled=false}
}
window.addEventListener('pagehide',stopAdminQualityRecordings);
