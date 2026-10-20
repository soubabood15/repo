const API='https://trainer-kb.alisoub60.workers.dev/functions/v1/icon7-padel';
const $=id=>document.getElementById(id);
let availability=null,selected=null,busy=false,submission=null,activeJob=null;
const labels={queued:'بانتظار جهاز الربط',processing:'جاري التنفيذ على أيكون',submitting:'جاري إرسال الحجز إلى أيكون',confirmed:'مؤكد لدى أيكون',failed:'لم يتم تأكيد الحجز',unknown:'النتيجة غير محسومة — راجع أيكون قبل إعادة الحجز'};
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function message(text,error=false){$('message').textContent=text;$('message').dataset.error=String(error)}
async function api(route,body) {
  let token;try{token=JSON.parse(localStorage.getItem('ebookAuthSession')||'null')?.access_token}catch{}
  if(!token)throw new Error('سجّل الدخول من بوابة eBook أولاً.');
  const response=await fetch(API+route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:AbortSignal.timeout(20000)});
  const data=await response.json();if(!response.ok)throw new Error(data.message||'تعذر الاتصال بالربط.');return data;
}
function setBusy(value) {
  busy=value;
  for(const element of document.querySelectorAll('#queryForm input,#queryForm select,#queryForm button,#bookingForm input,#bookingForm textarea,#bookingForm button,.live-slot'))element.disabled=value;
}
async function status() {
  try{const state=await api('/status');$('connection').textContent=state.ready?'جهاز الربط متصل':state.online?'أيكون يحتاج تسجيل دخول على جهاز الربط':'جهاز الربط غير متصل'}catch(error){$('connection').textContent='الربط غير جاهز'}
}
async function waitJob(id) {
  const deadline=Date.now()+180000;
  while(Date.now()<deadline) {
    const job=await api('/jobs/'+encodeURIComponent(id));
    message(labels[job.status]||job.status,job.status==='unknown'||job.status==='failed');
    if(['confirmed','failed','unknown'].includes(job.status))return job;
    await delay(2000);
  }
  return {status:'unknown',result:{message:'انتهت مهلة المتابعة. حدّث طلباتي للتحقق؛ لا ترسل حجزاً آخر لنفس الموعد.'}};
}
function renderSlots(slots) {
  $('courts').replaceChildren();
  for(const court of ['Court A','Court B','Court C']) {
    const article=document.createElement('article');article.className='live-court';
    const heading=document.createElement('h3');heading.textContent=court;article.append(heading);
    const grid=document.createElement('div');grid.className='live-slots';article.append(grid);
    for(const slot of slots.filter(s=>s.court===court)) {
      const button=document.createElement('button');button.type='button';button.className='live-slot';
      button.textContent=slot.start;
      const price=document.createElement('small');price.textContent=slot.price+' JOD';button.append(price);
      button.addEventListener('click',()=>{
        if(busy||submission)return;selected=slot;submission=null;activeJob=null;$('submitBooking').textContent='تأكيد وإرسال الحجز إلى أيكون';
        $('bookingPanel').hidden=false;
        $('selection').textContent=`${court} · ${availability.date} · ${slot.start} · ${slot.duration} دقيقة · ${slot.price} دينار`;
        $('bookingPanel').scrollIntoView({behavior:'smooth',block:'start'});$('customer').focus();
      });grid.append(button);
    }
    if(!grid.children.length){const empty=document.createElement('p');empty.className='live-empty';empty.textContent='لا توجد مواعيد متاحة لهذه المدة.';grid.append(empty)}
    $('courts').append(article);
  }
}
async function history() {
  try {
    const {jobs}=await api('/bookings');$('history').replaceChildren();
    if(!jobs.length){$('history').textContent='لا توجد طلبات حجز.';return}
    for(const job of jobs) {
      const article=document.createElement('article');
      const p=job.booking;
      const detail=document.createElement('div');detail.textContent=`${p.date} · ${p.court} · ${p.start} · ${p.customer}`;
      const result=document.createElement('strong');result.textContent=labels[job.status]+(job.result?.provider_id?' · رقم أيكون #'+job.result.provider_id:'');
      const note=document.createElement('div');note.textContent=job.result?.message||'';
      article.append(detail,result,note);$('history').append(article);
    }
  }catch(error){$('history').textContent=error.message}
}
$('queryForm').addEventListener('submit',async event=>{
  event.preventDefault();if(busy)return;
  if(submission){message('تابع الطلب الحالي أو راجع طلباتي قبل اختيار موعد جديد.',true);return}
  setBusy(true);selected=null;$('bookingPanel').hidden=true;$('courts').replaceChildren();availability=null;
  try {
    message('جاري قراءة المواعيد من موقع أيكون…');
    const date=$('bookingDate').value,duration=Number($('duration').value);
    const created=await api('/availability',{date,duration,request_key:crypto.randomUUID()});
    const job=await waitJob(created.id);
    if(job.status!=='confirmed')throw new Error(job.result?.message||'تعذر جلب المواعيد.');
    availability={id:job.id,date,duration};renderSlots(job.result.slots);
    message('هذه المواعيد متاحة وقت القراءة. يتم فحص الموعد والسعر مرة ثانية قبل تسجيل الحجز.');
  }catch(error){message(error.message,true)}finally{setBusy(false);status()}
});
$('bookingForm').addEventListener('submit',async event=>{
  event.preventDefault();if(busy||!selected||!availability)return;
  // Retain the same key through network failures; never turn a retry into a new booking.
  submission ||= {request_key:crypto.randomUUID(),availability_id:availability.id,date:availability.date,...selected,customer:$('customer').value.trim(),phone:$('phone').value.trim(),notes:$('notes').value.trim()};
  setBusy(true);message('جاري إرسال الطلب…');
  try {
    const job=activeJob?{id:activeJob}:await api('/bookings',submission);activeJob=job.id;
    const outcome=await waitJob(job.id);
    if(outcome.status==='confirmed') {
      message('تم تأكيد الحجز لدى أيكون. رقم الحجز #'+outcome.result.provider_id);
      $('bookingPanel').hidden=true;$('courts').replaceChildren();selected=null;availability=null;submission=null;activeJob=null;$('bookingForm').reset();
    }else {
      message(outcome.result?.message||labels[outcome.status],true);
      // A new request needs fresh availability; unknown outcomes must first be reconciled.
      $('bookingPanel').hidden=true;$('courts').replaceChildren();selected=null;availability=null;submission=null;activeJob=null;
    }
  }catch(error){message(error.message+' إذا انقطع الاتصال، اضغط متابعة بنفس الطلب أو حدّث طلباتي؛ لا تنشئ حجزاً جديداً.',true);$('submitBooking').textContent='متابعة بنفس الطلب'}
  finally{setBusy(false);history();status()}
});
$('cancelBooking').addEventListener('click',()=>{
  if(submission){message('يوجد طلب أُرسل أو لم تُحسم نتيجته. تابع الطلب نفسه أو راجع طلباتي.',true);return}
  $('bookingPanel').hidden=true;selected=null;
});
for(const control of [$('bookingDate'),$('duration')])control.addEventListener('change',()=>{if(submission){message('يوجد طلب لم تُحسم نتيجته. تابع الطلب نفسه أو راجع طلباتي.',true);return}availability=null;selected=null;$('courts').replaceChildren();$('bookingPanel').hidden=true});
$('refreshHistory').addEventListener('click',history);
$('bookingDate').value=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Amman',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());$('bookingDate').min=$('bookingDate').value;
status();history();setInterval(()=>{if(!document.hidden)status()},30000);

try{const user=JSON.parse(localStorage.getItem('ebookUser')||'null');$('pairDevice').hidden=String(user?.role).toLowerCase()!=='admin'}catch{}
$('pairDevice').addEventListener('click',async()=>{
  try{const result=await api('/pair-code',{});message('رمز ربط جهاز Windows (صالح 10 دقائق ولمرة واحدة):\n'+result.code+'\nأدخله في Setup.cmd على جهاز الربط. الربط يستبدل اتصال الجهاز السابق إن وجد.')}catch(error){message(error.message,true)}
});
