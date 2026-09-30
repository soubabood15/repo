const ANSWERED=new Set(["ANSWERED","ANSWER","CONNECTED"]);
const QUEUE_TYPES={login:"login",queue_login:"login",logout:"logout",queue_logout:"logout",pause:"pause",paused:"pause",unpause:"unpause",resume:"unpause",unpaused:"unpause"};
const text=value=>String(value??"").trim();
const number=value=>Number.isFinite(Number(value))?Number(value):0;

export function ammanDateKey(value=new Date()){
  const date=value instanceof Date?value:new Date(value);
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Amman",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
  const get=type=>parts.find(part=>part.type===type)?.value||"";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function normalizeCdr(input,receivedAt=new Date().toISOString()){
  const row=input?.cdr||input?.data||input||{};
  const externalId=text(row.session||row.AcctId||row.acctid||row.uniqueid||row.call_id);
  if(!externalId)throw new Error("CDR requires session, AcctId, uniqueid, or call_id");
  const startedAt=text(row.start||row.start_time||row.calldate)||receivedAt;
  const answeredAt=text(row.answer||row.answer_time)||null,endedAt=text(row.end||row.end_time)||receivedAt;
  const src=text(row.src||row.caller||row.source),dst=text(row.dst||row.callee||row.destination);
  const actionType=text(row.action_type||row.call_type||row.type).toLowerCase(),service=text(row.service||row.dcontext).toLowerCase();
  const direction=/out|outbound/.test(actionType+" "+service)?"outbound":/in|inbound|queue/.test(actionType+" "+service)?"inbound":"unknown";
  const disposition=text(row.disposition||row.status).toUpperCase();
  return {external_id:externalId,session_id:text(row.session)||externalId,unique_id:text(row.uniqueid)||null,agent_extension:text(row.action_owner||row.channel_ext||row.chanext||row.dstchannel_ext||row.dstchanext)||null,queue_name:text(row.queue||row.queue_name||row.accountcode||row.service)||null,direction,source_number:src||null,destination_number:dst||null,started_at:startedAt,answered_at:answeredAt,ended_at:endedAt,duration_seconds:number(row.duration),talk_seconds:number(row.billsec||row.talk_seconds),wait_seconds:number(row.wait_seconds||row.wait),disposition:disposition||"UNKNOWN",answered:ANSWERED.has(disposition)||number(row.billsec)>0,raw:row,received_at:receivedAt};
}

export function normalizeQueueEvent(input,receivedAt=new Date().toISOString()){
  const row=input?.event||input?.data||input||{},rawType=text(row.event_type||row.event||row.action||row.type).toLowerCase().replace(/[\s-]+/g,"_");
  const eventType=QUEUE_TYPES[rawType];if(!eventType)throw new Error(`Unsupported queue event: ${rawType||"empty"}`);
  const extension=text(row.extension||row.agent||row.agent_extension||row.member);if(!extension)throw new Error("Queue event requires agent extension");
  const occurredAt=text(row.occurred_at||row.timestamp||row.time)||receivedAt,queue=text(row.queue||row.queue_name||row.queue_extension)||null;
  const eventId=text(row.event_id||row.id)||`${extension}|${queue||"all"}|${eventType}|${occurredAt}`;
  return {event_id:eventId,agent_extension:extension,queue_name:queue,event_type:eventType,reason:text(row.reason||row.pause_reason)||null,occurred_at:occurredAt,raw:row,received_at:receivedAt};
}

export function aggregateQueueDay(events,{date,shiftStart=null,shiftEnd=null,graceMinutes=10,isOff=false,now=new Date()}={}){
  const rows=[...events].sort((a,b)=>new Date(a.occurred_at)-new Date(b.occurred_at));
  const logins=rows.filter(row=>row.event_type==="login"),logouts=rows.filter(row=>row.event_type==="logout");
  const firstLogin=logins[0]?.occurred_at||null,lastLogout=logouts.at(-1)?.occurred_at||null;
  let pauseStart=null,breakSeconds=0;
  for(const row of rows){if(row.event_type==="pause"&&!pauseStart)pauseStart=new Date(row.occurred_at);if(row.event_type==="unpause"&&pauseStart){breakSeconds+=Math.max(0,(new Date(row.occurred_at)-pauseStart)/1000);pauseStart=null}}
  let lateMinutes=0,status=isOff?"off":firstLogin?"present":"not_logged_in";
  if(firstLogin&&shiftStart&&date){const scheduled=new Date(`${date}T${shiftStart}:00+03:00`);lateMinutes=Math.max(0,Math.floor((new Date(firstLogin)-scheduled)/60000)-Number(graceMinutes||0));if(lateMinutes>0)status="late"}
  if(firstLogin&&!lastLogout){let shiftFinished=true;if(shiftEnd&&date){let end=new Date(`${date}T${shiftEnd}:00+03:00`);if(shiftStart&&shiftEnd<=shiftStart)end=new Date(end.getTime()+86400000);shiftFinished=new Date(now).getTime()>end.getTime()+Number(graceMinutes||0)*60000}status=shiftFinished?"missing_logout":status}
  const workSeconds=firstLogin&&lastLogout?Math.max(0,Math.round((new Date(lastLogout)-new Date(firstLogin))/1000)-Math.round(breakSeconds)):0;
  return {date:firstLogin?ammanDateKey(firstLogin):date,first_login:firstLogin,last_logout:lastLogout,break_seconds:Math.round(breakSeconds),work_seconds:workSeconds,late_minutes:lateMinutes,status,event_count:rows.length};
}
