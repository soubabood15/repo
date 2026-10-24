function qualityRecordingTime(seconds){const value=Math.max(0,Math.floor(Number(seconds)||0));return Math.floor(value/60)+':'+String(value%60).padStart(2,'0')}
async function qualityRecordingBlob(response){
 if(!response.ok)throw Error('Recording request failed.');
 const reader=response.body.getReader(),parts=[];let length=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>128*1024*1024){await reader.cancel();throw Error('Recording is too large.')}parts.push(value)}}finally{reader.releaseLock()}
 if(!length)throw Error('UCM returned an empty recording.');return new Blob(parts,{type:'audio/wav'});
}
function bindQualityRecordingPlayer(card,audio){
 const toggle=card.querySelector('[data-ucm-toggle]'),seek=card.querySelector('[data-ucm-seek]'),clock=card.querySelector('[data-ucm-clock]'),speed=card.querySelector('[data-ucm-speed]');
 const update=()=>{const duration=Number.isFinite(audio.duration)?audio.duration:0;clock.textContent=qualityRecordingTime(audio.currentTime||0)+' / '+qualityRecordingTime(duration);seek.value=duration?Math.round(audio.currentTime/duration*1000):0;seek.disabled=!duration;toggle.textContent=audio.paused?'▶':'❚❚';toggle.disabled=!duration};
 toggle.onclick=()=>{if(audio.paused){if(audio.ended)audio.currentTime=0;audio.play().catch(()=>{})}else audio.pause()};
 seek.oninput=()=>{if(Number.isFinite(audio.duration))audio.currentTime=Number(seek.value)/1000*audio.duration;update()};
 speed.onchange=()=>audio.playbackRate=Number(speed.value);
 audio.ontimeupdate=update;audio.ondurationchange=update;audio.onplay=update;audio.onpause=update;audio.onended=update;update();return update;
}
