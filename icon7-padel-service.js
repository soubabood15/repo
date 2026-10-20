const ROOT='/functions/v1/icon7-padel';
const CONNECTOR='/integrations/icon7-padel';
const uuid=()=>crypto.randomUUID();
const parse=value=>JSON.parse(value||'null');
export function ammanDay(now=Date.now()) {
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Amman',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
}
export function validPadelQuery(body,now=Date.now()) {
  const date=String(body?.date||''),duration=Number(body?.duration);
  const timestamp=Date.parse(date+'T12:00:00Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(timestamp)||new Date(timestamp).toISOString().slice(0,10)!==date||date<ammanDay(now)||date>ammanDay(now+180*86400000)||![60,90,120].includes(duration))throw new Error('اختر تاريخاً خلال الستة أشهر القادمة ومدة صحيحة.');
  return {date,duration};
}
export function cleanSlots(slots,duration) {
  if(!Array.isArray(slots)||slots.length>500)throw new Error('Invalid provider schedule');
  const seen=new Set();
  return slots.map(slot=>{
    const court=String(slot.court||''),start=String(slot.start||''),price=Number(slot.price);
    const key=court+'|'+start;
    if(!/^Court [ABC]$/.test(court)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(start)||!Number.isFinite(price)||price<0||price>10000||Number(slot.duration)!==duration||seen.has(key))throw new Error('Invalid provider slot');
    seen.add(key);return {court,start,price,duration};
  });
}
export function publicPadelJob(row,now=Date.now()) {
  let status=row.status;
  // Once claimed, a booking is never automatically reclaimed or resubmitted.
  if(['processing','submitting'].includes(status)&&now-row.updated_at>180000)status='unknown';
  if(status==='queued'&&row.expires_at<=now)status='failed';
  return {id:row.id,kind:row.kind,status,created_at:row.created_at,updated_at:row.updated_at,result:parse(row.result)};
}
async function fingerprint(value) {return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('')}
async function secureEquals(a,b) {
  const encoder=new TextEncoder(),hash=async v=>new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(v)));
  const [left,right]=await Promise.all([hash(a),hash(b)]);let diff=0;for(let i=0;i<left.length;i++)diff|=left[i]^right[i];return diff===0;
}
export function createPadelHandler({json,authenticate}) {
  return async function handle(request,env,url=new URL(request.url)) {
    const db=env.trainer_kb,now=Date.now(),origin=request.headers.get('Origin')||'*';
    const send=(data,status=200)=>json(data,status,{'Cache-Control':'no-store'},origin);
    const allowed=async profile=>profile&&String(profile.role).toLowerCase()==='admin'||Boolean(profile&&await db.prepare("SELECT 1 ok FROM ebook_permissions WHERE agent_name=? AND lower(project_id)='icon7' AND is_allowed=1 AND (expires_at IS NULL OR expires_at='' OR expires_at>=?) LIMIT 1").bind(profile.username,ammanDay(now)).first());
    const readBody=async()=>{const raw=await request.text();if(raw.length>180000)throw new Error('Request too large');return JSON.parse(raw)};
    if(url.pathname.startsWith(CONNECTOR+'/')) {
      if(url.pathname===CONNECTOR+'/pair'&&request.method==='POST') {
        let body;try{body=await readBody()}catch{return send({message:'Invalid pairing request'},400)}
        if(!/^[a-f0-9]{32}$/.test(String(body.code))||typeof body.secret!=='string'||body.secret.length<32||body.secret.length>128)return send({message:'Invalid pairing code'},400);
        const paired=await db.prepare('UPDATE icon7_padel_pairing SET secret_hash=?,pairing_hash=NULL,pairing_expires=NULL WHERE id=1 AND pairing_hash=? AND pairing_expires>? RETURNING id').bind(await fingerprint(body.secret),await fingerprint(body.code),now).first();
        return send({ok:Boolean(paired)},paired?200:403);
      }
      const supplied=(request.headers.get('Authorization')||'').replace(/^Bearer /,'');
      const paired=await db.prepare('SELECT secret_hash FROM icon7_padel_pairing WHERE id=1').first();
      const validSecret=supplied&&((env.ICON7_CONNECTOR_SECRET?.length>=32&&await secureEquals(supplied,env.ICON7_CONNECTOR_SECRET))||(paired?.secret_hash&&await secureEquals(await fingerprint(supplied),paired.secret_hash)));
      if(!validSecret)return send({message:'Connector authentication required'},401);
      if(request.method!=='POST')return send({message:'Method not allowed'},405);
      let body;try{body=await readBody()}catch{return send({message:'Invalid request'},400)}
      if(url.pathname===CONNECTOR+'/poll') {
        await db.prepare('INSERT INTO icon7_padel_connector(id,seen_at,ready) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET seen_at=excluded.seen_at,ready=excluded.ready').bind(now,body.ready===true?1:0).run();
        if(body.ready!==true)return send({job:null});
        await db.prepare("UPDATE icon7_padel_jobs SET status='failed',result=?,updated_at=? WHERE status='queued' AND expires_at<=?").bind(JSON.stringify({message:'انتهت مهلة الطلب قبل تنفيذه.'}),now,now).run();
        // A single connector may execute at a time. A stuck claim needs manual review.
        const active=await db.prepare("SELECT id FROM icon7_padel_jobs WHERE status IN ('processing','submitting') AND updated_at>? LIMIT 1").bind(now-180000).first();
        if(active)return send({job:null});
        const token=uuid();
        const row=await db.prepare("UPDATE icon7_padel_jobs SET status='processing',claim_token=?,updated_at=? WHERE id=(SELECT id FROM icon7_padel_jobs WHERE status='queued' AND expires_at>? ORDER BY created_at LIMIT 1) AND status='queued' AND NOT EXISTS(SELECT 1 FROM icon7_padel_jobs WHERE status IN ('processing','submitting') AND updated_at>?) RETURNING *").bind(token,now,now,now-180000).first();
        return send({job:row?{id:row.id,kind:row.kind,username:row.username,payload:parse(row.payload),claim_token:token,expires_at:row.expires_at}:null});
      }
      if(!/^[\w-]{36}$/.test(String(body.id))||typeof body.claim_token!=='string')return send({message:'Invalid claim'},400);
      const row=await db.prepare('SELECT * FROM icon7_padel_jobs WHERE id=? AND claim_token=?').bind(body.id,body.claim_token).first();
      if(!row)return send({message:'Claim not found'},404);
      if(url.pathname===CONNECTOR+'/begin') {
        const profile=await db.prepare('SELECT username,role FROM trainer_users WHERE username=? AND active=1').bind(row.username).first();
        if(row.kind!=='booking'||row.status!=='processing'||row.expires_at<=now||!await allowed(profile))return send({message:'Booking expired or access revoked'},409);
        const changed=await db.prepare("UPDATE icon7_padel_jobs SET status='submitting',updated_at=? WHERE id=? AND status='processing' RETURNING id").bind(now,row.id).first();
        return send({ok:Boolean(changed)},changed?200:409);
      }
      if(url.pathname===CONNECTOR+'/result') {
        if(!['confirmed','failed','unknown'].includes(body.status))return send({message:'Invalid outcome'},400);
        if(!['processing','submitting'].includes(row.status))return send({ok:row.status===body.status},row.status===body.status?200:409);
        let result;
        if(body.status==='confirmed'&&row.kind==='availability') {
          try{result={slots:cleanSlots(body.result?.slots,parse(row.payload).duration),observed_at:now}}catch{return send({message:'Invalid schedule'},400)}
        }else if(body.status==='confirmed') {
          if(row.status!=='submitting'||!/^\d{1,12}$/.test(String(body.result?.provider_id||'')))return send({message:'Verified provider booking ID required'},400);
          result={provider_id:String(body.result.provider_id),message:'تم التحقق من تسجيل الحجز لدى أيكون.'};
        }else result={message:String(body.result?.message||'تعذر التحقق من نتيجة الحجز. راجع أيكون قبل إعادة المحاولة.').slice(0,300)};
        await db.prepare('UPDATE icon7_padel_jobs SET status=?,result=?,updated_at=? WHERE id=? AND status IN (\'processing\',\'submitting\')').bind(body.status,JSON.stringify(result),now,row.id).run();
        return send({ok:true});
      }
      return send({message:'Not found'},404);
    }
    const auth=await authenticate(request,env),profile=auth?.profile;
    if(!profile)return send({message:'سجّل دخولك من بوابة eBook.'},401);
    if(!await allowed(profile))return send({message:'لا تملك صلاحية ICON7.'},403);
    if(request.method==='POST'&&url.pathname===ROOT+'/pair-code') {
      if(String(profile.role).toLowerCase()!=='admin')return send({message:'صلاحية مدير النظام مطلوبة لربط الجهاز.'},403);
      const code=uuid().replaceAll('-',''),expires=now+10*60000;
      await db.prepare('INSERT INTO icon7_padel_pairing(id,pairing_hash,pairing_expires) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET pairing_hash=excluded.pairing_hash,pairing_expires=excluded.pairing_expires').bind(await fingerprint(code),expires).run();
      return send({code,expires_at:expires});
    }
    if(request.method==='GET'&&url.pathname===ROOT+'/status') {
      const state=await db.prepare('SELECT * FROM icon7_padel_connector WHERE id=1').first();
      return send({online:Boolean(state&&now-state.seen_at<45000),ready:Boolean(state?.ready&&now-state.seen_at<45000)});
    }
    if(request.method==='GET'&&url.pathname===ROOT+'/bookings') {
      const rows=await db.prepare("SELECT * FROM icon7_padel_jobs WHERE username=? AND kind='booking' ORDER BY created_at DESC LIMIT 20").bind(profile.username).all();
      return send({jobs:(rows.results||[]).map(row=>({...publicPadelJob(row,now),booking:parse(row.payload)}))});
    }
    const match=url.pathname.match(/^\/functions\/v1\/icon7-padel\/jobs\/([\w-]{36})$/);
    if(match&&request.method==='GET') {
      const row=await db.prepare('SELECT * FROM icon7_padel_jobs WHERE id=? AND username=?').bind(match[1],profile.username).first();
      return row?send(publicPadelJob(row,now)):send({message:'الطلب غير موجود.'},404);
    }
    if(request.method!=='POST'||![ROOT+'/availability',ROOT+'/bookings'].includes(url.pathname))return send({message:'Not found'},404);
    let body;try{body=await readBody()}catch{return send({message:'Invalid request'},400)}
    const key=String(body.request_key||'');if(!/^[\w-]{16,80}$/.test(key))return send({message:'مفتاح الطلب مطلوب.'},400);
    const prior=await db.prepare('SELECT * FROM icon7_padel_jobs WHERE username=? AND request_key=?').bind(profile.username,key).first();
    if(prior)return send(publicPadelJob(prior,now));
    const state=await db.prepare('SELECT * FROM icon7_padel_connector WHERE id=1').first();
    if(!state?.ready||now-state.seen_at>=45000)return send({message:'جهاز الربط غير جاهز. تأكد من تشغيله وتسجيل الدخول إلى أيكون.'},503);
    const backlog=await db.prepare("SELECT count(*) n FROM icon7_padel_jobs WHERE status IN ('queued','processing','submitting') AND updated_at>?").bind(now-180000).first();
    if(backlog.n>=12)return send({message:'الربط مشغول حالياً. حاول بعد قليل.'},429);
    let payload,kind=url.pathname.endsWith('/availability')?'availability':'booking';
    try {
      payload=validPadelQuery(body,now);
      if(kind==='booking') {
        const snapshot=await db.prepare("SELECT * FROM icon7_padel_jobs WHERE id=? AND username=? AND kind='availability' AND status='confirmed'").bind(String(body.availability_id||''),profile.username).first();
        if(!snapshot||now-snapshot.updated_at>120000)throw new Error('حدّث المواعيد قبل الحجز.');
        const query=parse(snapshot.payload),slot=parse(snapshot.result).slots.find(s=>s.court===body.court&&s.start===body.start);
        if(query.date!==payload.date||query.duration!==payload.duration||!slot||Number(body.price)!==slot.price)throw new Error('الموعد أو السعر تغيّر. حدّث المواعيد.');
        const customer=String(body.customer||'').trim(),phone=String(body.phone||'').trim(),notes=String(body.notes||'').trim();
        if(customer.length<2||customer.length>100||!/^\+?[\d ()-]{7,24}$/.test(phone)||notes.length>400)throw new Error('راجع اسم العميل ورقم الهاتف والملاحظات.');
        payload={...payload,...slot,customer,phone,notes,agent:profile.username};
        const duplicate=await db.prepare("SELECT id FROM icon7_padel_jobs WHERE kind='booking' AND status IN ('queued','processing','submitting','confirmed','unknown') AND json_extract(payload,'$.date')=? AND json_extract(payload,'$.court')=? AND json_extract(payload,'$.start')=? LIMIT 1").bind(payload.date,payload.court,payload.start).first();
        if(duplicate)throw new Error('يوجد طلب حجز لهذا الموعد. راجع حالة الطلب قبل إعادة الحجز.');
      }
    }catch(error){return send({message:error.message},400)}
    const id=uuid();
    // INSERT OR IGNORE ensures parallel retries sharing the same key return one job.
    await db.prepare("INSERT OR IGNORE INTO icon7_padel_jobs(id,username,kind,request_key,payload,status,created_at,expires_at,updated_at) VALUES(?,?,?,?,?,'queued',?,?,?)").bind(id,profile.username,kind,key,JSON.stringify(payload),now,now+120000,now).run();
    const saved=await db.prepare('SELECT * FROM icon7_padel_jobs WHERE username=? AND request_key=?').bind(profile.username,key).first();
    if(!saved)return send({message:'يوجد طلب حجز لهذا الموعد. راجع طلباتي قبل إعادة المحاولة.'},409);
    return send(publicPadelJob(saved,now),202);
  };
}
