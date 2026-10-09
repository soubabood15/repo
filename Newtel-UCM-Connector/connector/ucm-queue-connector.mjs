import path from 'node:path';
import {startQueueConnector} from './ucm-queue-runtime.mjs';
const config={...process.env};
config.UCM_OUTBOX_FILE||=process.env.ProgramData?path.join(process.env.ProgramData,'Newtel','UcmConnector','state','queue-outbox.json'):path.resolve('connector-state','queue-outbox.json');
const connector=startQueueConnector(config);
console.log(JSON.stringify({level:'info',event:'ucm_attendance_only',events:['login','logout']}));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{connector.stop();process.exit(0)});
