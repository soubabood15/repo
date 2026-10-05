/* Read-only daily QA, derived from the same saved evaluations as Quality. */
globalThis.QualityDailyScores=Object.freeze({
  aggregate(rows,username,month){
    const days={},seen=new Set();
    for(const row of rows){
      if(row.agent_username!==username||row.status!=='evaluated'||row.score==null||row.score==='')continue;
      const score=Number(row.score),date=String(row.call_date||row.created_at||'').slice(0,10);
      if(!Number.isFinite(score)||score<0||score>100||!/^\d{4}-\d{2}-\d{2}$/.test(date)||date.slice(0,7)!==month)continue;
      const day=Number(date.slice(8)),[year,m]=month.split('-').map(Number);
      if(day<1||day>new Date(year,m,0).getDate())continue;
      if(row.id){if(seen.has(row.id))continue;seen.add(row.id)}
      const entry=days[day]||(days[day]={total:0,count:0,updatedAt:''});
      entry.total+=score;entry.count++;
      const updated=String(row.updated_at||row.evaluated_at||'');if(updated>entry.updatedAt)entry.updatedAt=updated;
    }
    return Object.fromEntries(Object.entries(days).map(([day,entry])=>[day,{score:entry.total/entry.count,count:entry.count,updatedAt:entry.updatedAt}]));
  },
  async fetch(client,username,month){
    const [year,m]=month.split('-').map(Number),next=`${m===12?year+1:year}-${String(m===12?1:m+1).padStart(2,'0')}-01`;
    const fields='id,agent_username,status,score,call_date,created_at,updated_at,evaluated_at';
    async function read(legacy){
      const rows=[];
      for(let offset=0;;offset+=500){
        let query=client.from('quality_calls').select(fields).eq('agent_username',username).eq('status','evaluated');
        query=legacy?query.is('call_date',null).gte('created_at',month+'-01').lt('created_at',next):query.gte('call_date',month+'-01').lt('call_date',next);
        const {data,error}=await query.order('id').range(offset,offset+499);
        if(error)throw error;
        rows.push(...(data||[]));if(!data||data.length<500)return rows;
      }
    }
    const lists=await Promise.all([read(false),read(true)]);
    return this.aggregate(lists.flat(),username,month);
  }
});
/* Same-browser updates are immediate; other devices use the visible-tab poll. */
globalThis.qualityScoreChannel=typeof BroadcastChannel==='function'?new BroadcastChannel('newtel-quality-scores'):null;
if(qualityScoreChannel)qualityScoreChannel.onmessage=()=>{
  if(!document.hidden&&typeof activeAdminTab!=='undefined'&&['qaTracker','qualityCalls'].includes(activeAdminTab)&&typeof checkQualityChanges==='function')checkQualityChanges(true);
};
