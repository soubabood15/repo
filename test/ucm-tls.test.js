import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import https from "node:https";
import {X509Certificate} from "node:crypto";
import WebSocket,{WebSocketServer} from "ws";
import {createPinnedUcmAgent,normalizeFingerprint,verifyPinnedCertificate,safeConnectionError} from "../connector/ucm-tls.mjs";

test('pin validation fails closed and never exposes raw error text',()=>{
  assert.equal(normalizeFingerprint(Array(32).fill('AB').join(':')),'ab'.repeat(32));
  for(const pin of ['', '00', 'g'.repeat(64), 'ab '.repeat(32)])assert.throws(()=>normalizeFingerprint(pin),{code:'UCM_PIN_INVALID'});
  assert.equal(safeConnectionError(new Error('https://secret:password@internal/cookie')),'UCM_CONNECTION_FAILED');
  assert.throws(()=>createPinnedUcmAgent('http://localhost','aa'.repeat(32)),{code:'UCM_TLS_ENDPOINT_INVALID'});
});

test('TLS pin gates HTTPS and WebSocket payloads before releasing the socket',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'newtel-pin-test-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const key=path.join(dir,'key.pem'),cert=path.join(dir,'cert.pem');
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost,IP:127.0.0.1'],{stdio:'ignore'});
  const x509=new X509Certificate(fs.readFileSync(cert)),peer=x509.toLegacyObject(),pin=x509.fingerprint256;
  verifyPinnedCertificate(peer,'localhost',pin);
  assert.throws(()=>verifyPinnedCertificate(peer,'wrong.invalid',pin),{code:'UCM_CERT_HOSTNAME_MISMATCH'});
  assert.throws(()=>verifyPinnedCertificate(peer,'localhost','00'.repeat(32)),{code:'UCM_PIN_MISMATCH'});
  assert.throws(()=>verifyPinnedCertificate(peer,'localhost',pin,Date.parse(x509.validTo)+1),{code:'UCM_CERT_DATE_INVALID'});
  assert.throws(()=>verifyPinnedCertificate(peer,'localhost',pin,Date.parse(x509.validFrom)-1),{code:'UCM_CERT_DATE_INVALID'});
  let requests=0,websocketMessages=0;
  const server=https.createServer({key:fs.readFileSync(key),cert:fs.readFileSync(cert)},(_req,res)=>{requests++;res.end('ok')});
  const wss=new WebSocketServer({server});
  wss.on('connection',socket=>socket.on('message',()=>{websocketMessages++;socket.close()}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{wss.close();server.close()});
  const endpoint=`https://127.0.0.1:${server.address().port}`;
  const get=agent=>new Promise((resolve,reject)=>{const req=https.get(endpoint,{agent,headers:{Authorization:'Basic TEST_ONLY'}},res=>{res.resume();res.on('end',resolve)});req.on('error',reject)});
  await assert.rejects(get(undefined));assert.equal(requests,0,'normal CA validation remains enabled');
  const wrong=createPinnedUcmAgent(endpoint,'00'.repeat(32));t.after(()=>wrong.destroy());
  await assert.rejects(get(wrong),{code:'UCM_PIN_MISMATCH'});assert.equal(requests,0,'mismatch must send no HTTP authorization');
  const correct=createPinnedUcmAgent(endpoint,pin);t.after(()=>correct.destroy());
  await get(correct);assert.equal(requests,1);
  const connect=agent=>new Promise((resolve,reject)=>{const ws=new WebSocket(endpoint.replace('https:','wss:'),{agent,handshakeTimeout:2000});ws.on('open',()=>ws.send('TEST_ONLY_LOGIN'));ws.on('error',reject);ws.on('close',()=>resolve())});
  await assert.rejects(connect(wrong),{code:'UCM_PIN_MISMATCH'});assert.equal(websocketMessages,0,'mismatch must send no login');
  await connect(correct);assert.equal(websocketMessages,1);
});
