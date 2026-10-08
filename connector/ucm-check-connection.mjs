import fs from "node:fs";
import https from "node:https";
import {randomBytes,X509Certificate,createHash} from "node:crypto";
import {createPinnedUcmAgent,safeConnectionError} from "./ucm-tls.mjs";

if(process.argv[2]==="--fingerprint-file"){
  try{console.log(new X509Certificate(fs.readFileSync(process.argv[3])).fingerprint256)}catch{console.log("CERT_FILE_INVALID");process.exitCode=1}
}else{
  let agent,request,timer;
  const finish=result=>{clearTimeout(timer);console.log(JSON.stringify(result));request?.destroy();agent?.destroy();process.exitCode=result.result==="UPGRADE_OK"?0:1};
  try{
    if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==="0")throw Object.assign(new Error(),{code:"UCM_GLOBAL_TLS_BYPASS_FORBIDDEN"});
    const url=new URL(process.env.UCM_WS_URL);
    if(url.protocol!=="wss:"||url.username||url.password)throw Object.assign(new Error(),{code:"UCM_TLS_ENDPOINT_INVALID"});
    const pin=process.env.UCM_TLS_FINGERPRINT_SHA256;
    if(pin)agent=createPinnedUcmAgent(url,pin);
    url.protocol="https:";
    const key=randomBytes(16).toString("base64"),accept=createHash("sha1").update(key+"258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
    request=https.request(url,{agent,headers:{Connection:"Upgrade",Upgrade:"websocket","Sec-WebSocket-Version":"13","Sec-WebSocket-Key":key,Origin:process.env.UCM_WS_ORIGIN||url.origin}});
    let finished=false;
    const done=result=>{if(finished)return;finished=true;finish(result)};
    timer=setTimeout(()=>done({result:"TIMEOUT"}),15000);
    request.on("upgrade",(response,socket)=>{socket.destroy();const valid=response.statusCode===101&&response.headers["sec-websocket-accept"]===accept&&String(response.headers.upgrade).toLowerCase()==="websocket";done({result:valid?"UPGRADE_OK":"INVALID_UPGRADE",status:response.statusCode,tls_mode:pin?"certificate_pin":"certificate_authority"})});
    request.on("response",response=>{response.resume();done({result:"HTTP_REJECTED",status:response.statusCode})});
    request.on("error",error=>done({result:"CONNECTION_FAILED",code:safeConnectionError(error)}));
    request.end();
  }catch(error){finish({result:"CONFIGURATION_FAILED",code:safeConnectionError(error)})}
}
