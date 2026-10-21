window.addEventListener('message',async event=>{
 if(event.source!==window||event.origin!==location.origin||event.data?.type!=='NEWTEL_OPEN_UCM_CALL'||typeof event.data.requestId!=='string')return;
 try{const result=await chrome.runtime.sendMessage({type:'quality-open-call',call:event.data.call});window.postMessage({type:'NEWTEL_UCM_RESULT',requestId:event.data.requestId,...result},location.origin)}
 catch{window.postMessage({type:'NEWTEL_UCM_RESULT',requestId:event.data.requestId,ok:false,error:'Reload Quality after installing or updating the extension.'},location.origin)}
});
