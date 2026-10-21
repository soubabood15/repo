import {cdrEmployeeExtensions} from './ucm-day-summary.mjs';
const time=value=>{const text=String(value||'');if(!text||text==='--')return null;const date=new Date(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(text)?text.replace(' ','T')+'+03:00':text);return Number.isFinite(date.getTime())?date.toISOString():null};
const seconds=value=>{if(typeof value==='string'&&/^\d+:\d{2}:\d{2}$/.test(value)){const [h,m,s]=value.split(':').map(Number);return h*3600+m*60+s}return Math.max(0,Number(value)||0)};
export function createQualityCalls(day,extensions){
 const calls=new Map();return {add(rows){for(const raw of rows){
  const started=time(raw.start||raw.start_time||raw.calldate);if(!started||new Date(Date.parse(started)+10800000).toISOString().slice(0,10)!==day)continue;
  const talk=seconds(raw.billsec??raw.talk_seconds);if(!/^(ANSWERED|ANSWER|CONNECTED)$/i.test(String(raw.disposition||raw.status||''))&&talk<=0)continue;
  const extension=cdrEmployeeExtensions(raw,extensions)[0];if(!extension)continue;
  const session=String(raw.session||raw.call_id||raw.cdr||raw.uniqueid||''),leg=raw.AcctId||raw.acctid||raw.uniqueid;if(!session)continue;
  const external=leg?JSON.stringify([session,String(leg)]):session;
  calls.set(external,{external_id:external,session_id:session,agent_extension:extension,queue_name:String(raw.queue||raw.queue_name||raw.service||'').slice(0,100),started_at:started,answered_at:time(raw.answer||raw.answer_time),ended_at:time(raw.end||raw.end_time)||new Date(Date.parse(started)+talk*1000).toISOString(),talk_seconds:talk,wait_seconds:seconds(raw.wait_seconds??raw.wait)});
  if(calls.size>5000)throw Error('QUALITY_CALL_LIMIT');
 }},finish:()=>[...calls.values()]};
}
