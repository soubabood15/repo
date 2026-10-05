let employeeHrState=null,employeeHrLoading=false,employeeHrPending=null,employeeHrQueued=false,employeeHrGeneration=0,employeeHrMutating=false,employeeHrChecking=false;
const employeeHrChannel=typeof BroadcastChannel==='function'?new BroadcastChannel('newtel-hr-updates'):null;
function notifyEmployeeHr(){employeeHrChannel?.postMessage({changed:true})}
const employeeHrEsc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function employeeHrMessage(text,error=false){const node=document.getElementById('employeeHrMessage');if(node){node.textContent=text;node.classList.toggle('error',error)}}
function employeeHrTime(value){return value?new Date(value).toLocaleTimeString('ar-JO',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Amman'}):'لم تُسجّل'}
function renderEmployeeHr(preserveDraft=true){
  const node=document.getElementById('employeeHrCard');if(!node||!employeeHrState)return;
  const data=employeeHrState,record=data.attendance;
  const retainedLeave=preserveDraft?node.querySelector('#employeeSickForm')?.closest('details'):null;
  if(retainedLeave)retainedLeave.remove();
  node.innerHTML=`<header><div><span>MY ATTENDANCE</span><h2>بصمة الدوام</h2></div><small>${employeeHrEsc(data.day)}</small></header><div class="employee-hr-shift">الجدول: <strong dir="ltr">${employeeHrEsc(data.shift||'لا يوجد جدول')}</strong></div><div class="employee-hr-times"><div><small>أول دخول اليوم</small><strong>${employeeHrTime(record?.punch_in)}</strong></div><div><small>خروج اليوم</small><strong>${employeeHrTime(record?.punch_out)}</strong></div></div><div class="employee-hr-buttons"><button type="button" data-hr-punch="in" ${record?.punch_in||!data.shift||data.shift==='OFF'?'disabled':''}>بصمة دخول</button><button type="button" data-hr-punch="out" ${!record?.punch_in||record?.punch_out?'disabled':''}>بصمة خروج</button></div>${data.late_minutes?`<p class="employee-hr-late">تأخير ${data.late_minutes} دقيقة حسب الجدول.</p>`:''}<p class="employee-hr-note">البصمة مستقلة عن تسجيل دخول الموقع. الرجوع إلى eBook لا يكرر بصمة اليوم.</p><div id="employeeHrMessage" role="status" aria-live="polite"></div><details class="employee-hr-leave"><summary>رفع إجازة مرضية</summary><form id="employeeSickForm"><label>من<input type="date" name="start_date" required value="${data.day}"></label><label>إلى<input type="date" name="end_date" required value="${data.day}"></label><label class="employee-hr-wide">المرفق · PDF / JPG / PNG · حتى 5 MB<input type="file" name="file" accept="application/pdf,image/jpeg,image/png" required></label><label class="employee-hr-wide">ملاحظة اختيارية<textarea name="note" maxlength="1000"></textarea></label><button class="employee-hr-wide" type="submit">إرسال إلى HR</button></form></details>${data.leaves.length?`<details class="employee-hr-leave"><summary>إجازاتي المرضية</summary>${data.leaves.map(leave=>`<p>${employeeHrEsc(leave.start_date)} ← ${employeeHrEsc(leave.end_date)} · ${{pending:'بانتظار المراجعة',approved:'معتمدة',rejected:'مرفوضة'}[leave.status]||employeeHrEsc(leave.status)}</p>`).join('')}</details>`:''}`;
  node.querySelectorAll('[data-hr-punch]').forEach(button=>button.onclick=async()=>{
    if(employeeHrMutating)return;
    if(button.dataset.hrPunch==='out'&&!confirm('تأكيد تسجيل بصمة الخروج من الدوام؟'))return;
    node.querySelectorAll('[data-hr-punch]').forEach(item=>item.disabled=true);
    employeeHrMutating=true;employeeHrGeneration++;
    try{const result=await NewtelHrApi.call('/punch',{method:'POST',body:{action:button.dataset.hrPunch}});employeeHrState={...employeeHrState,...result};renderEmployeeHr();notifyEmployeeHr();await loadEmployeeHr({force:true});employeeHrMessage('تم تسجيل البصمة بوقت السيرفر.')}catch(error){renderEmployeeHr();employeeHrMessage(error.message,true)}finally{employeeHrMutating=false}
  });
  if(retainedLeave)node.querySelector('#employeeSickForm').closest('details').replaceWith(retainedLeave);
  const form=document.getElementById('employeeSickForm');form.onsubmit=async event=>{event.preventDefault();if(employeeHrMutating)return;employeeHrMutating=true;employeeHrGeneration++;const button=form.querySelector('button');button.disabled=true;try{await NewtelHrApi.call('/sick-leaves',{method:'POST',body:new FormData(form)});form.reset();notifyEmployeeHr();await loadEmployeeHr({force:true});employeeHrMessage('تم رفع الإجازة؛ بانتظار مراجعة HR.')}catch(error){employeeHrMessage(error.message,true)}finally{employeeHrMutating=false;button.disabled=false}};
  showEmployeeHrAction();
}
function showEmployeeHrAction(){
  let dialog=document.getElementById('employeeHrActionDialog');
  const action=employeeHrState?.warnings?.[0];
  if(!action){if(dialog?.open)dialog.close();return}
  if(dialog?.open&&dialog.dataset.actionId===action.id)return;
  if(!dialog){dialog=document.createElement('dialog');dialog.id='employeeHrActionDialog';dialog.className='employee-hr-action-dialog';dialog.dir='rtl';dialog.addEventListener('cancel',event=>event.preventDefault());document.body.appendChild(dialog)}
  dialog.innerHTML=`<span class="employee-hr-action-kicker">إجراء من الموارد البشرية</span><h2>إشعار شفوي</h2><small>${employeeHrEsc(action.action_date)}</small><p>${employeeHrEsc(action.message)}</p><p class="employee-hr-note">سيُسجّل وقت إقرارك بالاطلاع والاستلام لدى HR.</p><div role="status" id="employeeHrAckError"></div><button type="button">اطلعت على الإجراء وأقرّ باستلامه</button>`;
  dialog.dataset.actionId=action.id;
  dialog.querySelector('button').onclick=async()=>{if(employeeHrMutating)return;employeeHrMutating=true;employeeHrGeneration++;const button=dialog.querySelector('button');button.disabled=true;try{await NewtelHrApi.call('/actions/'+encodeURIComponent(action.id)+'/ack',{method:'POST'});employeeHrState.warnings=employeeHrState.warnings.filter(item=>item.id!==action.id);dialog.close();showEmployeeHrAction();notifyEmployeeHr()}catch(error){document.getElementById('employeeHrAckError').textContent=error.message;button.disabled=false}finally{employeeHrMutating=false}};
  if(!dialog.open)dialog.showModal();
}
function loadEmployeeHr({force=false}={}){
  if(typeof currentUser==='undefined'||!currentUser?.username)return Promise.resolve();
  if(employeeHrPending){if(force||!employeeHrState)employeeHrQueued=true;return employeeHrPending}
  employeeHrLoading=true;
  const username=currentUser.username,generation=employeeHrGeneration;
  employeeHrPending=(async()=>{try{const data=await NewtelHrApi.call('/me');if(currentUser?.username!==username||generation!==employeeHrGeneration)return;employeeHrState=data;renderEmployeeHr()}catch(error){if(currentUser?.username!==username||generation!==employeeHrGeneration)return;const node=document.getElementById('employeeHrCard');if(node&&!employeeHrState)node.innerHTML='<h2>بصمة الدوام</h2><div id="employeeHrMessage" role="status"></div>';employeeHrMessage(error.message,true)}})().finally(()=>{employeeHrLoading=false;employeeHrPending=null;if(employeeHrQueued){employeeHrQueued=false;return loadEmployeeHr()}});
  return employeeHrPending;
}
async function checkEmployeeHr(){
  if(document.hidden||globalThis.NewTelIdle?.isPaused()||employeeHrLoading||employeeHrMutating||employeeHrChecking||typeof currentUser==='undefined'||!currentUser?.username)return;
  if(!employeeHrState)return loadEmployeeHr();
  employeeHrChecking=true;const generation=employeeHrGeneration;
  try{const check=await NewtelHrApi.call('/me/check');if(generation!==employeeHrGeneration)return;const windowEnd=employeeHrState.shift?.match(/-\s*(\d{2}:\d{2})$/),previousEnded=employeeHrState.day<check.today&&!employeeHrState.attendance?.punch_in&&windowEnd&&Date.parse(check.server_now)>=Date.parse(`${check.today}T${windowEnd[1]}:00+03:00`);if(check.revision!==employeeHrState.revision||check.today!==employeeHrState.today||previousEnded)await loadEmployeeHr()}catch{/* Keep loaded data on temporary network failure. */}finally{employeeHrChecking=false}
}
function resetEmployeeHr(){employeeHrGeneration++;employeeHrQueued=false;employeeHrState=null;document.getElementById('employeeHrActionDialog')?.remove();const node=document.getElementById('employeeHrCard');if(node)node.replaceChildren()}
employeeHrChannel?.addEventListener('message',checkEmployeeHr);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkEmployeeHr()});
globalThis.addEventListener('newtel:idle-resume',checkEmployeeHr);
setInterval(checkEmployeeHr,10000);
