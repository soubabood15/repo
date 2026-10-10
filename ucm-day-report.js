import {ucmKpiScores} from './ucm-kpi.js';
export function dayReportsToKpi(days){
  const users=new Map();
  for(const day of days)for(const a of day.agents||[]){
    const key=a.username||'extension:'+a.extension,u=users.get(key)||{username:key,agent_name:a.full_name||a.extension,total:0,answered:0,talk:0,wait:0,talk_known:true,wait_known:true,days:new Set(),daily:new Map(),queues:new Map(),hourly:new Map()};
    for(const k of ['total','answered','talk','wait'])u[k]+=a[k];u.talk_known&&=a.talk_known;u.wait_known&&=a.wait_known;if(a.total>0)u.days.add(day.day);
    const add=(map,key,value)=>{const metric=map.get(key)||{total:0,answered:0,talk:0,wait:0};for(const k of ['total','answered','talk','wait'])metric[k]+=value[k];map.set(key,metric)};
    add(u.daily,day.day,a);for(const q of a.queues||[])add(u.queues,q.queue,q);for(const h of a.hourly||[])add(u.hourly,h.hour,h);users.set(key,u);
  }
  const max=Math.max(0,...[...users.values()].map(u=>u.answered/Math.max(1,u.days.size))),from=days.map(d=>d.day).sort()[0],to=days.map(d=>d.day).sort().at(-1),metric=m=>({...m,abandoned:m.total-m.answered,answerRate:m.total?100*m.answered/m.total:0,avgWait:m.total?m.wait/m.total:0,avgTalk:m.answered?m.talk/m.answered:0});
  return [...users.values()].map(u=>{const score=ucmKpiScores({total:u.total,answered:u.answered,talk:u.talk,wait:u.wait,activeDays:u.days.size,maxProductivity:max,talkKnown:u.talk_known,waitKnown:u.wait_known}),s=score?.scores||{};
    return {username:u.username,agent_name:u.agent_name,total_calls:u.total,answered_calls:u.answered,abandoned_calls:u.total-u.answered,active_days:u.days.size,quality_score:null,response_score:s.response??null,handling_score:s.handling??null,productivity_score:s.productivity??null,answer_rate_score:s.answerRate??null,kpi_score:score?.kpi??null,average_wait_seconds:u.wait_known&&u.total?u.wait/u.total:null,average_talk_seconds:u.talk_known&&u.answered?u.talk/u.answered:null,main_queue:[...u.queues].sort((a,b)=>b[1].total-a[1].total)[0]?.[0]||'Unknown',data_from:from,data_to:to,updated_at:days.map(d=>d.as_of).sort().at(-1),details:{source:'ucm_api',coverage:'requested_days',unavailable_scores:['quality',...(!u.wait_known?['response']:[]),...(!u.talk_known?['handling']:[])],daily:[...u.daily].map(([date,m])=>({date,...metric(m)})),queues:[...u.queues].map(([queue,m])=>({queue,...metric(m)})),hourly:[...u.hourly].map(([hour,m])=>({hour,...metric(m)}))}};
  });
}
