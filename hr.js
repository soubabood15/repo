import './hr-live-dom.js';
import {hrDay,hrAttendanceStatus,hrPresence,hrShiftValue,hrShiftWindow,hrWorkSummary} from './hr-core.js';
import {hrAllowed} from './hr-permissions.js';
import {renderAttendanceRecords} from './hr-attendance-ui.js';
import {downloadAttendanceExcel} from './hr-export.js';
import {renderHrStaff} from './hr-staff-ui.js';
const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const state={data:null,view:'attendance',presence:[],offset:0,busy:false,checking:false,mutating:false,pending:null,reloadRequested:false,analytics:null,requests:null,cache:new Map(),navigation:0,insightPending:null};
const hrChannel=typeof BroadcastChannel==='function'?new BroadcastChannel('newtel-hr-updates'):null;
function notifyHrChange(){hrChannel?.postMessage({changed:true});state.cache.clear()}
function renderPreservingDrafts(){
  // In-place patching retains dirty inputs, focused controls and open details.
  render();
}
async function deleteHrRecord(kind,id){
  if(state.mutating||!confirm('Permanently delete this record'+(kind==='sick-leaves'?' and its private attachment':'')+'? Attendance calculations will be updated.'))return;
  await mutate('/'+kind+'/'+encodeURIComponent(id),{method:'DELETE'},'Record deleted.');
}
const titles={records:"Attendance records",staff:"HR staff & permissions",attendance:'Team attendance',online:'Online employees',schedule:'Weekly schedule',actions:'Verbal actions',leaves:'Leave & preferences',performance:'Agent360 performance',lateness:'Attendance analysis'};
const descriptions={records:"Review a month, correct daily punches and mark employees present.",staff:"Create HR accounts and assign access to each section.",attendance:"A clear view of your team's day.",online:'Portal activity does not replace attendance punches.',schedule:'The same official weekly schedule used by the live shift page.',actions:'Send an action and follow the employee’s acknowledgment.',leaves:'Review annual, hourly and medical leave, and next-week preferences.',performance:'The same monthly KPI source used by Agent360.',lateness:'Monthly lateness, attendance, actions and approved time off.'};
const labels={late:'Late',present:'Present',checked_out:'Checked out',missing_login:'Not checked in',absent:'Absent',off:'Day off',upcoming:'Upcoming',not_scheduled:'No schedule',sick_leave:'Approved sick leave',annual_leave:'Approved annual leave',approved_leave:'Approved hourly leave',pending:'Pending',approved:'Approved',rejected:'Rejected'};
const colors={late:'yellow',missing_login:'red',absent:'red',present:'green',checked_out:'green',sick_leave:'green',annual_leave:'green',approved_leave:'green',pending:'yellow',approved:'green',rejected:'red'};
const kinds={annual:'Annual leave',short_leave:'Hourly leave',schedule_preference:'Next-week preference',sick:'Sick leave'};
const time=value=>value?new Date(value).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Amman'}):'—';
const dateLabel=day=>new Date(day+'T12:00:00Z').toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short',timeZone:'Asia/Amman'});
const minutes=value=>{const n=Math.max(0,Math.round(Number(value)||0));return Math.floor(n/60)+'h '+n%60+'m'};
const percent=value=>value===null||value===undefined?'—':Number(value).toFixed(1)+'%';
const presets=Object.fromEntries(Array.from({length:16},(_,i)=>{const letter=String.fromCharCode(65+i),start=String((8+i)%24).padStart(2,'0')+':00';return [[letter,start+' - '+String((17+i)%24).padStart(2,'0')+':00'],[letter+letter,start+' - '+String((20+i)%24).padStart(2,'0')+':00']]}).flat());
function message(text,error=false){$('hrMessage').textContent=text;$('hrMessage').classList.toggle('error',error)}
function badge(status){return '<span class="hr-badge '+(colors[status]||'')+'">'+esc(labels[status]||status)+'</span>'}
function person(user){return '<div class="hr-person"><span class="hr-avatar">'+esc(String(user.full_name||user.username).split(/\s+/).slice(0,2).map(p=>p[0]).join(''))+'</span><div><strong>'+esc(user.full_name||user.username)+'</strong><small>'+esc(user.username)+' · '+esc(user.role)+'</small></div></div>'}
function details(items){return '<div class="hr-details">'+items.map(([label,value])=>'<div><small>'+esc(label)+'</small><strong>'+esc(value)+'</strong></div>').join('')+'</div>'}
function roster(){return state.data.roster.map(row=>({...row,...hrAttendanceStatus({day:row.attendance_day||state.data.day,shift:row.shift,attendance:row.attendance,leave:row.leave,requests:row.requests,grace:state.data.grace,now:Date.now()+state.offset}),online:state.presence.some(item=>item.username===row.username&&hrPresence(item,Date.now()+state.offset)==='online')}))}
async function mutate(path,options,success){
  if(state.mutating)return;state.mutating=true;
  try{await NewtelHrApi.call(path,options);notifyHrChange();await load();message(success)}catch(error){message(error.message,true)}finally{state.mutating=false}
}
function render(){
  const data=state.data;if(!data)return;
  const resource=view=>({lateness:'analysis',records:'attendance'}[view]||view),allowed=view=>hrAllowed(data.permissions,resource(view));
  document.querySelectorAll('[data-view]').forEach(button=>button.hidden=!allowed(button.dataset.view));
  $('hrExport').hidden=!hrAllowed(data.permissions,'export');
  $('hrExportMonthLabel').hidden=$('hrExport').hidden;
  if(!allowed(state.view))state.view=Object.keys(titles).find(allowed)||'attendance';
  if(!allowed(state.view)){NewtelLiveDom.html($('hrView'),'<div class="hr-empty">No HR sections have been assigned to your account.</div>');NewtelLiveDom.html($('hrMetrics'),'');return}
  const insights=['performance','lateness'].includes(state.view),monthly=insights||['leaves','records'].includes(state.view);
  $('hrPreviousPerformance').hidden=state.view!=='performance';
  if(state.view!=='performance')$('hrPerformanceLoading').hidden=true;
  NewtelLiveDom.text($('hrPageTitle'),titles[state.view]);NewtelLiveDom.text($('hrPageDescription'),descriptions[state.view]);if($('hrDayLabel').hidden!==monthly)$('hrDayLabel').hidden=monthly;if($('hrMonthLabel').hidden===monthly)$('hrMonthLabel').hidden=!monthly;
  document.querySelectorAll('[data-view]').forEach(button=>{const selected=button.dataset.view===state.view;button.classList.toggle('active',selected);selected?button.setAttribute('aria-current','page'):button.removeAttribute('aria-current')});
  $('hrMetrics').hidden=!['attendance','online','performance','lateness'].includes(state.view);
  const people=roster(),counts=state.view==='performance'&&state.analytics?[['Employees',state.analytics.roster.length],['KPI records',state.analytics.roster.filter(p=>p.kpi).length],['Reporting month',state.analytics.month],['Data source','Agent360']]:insights&&state.analytics?[
    ['Employees',state.analytics.roster.length],['Late arrivals',state.analytics.roster.reduce((s,p)=>s+p.late_days,0)],['Verbal actions',state.analytics.roster.reduce((s,p)=>s+p.action_count,0)],['Approved leave days',state.analytics.roster.reduce((s,p)=>s+p.sick_days+p.annual_days,0)]
  ]:[['Online',people.filter(p=>p.online).length],['Checked in',people.filter(p=>p.attendance?.punch_in).length],['Late arrivals',people.filter(p=>p.late_minutes>0&&p.attendance?.punch_in).length],['Missing / absent',people.filter(p=>['missing_login','absent'].includes(p.status)).length]];
  NewtelLiveDom.html($('hrMetrics'),counts.map(([name,value])=>'<div><small>'+name+'</small><strong>'+value+'</strong></div>').join(''));
  const holder=$('hrView');
  if(state.view==='staff'){loadStaff();return}
  if(state.view==='records'){loadRecords();return}
  if(insights){renderAnalytics();return}
  if(['attendance','online'].includes(state.view)){
    const rows=state.view==='online'?people.filter(p=>p.online):people;
    NewtelLiveDom.html(holder,'<div class="hr-grid">'+(rows.map(user=>{
      const work=hrWorkSummary({day:user.attendance_day||data.day,shift:user.shift,attendance:user.attendance,leave:user.leave,requests:user.requests,now:Date.now()+state.offset});
      return '<article class="hr-card" data-live-key="'+state.view+':'+esc(user.username)+'">'+person(user)+(state.view==='online'?'<span class="hr-badge green">Online now</span>':badge(user.status))+(user.late_minutes?'<p>'+user.late_minutes+' minutes late'+(user.attendance?.punch_in?'':' · awaiting check-in')+'</p>':'')+details([['Saved shift',user.shift||'Not scheduled'],['Connection',user.online?'Online':'Offline'],['First check-in',time(user.attendance?.punch_in)],['Check-out',time(user.attendance?.punch_out)],['Worked / required',minutes(work.work_minutes)+' / '+minutes(work.required_minutes)],['Approved hourly leave',minutes(work.approved_leave_minutes)]])+'</article>';
    }).join('')||'<div class="hr-empty">No employees to show.</div>')+'</div>');
  }else if(state.view==='schedule'){
    NewtelLiveDom.html(holder,people.map(user=>'<details class="hr-card hr-schedule" data-schedule-person="'+esc(user.username)+'" style="margin-bottom:14px"><summary>'+esc(user.full_name)+' · '+esc(user.role)+'</summary><div class="hr-week">'+data.dates.map(day=>{
      const value=hrShiftValue(data.controls,user.username,day),code=value==='OFF'?'OFF':Object.keys(presets).find(k=>presets[k]===value)||'MAN',times=value.match(/(\d{2}:\d{2}) - (\d{2}:\d{2})/);
      return '<div class="hr-week-day" data-schedule-user="'+esc(user.username)+'" data-schedule-day="'+day+'"><strong>'+esc(dateLabel(day))+'</strong>'+(hrAllowed(data.permissions,state.view==="schedule"?"schedule":"actions",true)?'<select data-shift-code aria-label="Shift '+esc(user.full_name)+' '+day+'"><option value="" '+(!value?'selected':'')+'>Not scheduled</option>'+['OFF',...Object.keys(presets),'MAN'].map(k=>'<option value="'+k+'" '+(value&&code===k?'selected':'')+'>'+(k==='OFF'?'OFF':k==='MAN'?'Custom':k+' · '+presets[k].slice(0,5))+'</option>').join('')+'</select><div class="hr-times" '+(code==='MAN'&&value?'':'hidden')+'><input type="time" data-start aria-label="Shift start" value="'+(times?.[1]||'')+'"><input type="time" data-end aria-label="Shift end" value="'+(times?.[2]||'')+'"></div><button data-save-shift>Save day</button>':'<small>'+esc(value||'Not scheduled')+'</small>')+'</div>';
    }).join('')+'</div></details>').join(''));
    holder.querySelectorAll('[data-shift-code]').forEach(select=>select.onchange=()=>select.closest('[data-schedule-day]').querySelector('.hr-times').hidden=select.value!=='MAN');
    holder.querySelectorAll('[data-save-shift]').forEach(button=>button.onclick=async()=>{const cell=button.closest('[data-schedule-day]'),code=cell.querySelector('select').value,value=code==='OFF'?'OFF':presets[code]||cell.querySelector('[data-start]').value+' - '+cell.querySelector('[data-end]').value;if(!code)return message('Select a shift or OFF.',true);if(state.mutating)return;button.disabled=true;
      try{await NewtelHrApi.call('/schedule',{method:'POST',body:{username:cell.dataset.scheduleUser,day:cell.dataset.scheduleDay,value}});cell.dataset.dirty='0';notifyHrChange();await load();message('Saved and shared with the live schedule.')}catch(error){message(error.message,true)}finally{button.disabled=false}});
  }else if(state.view==='actions'){
    NewtelLiveDom.html(holder,(hrAllowed(data.permissions,state.view==="schedule"?"schedule":"actions",true)?'<form class="hr-form" id="hrActionForm"><h2>Record a verbal action</h2><label>Employee<select name="username" required>'+people.map(p=>'<option value="'+esc(p.username)+'">'+esc(p.full_name)+'</option>').join('')+'</select></label><label>Date<input type="date" name="day" required value="'+data.day+'"></label><label>Action details<textarea name="message" required minlength="3" maxlength="2000"></textarea></label><button>Send to employee</button></form>':'')+'<div class="hr-grid">'+(data.actions.map(action=>'<article class="hr-card" data-live-key="action:'+esc(action.id)+'"><h3>'+esc(people.find(p=>p.username===action.username)?.full_name||action.username)+'</h3><time>'+esc(action.action_date)+'</time><p>'+esc(action.message)+'</p><span class="hr-badge '+(action.acknowledged_at?'green':'yellow')+'">'+(action.acknowledged_at?'Acknowledged by employee':'Awaiting acknowledgment')+'</span>'+(action.acknowledged_at?'<p>'+esc(new Date(action.acknowledged_at).toLocaleString('en-GB',{timeZone:'Asia/Amman'}))+'</p>':'')+(hrAllowed(data.permissions,state.view==="schedule"?"schedule":"actions",true)?'<div class="hr-actions-row"><button class="hr-reject" data-delete-kind="actions" data-id="'+esc(action.id)+'">Delete action</button></div>':'')+'</article>').join('')||'<div class="hr-empty">No actions in this week.</div>')+'</div>');
    const form=$('hrActionForm');if(form)form.onsubmit=async event=>{event.preventDefault();if(state.mutating)return;const button=form.querySelector('button');button.disabled=true;
      try{await NewtelHrApi.call('/actions',{method:'POST',body:Object.fromEntries(new FormData(form))});form.reset();form.dataset.dirty='0';notifyHrChange();await load();message('Sent. Open employee pages receive updates within 10 seconds.')}catch(error){message(error.message,true)}finally{button.disabled=false}};
  }else renderRequests();
  bindRecordButtons();
  holder.oninput=event=>{const node=event.target.closest('[data-schedule-day],#hrActionForm');if(node)node.dataset.dirty='1'};holder.onchange=holder.oninput;
}
let recordsPending=null,staffPending=null,recordsKey='',staffKey='';
async function loadRecords(){
  const month=$('hrMonth').value,key=month+':'+state.data.revision;
  if(recordsPending)return;
  const renderReport=report=>renderAttendanceRecords($('hrView'),report,{write:hrAllowed(state.data.permissions,'attendance',true),onChanged:async()=>{notifyHrChange();recordsKey='';await load();message('Attendance updated.')},onError:text=>message(text,true)});
  if(recordsKey===key&&state.cache.has('attendance:'+key)){renderReport(state.cache.get('attendance:'+key));return}
  recordsPending=(async()=>{try{const report=await NewtelHrApi.call('/attendance?month='+encodeURIComponent(month));if(state.view!=='records'||month!==$('hrMonth').value||key!==month+':'+state.data.revision)return;recordsKey=key;state.cache.set('attendance:'+key,report);renderReport(report)}catch(error){message(error.message,true)}})().finally(()=>{recordsPending=null;if(state.view==='records'&&key!==$('hrMonth').value+':'+state.data.revision)loadRecords()});await recordsPending;
}
async function loadStaff(){
  const key=state.data.revision;if(staffPending||staffKey===key&&$('hrStaffCreate'))return;
  staffPending=(async()=>{try{await renderHrStaff($('hrView'),{shouldRender:()=>state.view==='staff'&&state.data.revision===key,onChanged:async()=>{staffKey='';notifyHrChange();await load();message('HR account permissions saved.')},onError:text=>message(text,true)});if(state.view==='staff'&&state.data.revision===key)staffKey=key}catch(error){message(error.message,true)}})().finally(()=>{staffPending=null});await staffPending;
}
function renderRequests(){
  const holder=$('hrView'),payload=state.requests;if(!payload){NewtelLiveDom.html(holder,'<div class="hr-empty">Loading leave requests…</div>');return}
  const all=[...payload.requests.map(row=>({...row,kind:'requests'})),...payload.leaves.map(row=>({...row,kind:'sick-leaves',request_type:'sick'}))];
  NewtelLiveDom.html(holder,'<div class="hr-toolbar"><label>Request type<select id="hrRequestType"><option value="">All types</option>'+Object.entries(kinds).map(([value,label])=>'<option value="'+value+'">'+label+'</option>').join('')+'</select></label><label>Status<select id="hrRequestStatus"><option value="">All statuses</option><option>pending</option><option>approved</option><option>rejected</option></select></label></div><p class="hr-explainer">Selected month plus all pending requests. Up to 500 records per source. Preferences change the official schedule only with “Approve & apply week”. No leave balance is assumed.</p><div id="hrRequestCards" class="hr-grid"></div>');
  const draw=()=>{
    const rows=all.filter(r=>(!$('hrRequestType').value||r.request_type===$('hrRequestType').value)&&(!$('hrRequestStatus').value||r.status===$('hrRequestStatus').value));
    NewtelLiveDom.html($('hrRequestCards'),rows.map(row=>'<article class="hr-card" data-live-key="'+row.kind+':'+esc(row.id)+'"><h3>'+esc(state.data.roster.find(p=>p.username===row.username)?.full_name||row.username)+'</h3><small>'+kinds[row.request_type]+'</small> '+badge(row.status)+'<p>'+esc(row.start_date)+' → '+esc(row.end_date)+(row.request_type==='short_leave'?'\n'+esc(row.start_time)+' – '+esc(row.end_time)+' · '+minutes(row.requested_minutes):'')+'</p>'+(row.note?'<p>'+esc(row.note)+'</p>':'')+(row.week_json?'<div class="hr-daily">'+JSON.parse(row.week_json).map(d=>'<div class="hr-daily-row"><strong>'+esc(dateLabel(d.day))+'</strong><span>'+esc(d.value)+'</span></div>').join('')+'</div>':'')+'<div class="hr-actions-row">'+(row.kind==='sick-leaves'?'<button data-leave-file="'+esc(row.id)+'">Attachment</button>':'')+(hrAllowed(state.data.permissions,"leaves",true)&&row.status==='pending'?'<button data-review="approved" data-kind="'+row.kind+'" data-id="'+esc(row.id)+'" '+(row.request_type==='schedule_preference'?'data-apply="true"':'')+'>'+(row.request_type==='schedule_preference'?'Approve & apply week':'Approve')+'</button><button class="hr-reject" data-review="rejected" data-kind="'+row.kind+'" data-id="'+esc(row.id)+'">Reject</button>':'')+(hrAllowed(state.data.permissions,"leaves",true)?'<button class="hr-reject" data-delete-kind="'+row.kind+'" data-id="'+esc(row.id)+'">Delete</button>':'')+'</div>'+(row.reviewed_at?'<p>Reviewed '+esc(new Date(row.reviewed_at).toLocaleString('en-GB',{timeZone:'Asia/Amman'}))+'</p>':'')+'</article>').join('')||'<div class="hr-empty">No matching requests.</div>');bindRecordButtons();
  };$('hrRequestType').onchange=draw;$('hrRequestStatus').onchange=draw;draw();
}
function bindRecordButtons(){
  $('hrView').querySelectorAll('[data-delete-kind]').forEach(button=>button.onclick=()=>deleteHrRecord(button.dataset.deleteKind,button.dataset.id));
  $('hrView').querySelectorAll('[data-review]').forEach(button=>button.onclick=async()=>{if(state.mutating||!confirm((button.dataset.review==='approved'?'Approve':'Reject')+' this request'+(button.dataset.apply?' and update the official week':'')+'?'))return;button.disabled=true;await mutate('/'+button.dataset.kind+'/'+encodeURIComponent(button.dataset.id),{method:'PATCH',body:{status:button.dataset.review,apply_schedule:button.dataset.apply==='true'}},'Decision sent to the employee.');button.disabled=false});
  $('hrView').querySelectorAll('[data-leave-file]').forEach(button=>button.onclick=async()=>{button.disabled=true;try{const blob=await NewtelHrApi.call('/sick-leaves/'+encodeURIComponent(button.dataset.leaveFile)+'/file',{file:true}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='sick-leave.'+(blob.type==='application/pdf'?'pdf':blob.type==='image/png'?'png':'jpg');link.click();setTimeout(()=>URL.revokeObjectURL(url),60000)}catch(error){message(error.message,true)}finally{button.disabled=false}});
}
function renderAnalytics(){
  const holder=$('hrView'),report=state.analytics;if(!report){NewtelLiveDom.html(holder,'<div class="hr-empty">Loading monthly analysis…</div>');return}
  NewtelLiveDom.html(holder,'<p class="hr-explainer">'+esc(report.basis)+'</p><div class="hr-grid">'+report.roster.map(user=>{
    if(state.view==='performance'){const k=user.kpi;return '<article class="hr-card">'+person(user)+(k?'<p class="hr-kpi-score">'+percent(k.kpi_score)+'</p>'+details([['Quality',percent(k.quality_score)],['Response',percent(k.response_score)],['Productivity',percent(k.productivity_score)],['Answer rate',percent(k.answer_rate_score)],['Total calls',k.total_calls??'—'],['Active days',k.active_days??'—']])+'<p>Data coverage: '+esc(k.data_from||'Unknown')+' → '+esc(k.data_to||'Unknown')+'\nUpdated: '+esc(k.updated_at||k.created_at||'Unknown')+'</p>':'<div class="hr-empty">No Agent360 KPI data for this employee in '+esc(report.month)+'. No score is estimated.</div>')+'</article>'}
    return '<article class="hr-card">'+person(user)+details([['Late arrivals',user.late_days],['Total lateness',minutes(user.late_minutes)],['Actions / acknowledged',user.action_count+' / '+user.acknowledged_actions],['Absent days',user.absent_days],['Annual / sick days',user.annual_days+' / '+user.sick_days],['Approved hourly leave',minutes(user.hourly_leave_minutes)],['Worked / required · completed shifts',minutes(user.worked_minutes)+' / '+minutes(user.required_minutes)],['Agent360 KPI',percent(user.kpi?.kpi_score)]])+'<details class="hr-daily"><summary>Daily attendance breakdown</summary>'+user.daily.filter(d=>d.scheduled_minutes||d.attendance).map(d=>'<div class="hr-daily-row"><div><strong>'+esc(dateLabel(d.day))+'</strong><br>'+badge(d.status)+'</div><span>'+esc(d.shift)+'<br>In '+time(d.attendance?.punch_in)+' · Out '+time(d.attendance?.punch_out)+'<br>'+(d.attendance?.punch_in?d.late_minutes+'m late':'No punch')+' · '+minutes(d.work_minutes)+' worked / '+minutes(d.required_minutes)+' required</span></div>').join('')+'</details></article>';
  }).join('')+'</div>');
}
async function loadInsights(){
  if(!['performance','lateness','leaves'].includes(state.view)||!state.data)return;
  const type=state.view==='leaves'?'requests':'analytics',month=$('hrMonth').value,key=type+':'+state.view+':'+month+':'+state.data.revision;
  if(state.cache.has(key)){state[type]=state.cache.get(key);renderPreservingDrafts();if(state.view==='performance')$('hrPerformanceLoading').hidden=state.analytics?.sync?.status==='complete';return}
  const navigation=state.navigation,revision=state.data.revision;
  if(state.view==='performance'&&(!state.analytics||state.analytics.month!==month||state.analytics.sync?.status==='pending')){
    $('hrPerformanceLoading').hidden=false;$('hrPerformanceLoadingText').textContent='Loading full-month performance for all employees…';
  }
  try{const payload=await NewtelHrApi.call('/'+type+'?month='+encodeURIComponent(month)+(state.view==='performance'?'&view=performance':''));if(month!==$('hrMonth').value||navigation!==state.navigation||revision!==state.data.revision)return;state.cache.set(key,payload);state[type]=payload;renderPreservingDrafts()}catch(error){message(error.message,true)}
  if(state.view==='performance'){
    const pending=state.analytics?.sync?.status!=='complete';$('hrPerformanceLoading').hidden=!pending;
    $('hrPerformanceLoadingText').textContent=pending?'No complete monthly report has been uploaded yet. Import this month in KPI Analyzer; saved readings will appear automatically.':'Full monthly performance loaded.';
  }
}
function previousHrMonth(){const date=new Date(hrDay().slice(0,7)+'-01T12:00:00Z');date.setUTCMonth(date.getUTCMonth()-1);return date.toISOString().slice(0,7)}
$('hrPreviousPerformance').onclick=()=>{$('hrMonth').value=previousHrMonth();state.analytics=null;render();loadInsights()};
function load({quiet=false}={}){
  if(state.busy){state.reloadRequested=true;return state.pending}state.busy=true;if(!quiet)$('hrRefresh').disabled=true;const selectedDay=$('hrDay').value;
  state.pending=(async()=>{try{const data=await NewtelHrApi.call('/dashboard?day='+encodeURIComponent(selectedDay));if(selectedDay!==$('hrDay').value)return;if(state.data?.revision!==data.revision){state.cache.clear()}state.data=data;state.presence=data.presence||[];state.offset=Date.parse(data.server_now)-Date.now();NewtelLiveDom.text($('hrName'),data.profile.full_name||data.profile.username);NewtelLiveDom.text($('hrPermission'),'HR · Assigned permissions');renderPreservingDrafts();await loadInsights()}catch(error){message(error.message,true);if(!state.data)NewtelLiveDom.html($('hrView'),'<div class="hr-empty">Sign in with an HR account. <a href="ebook.html">Back to eBook</a></div>')}})().finally(()=>{state.busy=false;state.pending=null;$('hrRefresh').disabled=false;if(state.reloadRequested||selectedDay!==$('hrDay').value){state.reloadRequested=false;return load()}});
  return state.pending;
}
async function check(){
  if(document.hidden||globalThis.NewTelIdle?.isPaused()||!state.data||state.busy||state.mutating||state.checking)return;
  state.checking=true;
  try{const data=await NewtelHrApi.call('/check');state.presence=data.presence;state.offset=Date.parse(data.server_now)-Date.now();const transition=state.data.roster.some(row=>row.attendance_day&&row.attendance_day!==state.data.day&&Date.parse(data.server_now)>=(hrShiftWindow(row.attendance_day,row.shift)?.end||Infinity));if(data.revision!==state.data.revision||transition)await load({quiet:true});else if(['attendance','online'].includes(state.view))render()}catch(error){message(error.message,true)}finally{state.checking=false}
}
const mobile=matchMedia('(max-width:760px)'),reduced=matchMedia('(prefers-reduced-motion:reduce)');
function menu(open,save=false){document.body.classList.toggle('hr-menu-closed',!open);$('hrMenuToggle').setAttribute('aria-expanded',String(open));$('hrBackdrop').hidden=!mobile.matches||!open;if(save&&!mobile.matches)localStorage.setItem('newtel-hr-menu',open?'open':'closed')}
menu(!mobile.matches&&localStorage.getItem('newtel-hr-menu')!=='closed');$('hrMenuToggle').onclick=()=>menu(document.body.classList.contains('hr-menu-closed'),true);$('hrBackdrop').onclick=()=>{menu(false);$('hrMenuToggle').focus()};
document.addEventListener('keydown',event=>{if(event.key==='Escape'){menu(false);$('hrMenuToggle').focus()}});
mobile.addEventListener('change',()=>menu(!mobile.matches&&localStorage.getItem('newtel-hr-menu')!=='closed'));
const icons={attendance:'M4 4h16v16H4z M8 2v4m8-4v4 M8 12l3 3 5-6',online:'M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M2 21v-3a6 6 0 0 1 12 0 M19 8v6m-3-3h6',schedule:'M4 5h16v16H4z M8 2v6m8-6v6 M4 10h16',actions:'M5 3h14v18H5z M8 8h8m-8 4h8m-8 4h5',leaves:'M12 3a9 9 0 1 0 9 9 M12 3v9h9 M14 7l3-3 3 3',performance:'M4 20V10m8 10V4m8 16v-7',lateness:'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18 M12 7v5l3 2'};
document.querySelectorAll('[data-icon]').forEach(node=>NewtelLiveDom.html(node,'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="'+icons[node.dataset.icon]+'"/></svg>'));
$('hrDay').value=hrDay();$('hrMonth').value=hrDay().slice(0,7);$('hrDay').onchange=load;$('hrMonth').onchange=()=>{state.analytics=null;state.requests=null;render();loadInsights()};$('hrRefresh').onclick=()=>{state.cache.clear();load()};$('hrLogout').onclick=()=>NewtelHrApi.logout();
$('hrExportMonth').value=hrDay().slice(0,7);
$('hrExport').onclick=async()=>{const button=$('hrExport');button.disabled=true;try{const report=await NewtelHrApi.call('/export?month='+encodeURIComponent($('hrExportMonth').value));downloadAttendanceExcel(report);message('Attendance exported.')}catch(error){message(error.message,true)}finally{button.disabled=false}};
document.querySelectorAll('[data-view]').forEach(button=>button.onclick=async()=>{if(state.view===button.dataset.view){if(mobile.matches)menu(false);return}const generation=++state.navigation;const holder=$('hrView');holder.classList.remove('hr-entering');holder.classList.add('hr-leaving');if(!reduced.matches)await new Promise(resolve=>setTimeout(resolve,120));if(generation!==state.navigation)return;state.view=button.dataset.view;if(state.view==='performance'){$('hrMonth').value=previousHrMonth();state.analytics=null}render();holder.classList.remove('hr-leaving');holder.classList.add('hr-entering');holder.addEventListener('animationend',()=>holder.classList.remove('hr-entering'),{once:true});if(reduced.matches)holder.classList.remove('hr-entering');if(mobile.matches)menu(false);await loadInsights()});
hrChannel?.addEventListener('message',check);document.addEventListener('visibilitychange',()=>{if(!document.hidden)check()});globalThis.addEventListener('newtel:idle-resume',check);setInterval(check,10000);load();
