(()=>{
// Runtime behavior for the original HTML attachment. Its markup and CSS stay intact.
const API='https://trainer-kb.alisoub60.workers.dev/functions/v1/icon7-padel';
const $=id=>document.getElementById(id);
const note=$('scheduleNote'),schedule=$('schedule');
const originalSchedule=schedule.cloneNode(true);
const statuses={queued:'Waiting for booking device…',processing:'Checking ICON7…',submitting:'Submitting to ICON7…',confirmed:'Confirmed by ICON7',failed:'Booking was not confirmed',unknown:'Outcome uncertain. Check ICON7 before booking again.'};
let availability=null,selection=null,busy=false,submission=null,activeJob=null,duration=60;
let date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Amman',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function status(text){note.textContent=text}
async function api(route,body){
  let token;try{token=JSON.parse(localStorage.getItem('ebookAuthSession')||'null')?.access_token}catch{}
  if(!token)throw new Error('Please sign in through the eBook Portal.');
  const response=await fetch(API+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(20000)});
  const data=await response.json();if(!response.ok)throw new Error(data.message||'Unable to connect to the booking device.');return data;
}
async function waitJob(id){
  const deadline=Date.now()+180000;
  while(Date.now()<deadline){
    const job=await api('/jobs/'+encodeURIComponent(id));status(statuses[job.status]||job.status);
    if(['confirmed','failed','unknown'].includes(job.status))return job;
    await pause(2000);
  }
  return {status:'unknown',result:{message:'Confirmation is still pending. Check My bookings before sending another request.'}};
}
function setBusy(value){
  busy=value;
  for(const button of document.querySelectorAll('.slot,#prevDay,#nextDay,#calendarButton,#selectedDay,#saveBooking,#cancelBooking'))button.disabled=value||button.dataset.unavailable==='true';
  for(const field of form.querySelectorAll('input,select,textarea'))field.disabled=value;
  save.disabled=value||!selection;
}
function setDay(){
  $('datePicker').value=date;
  const value=new Date(date+'T12:00:00Z');
  $('weekdayLabel').textContent=new Intl.DateTimeFormat('en',{weekday:'long',timeZone:'Asia/Amman'}).format(value);
  $('dateLabel').textContent=new Intl.DateTimeFormat('en-GB',{day:'numeric',month:'long',year:'numeric',timeZone:'Asia/Amman'}).format(value);
}
function preview(message){
  availability=null;schedule.replaceChildren(...[...originalSchedule.childNodes].map(n=>n.cloneNode(true)));
  schedule.style.gridTemplateColumns=originalSchedule.style.gridTemplateColumns;
  for(const button of schedule.querySelectorAll('button')){button.disabled=true;button.dataset.unavailable='true';button.title='Design example only — live availability is not loaded';}
  status('Design preview — '+message+' Times shown are examples.');
}
function renderSlots(slots){
  const hours=Array.from({length:12},(_,i)=>`${String(i+10).padStart(2,'0')}:00`);
  const times=[...new Set([...hours,...slots.map(s=>s.start)])].sort((a,b)=>((Number(a.slice(0,2))+14)%24*60+Number(a.slice(3)))-((Number(b.slice(0,2))+14)%24*60+Number(b.slice(3))));
  schedule.replaceChildren();schedule.style.gridTemplateColumns=`64px repeat(${times.length},minmax(72px,1fr))`;
  for(const title of ['Court',...times]){const heading=document.createElement('div');heading.className='grid-head';heading.textContent=title;schedule.append(heading)}
  for(const court of ['Court A','Court B','Court C']){
    const label=document.createElement('div');label.className='court';const letter=document.createElement('span');letter.className='court-no';letter.textContent=court.slice(-1);label.append(letter);schedule.append(label);
    for(const time of times){
      const slot=slots.find(s=>s.court===court&&s.start===time),button=document.createElement('button');button.type='button';button.className=slot?'slot':'slot busy';
      if(slot){button.textContent='＋';button.setAttribute('aria-label',`Book court ${court.slice(-1)} at ${time}`);button.addEventListener('click',()=>openBooking(slot))}
      else{const title=document.createElement('b');title.textContent='Unavailable';const detail=document.createElement('small');detail.textContent=time;button.append(title,detail);button.disabled=true;button.dataset.unavailable='true'}
      schedule.append(button);
    }
  }
}
async function loadSlots({keepSelection=false}={}){
  if(busy||submission)return;
  const retained=keepSelection?selection:null;
  setBusy(true);availability=null;schedule.inert=true;status('Checking live availability with ICON7…');
  try{
    const state=await api('/status');if(!state.ready)throw new Error(state.online?'Sign in to ICON7 on the booking device.':'Booking device offline.');
    const created=await api('/availability',{date,duration,request_key:crypto.randomUUID()});
    const job=await waitJob(created.id);
    if(job.status!=='confirmed')throw new Error(job.result?.message||'Unable to load live availability.');
    availability={id:job.id,date,duration,slots:job.result.slots};renderSlots(job.result.slots);
    status('Opening hours: 10:00 AM to 3:00 AM');
    if(retained){selection=job.result.slots.find(s=>s.court===retained.court&&s.start===retained.start)||null;updateSummary();if(!selection)status('This start time is unavailable for the selected duration.')}
  }catch(error){selection=null;preview(error.message);if(retained)updateSummary()}
  finally{schedule.inert=false;setBusy(false)}
}
// Reuse the modal styles already provided in the attachment; no initial-layout additions.
const backdrop=document.createElement('div');backdrop.className='modal-bg';backdrop.style.display='none';
const modal=document.createElement('section');modal.className='modal';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-label','Court booking');
const top=document.createElement('div');top.className='modal-top';const title=document.createElement('h2');title.textContent='Book court';const close=document.createElement('button');close.type='button';close.className='close';close.textContent='×';close.setAttribute('aria-label','Close booking');top.append(title,close);
const summary=document.createElement('p');summary.style.whiteSpace='pre-line';
const form=document.createElement('form');
function field(labelText,id,type='text'){
  const label=document.createElement('label');label.htmlFor=id;label.textContent=labelText;
  const input=document.createElement('input');input.id=id;input.type=type;input.required=true;
  label.append(input);form.append(label);return input;
}
const customer=field('Customer name','bookingCustomer');customer.minLength=2;customer.maxLength=100;
const phone=field('Phone number','bookingPhone','tel');phone.maxLength=24;
const durationLabel=document.createElement('label');durationLabel.htmlFor='bookingDuration';durationLabel.textContent='Duration';
const durationSelect=document.createElement('select');durationSelect.id='bookingDuration';
// Apply the supplied input treatment only inside the on-demand dialog.
durationSelect.style.cssText='display:block;width:100%;padding:11px;margin-top:6px;border:1px solid var(--line);border-radius:9px;background:#fff';
for(const [value,label]of [[60,'1 hour'],[90,'1.5 hours'],[120,'2 hours']]){const option=document.createElement('option');option.value=value;option.textContent=label;durationSelect.append(option)}
durationLabel.append(durationSelect);form.append(durationLabel);
const notes=field('Notes (optional)','bookingNotes');notes.required=false;notes.maxLength=400;
const actions=document.createElement('div');actions.className='modal-actions';
const cancel=document.createElement('button');cancel.id='cancelBooking';cancel.type='button';cancel.textContent='Cancel';
const save=document.createElement('button');save.id='saveBooking';save.type='submit';save.className='btn-primary';save.textContent='Confirm booking';actions.append(cancel,save);form.append(actions);
modal.append(top,summary,form);backdrop.append(modal);document.body.append(backdrop);
function updateSummary(){summary.textContent=selection?`${selection.court} · ${date}\n${selection.start} · ${duration} minutes · ${selection.price} JOD`:'The selected time is unavailable.';save.disabled=!selection||busy}
function openBooking(slot){
  if(busy||submission||!availability)return;
  selection=slot;durationSelect.value=String(duration);save.textContent='Confirm booking';updateSummary();backdrop.style.display='grid';customer.focus();
}
function closeBooking(){if(busy)return;if(submission){status('A request is pending. Continue the same request or check My bookings.');return}backdrop.style.display='none';selection=null}
close.addEventListener('click',closeBooking);cancel.addEventListener('click',closeBooking);
document.addEventListener('keydown',event=>{if(event.key==='Escape')closeBooking()});
durationSelect.addEventListener('change',async()=>{if(submission)return;duration=Number(durationSelect.value);await loadSlots({keepSelection:true})});
form.addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!selection||!availability)return;
  submission||={request_key:crypto.randomUUID(),availability_id:availability.id,date:availability.date,...selection,customer:customer.value.trim(),phone:phone.value.trim(),notes:notes.value.trim()};
  setBusy(true);status('Sending booking request…');
  try{
    const job=activeJob?{id:activeJob}:await api('/bookings',submission);activeJob=job.id;
    const outcome=await waitJob(job.id);
    status(outcome.status==='confirmed'?'Confirmed by ICON7 — booking #'+outcome.result.provider_id:outcome.result?.message||statuses[outcome.status]);
    backdrop.style.display='none';selection=null;availability=null;submission=null;activeJob=null;form.reset();
    // A new booking always needs a fresh quote. Keep the result visible until refresh.
    schedule.inert=true;
  }catch(error){status(error.message+' Continue the same request; do not create a second booking.');save.textContent='Continue same request'}
  finally{setBusy(false)}
});
function changeDay(value){
  if(busy||submission)return;
  date=value;selection=null;backdrop.style.display='none';setDay();loadSlots();
}
for(const [id,offset]of [['prevDay',-1],['nextDay',1]])$(id).addEventListener('click',()=>{
  const next=new Date(date+'T12:00:00Z');next.setUTCDate(next.getUTCDate()+offset);changeDay(next.toISOString().slice(0,10));
});
function calendar(){if(busy||submission)return;const input=$('datePicker');if(typeof input.showPicker==='function')input.showPicker();else input.click()}
$('calendarButton').addEventListener('click',calendar);$('selectedDay').addEventListener('click',calendar);
$('datePicker').addEventListener('change',()=>{if($('datePicker').value)changeDay($('datePicker').value)});
// Existing profile control opens operational details without adding UI to the design.
const profile=document.querySelector('.profile');profile.setAttribute('role','button');profile.tabIndex=0;profile.title='Connection and my bookings';
async function tools(){
  if(busy)return;
  const old=document.getElementById('bookingTools');if(old)old.remove();
  const bg=document.createElement('div');bg.id='bookingTools';bg.className='modal-bg';bg.style.display='grid';
  const panel=document.createElement('section');panel.className='modal';panel.setAttribute('role','dialog');panel.setAttribute('aria-label','My bookings');panel.style.maxHeight='85vh';panel.style.overflow='auto';
  const heading=document.createElement('h2');heading.textContent='My bookings';const body=document.createElement('div');body.textContent='Loading…';
  const buttons=document.createElement('div');buttons.className='modal-actions';
  const refresh=document.createElement('button');refresh.type='button';refresh.textContent='Refresh schedule';refresh.addEventListener('click',()=>{bg.remove();loadSlots()});
  const dismiss=document.createElement('button');dismiss.type='button';dismiss.className='btn-primary';dismiss.textContent='Close';dismiss.addEventListener('click',()=>bg.remove());buttons.append(refresh,dismiss);
  panel.append(heading,body,buttons);bg.append(panel);document.body.append(bg);
  try{const {jobs}=await api('/bookings');body.replaceChildren();if(!jobs.length)body.textContent='No bookings yet.';for(const job of jobs){const row=document.createElement('p');row.textContent=`${job.booking.date} · ${job.booking.court} · ${job.booking.start} · ${job.booking.customer}\n${statuses[job.status]}${job.result?.provider_id?' · #'+job.result.provider_id:''}`;row.style.whiteSpace='pre-line';body.append(row)}}catch(error){body.textContent=error.message}
}
profile.addEventListener('click',tools);profile.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();tools()}});
setDay();preview('Checking connection.');loadSlots();
setInterval(()=>{if(!document.hidden&&!busy&&!submission&&!availability&&backdrop.style.display==='none')loadSlots()},30000);

})();
