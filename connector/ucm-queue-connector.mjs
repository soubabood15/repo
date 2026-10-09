import path from 'node:path';
import {startQueueConnector} from './ucm-queue-runtime.mjs';
import {startCdrSync} from './ucm-cdr-sync.mjs';
const config={...process.env};
config.UCM_OUTBOX_FILE||=process.env.ProgramData?path.join(process.env.ProgramData,'Newtel','UcmConnector','state','queue-outbox.json'):path.resolve('connector-state','queue-outbox.json');
const connector=startQueueConnector(config);
let cdr;
try{cdr=startCdrSync(config)}catch{console.error(JSON.stringify({level:'error',event:'ucm_cdr_sync_failed',code:'CDR_SYNC_START_FAILED'}))}
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{cdr?.stop();connector.stop();process.exit(0)});
