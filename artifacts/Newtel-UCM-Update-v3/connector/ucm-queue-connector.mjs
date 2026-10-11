import path from 'node:path';
import {startQueueConnector} from './ucm-queue-runtime.mjs';
import {startDaySync} from './ucm-day-sync.mjs';
const config={...process.env};
config.UCM_OUTBOX_FILE||=process.env.ProgramData?path.join(process.env.ProgramData,'Newtel','UcmConnector','state','queue-outbox.json'):path.resolve('connector-state','queue-outbox.json');
const connector=startQueueConnector(config);
const days=startDaySync(config);
console.log(JSON.stringify({level:'info',event:'ucm_cost_controlled_sync',events:['login','logout'],cdr:'on_demand_shared_daily_summaries',pauses:'local_observations'}));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{days.stop();connector.stop();process.exit(0)});
