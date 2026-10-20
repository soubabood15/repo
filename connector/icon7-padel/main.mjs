import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Icon7Provider,PROVIDER_URL} from './provider.mjs';
import {Journal,processJob,reportPending} from './runtime.mjs';
const directory=path.dirname(fileURLToPath(import.meta.url));
const configFile=path.join(directory,'private','config.json');
if(!fs.existsSync(configFile))throw new Error('Run windows/Setup.cmd first.');
const config=JSON.parse(fs.readFileSync(configFile,'utf8').replace(/^\uFEFF/,''));
const base=new URL(config.portal);
if(base.protocol!=='https:'||base.username||base.password||!config.secret||config.secret.length<32)throw new Error('HTTPS portal URL and connector secret (32+ characters) required.');
const login=process.argv.includes('--login'),check=process.argv.includes('--check');
const lock=path.join(directory,'private','running.lock');
let fd;
function takeLock() {
  try{fd=fs.openSync(lock,'wx');fs.writeFileSync(fd,String(process.pid))}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    const pid=Number(fs.readFileSync(lock,'utf8'));
    if(!Number.isInteger(pid)||pid<1)throw new Error('Invalid lock. Close the connector before removing private/running.lock.');
    try{process.kill(pid,0)}catch(check){if(check.code==='ESRCH'){fs.unlinkSync(lock);return takeLock()}throw check}
    throw new Error('Connector already running. Close it before starting another copy.');
  }
}
takeLock();
const release=()=>{try{fs.closeSync(fd);fs.unlinkSync(lock)}catch{}};
process.on('exit',release);
const {chromium}=await import('playwright');
let context;
try {
  context=await chromium.launchPersistentContext(path.join(directory,'private','browser'),{headless:!login,viewport:{width:1440,height:1000}});
  const page=context.pages()[0]||await context.newPage();
  const provider=new Icon7Provider(page);
  await page.goto(PROVIDER_URL,{waitUntil:'domcontentloaded'});
  if(login) {
    console.log('Sign in to ICON7 in the dedicated browser. Close the browser when the Available Times page is ready.');
    await new Promise(resolve=>context.on('close',resolve));
  }else {
    const api=async(route,body)=>{
      const response=await fetch(new URL('/integrations/icon7-padel'+route,base),{method:'POST',headers:{Authorization:'Bearer '+config.secret,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
      if(!response.ok)throw new Error('Portal connection rejected ('+response.status+').');return response.json();
    };
    const journal=new Journal(path.join(directory,'private','journal'));
    if(check) {
      const ready=await provider.ready();
      console.log(ready?'ICON7 login ready. Checking queue connection without claiming a job.':'Sign in using Login.cmd.');
      await api('/poll',{ready:false});
      console.log('Portal connection OK. No booking submitted.');
    }else {
      const stop=async()=>{await context.close().catch(()=>{});process.exit(0)};
      process.on('SIGINT',stop);process.on('SIGTERM',stop);
      console.log('ICON7 connector started. Keep this window running. Customer data is not printed.');
      let lastRefresh=Date.now();
      while(true) {
        try {
          await reportPending(journal,api);
          // Periodically revisit the provider so an expired session is detected while idle.
          if(Date.now()-lastRefresh>60000){await page.goto(PROVIDER_URL,{waitUntil:'domcontentloaded'});lastRefresh=Date.now()}
          const ready=await provider.ready();
          const {job}=await api('/poll',{ready});
          if(job) {
            await processJob(job,{provider,api,journal,maySubmit:config.booking_enabled===true});
            await reportPending(journal,api);
            lastRefresh=0;
          }
        }catch(error){console.error(new Date().toISOString(),error.message.startsWith('Portal')?error.message:'Connector paused. Check network, provider sign-in, and pending jobs.');}
        await new Promise(resolve=>setTimeout(resolve,5000));
      }
    }
  }
}finally{await context?.close().catch(()=>{});release()}
