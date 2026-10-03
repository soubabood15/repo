/* Dated shift drafts stay in memory until explicitly saved. */
const plannerDrafts=new Map();
const plannerManualModes=new Set();
let plannerSaving=false;
function plannerDateOffset(date,days){
  const value=new Date(date+'T12:00:00');value.setDate(value.getDate()+days);
  return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
}
function plannerInterval(value,offset=0){
  const match=String(value).match(/^(\d{2}):([0-5]\d) - (\d{2}):([0-5]\d)$/);
  if(!match||Number(match[1])>23||Number(match[3])>23)return null;
  const start=Number(match[1])*60+Number(match[2]),end=Number(match[3])*60+Number(match[4]);
  return {start:start+offset,end:end+offset+(end<=start?1440:0)};
}
function plannerCoverage(username,date,users){
  const own=plannerInterval(plannerValue(username,date));if(!own)return null;
  const peers=[];
  for(const user of users)if(user.username!==username)for(const offset of [-1,0,1]){
    const interval=plannerInterval(plannerValue(user.username,plannerDateOffset(date,offset)),offset*1440);
    if(interval&&interval.end>own.start&&interval.start<own.end)peers.push(interval);
  }
  const points=[...new Set([own.start,own.end,...peers.flatMap(p=>[Math.max(own.start,p.start),Math.min(own.end,p.end)])])].sort((a,b)=>a-b);
  let longest=0,run=0,total=0;
  for(let i=0;i<points.length-1;i++){
    if(peers.some(p=>p.start<=points[i]&&p.end>=points[i+1]))run=0;
    else {run+=points[i+1]-points[i];total+=points[i+1]-points[i];longest=Math.max(longest,run)}
  }
  return total===0?{level:'green',text:'Covered throughout'}:peers.length&&longest<=60?{level:'yellow',text:`Nearby cover · ${total} min alone`}:{level:'red',text:`Alone for ${total} min`};
}
function copyPlannerPreviousWeek(){
  if(plannerSaving)return;
  const dates=getWeekDates($('scheduleWeekDate')?.value||getTodayIsoDate());
  const users=ScheduleRoleGroups.group(getScheduleUsers()).flatMap(group=>group.users);
  const entries=users.flatMap(user=>dates.map(day=>({username:user.username,date:day.value,value:plannerSavedShift(user.username,plannerDateOffset(day.value,-7))}))).filter(entry=>entry.value);
  if(!entries.length)return showMsg($('shiftMsg'),'No saved shifts found for the previous week.',false);
  if(!confirm('Copy the previous week for all roles? This replaces current week drafts. Nothing is saved until you press Save changes.'))return;
  for(const entry of entries){plannerManualModes.delete(plannerKey(entry.username,entry.date));plannerSet(entry.username,entry.date,entry.value)}
  renderShiftPlanner();showMsg($('shiftMsg'),`${entries.length} shifts copied as drafts. Missing previous shifts were left unchanged. Review then save.`);
}
function plannerKey(username,date){return `shift_${username}_${date}`}
function plannerSavedShift(username,date){
  const day=WEEKDAY_BY_DATE[new Date(date+'T12:00:00').getDay()];
  return getAppControlValue(plannerKey(username,date))||getAppControlValue(plannerKey(username,day));
}
function plannerValue(username,date){
  const key=plannerKey(username,date);
  return plannerDrafts.has(key)?plannerDrafts.get(key).value:plannerSavedShift(username,date);
}
function plannerSet(username,date,value){
  const key=plannerKey(username,date);
  if(value===plannerSavedShift(username,date))plannerDrafts.delete(key);
  else plannerDrafts.set(key,{key,value,username,date});
  updatePlannerCount();
}
function updatePlannerCount(){
  const count=$('plannerDraftCount');if(count)count.textContent=plannerDrafts.size?`${plannerDrafts.size} unsaved day changes (all weeks)`:'All changes saved';
  const save=$('plannerSaveAll');if(save){save.disabled=plannerSaving||!plannerDrafts.size;save.textContent=plannerSaving?'Saving…':'Save changes'}
}
function renderShiftPlanner(){
  const dates=getWeekDates($('scheduleWeekDate')?.value||getTodayIsoDate());
  const query=String($('plannerSearch')?.value||'').trim().toLowerCase();
  const allGroups=ScheduleRoleGroups.group(getScheduleUsers());
  const groups=allGroups.map(group=>({...group,users:group.users.filter(user=>`${user.full_name} ${user.username}`.toLowerCase().includes(query))})).filter(group=>group.users.length);
  const users=groups.flatMap(group=>group.users);
  const label=$('plannerWeekLabel');if(label)label.textContent=`${dates[0].value} — ${dates[6].value} · ${users.length} employees`;
  const options=['OFF',...Object.keys(SHIFT_PRESETS),'MAN'];
  const reference=$('plannerCodeReference');
  if(reference)reference.innerHTML=Object.entries(SHIFT_PRESETS).map(([code,shift])=>`<span><b>${esc(code)}</b>${esc(shift.start)} — ${esc(shift.end)}</span>`).join('')+'<span><b>OFF</b>Day off</span><span><b>MAN</b>Custom hours</span>';
  $('monthlyScheduleHolder').innerHTML=groups.map(group=>`<section class="planner-role-group" data-schedule-role="${esc(group.role)}"><header class="planner-role-heading"><h3>${esc(group.label)}</h3><span>${group.users.length} employees</span></header><div class="planner-scroll"><table class="planner-table" aria-label="${esc(group.label)} weekly schedules"><thead><tr><th>Employee</th>${dates.map(date=>`<th>${esc(date.dayName)}<small>${esc(date.value.slice(5))}</small></th>`).join('')}<th>Save</th></tr></thead><tbody>${group.users.map(user=>`<tr data-planner-user="${esc(user.username)}"><th><strong>${esc(user.full_name||user.username)}</strong><small>${esc(user.username)}</small></th>${dates.map(date=>{
    const value=plannerValue(user.username,date.value),parsed=parseShiftValue(value),code=plannerManualModes.has(plannerKey(user.username,date.value))?'MAN':value?getShiftCode(value):'';
    const coverage=plannerCoverage(user.username,date.value,allGroups.find(item=>item.role===group.role).users);
    return `<td class="${code==='OFF'?'planner-off ':''}${plannerDrafts.has(plannerKey(user.username,date.value))?'planner-dirty':''}" data-planner-date="${date.value}" data-day-label="${esc(date.dayName)} · ${date.value.slice(5)}"><select aria-label="${esc(user.full_name)} ${date.dayName} shift" onchange="changePlannerCode(this)" ${plannerSaving?'disabled':''}><option value="">Not assigned</option>${options.map(option=>`<option value="${option}" ${option===code?'selected':''}>${option}${SHIFT_PRESETS[option]?' · '+SHIFT_PRESETS[option].start:''}</option>`).join('')}</select><div class="planner-hours" ${code==='MAN'?'':'hidden'}><input type="time" aria-label="Start time" data-planner-start value="${esc(parsed.start)}" onchange="changePlannerHours(this)"><input type="time" aria-label="End time" data-planner-end value="${esc(parsed.end)}" onchange="changePlannerHours(this)"></div><small>${code&&code!=='OFF'&&code!=='MAN'?esc(value):code==='OFF'?'Day off':code==='MAN'?'Custom hours':'No saved shift'}</small>${coverage?`<span class="planner-coverage ${coverage.level}">${coverage.text}</span>`:''}<button type="button" class="planner-copy" onclick="copyPlannerAcross(this)" ${!value||plannerSaving?'disabled':''} title="Copy this shift to remaining days">Copy →</button></td>`;
  }).join('')}<td><button type="button" onclick="savePlannerDrafts(this.closest('tr').dataset.plannerUser)" ${plannerSaving?'disabled':''}>Save row</button></td></tr>`).join('')}</tbody></table></div></section>`).join('')||'<p class="planner-empty">No matching employees.</p>';
  updatePlannerCount();
}
function changePlannerCode(select){
  if(plannerSaving)return;
  const cell=select.closest('[data-planner-date]'),username=select.closest('tr').dataset.plannerUser,date=cell.dataset.plannerDate,code=select.value;
  if(!code){select.value=plannerValue(username,date)?getShiftCode(plannerValue(username,date)):'';return}
  const key=plannerKey(username,date);
  if(code==='MAN')plannerManualModes.add(key);else plannerManualModes.delete(key);
  const preset=SHIFT_PRESETS[code];
  const value=code==='OFF'?'OFF':preset?`${preset.start} - ${preset.end}`:`${cell.querySelector('[data-planner-start]').value} - ${cell.querySelector('[data-planner-end]').value}`;
  plannerSet(username,date,value);renderShiftPlanner();
}
function changePlannerHours(input){
  if(plannerSaving)return;
  const cell=input.closest('[data-planner-date]');
  plannerSet(input.closest('tr').dataset.plannerUser,cell.dataset.plannerDate,`${cell.querySelector('[data-planner-start]').value} - ${cell.querySelector('[data-planner-end]').value}`);
  renderShiftPlanner();
}
function copyPlannerAcross(button){
  const cell=button.closest('[data-planner-date]'),username=button.closest('tr').dataset.plannerUser,date=cell.dataset.plannerDate,value=plannerValue(username,date);
  if(!value)return;
  if(!confirm('Copy this shift to the remaining days of this employee’s week, including OFF days? Changes are not saved yet.'))return;
  for(const day of getWeekDates(date))if(day.value>date)plannerSet(username,day.value,value);
  renderShiftPlanner();
}
function discardPlannerDrafts(){
  if(plannerSaving||!plannerDrafts.size||!confirm('Discard all unsaved shift changes across all weeks?'))return;
  plannerDrafts.clear();plannerManualModes.clear();renderShiftPlanner();
}
async function savePlannerDrafts(username=''){
  if(plannerSaving)return;
  const entries=[...plannerDrafts.values()].filter(item=>!username||item.username===username);
  if(!entries.length)return showMsg($('shiftMsg'),'No changes to save.');
  if(entries.some(item=>item.value!=='OFF'&&!/^\d{2}:\d{2} - \d{2}:\d{2}$/.test(item.value)))return showMsg($('shiftMsg'),'Complete start and end times for every custom shift before saving.',false);
  plannerSaving=true;renderShiftPlanner();
  try{
    const payload=entries.map(({key,value})=>({key,value,updated_at:new Date().toISOString()}));
    const {error}=await db.from('app_control').upsert(payload,{onConflict:'key'});
    if(error)throw error;
    for(const item of payload){const existing=appControlCache.find(row=>row.key===item.key);if(existing)Object.assign(existing,item);else appControlCache.push(item);plannerDrafts.delete(item.key)}
    showMsg($('shiftMsg'),`${payload.length} shift changes saved.`);
  }catch(error){showMsg($('shiftMsg'),error.message||'Could not save. Your changes are kept; retry.',false)}
  finally{plannerSaving=false;renderShiftPlanner()}
}
window.addEventListener('beforeunload',event=>{if(plannerDrafts.size){event.preventDefault();event.returnValue=''}});
