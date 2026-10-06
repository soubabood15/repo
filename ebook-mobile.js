/* The desktop sidebar remains unchanged; only phone navigation becomes a drawer. */
(()=>{
  const mobile=matchMedia('(max-width:720px)'),body=document.body,nav=document.getElementById('portalSectionNav'),toggle=document.getElementById('ebookMobileMenuToggle'),close=document.getElementById('ebookMobileMenuClose'),backdrop=document.getElementById('ebookMobileBackdrop');
  if(!nav||!toggle||!close||!backdrop)return;
  let open=false;
  function setOpen(next,restoreFocus=false){
    open=mobile.matches&&next&&body.classList.contains('ebook-authenticated');
    body.classList.toggle('ebook-mobile-menu-open',open);toggle.setAttribute('aria-expanded',String(open));toggle.setAttribute('aria-label',open?'Close navigation':'Open navigation');
    backdrop.hidden=!open;nav.inert=mobile.matches&&!open;
    if(mobile.matches)nav.setAttribute('aria-hidden',String(!open));else nav.removeAttribute('aria-hidden');
    if(open)close.focus();else if(restoreFocus&&mobile.matches)toggle.focus();
  }
  toggle.onclick=()=>setOpen(!open,true);close.onclick=()=>setOpen(false,true);backdrop.onclick=()=>setOpen(false,true);
  nav.addEventListener('click',event=>{if(event.target.closest('[data-portal-section]')&&mobile.matches)setOpen(false,true)});
  document.addEventListener('keydown',event=>{
    if(!open)return;
    if(event.key==='Escape'){event.preventDefault();setOpen(false,true);return}
    if(event.key==='Tab'){
      const items=[...nav.querySelectorAll('button,a[href],input,select,[tabindex="0"]')].filter(node=>!node.disabled&&!node.hidden),first=items[0],last=items.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}
    }
  });
  mobile.addEventListener('change',()=>setOpen(false));
  new MutationObserver(()=>{if(open&&!body.classList.contains('ebook-authenticated'))setOpen(false)}).observe(body,{attributes:true,attributeFilter:['class']});
  setOpen(false);
})();
