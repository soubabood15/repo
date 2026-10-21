const SITE='https://soubabood15.github.io';
function validCall(call){
 return call&&typeof call.id==='string'&&call.id.length>0&&call.id.length<=1000&&/^\d{2,10}$/.test(call.extension)&&Number.isFinite(Date.parse(call.start))&&Number.isFinite(Date.parse(call.end))&&Date.parse(call.end)>=Date.parse(call.start)&&Date.parse(call.end)-Date.parse(call.start)<=86400000;
}
function configuredUrl(value){const url=new URL(value);if(url.protocol!=='https:'||url.username||url.password||url.pathname.replace(/\/$/,'')!=='/cdr/cdr')throw Error('Use the HTTPS CDR page URL ending in /cdr/cdr.');url.hash='';url.search='';return url}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 (async()=>{
  if(message?.type==='quality-open-call'){
   const source=new URL(sender.url||'');
   if(source.origin!==SITE||source.pathname!=='/repo/quality_calls.html'||!sender.tab||!validCall(message.call))throw Error('Invalid Quality call request.');
   const {cdrUrl}=await chrome.storage.local.get('cdrUrl');if(!cdrUrl)throw Error('Open the NEWTEL extension icon and save your UCM CDR address first.');
   const url=configuredUrl(cdrUrl);
   if(!await chrome.permissions.contains({origins:[url.origin+'/*']}))throw Error('Open the extension settings and allow access to your UCM address.');
   // A blank tab prevents the CDR page loading before its call request is stored.
   const tab=await chrome.tabs.create({url:'about:blank',active:true});
   await chrome.storage.session.set({['call:'+tab.id]:{call:message.call,origin:url.origin,expires:Date.now()+10*60000}});
   await chrome.tabs.update(tab.id,{url:url.href});return {ok:true};
  }
  if(message?.type==='quality-pending-call'||message?.type==='quality-call-done'){
   if(!sender.tab)return {ok:false};const key='call:'+sender.tab.id,entry=(await chrome.storage.session.get(key))[key];
   if(!entry||entry.expires<Date.now()){await chrome.storage.session.remove(key);return {ok:false}}
   if(new URL(sender.url||'').origin!==entry.origin)return {ok:false};
   if(message.type==='quality-call-done'){await chrome.storage.session.remove(key);return {ok:true}}
   return {ok:true,call:entry.call};
  }
  return {ok:false};
 })().then(respond,error=>respond({ok:false,error:error.message}));return true;
});
chrome.tabs.onRemoved.addListener(id=>chrome.storage.session.remove('call:'+id));
