import './hr-live-dom.js';
import {hrDay} from './hr-core.js';
import {renderAttendanceRecords} from './hr-attendance-ui.js';
const root=document.getElementById('adminAttendanceRecords');
root.innerHTML='<label>Attendance month<input type="month" id="adminPunchMonth"></label><button type="button" id="adminPunchLoad">Load records</button><p id="adminPunchMessage" role="status"></p><div id="adminPunchCards"></div>';
const month=document.getElementById('adminPunchMonth');month.value=hrDay().slice(0,7);
async function load(){
  const button=document.getElementById('adminPunchLoad');button.disabled=true;
  try{const selected=month.value,report=await NewtelHrApi.call('/attendance?month='+encodeURIComponent(selected));if(selected!==month.value)return;
    renderAttendanceRecords(document.getElementById('adminPunchCards'),report,{write:true,onChanged:async()=>{document.getElementById('adminPunchMessage').textContent='Attendance updated.';if(typeof BroadcastChannel==='function'){const channel=new BroadcastChannel('newtel-hr-updates');channel.postMessage({changed:true});channel.close()}await load()},onError:text=>document.getElementById('adminPunchMessage').textContent=text});
  }catch(error){document.getElementById('adminPunchMessage').textContent=error.message}finally{button.disabled=false}
}
document.getElementById('adminPunchLoad').onclick=load;month.onchange=load;
const panel=document.getElementById('attendanceRecords');new MutationObserver(()=>{if(panel.classList.contains('active'))load()}).observe(panel,{attributes:true,attributeFilter:['class']});
