function qualityCdrUrl(){try{const url=new URL(localStorage.getItem('quality-ucm-cdr-url')||'');return url.protocol==='https:'&&!url.username&&!url.password?url.href:''}catch{return ''}}
async function openQualityCdr(row){
 if(row?.source_call_id){
  if(!row.agent_extension||!Number.isFinite(Date.parse(row.call_started_at))||!Number.isFinite(Date.parse(row.ended_at))){$('msg').textContent='Relink this call to load its UCM extension and timestamps.';return}
  const requestId=crypto.randomUUID();
  const result=await new Promise(resolve=>{
   let timer;const receive=event=>{if(event.source!==window||event.origin!==location.origin||event.data?.type!=='NEWTEL_UCM_RESULT'||event.data.requestId!==requestId)return;clearTimeout(timer);window.removeEventListener('message',receive);resolve(event.data)};
   window.addEventListener('message',receive);timer=setTimeout(()=>{window.removeEventListener('message',receive);resolve({ok:false,error:'Install the NEWTEL Quality UCM Chrome extension, save the UCM address, and refresh Quality.'})},3500);
   window.postMessage({type:'NEWTEL_OPEN_UCM_CALL',requestId,call:{id:String(row.source_call_id),extension:String(row.agent_extension),start:row.call_started_at,end:row.ended_at}},location.origin);
  });
  $('msg').textContent=result.ok?'Opening the selected UCM call. The extension will apply its filters.':result.error;return;
 }
 const url=qualityCdrUrl();if(url){window.open(url,'_blank','noopener,noreferrer');return}$('qualityCdrUrl').value='';$('qualityCdrError').textContent='';$('qualityCdrSettings').showModal();
}

