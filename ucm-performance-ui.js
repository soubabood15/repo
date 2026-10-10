import {dayReportsToKpi} from './ucm-day-report.js';
const base='https://trainer-kb.alisoub60.workers.dev',today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Amman',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function periodDays(period,now=today()){
  if(/^\d{4}-\d{2}-\d{2}$/.test(period))return period<=now?[period]:[];
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(period))return [];
  const days=[],date=new Date(period+'-01T12:00:00Z');while(date.toISOString().startsWith(period)&&date.toISOString().slice(0,10)<=now){days.push(date.toISOString().slice(0,10));date.setUTCDate(date.getUTCDate()+1)}return days;
}
const styles=`:host{display:block;color:inherit;font:14px/1.5 Arial,sans-serif;--ucm-surface:#f4f8fc;--ucm-border:#dce7ef;--ucm-ink:#18324a}:host([hidden]){display:none}.box{padding:20px;border:1px solid var(--ucm-border);border-radius:16px;background:var(--ucm-surface);color:var(--ucm-ink);margin:16px 0}h3{margin:0 0 5px;font-size:19px}.sub{color:#698097;font-size:12px}.controls{display:flex;flex-wrap:wrap;gap:12px;align-items:end;margin:16px 0}label{display:grid;gap:6px;font-size:12px;font-weight:600}input,select,button{font:inherit;box-sizing:border-box;border-radius:9px;min-height:42px;padding:9px 12px}input,select{border:1px solid var(--ucm-border);background:var(--ucm-surface);color:inherit;max-width:100%}button{background:#087fc3;color:#fff;border:0;cursor:pointer;font-weight:600}button.secondary{background:transparent;color:inherit;border:1px solid var(--ucm-border)}button:disabled{opacity:.5;cursor:wait}.progress{display:grid;gap:8px}progress{width:100%;accent-color:#087fc3}.error{color:#bd3949}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,230px),1fr));gap:12px}.card{padding:14px;border:1px solid var(--ucm-border);border-radius:12px;min-width:0}.card strong{display:block}.metrics{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px}.metrics span{font-size:12px}.metrics b{display:block;font-size:17px}.badge{font-size:11px;color:#087fc3}.daily{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}.daily span{font-size:11px;padding:4px 7px;border-radius:5px;border:1px solid var(--ucm-border)}.done{color:#168455}.current{color:#087fc3}@media(max-width:480px){.box{padding:14px}.controls>*{flex:1 1 40%}.controls button{width:100%}}`;
export class UcmPerformanceLoader extends HTMLElement{
  static observedAttributes=['month'];
  connectedCallback(){
    if(this.ready)return;this.ready=true;this.generation=0;this.days=[];this.attachShadow({mode:'open'});
    this.shadowRoot.innerHTML=`<style>${styles}</style><section class="box"><h3>UCM performance</h3><p class="sub">One shared import per day for all employees. Saved days are reused. Quality scores remain in the saved KPI Analyzer report.</p><div class="controls"><label>Period<select id="mode"><option value="day">Day</option><option value="month">Month · day by day</option></select></label><label>Date<input id="period" type="date" max="${today()}" value="${today()}"></label><button id="load" type="button">Load day</button><button id="cancel" class="secondary" type="button" hidden>Stop loading</button>${this.hasAttribute('live')?'<label><span>Live today · every 5 minutes</span><input id="live" type="checkbox" checked></label>':''}</div><div class="progress" role="status" aria-live="polite"><span id="message">Choose a day or load a month one day at a time.</span><progress id="progress" max="1" value="0" hidden></progress></div><div id="daily" class="daily"></div><div id="results" class="cards"></div></section>`;
    const $=id=>this.shadowRoot.getElementById(id);this.$=$;
    if(this.hasAttribute('preview')){
      $('mode').querySelector('[value="month"]').remove();
      this.shadowRoot.querySelector('h3').textContent='View calls for one day';
      this.shadowRoot.querySelector('.sub').textContent='Read directly from UCM on request. Temporary results are removed after delivery; only manually uploaded monthly KPI reports are saved.';
    }
    $('mode').onchange=()=>{this.cancel();this.clearResult();$('period').value='';$('period').max='';$('period').type=$('mode').value==='month'?'month':'date';$('period').value=today().slice(0,$('mode').value==='month'?7:10);$('period').max=today().slice(0,$('mode').value==='month'?7:10);$('load').textContent=$('mode').value==='month'?'Load month':'Load day';if($('live'))$('live').checked=false};
    $('period').onchange=()=>{this.cancel();this.clearResult();if($('live'))$('live').checked=false};$('load').onclick=()=>this.load();$('cancel').onclick=()=>this.cancel();
    if(this.getAttribute('month'))this.selectMonth(this.getAttribute('month'));
    this.visibility=()=>{if(!document.hidden&&$('live')?.checked)this.load({live:true})};document.addEventListener('visibilitychange',this.visibility);
    this.timer=setInterval(()=>{if(!document.hidden&&!globalThis.NewTelIdle?.isPaused()&&$('live')?.checked&&!this.busy)this.load({live:true})},300000);
    if($('live')){$('live').onchange=()=>{if($('live').checked)this.load({live:true});else this.cancel()};this.load({live:true})}
  }
  disconnectedCallback(){this.cancel();clearInterval(this.timer);document.removeEventListener('visibilitychange',this.visibility)}
  attributeChangedCallback(name,old,value){if(this.ready&&name==='month'&&value!==old)this.selectMonth(value)}
  clearResult(){this.days=[];this.$('results').replaceChildren();this.$('daily').replaceChildren();this.$('progress').hidden=true;this.$('message').classList.remove('error');this.$('message').textContent='Choose a period and use Load. Saved days are reused.'}
  selectMonth(month){this.cancel();this.clearResult();this.$('mode').value='month';this.$('period').value='';this.$('period').max='';this.$('period').type='month';this.$('period').max=today().slice(0,7);this.$('period').value=month;this.$('load').textContent='Load month';this.$('message').textContent='Load '+month+' for all days through today. Saved days are reused.'}
  cancel(){const busy=this.busy;this.generation++;this.controller?.abort();this.busy=false;if(this.$){this.$('load').disabled=false;this.$('cancel').hidden=true;if(busy)this.$('message').textContent='Loading stopped. Saved days are retained.'}}
  async token(){if(globalThis.NewtelUcmToken)return globalThis.NewtelUcmToken();if(globalThis.NewtelHrApi?.token)return NewtelHrApi.token();throw Error('Sign in before loading UCM performance.')}
  async call(day,{method='GET',refresh=false,signal}={}){
    const token=await this.token(),preview=this.hasAttribute('preview'),query=preview?'&mode=preview'+(method==='GET'?'&request_id='+encodeURIComponent(this.activeRequest||''):''):(refresh?'&refresh=1':'');
    const response=await fetch(base+'/integrations/ucm/day?day='+day+query,{method,headers:{Authorization:'Bearer '+token},cache:'no-store',signal}),data=await response.json();
    if(!response.ok)throw Error(data.message||'UCM request failed.');if(preview&&data.request_id)this.activeRequest=data.request_id;return data;
  }
  async load({live=false}={}){
    if(this.busy)return;
    if(live){this.$('mode').value='day';this.$('period').value='';this.$('period').max='';this.$('period').type='date';this.$('period').max=today();this.$('period').value=today();this.$('load').textContent='Load day'}
    const period=this.$('period').value,days=periodDays(period);if(!days.length){this.$('message').textContent='Choose a valid past or current date.';return}
    this.activeRequest=null;
    this.cancel();const generation=this.generation,controller=this.controller=new AbortController();this.busy=true;this.days=[];this.$('load').disabled=true;this.$('cancel').hidden=false;this.$('progress').hidden=false;this.$('progress').max=days.length;this.$('progress').value=0;this.$('message').classList.remove('error');if(!live)this.$('results').replaceChildren();
    try{
      for(const [index,day] of days.entries()){
        if(this.generation!==generation)return;
        while(document.hidden){await new Promise(r=>setTimeout(r,1000));if(this.generation!==generation)return}
        this.$('message').textContent=`Loading ${day} · ${index+1} of ${days.length}. Waiting for the Windows connector…`;
        let result=await this.call(day,{method:'POST',refresh:live,signal:controller.signal}),tries=0;
        while(result.status!=='complete'){
          if(result.status==='failed')throw Error(result.message||'Day import failed.');if(tries++>120)throw Error('The connector has not completed this day. Keep it running and use Load to resume; saved days will not be imported again.');
          await new Promise(resolve=>setTimeout(resolve,5000));if(this.generation!==generation)return;
          if(document.hidden)continue;result=await this.call(day,{signal:controller.signal});
        }
        this.days.push(result);this.$('progress').value=index+1;this.renderResult();this.$('daily').innerHTML=this.days.map(d=>'<span class="done">'+esc(d.day)+' ✓</span>').join('');
      }
      this.$('message').textContent=`Complete · ${days.length} days loaded. Latest data: ${new Date(this.days.map(d=>d.as_of).sort().at(-1)).toLocaleString('en-GB',{timeZone:'Asia/Amman'})}. ${this.hasAttribute('preview')?'Temporary view only. No KPI report was saved.':live?'Live refresh every five minutes while this page is visible.':''}`;
    }catch(error){if(this.generation===generation){this.$('message').classList.add('error');this.$('message').textContent=error.name==='AbortError'?'Loading stopped. Saved days are retained.':error.message}}
    finally{if(this.generation===generation){this.busy=false;this.$('load').disabled=false;this.$('cancel').hidden=true}}
  }
  renderResult(){
    const rows=dayReportsToKpi(this.days),p=value=>value==null?'—':value.toFixed(1)+'%';
    const preview=this.hasAttribute('preview'),html=rows.map(r=>'<article class="card" data-live-key="ucm:'+esc(r.username)+'"><strong>'+esc(r.agent_name)+'</strong><span class="badge">'+esc(r.username)+' · '+(preview?esc(this.days[0]?.day):r.active_days+' active days')+'</span><div class="metrics"><span>Calls<b>'+r.total_calls+'</b></span><span>Answered<b>'+r.answered_calls+'</b></span><span>Answer rate<b>'+p(r.answer_rate_score)+'</b></span><span>'+(preview?'Average talk<b>'+(r.average_talk_seconds==null?'—':Math.round(r.average_talk_seconds)+'s'):'Call KPI · no quality<b>'+p(r.kpi_score))+'</b></span></div></article>').join('')||'<p>No calls for this employee in the loaded days.</p>';
    if(globalThis.NewtelLiveDom)NewtelLiveDom.html(this.$('results'),html);else if(this.$('results').innerHTML!==html)this.$('results').innerHTML=html;
    this.dispatchEvent(new CustomEvent('ucm-performance',{bubbles:true,detail:{days:this.days,rows,complete:this.$('progress').value===this.$('progress').max}}));
  }
}
if(!customElements.get('ucm-performance-loader'))customElements.define('ucm-performance-loader',UcmPerformanceLoader);
