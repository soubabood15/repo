import fs from 'node:fs';
import path from 'node:path';
export class Journal {
  constructor(directory){this.directory=directory;fs.mkdirSync(directory,{recursive:true})}
  file(id){if(!/^[\w-]{36}$/.test(id))throw new Error('Invalid job ID');return path.join(this.directory,id+'.json')}
  read(id){try{return JSON.parse(fs.readFileSync(this.file(id),'utf8'))}catch(error){if(error.code==='ENOENT')return null;throw error}}
  write(id,value){const file=this.file(id),temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(value),{mode:0o600});const fd=fs.openSync(temp,'r');try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}fs.renameSync(temp,file)}
  pending(){return fs.readdirSync(this.directory).filter(s=>/^[\w-]{36}\.json$/.test(s)).map(s=>JSON.parse(fs.readFileSync(path.join(this.directory,s),'utf8'))).filter(s=>!s.reported)}
}
export async function processJob(job,{provider,api,journal,maySubmit,now=()=>Date.now()}) {
  const previous=journal.read(job.id);
  if(previous)return previous;
  const record={id:job.id,claim_token:job.claim_token,status:'failed',result:{message:'تعذر تجهيز الحجز.'},reported:false};
  // Written before any external action. A crash is recovered as unknown, never a repeat click.
  journal.write(job.id,{...record,status:'unknown',result:{message:'توقف برنامج الربط أثناء الطلب. راجع أيكون قبل إعادة المحاولة.'}});
  let submitted=false;
  try {
    if(now()>=job.expires_at)throw new Error('انتهت مهلة الطلب قبل تنفيذه.');
    if(job.kind==='availability')record.result=await provider.slots(job.payload);
    else record.result=await provider.book(job,{maySubmit,beforeSubmit:async()=>{
      if(now()>=job.expires_at)throw new Error('انتهت مهلة الطلب قبل الإرسال.');
      await api('/begin',{id:job.id,claim_token:job.claim_token});
      submitted=true;
      journal.write(job.id,{...record,status:'unknown',result:{message:'بدأ إرسال الحجز. يلزم التحقق من أيكون إذا انقطع الاتصال.'}});
    }});
    record.status='confirmed';
  }catch(error){record.status=submitted?'unknown':'failed';record.result={message:error.message}}
  journal.write(job.id,record);return record;
}
export async function reportPending(journal,api) {
  for(const record of journal.pending()) {
    await api('/result',record);
    journal.write(record.id,{...record,reported:true});
  }
}
