// UI-only integration. Requests to ICON7 are made by their own page, never replayed.
export const PROVIDER_URL='https://booking.icon7.net/available-times';
export function clock24(value) {
  const match=String(value).match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
  if(!match)throw new Error('Unrecognized provider time');
  let hour=Number(match[1]);const minute=Number(match[2]),period=match[3]?.toUpperCase();
  if(minute>59||hour>(period?12:23)||period&&hour<1)throw new Error('Invalid provider time');
  if(period)hour=hour%12+(period==='PM'?12:0);
  return `${String(hour).padStart(2,'0')}:${match[2]}`;
}
export function parseAvailableTitle(title,court,duration) {
  const match=String(title).match(/^Available!\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*-\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)\s*\((\d+) minutes\)\s*Price:\s*([\d.]+)\s*JOD/i);
  if(!match||Number(match[3])!==duration||!/^Court [ABC]$/.test(court))return null;
  const price=Number(match[4]);if(!Number.isFinite(price)||price<0)return null;
  return {court,start:clock24(match[1].trim()),price,duration};
}
export function detailsMatch(text,job) {
  const p=job.payload,compact=String(text).replace(/\s+/g,' ');
  const escape=value=>String(value).replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  const endMinutes=(Number(p.start.slice(0,2))*60+Number(p.start.slice(3))+p.duration)%1440;
  const end=`${String(Math.floor(endMinutes/60)).padStart(2,'0')}:${String(endMinutes%60).padStart(2,'0')}`;
  const name=new RegExp(`Name:\\s*${escape(p.customer)}\\s+(?:Phone:|Court Information)`);
  const phone=new RegExp(`Phone:\\s*${escape(p.phone)}(?:\\s|$)`);
  const court=new RegExp(`Court:\\s*${escape(p.court)}(?:\\s|$)`);
  const time=new RegExp(`Time:\\s*${p.start}(?::00)?\\s*-\\s*${end}(?::00)?(?:\\s|$)`);
  const price=compact.match(/Final Price:\s*([\d.]+)\s*JOD/),id=compact.match(/Booking ID:\s*#(\d+)/);
  return name.test(compact)&&phone.test(compact)&&court.test(compact)&&time.test(compact)&&price&&Math.abs(Number(price[1])-p.price)<0.001&&id?{provider_id:id[1]}:null;
}
export function durationMinutes(label) {
  const hours=String(label).match(/(\d+(?:\.\d+)?)\s*Hours?/i),minutes=String(label).match(/(\d+)\s*Min(?:ute)?s?/i);
  return hours||minutes?Number(hours?.[1]||0)*60+Number(minutes?.[1]||0):NaN;
}
export class Icon7Provider {
  constructor(page) {this.page=page;page.setDefaultTimeout(15000);page.setDefaultNavigationTimeout(30000)}
  async ready() {
    if(!this.page.url().startsWith(PROVIDER_URL))return false;
    try{await this.page.getByRole('heading',{name:/Available Times/}).waitFor({timeout:5000});await this.page.getByRole('table').waitFor({timeout:15000});return true}catch{return false}
  }
  async load(query) {
    await this.page.goto(PROVIDER_URL,{waitUntil:'domcontentloaded'});
    if(!await this.ready())throw new Error('سجّل الدخول إلى أيكون على جهاز الربط.');
    await this.page.getByLabel('Date',{exact:true}).fill(query.date);
    // Select values are derived from the actual labelled controls, not assumed IDs.
    const duration=this.page.getByLabel('Duration',{exact:true});
    const options=(await duration.locator('option').allTextContents()).map(s=>s.trim());
    const label=options.find(label=>durationMinutes(label)===query.duration);
    if(!label)throw new Error('المدة المطلوبة غير متاحة في موقع أيكون.');
    await duration.selectOption({label});
    await this.page.getByLabel('Court Filter',{exact:true}).selectOption({label:'All Courts'});
    await this.page.getByLabel('Show',{exact:true}).selectOption({label:'All Times'});
    // Await the page's own refresh response. No direct requests are sent by the connector.
    const loaded=this.page.waitForResponse(response=>{
      const url=new URL(response.url());
      return url.origin===new URL(PROVIDER_URL).origin&&url.pathname==='/api/available-times'&&url.searchParams.get('date')===query.date&&Number(url.searchParams.get('duration'))===query.duration&&response.ok();
    },{timeout:25000});
    loaded.catch(()=>{});
    await this.page.getByRole('button',{name:/Refresh/}).first().click();
    await loaded;
    await this.page.locator('#loadingOverlay').waitFor({state:'hidden'});
    // response delivery precedes rendering; wait for the selected schedule heading.
    await this.page.getByRole('heading',{name:new RegExp(`Dynamic Booking Schedule.*${query.date}.*${query.duration} minutes`)}).waitFor();
    await this.page.getByRole('table').waitFor();
  }
  async slots(query) {
    await this.load(query);
    const result=[];
    for(const row of await this.page.getByRole('table').getByRole('row').all()) {
      const cells=row.getByRole('cell');if(await cells.count()<3)continue;
      const court=(await cells.first().innerText()).trim();
      if(!/^Court [ABC]$/.test(court))continue;
      for(const cell of await cells.all()) {
        const title=await cell.getAttribute('title')||await cell.getAttribute('data-bs-original-title')||'';
        const slot=parseAvailableTitle(title,court,query.duration);
        if(slot)result.push(slot);
      }
    }
    // Fail closed if the UI changed, rather than silently presenting an empty schedule.
    const body=await this.page.getByRole('table').innerText();
    if(!result.length&&body.includes('✓'))throw new Error('تغيّر شكل جدول أيكون. يلزم تحديث برنامج الربط.');
    return {slots:result};
  }
  async findCell(payload,reserved=false) {
    const row=this.page.getByRole('table').getByRole('row').filter({has:this.page.getByRole('cell',{name:payload.court,exact:true})});
    if(await row.count()!==1)throw new Error('تعذر تحديد الملعب.');
    const candidates=[];
    for(const cell of await row.getByRole('cell').all()) {
      const title=await cell.getAttribute('title')||await cell.getAttribute('data-bs-original-title')||'';
      if(!reserved) {
        const slot=parseAvailableTitle(title,payload.court,payload.duration);
        if(slot&&slot.start===payload.start)candidates.push(cell);
      }else {
        const match=title.match(/^Reserved!\s*(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i);
        if(match&&clock24(match[1].trim())===payload.start)candidates.push(cell);
      }
    }
    if(candidates.length!==1)throw new Error('الموعد لم يعد متاحاً أو تعذر التحقق منه.');
    return candidates[0];
  }
  async book(job,{beforeSubmit,maySubmit}) {
    const p=job.payload;
    const current=await this.slots(p);
    const live=current.slots.find(s=>s.court===p.court&&s.start===p.start);
    if(!live||Math.abs(live.price-p.price)>0.001)throw new Error('الموعد أو السعر تغيّر. حدّث المواعيد.');
    await (await this.findCell(p)).click();
    await this.page.getByRole('heading',{name:/Book Court Reservation/}).waitFor();
    const start=this.page.getByLabel(/Start Time/);
    if((await start.inputValue()).slice(0,5)!==p.start)throw new Error('وقت النموذج لا يطابق الطلب.');
    const summary=await this.page.locator('#courtBookingModal').innerText();
    const total=Number(summary.match(/Total:\s*([\d.]+)/)?.[1]);
    if(!Number.isFinite(total)||Math.abs(total-p.price)>0.001)throw new Error('السعر تغيّر في نموذج الحجز.');
    await this.page.getByLabel(/Customer Name/).fill(p.customer);
    await this.page.getByLabel(/Phone Number/).fill(p.phone);
    await this.page.getByLabel(/Discount \(JOD\)/).fill('0');
    await this.page.getByLabel(/Notes \(Optional\)/).fill(`${p.notes}\nNEWTEL ${p.agent} | ${job.id}`.trim());
    if(!maySubmit)throw new Error('التشغيل التجريبي: لم يتم إرسال الحجز.');
    // This callback journals the attempt and obtains one-use server permission.
    await beforeSubmit();
    const responsePromise=this.page.waitForResponse(response=>{
      const url=new URL(response.url());return url.origin==='https://booking.icon7.net'&&url.pathname==='/court-bookings'&&response.request().method()==='POST';
    },{timeout:30000});
    responsePromise.catch(()=>{});
    await this.page.getByRole('button',{name:/Confirm Booking/}).click();
    const response=await responsePromise;
    const acknowledgment=await response.json();
    if(!response.ok()||acknowledgment.success!==true)throw new Error('لم يصل تأكيد موثوق من أيكون. راجع الحجز قبل إعادة المحاولة.');
    await this.load(p);
    await (await this.findCell(p,true)).click();
    await this.page.getByRole('heading',{name:/Reserved Booking Details/}).waitFor();
    // The observed details UI may be a dynamically created container, not role=dialog.
    const text=await this.page.locator('#bookingDetailsModal').innerText();
    const verified=detailsMatch(text,job);
    const reported=acknowledgment.booking?.id??acknowledgment.data?.id??acknowledgment.booking_id;
    if(reported&&verified&&String(reported)!==verified.provider_id)throw new Error('رقم تأكيد أيكون لا يطابق تفاصيل الحجز.');
    if(!verified)throw new Error('تم الإرسال لكن تعذر التحقق من تفاصيل الحجز. راجع أيكون قبل إعادة المحاولة.');
    return verified;
  }
}
