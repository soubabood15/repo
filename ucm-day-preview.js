import {validDaySummary} from './connector/ucm-day-summary.mjs';
const prefix='ucm/transient-days/v1/';
const validId=id=>/^transient-\d{13}-[a-f0-9-]{36}$/.test(id||'');
const key=id=>prefix+id+'.json';
const ttl=15*60000;
async function read(bucket,id){if(!validId(id))return null;const object=await bucket.get(key(id));return object?object.json():null}
async function pending(bucket){
  const listing=await bucket.list({prefix,limit:1000}),jobs=[];
  for(const object of listing.objects){
    const record=await bucket.get(object.key);if(!record)continue;const job=await record.json();
    if(job.expires_at<=Date.now()){await bucket.delete(object.key);continue}
    jobs.push(job);
  }
  return jobs;
}
export async function cleanupDayPreviews(bucket){if(bucket)await pending(bucket)}
export async function claimDayPreview(bucket){
  const jobs=await pending(bucket);
  if(jobs.some(j=>j.status==='running'&&j.lease_until>Date.now()))return {busy:true,job:null};
  const job=jobs.sort((a,b)=>a.created_at-b.created_at).find(j=>j.status==='pending'||j.status==='running'&&j.lease_until<Date.now());
  if(!job)return {busy:false,job:null};
  job.attempts=(job.attempts||0)+1;
  if(job.attempts>3){job.status='failed';await bucket.put(key(job.request_id),JSON.stringify(job));return {busy:false,job:null}}
  job.status='running';job.lease_until=Date.now()+ttl;
  await bucket.put(key(job.request_id),JSON.stringify(job));
  return {busy:true,job:{day:job.day,request_id:job.request_id,extensions:job.extensions}};
}
export async function completeDayPreview(bucket,input){
  if(!validId(input.request_id))return null;
  const job=await read(bucket,input.request_id);
  if(!job||job.day!==input.day||job.expires_at<=Date.now())return {message:'Temporary request expired',code:409};
  if(job.status==='complete')return {ok:true,duplicate:true};
  if(job.status!=='running')return {message:'Claim the request first',code:409};
  if(input.action==='failed'){job.status='failed';await bucket.put(key(job.request_id),JSON.stringify(job));return {ok:true}}
  if(input.action!=='complete'||!validDaySummary(input.summary,input.day))return {message:'Invalid day summary',code:400};
  const metric=a=>({total:a.total,answered:a.answered,talk:a.talk,wait:a.wait,talk_known:a.talk_known,wait_known:a.wait_known});
  job.status='complete';job.expires_at=Date.now()+ttl;job.result={day:job.day,as_of:input.summary.as_of,parser_version:input.summary.parser_version||1,source:'ucm_api',agents:input.summary.agents.filter(a=>job.extensions.includes(a.extension)).map(a=>({extension:a.extension,username:job.owner,full_name:job.full_name,...metric(a),queues:a.queues.map(q=>({queue:q.queue,...metric(q)})),hourly:a.hourly.map(h=>({hour:h.hour,...metric(h)}))}))};
  await bucket.put(key(job.request_id),JSON.stringify(job));return {ok:true};
}
export async function dayPreview(request,bucket,url,profile,people,day){
  if(request.method==='POST'){
    const jobs=await pending(bucket),existing=jobs.find(j=>j.owner===profile.username&&j.day===day&&['pending','running','complete'].includes(j.status));
    if(existing)return existing.status==='complete'?{status:'complete',request_id:existing.request_id,temporary:true,cached:true,expires_at:existing.expires_at,...existing.result}:{status:existing.status,request_id:existing.request_id,day};
    if(jobs.filter(j=>['pending','running'].includes(j.status)).length>=40||jobs.filter(j=>j.owner===profile.username&&['pending','running'].includes(j.status)).length>=2)return {message:'A day request is already loading. Wait for it to finish.',code:429};
    const extensions=people.mappings.filter(m=>m.username===profile.username).map(m=>m.extension);
    if(!extensions.length)return {message:'No UCM extension is linked to this employee.',code:409};
    const now=Date.now(),request_id='transient-'+now+'-'+crypto.randomUUID();
    await bucket.put(key(request_id),JSON.stringify({request_id,day,owner:profile.username,full_name:profile.full_name,extensions,status:'pending',created_at:now,expires_at:now+ttl}));
    return {status:'pending',request_id,day};
  }
  const job=await read(bucket,url.searchParams.get('request_id'));
  if(!job||job.owner!==profile.username||job.day!==day)return {message:'Request a day to view your UCM calls.',code:404};
  if(job.expires_at<=Date.now()){await bucket.delete(key(job.request_id));return {message:'Temporary request expired. Request the day again.',code:410}}
  if(job.status==='complete'){
    // Delivery never extends the fifteen-minute TTL or adds a KPI archive.
    return {status:'complete',request_id:job.request_id,temporary:true,cached:true,expires_at:job.expires_at,...job.result};
  }
  return {status:job.status,day,request_id:job.request_id,message:job.status==='failed'?'UCM could not read this day. Request it again.':'Waiting for the Windows connector.'};
}