let qualityUcmPollStarted=0;
let qualityUcmEvaluation=null,qualityUcmOffset=0,qualityUcmBusy=false,qualityUcmRequest=0;
function qualityUcmMarkup(row){
  const linked=Boolean(row.source_call_id);
  return `<div class="quality-ucm">${linked?'<button type="button" class="quality-listen" data-ucm-listen>▶ Play recording</button><div data-ucm-audio-holder hidden><small data-ucm-audio-status role="status"></small><audio data-ucm-stream controls controlsList="nodownload" preload="none" style="width:100%"></audio><label data-recording-label hidden>Recording <select data-recording-segment></select></label></div>':''}<div class="quality-ucm-actions">${row.source_type==='manual_reference'?`<button type="button" data-ucm-link>${linked?'Change UCM call':'Link UCM call'}</button>`:''}<button type="button" data-ucm-open>${linked?'Open this call in UCM ↗':'Open UCM CDR ↗'}</button></div>${linked?`<small>Extension ${esc(row.agent_extension||'—')} · ${esc(qualityExactTime(row.call_started_at))} · ${esc(formatAudioTime(Number(row.talk_seconds||0)))}</small><button type="button" data-ucm-copy>Copy call details</button>`:'<small>Choose the actual call from this employee’s saved UCM records.</small>'}</div>`;
}
async function qualityUcmAuthToken(){
  let token;
  if(qualityEbookRoleSession){try{token=JSON.parse(localStorage.getItem('ebookAuthSession')||'null')?.access_token}catch{}}
  else{const {data}=await db.auth.getSession();token=data.session?.access_token}
  if(!token)throw new Error('Sign in through eBook again.');return token;
}
async function qualityUcmApi(body){
  const token=await qualityUcmAuthToken();
  const response=await fetch(`${SUPABASE_URL}/functions/v1/quality-ucm-calls`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const result=await response.json();if(!response.ok)throw new Error(result.message||'Could not load UCM calls.');return result;
}
async function openQualityUcm(card,offset=0){
  stopQualityRecordings();
  if(qualityUcmBusy)return;
  const row=rows.find(row=>String(row.id)===card.dataset.id);if(!row)return;
  const project=qualityUcmEvaluation?.id===row.id?$('qualityUcmProject').value:(row.project_id||'');$('qualityUcmProject').value=project;
  qualityUcmEvaluation=row;qualityUcmOffset=offset;const request=++qualityUcmRequest,dialog=$('qualityUcmDialog');
  $('qualityUcmTitle').textContent=`${row.agent_name||row.agent_username} · ${qualityDayLabel(qualityCallDate(row))}`;
  $('qualityUcmList').textContent='Loading UCM calls...';$('qualityUcmStatus').textContent='';$('qualityUcmNext').disabled=true;$('qualityUcmPrevious').disabled=true;
  if(!dialog.open)dialog.showModal();
  try{
    const result=await qualityUcmApi({action:'list',evaluation_id:row.id,offset,project_id:project});
    if(request!==qualityUcmRequest||!dialog.open)return;
    if(['pending','running','busy'].includes(result.status)){
      $('qualityUcmList').textContent=result.message||'Waiting for the company connector...';
      if(offset===0){qualityUcmPollStarted||=Date.now();if(Date.now()-qualityUcmPollStarted<120000)setTimeout(()=>{if(dialog.open&&request===qualityUcmRequest)openQualityUcm(card,offset)},5000);else $('qualityUcmStatus').textContent='The connector has not returned calls. Update and run it on the company computer, then reopen this window.'}return;
    }
    qualityUcmPollStarted=0;
    $('qualityUcmList').innerHTML=result.calls.length?result.calls.map(call=>`<div class="quality-ucm-choice" data-preview-id="${esc(call.external_id)}"><strong>${esc(qualityExactTime(call.started_at))}</strong><span>Extension ${esc(call.agent_extension||'—')} · ${esc(formatAudioTime(Number(call.talk_seconds||0)))} · ${esc(call.queue_name||'No queue')}</span><div style="display:flex;gap:8px"><button type="button" data-ucm-listen>▶ Play recording</button><button type="button" data-ucm-id="${esc(call.external_id)}">Select call</button></div><div data-ucm-audio-holder hidden><small data-ucm-audio-status role="status"></small><audio data-ucm-stream controls controlsList="nodownload" preload="none" style="width:100%"></audio><label data-recording-label hidden>Recording <select data-recording-segment></select></label></div></div>`).join(''):'<p>No matching calls for this employee, date and project. Project filtering uses the UCM queue name.</p>';
    $('qualityUcmList').querySelectorAll('[data-preview-id]').forEach(choice=>choice.querySelector('[data-ucm-listen]').onclick=()=>playQualityRecording(choice));
    $('qualityUcmNext').disabled=!result.has_more;$('qualityUcmPrevious').disabled=offset===0;
    $('qualityUcmList').querySelectorAll('[data-ucm-id]').forEach(button=>button.onclick=()=>linkQualityUcm(button));
  }catch(error){if(request===qualityUcmRequest)$('qualityUcmList').textContent=error.message}
}
async function linkQualityUcm(button){
  if(qualityUcmBusy||!qualityUcmEvaluation)return;qualityUcmBusy=true;
  const evaluation=qualityUcmEvaluation;$('qualityUcmStatus').textContent='Linking call...';
  $('qualityUcmList').querySelectorAll('button').forEach(node=>node.disabled=true);
  try{const {call}=await qualityUcmApi({action:'link',evaluation_id:evaluation.id,source_call_id:button.dataset.ucmId});
    Object.assign(evaluation,{source_call_id:call.external_id,agent_extension:call.agent_extension,queue_name:call.queue_name,call_started_at:call.started_at,answered_at:call.answered_at,ended_at:call.ended_at,talk_seconds:call.talk_seconds,wait_seconds:call.wait_seconds});
    const card=[...document.querySelectorAll('.call')].find(card=>card.dataset.id===String(evaluation.id));if(card){stopQualityRecordings();card.querySelector('.quality-ucm').outerHTML=qualityUcmMarkup(evaluation);bindQualityUcm(card)}
    $('qualityUcmDialog').close();$('msg').textContent='UCM call linked. Open UCM CDR and use the copied call details to find it.';
  }
  catch(error){$('qualityUcmStatus').textContent=error.message;$('qualityUcmList').querySelectorAll('button').forEach(node=>node.disabled=false)}
  finally{qualityUcmBusy=false}
}
function bindQualityUcm(card){
  const listen=card.querySelector('[data-ucm-listen]');if(listen)listen.onclick=()=>playQualityRecording(card);
  const open=card.querySelector('[data-ucm-open]');if(open)open.onclick=()=>openQualityCdr(rows.find(row=>String(row.id)===card.dataset.id));
  const button=card.querySelector('[data-ucm-link]');if(button)button.onclick=()=>openQualityUcm(card);
  const copy=card.querySelector('[data-ucm-copy]');if(copy)copy.onclick=async()=>{
    const row=rows.find(row=>String(row.id)===card.dataset.id);if(!row)return;
    try{await navigator.clipboard.writeText(`Call ID: ${row.source_call_id}\nExtension: ${row.agent_extension||''}\nStart: ${qualityExactTime(row.call_started_at)}\nEnd: ${qualityExactTime(row.ended_at)}\nTalk time: ${formatAudioTime(Number(row.talk_seconds||0))}`);copy.textContent='Copied';setTimeout(()=>copy.textContent='Copy call details',1600)}catch{$('msg').textContent='Clipboard unavailable. Call ID: '+row.source_call_id}
  };
}
const qualityAudioSessions=new Map();
let qualityAudioGeneration=0;
function stopQualityRecordings(){
 qualityAudioGeneration++;
 for(const [audio,session] of qualityAudioSessions){qualityAudioSessions.delete(audio);audio.onerror=null;audio.onloadedmetadata=null;audio.pause();audio.removeAttribute('src');audio.load();fetch(session.url+'/cancel'+session.query,{method:'POST',keepalive:true}).catch(()=>{});qualityAudioSessions.delete(audio)}
}
async function qualityRecordingFailure(card,audio,session,error){
 if(session?.failure)return session.failure;
 const report=(async()=>{
  let message=error?.message||'Recording could not be played.';
  if(session){
   try{const response=await fetch(session.url+'/status'+session.query),status=await response.json();if(status.error)message=status.error;else if(!response.ok&&status.message)message=status.message}catch{}
   if(qualityAudioSessions.get(audio)!==session)return;
  }
  const descriptions={RECORDING_NOT_FOUND:'No recording file was found for this UCM call.',CALL_NOT_FOUND:'UCM could not match the linked call. Relink the call and retry.',RECORDING_FORMAT_UNSUPPORTED:'UCM returned an unrecognized audio format.',RECORDING_ENCRYPTED:'The UCM recording is encrypted (.venc). Enable an authorized playback method for encrypted recordings.',RECORDING_ARCHIVE_INVALID:'UCM returned an invalid or unsupported recording archive.',RECORDING_API_RESPONSE:'UCM returned a web/login page instead of an audio recording.',RECORDING_API_DENIED:'UCM refused recording access. Check recording permissions for the connector API account.',UCM_RECORDING_FAILED:'The company connector could not fetch this recording. Check its audio log.'};
  const apiStatus=message.match(/^RECORDING_API_ERROR(?: \(status (-?\d+)\))?$/);if(apiStatus){const status=Number(apiStatus[1]);message=status===-47?'UCM refused recording access: the API account has no permission (status -47).':[-5,-6].includes(status)?'UCM rejected the API session after renewal (status '+status+').':'UCM recording API returned an error'+(apiStatus[1]?' (status '+status+')':'')+'.'}
  const detail=descriptions[message]?`${descriptions[message]} (${message})`:message;
  card.querySelector('[data-ucm-audio-holder]').hidden=false;card.querySelector('[data-ucm-audio-status]').textContent=detail;$('msg').textContent=detail;
  if(session){qualityAudioSessions.delete(audio);audio.onerror=null;fetch(session.url+'/cancel'+session.query,{method:'POST'}).catch(()=>{})}
 })();
 if(session)session.failure=report;return report;
}
async function playQualityRecording(card,segment=0){
 const button=card.querySelector('[data-ucm-listen]'),row=card.dataset.previewId?qualityUcmEvaluation:rows.find(row=>String(row.id)===card.dataset.id),audio=card.querySelector('[data-ucm-stream]');
 if(!row||!audio||button.disabled)return;stopQualityRecordings();card.querySelector('[data-ucm-audio-status]').textContent='Connecting to UCM…';button.disabled=true;button.textContent='Connecting to UCM…';
 const generation=qualityAudioGeneration;let session;
 try{
  const token=await qualityUcmAuthToken(),url=SUPABASE_URL+'/functions/v1/quality-audio';
  const response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({evaluation_id:row.id,segment,...(card.dataset.previewId?{source_call_id:card.dataset.previewId}:{})})});
  const result=await response.json();if(!response.ok)throw Error(result.message||'Could not start recording.');
  session={url,query:'?'+new URLSearchParams({id:result.id,token:result.token})};
  if(generation!==qualityAudioGeneration){fetch(url+'/cancel'+session.query,{method:'POST'}).catch(()=>{});return}
  qualityAudioSessions.set(audio,session);
  card.querySelector('[data-ucm-audio-holder]').hidden=false;
  audio.onloadedmetadata=async()=>{
   if(qualityAudioSessions.get(audio)!==session)return;card.querySelector('[data-ucm-audio-status]').textContent='Streaming from UCM';button.textContent='↻ Restart recording';
   try{const status=await (await fetch(url+'/status'+session.query)).json();const select=card.querySelector('[data-recording-segment]');if(status.segments>1){card.querySelector('[data-recording-label]').hidden=false;select.innerHTML=Array.from({length:status.segments},(_,i)=>`<option value="${i}">Recording ${i+1}</option>`).join('');select.value=String(segment);select.onchange=()=>playQualityRecording(card,Number(select.value))}}catch{}
  };
  audio.onerror=async()=>{await qualityRecordingFailure(card,audio,session);button.textContent='▶ Retry recording'};
  audio.src=url+'/stream'+session.query;
  const playback=audio.play();if(playback)await playback;
 }catch(error){await qualityRecordingFailure(card,audio,session,error);button.textContent='▶ Retry recording'}
 finally{button.disabled=false}
}
window.addEventListener('pagehide',stopQualityRecordings);
function qualityUcmPage(delta){
  const card=[...document.querySelectorAll('.call')].find(card=>card.dataset.id===String(qualityUcmEvaluation?.id));if(card)openQualityUcm(card,Math.max(0,qualityUcmOffset+delta));
}
document.addEventListener('DOMContentLoaded',()=>{
  $('qualityCdrSave').onclick=()=>{
    try{const url=new URL($('qualityCdrUrl').value.trim());if(url.protocol!=='https:'||url.username||url.password)throw Error('Enter an HTTPS CDR URL without login details.');localStorage.setItem('quality-ucm-cdr-url',url.href);$('qualityCdrSettings').close();openQualityCdr()}catch(error){$('qualityCdrError').textContent=error.message||'Enter a valid HTTPS URL.'}
  };

  $('qualityUcmProject').onchange=()=>qualityUcmPage(-qualityUcmOffset);
  $('qualityUcmNext').onclick=()=>qualityUcmPage(50);$('qualityUcmPrevious').onclick=()=>qualityUcmPage(-50);
  $('qualityUcmDialog').addEventListener('close',()=>{stopQualityRecordings();qualityUcmRequest++;qualityUcmPollStarted=0});
});
