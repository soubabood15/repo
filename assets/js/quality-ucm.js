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
  return `<div class="quality-ucm">${linked?'<button type="button" class="quality-listen" data-ucm-listen>▶ Play recording</button><div data-ucm-audio-holder hidden><audio data-ucm-stream controls controlsList="nodownload" preload="none" style="width:100%"></audio><label data-recording-label hidden>Recording <select data-recording-segment></select></label></div>':''}<div class="quality-ucm-actions">${row.source_type==='manual_reference'?`<button type="button" data-ucm-link>${linked?'Change UCM call':'Link UCM call'}</button>`:''}<button type="button" data-ucm-open>${linked?'Open this call in UCM ↗':'Open UCM CDR ↗'}</button></div>${linked?`<small>Extension ${esc(row.agent_extension||'—')} · ${esc(qualityExactTime(row.call_started_at))} · ${esc(formatAudioTime(Number(row.talk_seconds||0)))}</small><button type="button" data-ucm-copy>Copy call details</button>`:'<small>Choose the actual call from this employee’s saved UCM records.</small>'}</div>`;
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
  if(qualityUcmBusy)return;
  const row=rows.find(row=>String(row.id)===card.dataset.id);if(!row)return;
  qualityUcmEvaluation=row;qualityUcmOffset=offset;const request=++qualityUcmRequest,dialog=$('qualityUcmDialog');
  $('qualityUcmTitle').textContent=`${row.agent_name||row.agent_username} · ${qualityDayLabel(qualityCallDate(row))}`;
  $('qualityUcmList').textContent='Loading UCM calls...';$('qualityUcmStatus').textContent='';$('qualityUcmNext').disabled=true;$('qualityUcmPrevious').disabled=true;
  if(!dialog.open)dialog.showModal();
  try{
    const result=await qualityUcmApi({action:'list',evaluation_id:row.id,offset});
    if(request!==qualityUcmRequest||!dialog.open)return;
    if(['pending','running','busy'].includes(result.status)){
      $('qualityUcmList').textContent=result.message||'Waiting for the company connector...';
      if(offset===0){qualityUcmPollStarted||=Date.now();if(Date.now()-qualityUcmPollStarted<120000)setTimeout(()=>{if(dialog.open&&request===qualityUcmRequest)openQualityUcm(card,offset)},5000);else $('qualityUcmStatus').textContent='The connector has not returned calls. Update and run it on the company computer, then reopen this window.'}return;
    }
    qualityUcmPollStarted=0;
    $('qualityUcmList').innerHTML=result.calls.length?result.calls.map(call=>`<button class="quality-ucm-choice" type="button" data-ucm-id="${esc(call.external_id)}"><strong>${esc(qualityExactTime(call.started_at))}</strong><span>Extension ${esc(call.agent_extension||'—')} · ${esc(formatAudioTime(Number(call.talk_seconds||0)))} · ${esc(call.queue_name||'No queue')}</span><small>Session: ${esc(call.session_id)}</small></button>`).join(''):'<p>No answered calls are saved for this employee and date. Check UCM sync and extension mapping.</p>';
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
function stopQualityRecordings(){
 for(const [audio,session] of qualityAudioSessions){audio.pause();audio.removeAttribute('src');audio.load();fetch(session.url+'/cancel'+session.query,{method:'POST',keepalive:true}).catch(()=>{});qualityAudioSessions.delete(audio)}
}
async function playQualityRecording(card,segment=0){
 const button=card.querySelector('[data-ucm-listen]'),row=rows.find(row=>String(row.id)===card.dataset.id),audio=card.querySelector('[data-ucm-stream]');
 if(!row||!audio||button.disabled)return;stopQualityRecordings();button.disabled=true;button.textContent='Connecting to UCM…';
 let session;
 try{
  const token=await qualityUcmAuthToken(),url=SUPABASE_URL+'/functions/v1/quality-audio';
  const response=await fetch(url,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({evaluation_id:row.id,segment})});
  const result=await response.json();if(!response.ok)throw Error(result.message||'Could not start recording.');
  session={url,query:'?'+new URLSearchParams({id:result.id,token:result.token})};qualityAudioSessions.set(audio,session);
  card.querySelector('[data-ucm-audio-holder]').hidden=false;
  audio.onloadedmetadata=async()=>{
   button.textContent='↻ Restart recording';
   try{const status=await (await fetch(url+'/status'+session.query)).json();const select=card.querySelector('[data-recording-segment]');if(status.segments>1){card.querySelector('[data-recording-label]').hidden=false;select.innerHTML=Array.from({length:status.segments},(_,i)=>`<option value="${i}">Recording ${i+1}</option>`).join('');select.value=String(segment);select.onchange=()=>playQualityRecording(card,Number(select.value))}}catch{}
  };
  audio.onerror=async()=>{
   let message='Recording could not be played. Check the company audio connector and UCM recording access.';
   try{const status=await (await fetch(url+'/status'+session.query)).json();if(status.error)message=status.error}catch{}
   $('msg').textContent=message;button.textContent='▶ Retry recording';
  };
  audio.src=url+'/stream'+session.query;
  const playback=audio.play();if(playback)await playback;
 }catch(error){$('msg').textContent=error.message||'Could not play recording.';button.textContent='▶ Play recording';if(session){fetch(session.url+'/cancel'+session.query,{method:'POST'}).catch(()=>{});qualityAudioSessions.delete(audio)}}
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

  $('qualityUcmNext').onclick=()=>qualityUcmPage(50);$('qualityUcmPrevious').onclick=()=>qualityUcmPage(-50);
  $('qualityUcmDialog').addEventListener('close',()=>{qualityUcmRequest++;qualityUcmPollStarted=0});
});
