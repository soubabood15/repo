/* Dated shift drafts stay in memory until explicitly saved. */
const plannerDrafts=new Map();
const plannerManualModes=new Set();
let plannerSaving=false;
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
  const users=getScheduleUsers().filter(user=>`${user.full_name} ${user.username}`.toLowerCase().includes(query));
  const label=$('plannerWeekLabel');if(label)label.textContent=`${dates[0].value} — ${dates[6].value} · ${users.length} employees`;
  const options=['OFF',...Object.keys(SHIFT_PRESETS),'MAN'];
  const reference=$('plannerCodeReference');
  if(reference)reference.innerHTML=Object.entries(SHIFT_PRESETS).map(([code,shift])=>`<span><b>${esc(code)}</b>${esc(shift.start)} — ${esc(shift.end)}</span>`).join('')+'<span><b>OFF</b>Day off</span><span><b>MAN</b>Custom hours</span>';
  $('monthlyScheduleHolder').innerHTML=`<div class="planner-scroll"><table class="planner-table"><thead><tr><th>Employee</th>${dates.map(date=>`<th>${esc(date.dayName)}<small>${esc(date.value.slice(5))}</small></th>`).join('')}<th>Save</th></tr></thead><tbody>${users.map(user=>`<tr data-planner-user="${esc(user.username)}"><th><strong>${esc(user.full_name||user.username)}</strong><small>${esc(user.username)}</small></th>${dates.map(date=>{
    const value=plannerValue(user.username,date.value),parsed=parseShiftValue(value),code=plannerManualModes.has(plannerKey(user.username,date.value))?'MAN':value?getShiftCode(value):'';
    return `<td class="${code==='OFF'?'planner-off ':''}${plannerDrafts.has(plannerKey(user.username,date.value))?'planner-dirty':''}" data-planner-date="${date.value}"><select aria-label="${esc(user.full_name)} ${date.dayName} shift" onchange="changePlannerCode(this)" ${plannerSaving?'disabled':''}><option value="">Not assigned</option>${options.map(option=>`<option value="${option}" ${option===code?'selected':''}>${option}${SHIFT_PRESETS[option]?' · '+SHIFT_PRESETS[option].start:''}</option>`).join('')}</select><div class="planner-hours" ${code==='MAN'?'':'hidden'}><input type="time" aria-label="Start time" data-planner-start value="${esc(parsed.start)}" onchange="changePlannerHours(this)"><input type="time" aria-label="End time" data-planner-end value="${esc(parsed.end)}" onchange="changePlannerHours(this)"></div><small>${code&&code!=='OFF'&&code!=='MAN'?esc(value):code==='OFF'?'Day off':code==='MAN'?'Custom hours':'No saved shift'}</small><button type="button" class="planner-copy" onclick="copyPlannerAcross(this)" ${!value||plannerSaving?'disabled':''} title="Copy this shift to remaining days">Copy →</button></td>`;
  }).join('')}<td><button type="button" onclick="savePlannerDrafts(this.closest('tr').dataset.plannerUser)" ${plannerSaving?'disabled':''}>Save row</button></td></tr>`).join('')||'<tr><td colspan="9">No matching employees.</td></tr>'}</tbody></table></div>`;
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
  cell.classList.add('planner-dirty');
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
