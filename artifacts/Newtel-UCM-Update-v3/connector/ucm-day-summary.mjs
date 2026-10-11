const n=value=>{if(typeof value==='string'&&/^\d+:\d{2}:\d{2}$/.test(value)){const [h,m,s]=value.split(':').map(Number);return h*3600+m*60+s}return Math.max(0,Number(value)||0)};
const utc=value=>new Date(/^[\d-]{10}[ T]\d{2}:\d{2}:\d{2}$/.test(String(value))?String(value).replace(' ','T')+'+03:00':value).toISOString();
const empty=key=>({key,total:0,answered:0,talk:0,wait:0,talk_known:true,wait_known:true,queues:{},hourly:{}});
const categories=()=>({inbound:0,outbound:0,internal:0,unknown:0,queue:0});
export function cdrCallCategory(raw){
  const label=String(raw.call_type||raw.calltype||raw.direction||raw.userfield||'').trim().toLowerCase(),context=String(raw.dcontext||raw.context||'').toLowerCase();
  const trunk=v=>!!String(v??'').trim()&&!/^(?:-+|none|unknown)$/i.test(String(v).trim());
  const source=trunk(raw.src_trunk_name||raw.source_trunk_name),destination=trunk(raw.dst_trunk_name||raw.dest_trunk_name);
  let direction='unknown';
  if(/^(?:inbound|incoming)$/.test(label))direction='inbound';
  else if(/^(?:outbound|outgoing)$/.test(label))direction='outbound';
  else if(label==='internal'||context.startsWith('ext-local'))direction='internal';
  else if(source&&!destination||context.startsWith('ext-did'))direction='inbound';
  else if(destination&&!source)direction='outbound';
  // from-internal alone is not sufficient: internal extension calls also use it.
  const queue=/^queue$/i.test(String(raw.action_type||''))||/^queue$/i.test(String(raw.lastapp||''))||trunk(raw.queue||raw.queue_name||raw.queue_route);
  return {direction,queue};
}
export function cdrEmployeeExtensions(raw,extensions){
  const allowed=extensions instanceof Set?extensions:Array.isArray(extensions)?new Set(extensions.map(String)):null;
  const candidates=[raw.action_owner,raw.channel_ext,raw.chanext,raw.dstchannel_ext,raw.dstchanext,raw.dstanswer];
  for(const channel of [raw.channel,raw.dstchannel]){const match=String(channel||'').match(/^(?:PJSIP|SIP)\/(\d{2,10})(?:-|\/|$)/i);if(match)candidates.push(match[1])}
  // Never infer an employee from an external caller number or queue destination.
  if(allowed){candidates.push(raw.src,raw.dst)}
  return [...new Set(candidates.map(v=>String(v??'').trim()).filter(v=>/^\d{2,10}$/.test(v)&&(!allowed||allowed.has(v))))];
}
export function createDaySummary(day,{extensions}={}){
  const agents=new Map(),seen=new Set(),allowed=Array.isArray(extensions)?new Set(extensions.map(String)):null;let records=0;
  return {
    add(rows){for(const raw of rows){
      const start=utc(raw.start||raw.start_time||raw.calldate),date=new Date(Date.parse(start)+10800000).toISOString();if(date.slice(0,10)!==day)continue;
      const session=raw.session||raw.call_id||raw.cdr,leg=raw.AcctId||raw.acctid||raw.uniqueid;
      const id=JSON.stringify([session||leg,leg||[start,raw.channel,raw.dstchannel,raw.src,raw.dst,raw.action_owner]]);if(!session&&!leg)throw Error('CDR_ID_MISSING');if(seen.has(id))continue;seen.add(id);records++;
      const category=cdrCallCategory(raw);
      for(const extension of cdrEmployeeExtensions(raw,allowed)){
      const a=agents.get(extension)||empty(extension),talk=n(raw.billsec??raw.talk_seconds),wait=n(raw.wait_seconds??raw.wait),answered=/^(ANSWERED|ANSWER|CONNECTED)$/i.test(String(raw.disposition||raw.status))||talk>0,queue=String(raw.queue||raw.queue_name||raw.service||'Unknown').slice(0,80),hour=date.slice(11,13);
      a.categories??=categories();a.categories[category.direction]++;if(category.queue)a.categories.queue++;
      for(const metric of [a,a.queues[queue]??=(empty(queue)),a.hourly[hour]??=(empty(hour))]){metric.total++;metric.answered+=answered?1:0;metric.talk+=talk;metric.wait+=wait;metric.talk_known&&=raw.billsec!=null||raw.talk_seconds!=null;metric.wait_known&&=raw.wait_seconds!=null||raw.wait!=null}
      agents.set(extension,a);
      }
    }},
    finish(asOf=new Date().toISOString()){const metric=a=>({total:a.total,answered:a.answered,talk:a.talk,wait:a.wait,talk_known:a.talk_known,wait_known:a.wait_known});return {version:1,parser_version:3,source:'ucm_api',day,as_of:asOf,records,agents:[...agents].map(([extension,a])=>({extension,...metric(a),categories:a.categories,queues:Object.entries(a.queues).map(([queue,m])=>({queue,...metric(m)})),hourly:Object.entries(a.hourly).map(([hour,m])=>({hour,...metric(m)}))}))}}
  };
}
export function validDaySummary(value,day){
  const metric=m=>!!m&&['total','answered','talk','wait'].every(k=>Number.isFinite(m[k])&&m[k]>=0&&m[k]<=1e9)&&m.answered<=m.total&&typeof m.talk_known==='boolean'&&typeof m.wait_known==='boolean';
  const stamp=Date.parse(value?.as_of);
  if(value?.version!==1||value.source!=='ucm_api'||value.day!==day||!Number.isFinite(stamp)||stamp>Date.now()+60000||!Number.isInteger(value.records)||value.records<0||value.records>1000000||!Array.isArray(value.agents)||value.agents.length>1000)return false;
  const extensions=new Set();
  for(const a of value.agents){if(!/^\d{2,10}$/.test(a.extension)||extensions.has(a.extension)||!metric(a)||!Array.isArray(a.queues)||a.queues.length>100||!Array.isArray(a.hourly)||a.hourly.length>24)return false;extensions.add(a.extension);if(!a.queues.every(q=>typeof q.queue==='string'&&q.queue.length<=80&&metric(q))||!a.hourly.every(h=>/^\d{2}$/.test(h.hour)&&Number(h.hour)<24&&metric(h)))return false;
    if(a.categories){if(!['inbound','outbound','internal','unknown','queue'].every(k=>Number.isInteger(a.categories[k])&&a.categories[k]>=0&&a.categories[k]<=a.total)||a.categories.inbound+a.categories.outbound+a.categories.internal+a.categories.unknown!==a.total)return false}else if(value.parser_version>=3)return false;
  }
  return true;
}
