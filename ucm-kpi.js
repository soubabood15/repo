const clamp=value=>Math.max(0,Math.min(100,value));
export function ucmKpiScores({total,answered,talk,wait,activeDays,maxProductivity,waitKnown=false,talkKnown=false}){
  if(!(total>0))return null;
  const scores={quality:null,response:waitKnown?(wait>0?clamp(20/(wait/total)*100):100):null,productivity:maxProductivity>0?clamp(answered/Math.max(1,activeDays)/maxProductivity*100):0,handling:answered>0&&talkKnown?(talk>0?clamp(300/(talk/answered)*100):100):null,answerRate:clamp(answered/total*100)};
  const weights={quality:0,response:25,productivity:20,handling:15,answerRate:5},available=Object.keys(scores).filter(k=>scores[k]!==null),sum=available.reduce((n,k)=>n+weights[k],0);
  return {scores,weights,kpi:available.reduce((n,k)=>n+scores[k]*weights[k]/sum,0)};
}
