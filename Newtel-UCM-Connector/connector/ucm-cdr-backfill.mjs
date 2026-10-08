#!/usr/bin/env node
import {UcmClient,backfillCdr,createNodeTransport} from "./ucm-api.mjs";
const required=name=>{const value=process.env[name];if(!value)throw new Error(`${name} is required`);return value};
const args=Object.fromEntries(process.argv.slice(2).map(value=>value.split("=",2))),start=args["--from"],end=args["--to"];
if(!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(start||"")||!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(end||""))throw new Error("Usage: npm run ucm:backfill -- --from=YYYY-MM-DD --to=YYYY-MM-DD");
const client=new UcmClient({apiBaseUrl:required("UCM_API_BASE_URL"),cdrBaseUrl:process.env.UCM_CDR_BASE_URL||"",cdrMode:process.env.UCM_CDR_MODE||"auto",username:required("UCM_API_USERNAME"),password:required("UCM_API_PASSWORD"),cdrUsername:process.env.UCM_CDR_USERNAME||process.env.UCM_API_USERNAME,cdrPassword:process.env.UCM_CDR_PASSWORD||process.env.UCM_API_PASSWORD,transport:createNodeTransport({caFile:process.env.UCM_CA_FILE,pinEndpoint:process.env.UCM_API_BASE_URL,fingerprint:process.env.UCM_TLS_FINGERPRINT_SHA256,allowSelfSignedDev:process.env.UCM_ALLOW_SELF_SIGNED_DEV==="true"})});
await client.login();
const endpoint=required("CLOUDFLARE_CDR_ENDPOINT"),basic=Buffer.from(`${required("UCM_INGEST_USERNAME")}:${required("UCM_INGEST_PASSWORD")}`).toString("base64");
const sendBatch=async records=>{let delay=1000,lastError;for(let attempt=1;attempt<=5;attempt++){try{const response=await fetch(endpoint,{method:"POST",headers:{Authorization:`Basic ${basic}`,"Content-Type":"application/json"},body:JSON.stringify({records})});if(response.ok)return;throw new Error(`Cloudflare ingest returned ${response.status}`)}catch(error){lastError=error;if(attempt<5)await new Promise(resolve=>setTimeout(resolve,delay));delay=Math.min(16000,delay*2)}}throw lastError};
const total=await backfillCdr({client,start,end,sendBatch,onProgress:value=>console.log(JSON.stringify({level:"info",event:"ucm_backfill_progress",...value}))});
console.log(JSON.stringify({level:"info",event:"ucm_backfill_complete",total,start,end,mode:client.lastCdrMode}));
