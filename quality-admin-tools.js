function qualityAdminDate(row){return String(row.call_date||row.created_at||'').slice(0,10)}
async function fetchAdminQualityCalls(month){
  const [year,m]=month.split('-').map(Number),next=`${m===12?year+1:year}-${String(m===12?1:m+1).padStart(2,'0')}-01`;
  async function read(legacy){
    const rows=[];
    for(let offset=0;;offset+=500){
      let query=authDb.from('quality_calls').select('*');
      query=legacy?query.is('call_date',null).gte('created_at',month+'-01').lt('created_at',next):query.gte('call_date',month+'-01').lt('call_date',next);
      const {data,error}=await query.order('created_at',{ascending:false}).order('id').range(offset,offset+499);
      if(error)throw error;rows.push(...(data||[]));if(!data||data.length<500)return rows;
    }
  }
  return (await Promise.all([read(false),read(true)])).flat();
}
function chooseQualityAgent(username){
  const select=$('qualityCallEmployeeFilter');
  if(select.options&&![...select.options].some(option=>option.value===username))select.add(new Option(username,username));
  select.value=username;
  $('qualityBrowseMonth').value=$('qualityBrowseMonth').value||getTodayIsoDate().slice(0,7);
  renderAdminQualityCalls();
}
function renderQualityAgentTiles(){
  const holder=$('qualityEmployeeAverages');if(!holder)return;
  const month=$('qualityBrowseMonth')?.value||'',selected=$('qualityCallEmployeeFilter')?.value||'all',groups=new Map();
  for(const user of usersCache)if(String(user.role||'').toLowerCase()==='agent')groups.set(user.username,{name:user.full_name||user.username,rows:[]});
  for(const row of qualityCallsCache){const key=row.agent_username||'unassigned';if(!groups.has(key))groups.set(key,{name:row.agent_name||key,rows:[]});if(!month||qualityAdminDate(row).slice(0,7)===month)groups.get(key).rows.push(row)}
  holder.innerHTML=[...groups].map(([username,group])=>{
    const scores=group.rows.filter(row=>row.status==='evaluated'&&row.score!=null&&Number.isFinite(Number(row.score))).map(row=>Number(row.score)),average=scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:null;
    return `<button type="button" class="quality-agent-tile ${selected===username?'selected':''}" data-quality-agent="${esc(username)}" aria-pressed="${selected===username}"><span class="quality-tile-avatar">${esc(group.name.trim().split(/\s+/).slice(0,2).map(part=>part[0]).join(''))}</span><strong>${esc(group.name)}</strong><small>${group.rows.length} calls · ${scores.length} evaluated</small><b>${average==null?'No score':average.toFixed(2)+' / 100'}</b></button>`;
  }).join('')||'<div class="knowledge-empty">No employees found.</div>';
  holder.querySelectorAll('[data-quality-agent]').forEach(button=>button.onclick=()=>chooseQualityAgent(button.dataset.qualityAgent));
}
async function fetchQualityMonthRows(month){
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Choose a valid month.');
  const [year,m]=month.split('-').map(Number),next=`${m===12?year+1:year}-${String(m===12?1:m+1).padStart(2,'0')}-01`;
  async function read(legacy){
    const rows=[];
    for(let offset=0;;offset+=500){
      let query=authDb.from('quality_calls').select('id,call_date,created_at,audio_path,audio_size');
      query=legacy?query.is('call_date',null).gte('created_at',month+'-01').lt('created_at',next):query.gte('call_date',month+'-01').lt('call_date',next);
      const {data,error}=await query.order('id').range(offset,offset+499);if(error)throw error;
      rows.push(...(data||[]));if(!data||data.length<500)return rows;
    }
  }
  return [...new Map((await Promise.all([read(false),read(true)])).flat().map(row=>[row.id,row])).values()];
}
let qualityMonthDeleteBusy=false;
async function deleteQualityMonth(){
  if(qualityMonthDeleteBusy)return;
  const month=$('qualityDeleteMonth')?.value,button=$('qualityDeleteMonthBtn');
  if(!month)return showMsg($('qualityCallMsg'),'Select the month to delete.',false);
  qualityMonthDeleteBusy=true;button.disabled=true;
  let deleted=0,files=0,cleanupFailed=false;
  try{
    const rows=await fetchQualityMonthRows(month);
    if(!rows.length)return showMsg($('qualityCallMsg'),`No Quality data found for ${month}.`);
    const paths=[...new Set(rows.map(row=>row.audio_path).filter(Boolean))];
    if(prompt(`Permanently delete ${rows.length} Quality evaluations for ${month}, across ALL employees, plus unreferenced audio files? QA Tracker scores for these evaluations will disappear. Other months, CDR and KPI records are not deleted. This cannot be undone.\nType DELETE ${month} to confirm:`)!==`DELETE ${month}`)return;
    for(let offset=0;offset<rows.length;offset+=100){
      const ids=rows.slice(offset,offset+100).map(row=>row.id);
      const {error}=await authDb.from('quality_calls').delete().in('id',ids);if(error)throw error;deleted+=ids.length;
    }
    // Keep audio files that are still used by evaluations outside this month.
    for(const path of paths){
      const {data,error}=await authDb.from('quality_calls').select('id').eq('audio_path',path).limit(1);
      if(error){cleanupFailed=true;continue}if(data?.length)continue;
      const {error:storageError}=await authDb.storage.from('quality-calls').remove([path]);if(storageError)cleanupFailed=true;else files++;
    }
    showMsg($('qualityCallMsg'),`${deleted} evaluations deleted for ${month}; ${files} unreferenced audio files removed.${cleanupFailed?' Some audio cleanup failed; records are deleted but storage may not be fully released.':''}`,!cleanupFailed);
  }catch(error){showMsg($('qualityCallMsg'),`${deleted?`${deleted} evaluations already deleted; audio cleanup was not completed. `:''}${error.message||'Deletion failed.'}`,false)}
  finally{qualityMonthDeleteBusy=false;button.disabled=false;if(deleted){QualityCache.invalidate(month);qualityScoreChannel?.postMessage({event:'evaluations-deleted',month});await loadAdminQualityCalls()}}
}
