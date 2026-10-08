import fs from 'node:fs';
import path from 'node:path';
export class UcmOutbox {
  constructor({file,forward,log=()=>{},retryMs=1000,maxRetryMs=60000}){
    this.file=file;this.forward=forward;this.log=log;this.retryMs=retryMs;this.maxRetryMs=maxRetryMs;this.delay=retryMs;this.running=false;this.timer=null;this.stopped=false;
    this.pending=file&&fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):[];
    if(!Array.isArray(this.pending)||this.pending.some(e=>!e?.event_id))throw new Error('UCM_OUTBOX_INVALID');
  }
  save(){if(!this.file)return;fs.mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700});const temp=this.file+'.tmp';fs.writeFileSync(temp,JSON.stringify(this.pending),{mode:0o600});fs.renameSync(temp,this.file)}
  enqueue(events){const ids=new Set(this.pending.map(e=>e.event_id));for(const event of events){if(!ids.has(event.event_id)){this.pending.push(event);ids.add(event.event_id)}}this.save();void this.flush()}
  async flush(){
    if(this.running||this.stopped)return;clearTimeout(this.timer);this.timer=null;this.running=true;
    try{while(this.pending.length&&!this.stopped){try{await this.forward(this.pending[0]);this.pending.shift();this.save();this.delay=this.retryMs;this.log({level:'info',event:'cloudflare_event_delivered',queued:this.pending.length})}catch(error){this.log({level:'error',event:'cloudflare_forward_failed',code:/^[A-Z0-9_]+$/.test(error.code||'')?error.code:'CF_DELIVERY_FAILED',queued:this.pending.length});this.timer=setTimeout(()=>{this.timer=null;void this.flush()},this.delay);this.delay=Math.min(this.maxRetryMs,this.delay*2);break}}}finally{this.running=false}
  }
  stop(){this.stopped=true;clearTimeout(this.timer)}
}
