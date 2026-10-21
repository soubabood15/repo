// Use the exact supplied documents; attach booking behavior without restyling them.
const workspace=document.getElementById('padelWorkspace');
const frame=document.getElementById('padelFrame');
frame.addEventListener('load',()=>{
  try{
    const location=frame.contentWindow.location;
    if(location.origin!==window.location.origin)return;
    const doc=frame.contentDocument;
    for(const link of doc.querySelectorAll('.nav a')){
      const url=new URL(link.href);if(url.origin===window.location.origin){url.searchParams.set('v','6');link.href=url.href;}
    }
    if(location.pathname.endsWith('/icon7-padel/admin.html')){
      const role=doc.getElementById('role');if(role)role.textContent='Administrator · Design preview';
      return;
    }
    if(!location.pathname.endsWith('/icon7-padel/user.html'))return;
    if(doc.getElementById('padelRuntime'))return;
    const script=doc.createElement('script');
    script.id='padelRuntime';script.src=new URL('booking.js?v=6',location.href).href;
    doc.body.append(script);
  }catch(error){console.warn('Unable to attach the booking interface.');}
});
document.getElementById('padelOpen').addEventListener('click',()=>{
  if(!window.currentUser)return;
  workspace.hidden=false;
  if(!frame.getAttribute('src'))frame.src='icon7-padel/user.html?v=6';
  workspace.scrollIntoView({behavior:'smooth',block:'start'});
});
document.getElementById('padelClose').addEventListener('click',()=>{
  workspace.hidden=true;document.getElementById('padelOpen').focus();
});
