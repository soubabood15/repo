(async()=>{
 const pending=await chrome.runtime.sendMessage({type:'quality-pending-call'}).catch(()=>null);if(!pending?.ok)return;
 const call=pending.call;
 const visible=element=>element.getClientRects().length>0&&getComputedStyle(element).visibility!=='hidden';
 const text=value=>String(value||'').replace(/[\s:\u200e\u200f]+/g,' ').trim().toLowerCase();
 let banner;
 function notice(message,error=false){
  if(!banner){banner=document.createElement('div');banner.setAttribute('role','status');Object.assign(banner.style,{position:'fixed',bottom:'20px',right:'20px',maxWidth:'420px',padding:'14px 18px',borderRadius:'10px',color:'#fff',font:'14px/1.6 Arial',zIndex:'2147483647',boxShadow:'0 8px 30px #0004'});document.documentElement.append(banner)}banner.style.background=error?'#9a3412':'#123b66';banner.textContent=message;
 }
 const local=stamp=>{const d=new Date(Date.parse(stamp)+10800000),iso=d.toISOString();return {date:iso.slice(0,10),time:iso.slice(11,16),full:iso.slice(0,19).replace('T',' ')}};
 const start=local(call.start),end=local(new Date(Math.ceil((Date.parse(call.end)+1000)/60000)*60000).toISOString());
 function fields(label,count){
  const labels=[...document.querySelectorAll('label,td,th,span,div')].filter(node=>visible(node)&&node.childElementCount<4&&text(node.textContent)===text(label)).sort((a,b)=>a.textContent.length-b.textContent.length);
  for(const node of labels){
   if(node.tagName==='LABEL'&&node.htmlFor){const input=document.getElementById(node.htmlFor);if(input&&visible(input)&&count===1)return [input]}
   const r=node.getBoundingClientRect(),inputs=[...document.querySelectorAll('input')].filter(input=>visible(input)&&!['hidden','checkbox','radio','button','submit'].includes(input.type)).map(input=>({input,r:input.getBoundingClientRect()})).filter(item=>item.r.left>=r.right-8&&Math.abs((item.r.top+item.r.bottom)/2-(r.top+r.bottom)/2)<32).sort((a,b)=>a.r.left-b.r.left);
   if(inputs.length>=count)return inputs.slice(0,count).map(item=>item.input);
  }return [];
 }
 function setValue(input,value){
  if(input.disabled)throw Error('A required UCM filter is disabled.');
  input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,value);
  input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));input.dispatchEvent(new Event('blur',{bubbles:true}));input.blur();
 }
 function button(label){return [...document.querySelectorAll('button,a,input[type=submit],input[type=button],span')].find(node=>visible(node)&&text(node.value||node.textContent)===text(label))}
 let opened=false,submitted=false,finished=false,attempts=0,timer;
 async function tick(){
  if(finished)return;attempts++;
  if(!location.pathname.startsWith('/cdr/cdr')){notice('NEWTEL: sign in to UCM, then open CDR. Your selected call is waiting.');if(attempts<240)timer=setTimeout(tick,1000);return}
  if(submitted){
   const matching=[...document.querySelectorAll('tbody tr,[role=row]')].filter(row=>visible(row)&&row.textContent.replace(/[\s\u200e\u200f]+/g,' ').includes(start.full));
   if(matching.length===1){const row=matching[0];row.style.outline='3px solid #2563eb';row.style.background='#eff6ff';row.scrollIntoView({behavior:'smooth',block:'center'});notice('NEWTEL: selected call highlighted. Use its recording control to listen.');finished=true;await chrome.runtime.sendMessage({type:'quality-call-done'});return}
   if(attempts>50){notice(matching.length>1?'NEWTEL: several records have the same start time. Filters are applied; verify the call before listening.':'NEWTEL: filters submitted, but the exact call row was not found. Check the results below.',true);finished=true;return}
   timer=setTimeout(tick,600);return;
  }
  const starts=fields('Start Time',2),ends=fields('End Time',2),extensions=fields('Extension',1);
  if(starts.length!==2||ends.length!==2||extensions.length!==1){
   if(!opened){const display=button('Display Filter');if(display){display.click();opened=true}}
   if(attempts>40){notice('NEWTEL: could not identify the UCM date/time and Extension fields safely. No filter was submitted. Send a screenshot of Display Filter.',true);finished=true;return}
   timer=setTimeout(tick,600);return;
  }
  const all=[...starts,...ends,...extensions];if(new Set(all).size!==5){notice('NEWTEL: filter fields are ambiguous. No search was submitted.',true);finished=true;return}
  const filter=button('Filter');if(!filter){notice('NEWTEL: Filter button not found. No search was submitted.',true);finished=true;return}
  try{
   // Avoid inheriting unrelated filters from a previous CDR search.
   const reset=button('Reset');if(reset){reset.click();await new Promise(resolve=>setTimeout(resolve,300))}
   const freshStart=fields('Start Time',2),freshEnd=fields('End Time',2),freshExtension=fields('Extension',1);
   if(freshStart.length!==2||freshEnd.length!==2||freshExtension.length!==1||new Set([...freshStart,...freshEnd,...freshExtension]).size!==5)throw Error('UCM filter layout changed after reset. No search was submitted.');
   setValue(freshStart[0],start.date);setValue(freshStart[1],start.time);setValue(freshEnd[0],end.date);setValue(freshEnd[1],end.time);setValue(freshExtension[0],call.extension);
   if(freshStart[0].value!==start.date||freshStart[1].value!==start.time||freshEnd[0].value!==end.date||freshEnd[1].value!==end.time||freshExtension[0].value!==call.extension)throw Error('UCM did not accept the filter values. No search was submitted.');
   notice('NEWTEL: finding your selected call…');submitted=true;attempts=0;button('Filter').click();timer=setTimeout(tick,800);
  }catch(error){notice('NEWTEL: '+error.message,true);finished=true}
 }
 notice('NEWTEL: preparing the selected call…');tick();
 window.addEventListener('pagehide',()=>clearTimeout(timer),{once:true});
})();
