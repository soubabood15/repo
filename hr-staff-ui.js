import {HR_RESOURCES} from './hr-permissions.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names={attendance:'Attendance records',online:'Online employees',schedule:'Schedules',actions:'Verbal actions',leaves:'Leave requests',performance:'Agent360 performance',analysis:'Attendance analysis',export:'Excel export'};
function matrix(permissions={}){return '<div class="hr-permission-grid">'+HR_RESOURCES.filter(key=>key!=='staff').map(key=>'<label>'+names[key]+'<select name="permission_'+key+'">'+['none','read','write'].map(level=>'<option value="'+level+'" '+((permissions[key]||'none')===level?'selected':'')+'>'+({none:'No access',read:'Read',write:'Write'}[level])+'</option>').join('')+'</select></label>').join('')+'</div>'}
function values(form){return Object.fromEntries(HR_RESOURCES.map(key=>[key,key==='staff'?'none':form.elements['permission_'+key].value]))}
export async function renderHrStaff(holder,{onChanged,onError,shouldRender=()=>true}){
  const payload=await NewtelHrApi.call('/staff');
  if(!shouldRender())return;
  NewtelLiveDom.html(holder,'<form class="hr-form" data-live-key="staff-create" id="hrStaffCreate"><h2>Add an HR employee</h2><label>Full name<input name="full_name" required maxlength="150" autocomplete="name"></label><label>Username<input name="username" required pattern="[a-z0-9._-]{3,50}" autocomplete="off"></label><label>Temporary password<input name="password" type="password" required minlength="10" maxlength="200" autocomplete="new-password"></label><p>Permissions apply immediately. Write includes read. Staff administration remains exclusive to HR Admin.</p>'+matrix()+'<button>Create HR account</button></form><div class="hr-grid">'+payload.users.map(user=>'<article class="hr-card" data-live-key="staff:'+esc(user.username)+'"><h3>'+esc(user.full_name)+'</h3><small>'+esc(user.username)+' · '+esc(user.role)+' · '+(user.active?'Active':'Disabled')+'</small>'+(user.role==='hr'?'<form data-staff-user="'+esc(user.username)+'">'+matrix(user.permissions)+'<button>Save permissions</button></form>':'<p>HR Admin account. Managed by the main administrator.</p>')+'</article>').join('')+'</div>');
  holder.querySelectorAll('form').forEach(form=>{
    form.oninput=()=>form.dataset.dirty='1';
    form.onsubmit=async event=>{event.preventDefault();const button=form.querySelector('button');button.disabled=true;
      try{const create=form.id==='hrStaffCreate',body={permissions:values(form)};if(create)Object.assign(body,{full_name:form.elements.full_name.value,username:form.elements.username.value,password:form.elements.password.value});
        await NewtelHrApi.call(create?'/staff':'/staff/'+encodeURIComponent(form.dataset.staffUser),{method:create?'POST':'PATCH',body});if(create)form.reset();form.dataset.dirty='0';await onChanged();
      }catch(error){onError(error.message)}finally{button.disabled=false}
    };
  });
}
