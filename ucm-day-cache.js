import {authorizeUcmIngest} from './ucm-ingest-auth.js';
import {loadUcmMappings} from './ucm-mapping.js';
import {hrAllowed,hrPermissions} from './hr-permissions.js';
import {ammanDateKey} from './ucm-core.js';
import {validDaySummary} from './connector/ucm-day-summary.mjs';
const objectKey=day=>'ucm/day-summaries/v1/'+day+'.json';
const memory=new WeakMap();
const validDay=day=>/^\d{4}-\d{2}-\d{2}$/.test(day)&&Number.isFinite(Date.parse(day+'T12:00:00Z'))&&new Date(day+'T12:00:00Z').toISOString().slice(0,10)===day;
export function createUcmDayHandler({json,authenticate}){
  return async function handler(request,env,url){
    const origin=request.headers.get('Origin')||'*',db=env.trainer_kb,bucket=env.trainer_kb_files;
    const respond=(data,status=200)=>json(data,status,{'Cache-Control':'private, no-store'},origin);
    const connector=url.pathname==='/integrations/ucm/day-jobs';
    if(connector){
      const body=await request.text();if(body.length>512000)return respond({message:'Summary too large'},413);
      const auth=await authorizeUcmIngest(request,env,body,'queue',Date.now(),{claimNonce:false});if(!auth.ok)return respond({message:'Connector authentication required'},auth.status);
      let input;try{input=JSON.parse(body)}catch{return respond({message:'Invalid JSON'},400)}
      const now=new Date().toISOString();
      if(input.action==='claim'){
        // Exactly one global job is leased atomically. A stale signed claim can
        // never steal a current lease; replays cannot cause repeated call reads.
        await db.prepare("UPDATE ucm_day_jobs SET status='failed',error_code='UCM_DAY_READ_FAILED' WHERE status='running' AND lease_until<? AND attempts>=3").bind(now).run();
        const job=await db.prepare("UPDATE ucm_day_jobs SET status='running',lease_until=?,updated_at=?,attempts=attempts+1 WHERE day=(SELECT day FROM ucm_day_jobs WHERE attempts<3 AND (status='pending' OR (status='running' AND lease_until<?)) AND NOT EXISTS(SELECT 1 FROM ucm_day_jobs WHERE status='running' AND lease_until>=?) ORDER BY requested_at LIMIT 1) RETURNING day,request_id").bind(new Date(Date.now()+15*60000).toISOString(),now,now,now).first();
        return respond({job:job||null});
      }
      if(!validDay(input.day)||typeof input.request_id!=='string')return respond({message:'Invalid day job'},400);
      const job=await db.prepare('SELECT * FROM ucm_day_jobs WHERE day=?').bind(input.day).first();
      if(!job||job.request_id!==input.request_id)return respond({message:'Job superseded'},409);
      if(job.status==='complete')return respond({ok:true,duplicate:true});
      if(job.status!=='running')return respond({message:'Claim the job first'},409);
      if(input.action==='complete'){
        if(!validDaySummary(input.summary,input.day))return respond({message:'Invalid day summary'},400);
        const canonical={version:1,source:'ucm_api',day:input.day,as_of:input.summary.as_of,records:input.summary.records,agents:input.summary.agents.map(a=>({extension:a.extension,total:a.total,answered:a.answered,talk:a.talk,wait:a.wait,talk_known:a.talk_known,wait_known:a.wait_known,queues:a.queues.map(q=>({queue:q.queue,total:q.total,answered:q.answered,talk:q.talk,wait:q.wait,talk_known:q.talk_known,wait_known:q.wait_known})),hourly:a.hourly.map(h=>({hour:h.hour,total:h.total,answered:h.answered,talk:h.talk,wait:h.wait,talk_known:h.talk_known,wait_known:h.wait_known}))}))};
        await bucket.put(objectKey(input.day),JSON.stringify(canonical),{httpMetadata:{contentType:'application/json'}});
        memory.get(bucket)?.delete(input.day);
        await db.prepare("UPDATE ucm_day_jobs SET status='complete',lease_until=NULL,updated_at=?,error_code=NULL WHERE day=? AND request_id=? AND status='running'").bind(now,input.day,input.request_id).run();
        return respond({ok:true});
      }
      if(input.action==='failed'){
        await db.prepare("UPDATE ucm_day_jobs SET status='failed',lease_until=NULL,updated_at=?,error_code=? WHERE day=? AND request_id=? AND status='running'").bind(now,'UCM_DAY_READ_FAILED',input.day,input.request_id).run();return respond({ok:true});
      }
      return respond({message:'Invalid job action'},400);
    }
    const identity=await authenticate(request,env);if(!identity)return respond({message:'Active login required'},401);
    const profile=identity.profile,permissions=await hrPermissions(db,profile),team=profile.role==='admin'||['hr','hr_admin'].includes(profile.role)&&hrAllowed(permissions,'performance');
    if(!team&&!['agent','quality','trainer'].includes(profile.role))return respond({message:'Performance access required'},403);
    const day=url.searchParams.get('day')||ammanDateKey(),today=ammanDateKey();
    if(!validDay(day)||day>today||day<new Date(Date.now()-2*366*86400000).toISOString().slice(0,10))return respond({message:'Choose today or a day in the last two years'},400);
    let entries=memory.get(bucket);if(!entries){entries=new Map();memory.set(bucket,entries)}
    let entry=entries.get(day);if(!entry||Date.now()-entry.at>30000){const object=await bucket.get(objectKey(day));entry={at:Date.now(),value:object?await object.json():null};entries.set(day,entry);if(entries.size>70)entries.delete(entries.keys().next().value)}
    const summary=entry.value,refresh=day===today&&request.method==='POST';
    // Yesterday is final only after its overnight calls have had time to end.
    const end=Date.parse(day+'T00:00:00+03:00')+36*3600000;
    const usable=summary&&(!refresh&&day===today||day<today&&Date.parse(summary.as_of)>=end||Date.now()-Date.parse(summary.as_of)<300000);
    const liveJob=day===today&&summary?await db.prepare('SELECT status,requested_at FROM ucm_day_jobs WHERE day=?').bind(day).first():null;
    if(usable&&!(liveJob&&liveJob.requested_at>summary.as_of)){
      const people=await loadUcmMappings(db),byExtension=new Map(people.mappings.map(m=>[m.extension,m.username]));
      return respond({status:'complete',day,as_of:summary.as_of,source:'ucm_api',cached:true,final:day<today&&Date.parse(summary.as_of)>=end,records:team?summary.records:undefined,agents:summary.agents.map(a=>({...a,username:byExtension.get(a.extension)||null,full_name:people.employees.find(p=>p.username===byExtension.get(a.extension))?.full_name||a.extension})).filter(a=>team||a.username===profile.username)});
    }
    if(request.method==='POST'){
      const id=crypto.randomUUID(),now=new Date().toISOString();
      const accepted=await db.prepare("INSERT INTO ucm_day_jobs(day,request_id,status,requested_at,updated_at) SELECT ?,?,'pending',?,? WHERE (SELECT COUNT(*) FROM ucm_day_jobs WHERE status IN ('pending','running'))<40 ON CONFLICT(day) DO UPDATE SET request_id=excluded.request_id,status='pending',requested_at=excluded.requested_at,updated_at=excluded.updated_at,attempts=0,error_code=NULL WHERE ucm_day_jobs.status IN ('complete','failed') AND ucm_day_jobs.updated_at<? RETURNING day").bind(day,id,now,now,new Date(Date.now()-5*60000).toISOString()).first();
      if(!accepted){const existing=await db.prepare('SELECT day FROM ucm_day_jobs WHERE day=?').bind(day).first();if(!existing)return respond({message:'Import queue is full. Try again later.'},429)}
    }
    const job=await db.prepare('SELECT status,updated_at,error_code FROM ucm_day_jobs WHERE day=?').bind(day).first();
    return respond({day,status:job?.status==='complete'?'pending':job?.status||'missing',updated_at:job?.updated_at||null,message:job?.status==='failed'?'The UCM day read failed. Retry after five minutes.':'Waiting for the Windows connector. No duplicate day import is created.'},202);
  };
}
