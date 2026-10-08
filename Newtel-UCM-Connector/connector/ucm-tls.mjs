import https from "node:https";
import tls from "node:tls";
import net from "node:net";
import {X509Certificate, timingSafeEqual} from "node:crypto";

const failure=code=>Object.assign(new Error(code),{code});
export function normalizeFingerprint(value){
  const text=String(value||"").trim();
  if(!/^(?:[a-f\d]{64}|(?:[a-f\d]{2}:){31}[a-f\d]{2})$/i.test(text))throw failure("UCM_PIN_INVALID");
  return text.replaceAll(":","").toLowerCase();
}
export function verifyPinnedCertificate(peer,hostname,fingerprint,now=Date.now()){
  const pin=normalizeFingerprint(fingerprint);
  if(!peer?.raw)throw failure("UCM_CERT_MISSING");
  const certificate=new X509Certificate(peer.raw),actual=normalizeFingerprint(certificate.fingerprint256);
  if(!timingSafeEqual(Buffer.from(pin,"hex"),Buffer.from(actual,"hex")))throw failure("UCM_PIN_MISMATCH");
  if(now<Date.parse(certificate.validFrom)||now>Date.parse(certificate.validTo))throw failure("UCM_CERT_DATE_INVALID");
  if(tls.checkServerIdentity(hostname,peer))throw failure("UCM_CERT_HOSTNAME_MISMATCH");
}

// No HTTP headers, cookies or login payload are released until the TLS peer
// passes all pin, date and hostname checks. This agent is scoped to one UCM.
export function createPinnedUcmAgent(endpoint,fingerprint){
  const target=new URL(endpoint),pin=normalizeFingerprint(fingerprint);
  if(!["https:","wss:"].includes(target.protocol)||target.username||target.password)throw failure("UCM_TLS_ENDPOINT_INVALID");
  if(process.env.NODE_TLS_REJECT_UNAUTHORIZED==="0")throw failure("UCM_GLOBAL_TLS_BYPASS_FORBIDDEN");
  const host=target.hostname,port=Number(target.port||443),agent=new https.Agent({keepAlive:false,maxCachedSessions:0});
  agent.createConnection=(options,callback)=>{
    if(options.host!==host||Number(options.port||443)!==port){callback(failure("UCM_TLS_ENDPOINT_MISMATCH"));return}
    let settled=false;
    const socket=tls.connect({...options,host,port,servername:net.isIP(host)?undefined:host,rejectUnauthorized:false});
    const finish=(error)=>{
      if(settled)return;settled=true;
      if(error){socket.destroy();callback(failure(/^[A-Z0-9_]+$/.test(error.code||"")?error.code:"UCM_TLS_FAILED"));return}
      socket.setTimeout(0);callback(null,socket);
    };
    socket.setTimeout(12000,()=>finish(failure("UCM_TLS_TIMEOUT")));
    socket.once("error",finish);
    socket.once("secureConnect",()=>{try{verifyPinnedCertificate(socket.getPeerCertificate(),host,pin);finish()}catch(error){finish(error)}});
    // Intentionally return nothing: returning the unverified socket would let
    // https.request / ws send credentials before the checks above complete.
  };
  return agent;
}
export function safeConnectionError(error){
  return /^[A-Z0-9_]+$/.test(error?.code||"")?error.code:"UCM_CONNECTION_FAILED";
}
