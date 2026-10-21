const input=document.getElementById('url'),status=document.getElementById('status');
chrome.storage.local.get('cdrUrl').then(value=>input.value=value.cdrUrl||'');
document.getElementById('save').onclick=async()=>{
 try{
  const url=new URL(input.value.trim());if(url.protocol!=='https:'||url.username||url.password||url.pathname.replace(/\/$/,'')!=='/cdr/cdr')throw Error('Paste the HTTPS CDR page URL ending in /cdr/cdr, without login details.');url.hash='';url.search='';
  const origin=url.origin+'/*';if(!await chrome.permissions.request({origins:[origin]}))throw Error('UCM access was not granted.');
  const old=(await chrome.storage.local.get('cdrUrl')).cdrUrl;
  await chrome.scripting.unregisterContentScripts({ids:['ucm-cdr']}).catch(()=>{});
  await chrome.scripting.registerContentScripts([{id:'ucm-cdr',matches:[origin],js:['cdr.js'],runAt:'document_idle',persistAcrossSessions:true}]);
  await chrome.storage.local.set({cdrUrl:url.href});
  if(old&&new URL(old).origin!==url.origin)await chrome.permissions.remove({origins:[new URL(old).origin+'/*']});
  status.textContent='Saved. Refresh the Quality page, then open a linked call.';
 }catch(error){status.textContent=error.message}
};
