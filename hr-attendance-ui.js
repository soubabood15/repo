import {hrDay,hrWorkSummary} from './hr-core.js';
globalThis.NewtelHrCore=Object.freeze({hrWorkSummary});
globalThis.updateEmployeeWork?.();
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const local=value=>value?new Date(Date.parse(value)+3*3600000).toISOString().slice(0,16):'';
const show=value=>value?new Date(value).toLocaleString('en-GB',{timeZone:'Asia/Amman'}):'Not recorded';
const selections=new WeakMap();
export function renderAttendanceRecords(holder,report,{write=false,onChanged=()=>{},onError=()=>{}}={}){
  const people=[...new Map(report.rows.map(row=>[row.username,row])).values()],prior=selections.get(holder),selection=prior?.month===report.month?prior:{month:report.month,username:people[0]?.username,day:report.rows.some(r=>r.day===hrDay())?hrDay():report.month+'-01'};
  if(!people.some(p=>p.username===selection.username))selection.username=people[0]?.username;
  selections.set(holder,selection);
  const selected=report.rows.find(row=>row.username===selection.username&&row.day===selection.day),days=report.rows.filter(row=>row.username===selection.username);
  NewtelLiveDom.html(holder,'<div class="hr-attendance-picker"><label>1 · Employee<select data-attendance-employee>'+people.map(p=>'<option value="'+esc(p.username)+'" '+(p.username===selection.username?'selected':'')+'>'+esc(p.full_name)+' · '+esc(p.username)+'</option>').join('')+'</select></label><label>2 · Attendance day<input data-attendance-date type="date" min="'+report.month+'-01" max="'+esc(days.at(-1)?.day||report.month+'-01')+'" value="'+esc(selection.day)+'"></label></div><div class="hr-attendance-calendar">'+days.map(row=>'<button type="button" class="'+(row.attendance?.punch_in?'present':['absent','missing_login'].includes(row.status)?'absent':'neutral')+(row.day===selection.day?' selected':'')+'" data-attendance-day="'+row.day+'" aria-label="'+esc(row.day+' '+row.status.replaceAll('_',' '))+'" aria-pressed="'+(row.day===selection.day)+'">'+Number(row.day.slice(8))+'</button>').join('')+'</div><p class="hr-explainer">'+esc(report.basis)+'</p><div class="hr-grid">'+(selected?[selected]:[]).map(row=>'<article class="hr-card" data-live-key="attendance:'+esc(row.username+':'+row.day)+'"><h3>'+esc(row.full_name)+'</h3><small>'+esc(row.day)+' · '+esc(row.shift||'Not scheduled')+'</small><p>'+esc(row.status.replaceAll('_',' '))+(row.missing_check_out?' · Missing check-out':'')+'</p><div class="hr-details"><div><small>Check-in</small><strong>'+esc(show(row.attendance?.punch_in))+'</strong></div><div><small>Check-out</small><strong>'+esc(show(row.attendance?.punch_out))+'</strong></div><div><small>Late minutes</small><strong>'+row.late_minutes+'</strong></div><div><small>Worked / required minutes</small><strong>'+row.work_minutes+' / '+row.required_minutes+'</strong></div></div>'+(write&&row.day<=hrDay()&&row.shift&&row.shift!=='OFF'?'<button type="button" data-correct-attendance="'+esc(row.username+':'+row.day)+'">'+(row.attendance?'Edit attendance':'Mark present')+'</button>':'')+(write&&row.attendance?'<button type="button" class="hr-reject" data-delete-attendance="'+esc(row.username+':'+row.day)+'">Delete daily punch</button>':'')+'</article>').join('')+'</div>');
  const redraw=()=>renderAttendanceRecords(holder,report,{write,onChanged,onError});
  holder.querySelector('[data-attendance-employee]').onchange=event=>{selection.username=event.target.value;redraw()};
  holder.querySelector('[data-attendance-date]').onchange=event=>{selection.day=event.target.value;redraw()};
  holder.querySelectorAll('[data-attendance-day]').forEach(button=>button.onclick=()=>{selection.day=button.dataset.attendanceDay;redraw()});
  holder.querySelectorAll('[data-correct-attendance]').forEach(button=>button.onclick=()=>{
    const row=report.rows.find(row=>row.username+':'+row.day===button.dataset.correctAttendance);attendanceEditor(row,{onChanged,onError});
  });
  holder.querySelectorAll('[data-delete-attendance]').forEach(button=>button.onclick=async()=>{
    const row=report.rows.find(row=>row.username+':'+row.day===button.dataset.deleteAttendance),reason=prompt('Reason for deleting '+row.full_name+' attendance on '+row.day+':');
    if(reason===null||!confirm('Delete only this employee’s punch on '+row.day+'?'))return;
    button.disabled=true;try{await NewtelHrApi.call('/attendance',{method:'DELETE',body:{username:row.username,day:row.day,reason}});await onChanged()}catch(error){onError(error.message)}finally{button.disabled=false}
  });
}
export function attendanceEditor(row,{onChanged,onError}){
  const dialog=document.createElement('dialog');dialog.className='hr-attendance-dialog';
  dialog.innerHTML='<form><h2>'+esc(row.attendance?'Correct attendance':'Mark employee present')+'</h2><p>'+esc(row.full_name)+' · '+esc(row.day)+'<br>'+esc(row.shift)+' · Asia/Amman</p><label>Check-in<input name="punch_in" type="datetime-local" required value="'+esc(local(row.attendance?.punch_in)||row.day+'T'+row.shift.slice(0,5))+'"></label><label>Check-out (optional)<input name="punch_out" type="datetime-local" value="'+esc(local(row.attendance?.punch_out))+'"></label><label>Correction reason<textarea name="reason" required minlength="3" maxlength="1000"></textarea></label><p role="alert"></p><div class="hr-actions-row"><button type="submit">Save attendance</button><button type="button" data-cancel>Cancel</button></div></form>';
  document.body.append(dialog);dialog.querySelector('[data-cancel]').onclick=()=>dialog.close();dialog.onclose=()=>dialog.remove();dialog.showModal();
  dialog.querySelector('form').onsubmit=async event=>{event.preventDefault();const form=event.target,button=form.querySelector('[type="submit"]');button.disabled=true;
    const timestamp=value=>value?value+':00+03:00':null;
    try{await NewtelHrApi.call('/attendance',{method:'PATCH',body:{username:row.username,day:row.day,punch_in:timestamp(form.elements.punch_in.value),punch_out:timestamp(form.elements.punch_out.value),reason:form.elements.reason.value}});dialog.close();await onChanged()}catch(error){dialog.querySelector('[role="alert"]').textContent=error.message;onError(error.message)}finally{button.disabled=false}
  };
}
