import fs from 'node:fs';
import path from 'node:path';
const dayOf=now=>new Date(now+10800000).toISOString().slice(0,10);
// Union pauses across queues: a member paused in three queues is not charged
// three times. Only intervals actually observed while connected are counted.
export function createPauseTracker(file,{now=Date.now}={}){
  let totals={};
  if(file&&fs.existsSync(file))totals=JSON.parse(fs.readFileSync(file,'utf8'));
  const active=new Map();
  function advance(stamp){
    for(const [extension,since] of active){
      let cursor=since;
      while(cursor<stamp){const day=dayOf(cursor),end=Math.min(stamp,Date.parse(day+'T00:00:00+03:00')+86400000),key=extension+'|'+day;totals[key]=Math.min(86400000,(totals[key]||0)+end-cursor);cursor=end}
      active.set(extension,stamp);
    }
  }
  function save(){if(!file)return;fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file+'.tmp',JSON.stringify(totals),{mode:0o600});fs.renameSync(file+'.tmp',file)}
  return {
    observe(states){const stamp=now();advance(stamp);const extensions=new Set([...states.values()].map(s=>s.extension));for(const ext of extensions){const members=[...states.values()].filter(s=>s.extension===ext);const key=ext+'|'+dayOf(stamp);if(members.some(m=>m.paused!==null))totals[key]??=0;if(members.some(m=>m.logged===true&&m.paused===true))active.set(ext,stamp);else active.delete(ext)}save()},
    snapshot(){advance(now());const earliest=dayOf(now()-62*86400000);totals=Object.fromEntries(Object.entries(totals).filter(([key])=>key.split('|')[1]>=earliest));save();return Object.entries(totals).map(([key,value])=>{const [extension,day]=key.split('|');return {extension,day,seconds:Math.floor(value/1000)}})},
    disconnect(){advance(now());active.clear();save()}
  };
}
