import bcrypt from "bcryptjs";
import {aggregateQueueDay,ammanDateKey,normalizeCdr,normalizeQueueEvent} from "./ucm-core.js";
import {createHrHandler,cleanupHrFiles} from './hr-service.js';
import {authorizeUcmIngest,ucmBodyHash} from './ucm-ingest-auth.js';
import {ucmKpiScores} from './ucm-kpi.js';
import {hrShiftValue} from './hr-core.js';
import {ucmRepairDownload} from './ucm-repair-download.js';
import {flattenCdrPayload} from './connector/ucm-cdr-format.mjs';
import {finishDailyUcmSync,ucmMonthWindow} from './ucm-retention.js';
const TABLES = new Set([
  "admin_live_daily_logs","admin_live_pings","agent_kpi_monthly","agent_sessions","app_control",
  "cases","ebook_permissions","ebook_sessions","groups","icon7_items","knowledge_change_requests",
  "live_agent_sessions","live_agents","passkeys","quality_access_requests","quality_calls",
  "quality_presence","saraya_kb_items","saraya_kb_sections","schedule_month_archive",
  "schedule_week_archive","sections","shift_swap_requests","solutions","trainer_users",
  "ucm_agent_mapping","ucm_cdr","ucm_queue_events","ucm_agent_daily","ucm_sync_state","ucm_ingest_failures"
]);
const PUBLIC_READ = new Set(["app_control","sections","groups","cases","solutions","icon7_items","saraya_kb_items","saraya_kb_sections"]);
const UCM_ADMIN_TABLES = new Set(["agent_kpi_monthly","ucm_agent_mapping","ucm_cdr","ucm_queue_events","ucm_agent_daily","ucm_sync_state","ucm_ingest_failures"]);
const BOOLEAN_COLUMNS = {
  agent_sessions:["is_visible"], cases:["escalation","refund"], ebook_permissions:["is_allowed"],
  ebook_sessions:["is_visible"], icon7_items:["is_active"], live_agents:["is_visible"],
  quality_presence:["page_visible"], saraya_kb_items:["escalation_required","active"],
  saraya_kb_sections:["active"], trainer_users:["active"]
};
const JSON_COLUMNS = {
  agent_kpi_monthly:["details"], agent_sessions:["device_info"], ebook_sessions:["device_info"],
  knowledge_change_requests:["proposed_data"], live_agents:["device_info"],
  schedule_month_archive:["weeks","schedule_json"], schedule_week_archive:["schedule_json"],
  ucm_cdr:["raw_json"],ucm_queue_events:["raw_json"],ucm_ingest_failures:["payload_json"]
};
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const DAILY_LOG_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;
let lastDailyLogCleanupAt = 0;

async function cleanupExpiredLiveData(env, force = false) {
  const now = Date.now();
  if (!force && now - lastDailyLogCleanupAt < 60 * 60 * 1000) return;
  lastDailyLogCleanupAt = now;
  const cutoff = new Date(now - DAILY_LOG_RETENTION_MS).toISOString(),failureCutoff=new Date(now-14*86400000).toISOString();
  await env.trainer_kb.batch([
    env.trainer_kb.prepare("DELETE FROM admin_live_daily_logs WHERE COALESCE(pinged_at, created_at) < ?").bind(cutoff),
    env.trainer_kb.prepare("DELETE FROM admin_live_pings WHERE COALESCE(last_ping_at, updated_at, created_at) < ?").bind(cutoff),
    // UCM months rotate only after a successful complete preceding-month sync.
    env.trainer_kb.prepare("DELETE FROM ucm_ingest_failures WHERE created_at < ?").bind(failureCutoff)
    ,env.trainer_kb.prepare('DELETE FROM ucm_ingest_receipts WHERE expires_at < ?').bind(new Date(now).toISOString())
  ]);
}

function cors(origin = "*") {
  const allowOrigin = (!origin || origin === "null") ? "*" : origin;
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,HEAD,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Expose-Headers": "content-range,location",
    Vary: "Origin"
  };
}

function json(value, status = 200, extra = {}, origin = "*") {
  return new Response(value === null ? "" : JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...cors(origin), ...extra }
  });
}

const encoder = new TextEncoder();
function b64url(value) {
  const bytes = value instanceof Uint8Array ? value : encoder.encode(value);
  let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}
function decodePart(value) {
  const base = value.replace(/-/g,"+").replace(/_/g,"/").padEnd(Math.ceil(value.length/4)*4,"=");
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(base), c=>c.charCodeAt(0))));
}
async function hmac(secret, value) {
  const key = await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign","verify"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC",key,encoder.encode(value)));
}
async function signJwt(env, payload) {
  const head=b64url(JSON.stringify({alg:"HS256",typ:"JWT"})), body=b64url(JSON.stringify(payload));
  return `${head}.${body}.${b64url(await hmac(env.AUTH_JWT_SECRET,`${head}.${body}`))}`;
}
async function verifyJwt(env, token) {
  try {
    const [head,body,signature]=token.split("."); if(!signature)return null;
    const expected=b64url(await hmac(env.AUTH_JWT_SECRET,`${head}.${body}`));
    if(expected!==signature)return null;
    const payload=decodePart(body); if(Number(payload.exp||0)<=Math.floor(Date.now()/1000))return null;
    return payload;
  } catch { return null; }
}

function publicUser(account) {
  let metadata={}; try{metadata=JSON.parse(account.user_metadata||"{}")}catch{}
  return {id:account.id,aud:"authenticated",role:"authenticated",email:account.email,email_confirmed_at:account.created_at,confirmed_at:account.created_at,last_sign_in_at:account.last_sign_in_at,app_metadata:{provider:"email",providers:["email"]},user_metadata:metadata,created_at:account.created_at,updated_at:account.created_at};
}

async function currentAccount(request, env) {
  const auth=request.headers.get("Authorization")||""; if(!auth.startsWith("Bearer "))return null;
  const payload=await verifyJwt(env,auth.slice(7)); if(!payload?.sub)return null;
  const account=await env.trainer_kb.prepare("SELECT * FROM auth_accounts WHERE id=? AND active=1").bind(payload.sub).first();
  return account?{account,payload}:null;
}

async function issueSession(env, account) {
  const now=Math.floor(Date.now()/1000), sessionId=crypto.randomUUID(), refreshToken=`rt_${crypto.randomUUID()}${crypto.randomUUID()}`;
  await env.trainer_kb.prepare("DELETE FROM auth_sessions WHERE expires_at < ?").bind(new Date().toISOString()).run();
  await env.trainer_kb.prepare("INSERT INTO auth_sessions (id,user_id,refresh_token,expires_at) VALUES (?,?,?,?)").bind(sessionId,account.id,refreshToken,new Date((now+30*86400)*1000).toISOString()).run();
  await env.trainer_kb.prepare("UPDATE auth_accounts SET last_sign_in_at=? WHERE id=?").bind(new Date().toISOString(),account.id).run();
  const accessToken=await signJwt(env,{sub:account.id,email:account.email,role:"authenticated",aud:"authenticated",session_id:sessionId,iat:now,exp:now+3600});
  return {access_token:accessToken,token_type:"bearer",expires_in:3600,expires_at:now+3600,refresh_token:refreshToken,user:publicUser({...account,last_sign_in_at:new Date().toISOString()})};
}

async function authRoute(request, env, url) {
  const origin=request.headers.get("Origin")||"*";
  if(url.pathname==="/auth/v1/token"&&request.method==="POST"){
    const body=await request.json(), grant=url.searchParams.get("grant_type");
    if(grant==="password"){
      const email=String(body.email||"").trim().toLowerCase();
      const account=await env.trainer_kb.prepare("SELECT * FROM auth_accounts WHERE email=? AND active=1").bind(email).first();
      if(!account||!(await bcrypt.compare(String(body.password||""),account.password_hash)))return json({code:400,error_code:"invalid_credentials",msg:"Invalid login credentials"},400,{},origin);
      return json(await issueSession(env,account),200,{"Cache-Control":"no-store"},origin);
    }
    if(grant==="refresh_token"){
      const row=await env.trainer_kb.prepare("SELECT a.* FROM auth_sessions s JOIN auth_accounts a ON a.id=s.user_id WHERE s.refresh_token=? AND s.expires_at>? AND a.active=1").bind(String(body.refresh_token||""),new Date().toISOString()).first();
      if(!row)return json({code:401,error_code:"refresh_token_not_found",msg:"Invalid Refresh Token"},401,{},origin);
      return json(await issueSession(env,row),200,{"Cache-Control":"no-store"},origin);
    }
  }
  if(url.pathname==="/auth/v1/user"&&request.method==="GET"){
    const auth=await currentAccount(request,env); return auth?json(publicUser(auth.account),200,{},origin):json({message:"Invalid token"},401,{},origin);
  }
  if(url.pathname==="/auth/v1/logout"&&request.method==="POST"){
    const auth=await currentAccount(request,env); if(auth?.payload?.session_id)await env.trainer_kb.prepare("DELETE FROM auth_sessions WHERE id=?").bind(auth.payload.session_id).run();
    return new Response(null,{status:204,headers:cors(origin)});
  }
  if(url.pathname==="/auth/v1/settings")return json({external:{},disable_signup:true,mailer_autoconfirm:true},200,{},origin);
  return json({message:"Auth route not found"},404,{},origin);
}

function cleanColumn(value) {
  const name = String(value || "").trim();
  if (!IDENT.test(name)) throw new Error(`Invalid column: ${name}`);
  return name;
}

function parseIn(raw) {
  const text = raw.startsWith("(") && raw.endsWith(")") ? raw.slice(1, -1) : raw;
  return text.split(",").map(v => decodeURIComponent(v).replace(/^"|"$/g, ""));
}

function whereFrom(url) {
  const clauses = [], values = [];
  const ignored = new Set(["select","order","limit","offset","on_conflict"]);
  for (const [key, raw] of url.searchParams) {
    if (ignored.has(key)) continue;
    const column = cleanColumn(key);
    const dot = raw.indexOf(".");
    const op = dot < 0 ? "eq" : raw.slice(0, dot);
    const value = dot < 0 ? raw : raw.slice(dot + 1);
    if (op === "in") {
      const list = parseIn(value);
      if (!list.length) { clauses.push("0"); continue; }
      clauses.push(`${column} IN (${list.map(() => "?").join(",")})`); values.push(...list);
    } else if (op === "is" && value === "null") clauses.push(`${column} IS NULL`);
    else if (op === "not" && value === "null") clauses.push(`${column} IS NOT NULL`);
    else {
      const sqlOp = { eq:"=", neq:"!=", gt:">", gte:">=", lt:"<", lte:"<=", like:"LIKE", ilike:"LIKE" }[op];
      if (!sqlOp) throw new Error(`Unsupported filter: ${op}`);
      clauses.push(`${column} ${sqlOp} ?`); values.push(value === "true" ? 1 : value === "false" ? 0 : value);
    }
  }
  return { sql: clauses.length ? ` WHERE ${clauses.join(" AND ")}` : "", values };
}

async function columnsFor(db, table) {
  const result = await db.prepare(`PRAGMA table_info(${table})`).all();
  return new Set((result.results || []).map(row => row.name));
}

function selectedColumns(url, allowed) {
  const requested = url.searchParams.get("select") || "*";
  if (requested === "*") return "*";
  return requested.split(",").map(part => cleanColumn(part.split(":").pop())).filter(c => allowed.has(c)).join(",") || "*";
}

function postgresArray(value) {
  if (Array.isArray(value) || typeof value !== "string" || !value.startsWith("{") || !value.endsWith("}")) return value;
  const body = value.slice(1, -1); if (!body) return [];
  return body.split(",").map(item => item.replace(/^"|"$/g, "").replace(/\\"/g, '"'));
}

function normalizeRows(table, rows) {
  return rows.map(source => {
    const row = { ...source };
    for (const key of BOOLEAN_COLUMNS[table] || []) if (key in row && row[key] !== null) row[key] = Boolean(row[key]);
    for (const key of JSON_COLUMNS[table] || []) if (typeof row[key] === "string") { try { row[key] = JSON.parse(row[key]); } catch {} }
    if(table==='agent_kpi_monthly'&&row.details?.source==='ucm_api'){
      const columns={quality:'quality_score',response:'response_score',handling:'handling_score'};
      for(const key of row.details.unavailable_scores||[])if(columns[key])row[columns[key]]=null;
    }
    if (table === "saraya_kb_items" && "keywords" in row) row.keywords = postgresArray(row.keywords);
    return row;
  });
}

async function verifyWrite(request, env) { return Boolean(await currentAccount(request,env)); }

export async function swapScheduleError(db,swap){
  const date=String(swap.swap_date||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return 'Invalid swap date';
  const day=['sun','mon','tue','wed','thu','fri','sat'][new Date(date+'T12:00:00Z').getUTCDay()];
  for(const username of [swap.requester_username,swap.target_username]){
    const exact=await db.prepare('SELECT value FROM app_control WHERE key=?').bind(`shift_${username}_${date}`).first();
    const weekly=exact?.value?null:await db.prepare('SELECT value FROM app_control WHERE key=?').bind(`shift_${username}_${day}`).first();
    const shift=String(exact?.value||weekly?.value||'').trim().toLowerCase();
    if(!shift)return 'Both agents must have saved shifts for this day';
    if(['off','day off','اوف','أوف'].includes(shift))return 'OFF days cannot be swapped';
  }
  return null;
}

async function rest(request, env, url, table) {
  if (!TABLES.has(table)) return json({ message: "Unknown table" }, 404, {}, request.headers.get("Origin") || "*");
  const origin = request.headers.get("Origin") || "*";
  const allowed = await columnsFor(env.trainer_kb, table);
  const method = request.method;
  const { sql: where, values } = whereFrom(url);
  if (method === "GET" || method === "HEAD") {
    if (!PUBLIC_READ.has(table) && !(await verifyWrite(request,env))) return json({ message: "Valid login required" }, 401, {}, origin);
    if(UCM_ADMIN_TABLES.has(table)&&!(await requireAdmin(request,env)))return json({message:"Administrator access required"},403,{},origin);
    const select = selectedColumns(url, allowed);
    let sql = `SELECT ${select} FROM ${table}${where}${table==='agent_kpi_monthly'?`${where?' AND ':' WHERE '}json_extract(details,'$.source')='ucm_api' AND total_calls>0`:''}`;
    const order = url.searchParams.get("order");
    if (order) sql += " ORDER BY " + order.split(",").map(item => { const [col, dir] = item.split("."); return `${cleanColumn(col)} ${dir === "desc" ? "DESC" : "ASC"}`; }).join(",");
    const limit = Math.min(Number(url.searchParams.get("limit") || 10000), 10000);
    const offset = Math.max(Number(url.searchParams.get("offset") || 0), 0);
    sql += ` LIMIT ${limit} OFFSET ${offset}`;
    const result = await env.trainer_kb.prepare(sql).bind(...values).all();
    const rows = normalizeRows(table, result.results || []);
    const wantsObject = (request.headers.get("Accept") || "").includes("vnd.pgrst.object");
    const body = wantsObject ? (rows[0] || null) : rows;
    return method === "HEAD" ? new Response(null, { status: 200, headers: cors(origin) }) : json(body, 200, {}, origin);
  }
  if (!(await verifyWrite(request,env))) return json({ message: "Valid login required" }, 401, {}, origin);
  if(['ucm_cdr','ucm_queue_events','ucm_agent_daily','agent_kpi_monthly'].includes(table)&&['POST','PATCH'].includes(method))return json({message:'UCM data is synchronized by the integration only. Manual publishing is disabled.'},403,{},origin);
  if(['trainer_users','app_control'].includes(table)&&!(await requireAdmin(request,env)))return json({message:'Administrator access required'},403,{},origin);
  if(table==="shift_swap_requests"&&method==="DELETE"&&!(await requireAdmin(request,env)))return json({message:"Administrator access required"},403,{},origin);
  if(table==="quality_calls"&&method==="DELETE"&&!(await requireAdmin(request,env)))return json({message:"Administrator access required"},403,{},origin);
  if(UCM_ADMIN_TABLES.has(table)&&!(await requireAdmin(request,env)))return json({message:"Administrator access required"},403,{},origin);
  if (method === "POST") {
    const input = await request.json();
    const rows = Array.isArray(input) ? input : [input];
    const written = [];
    for (const source of rows) {
      if(table==='shift_swap_requests'){
        const error=await swapScheduleError(env.trainer_kb,source);
        if(error)return json({message:error},400,{},origin);
      }
      const row = Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key)));
      if (allowed.has("id") && !row.id) row.id = crypto.randomUUID();
      const keys = Object.keys(row); if (!keys.length) continue;
      const conflict = url.searchParams.get("on_conflict");
      const merge = (request.headers.get("Prefer") || "").includes("resolution=merge-duplicates");
      let sql = `INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`;
      if (merge && conflict && IDENT.test(conflict)) sql += ` ON CONFLICT(${conflict}) DO UPDATE SET ${keys.filter(k => k !== conflict).map(k => `${k}=excluded.${k}`).join(",")}`;
      await env.trainer_kb.prepare(sql).bind(...keys.map(k => typeof row[k] === "object" && row[k] !== null ? JSON.stringify(row[k]) : row[k])).run();
      written.push(row);
    }
    return json((request.headers.get("Prefer") || "").includes("return=representation") ? written : null, 201, {}, origin);
  }
  if (method === "PATCH") {
    const source = await request.json();
    if(table==='shift_swap_requests'&&['agent_approved','approved'].includes(source.status)){
      const swaps=await env.trainer_kb.prepare(`SELECT * FROM shift_swap_requests${where}`).bind(...values).all();
      for(const swap of swaps.results||[]){
        const error=await swapScheduleError(env.trainer_kb,swap);
        if(error)return json({message:error},400,{},origin);
      }
    }
    const row = Object.fromEntries(Object.entries(source).filter(([key]) => allowed.has(key)));
    const keys = Object.keys(row); if (!keys.length) return json([], 200, {}, origin);
    const sql = `UPDATE ${table} SET ${keys.map(k => `${k}=?`).join(",")}${where}`;
    await env.trainer_kb.prepare(sql).bind(...keys.map(k => typeof row[k] === "object" && row[k] !== null ? JSON.stringify(row[k]) : row[k]), ...values).run();
    return json([], 200, {}, origin);
  }
  if (method === "DELETE") {
    await env.trainer_kb.prepare(`DELETE FROM ${table}${where}`).bind(...values).run();
    return json([], 200, {}, origin);
  }
  return json({ message: "Method not allowed" }, 405, {}, origin);
}

async function requireAdmin(request,env){
  const auth=await currentAccount(request,env); if(!auth)return null;
  const profile=await env.trainer_kb.prepare("SELECT id,username,role,active FROM trainer_users WHERE auth_user_id=? AND active=1").bind(auth.account.id).first();
  return profile&&String(profile.role).toLowerCase()==="admin"?{...auth,profile}:null;
}
const hrRoute=createHrHandler({json,hashPassword:password=>bcrypt.hash(password,12),authenticate:async(request,env)=>{
  const auth=await currentAccount(request,env);if(!auth)return null;
  const profile=await env.trainer_kb.prepare('SELECT id,username,full_name,role FROM trainer_users WHERE auth_user_id=? AND active=1').bind(auth.account.id).first();
  return profile?{...auth,profile}:null;
}});
async function qualityRevisions(request,env){
  const origin=request.headers.get('Origin')||'*';
  if(!(await requireAdmin(request,env)))return json({message:'Administrator access required'},403,{},origin);
  const result=await env.trainer_kb.prepare("SELECT key,value FROM app_control WHERE key LIKE 'quality_revision_%'").all();
  if(!(result.results||[]).some(row=>row.key==='quality_revision_ready'&&row.value==='1'))return json({message:'Quality cache migration 0004 must be applied before enabling change-only refresh.'},503,{},origin);
  const months=Object.fromEntries((result.results||[]).filter(row=>/^quality_revision_\d{4}-\d{2}$/.test(row.key)).map(row=>[row.key.slice('quality_revision_'.length),row.value]));
  return json({months},200,{'Cache-Control':'no-store'},origin);
}

async function adminCreateUser(request,env){
  const origin=request.headers.get("Origin")||"*", admin=await requireAdmin(request,env);
  if(!admin)return json({error:"Administrator access required"},403,{},origin);
  const body=await request.json(), action=String(body.action||"create");
  if(action==="create"){
    const username=String(body.username||"").trim().toLowerCase(), password=String(body.password||""), fullName=String(body.full_name||"").trim(), role=String(body.role||"agent").toLowerCase();
    if(!/^[a-z0-9._-]{3,50}$/.test(username))return json({error:"Invalid username"},400,{},origin);
    if(password.length<10)return json({error:"Password must be at least 10 characters"},400,{},origin);
    if(!["agent","trainer","quality","admin","hr","hr_admin"].includes(role))return json({error:"Invalid role"},400,{},origin);
    const id=crypto.randomUUID(), profileId=crypto.randomUUID(), email=`${username}@ebook.com`, hash=await bcrypt.hash(password,12), now=new Date().toISOString();
    const exists=await env.trainer_kb.prepare("SELECT 1 FROM auth_accounts WHERE email=?").bind(email).first(); if(exists)return json({error:"User already exists"},409,{},origin);
    await env.trainer_kb.batch([
      env.trainer_kb.prepare("INSERT INTO auth_accounts (id,email,password_hash,user_metadata,created_at,active) VALUES (?,?,?,?,?,1)").bind(id,email,hash,JSON.stringify({username,full_name:fullName||username,role}),now),
      env.trainer_kb.prepare("INSERT INTO trainer_users (id,full_name,username,role,active,created_at,updated_at,auth_user_id) VALUES (?,?,?,?,1,?,?,?)").bind(profileId,fullName||username,username,role,now,now,id)
    ]);
    return json({user:{id:profileId,username,full_name:fullName||username,role,active:true}},201,{},origin);
  }
  const profileId=String(body.user_id||""), target=await env.trainer_kb.prepare("SELECT id,username,auth_user_id FROM trainer_users WHERE id=?").bind(profileId).first();
  if(!target?.auth_user_id)return json({error:"Target user not found"},404,{},origin);
  if(target.auth_user_id===admin.account.id&&["delete","set_active"].includes(action))return json({error:"You cannot disable or delete your own Admin account"},400,{},origin);
  if(action==="change_password"){
    const password=String(body.password||""); if(password.length<10)return json({error:"Password must be at least 10 characters"},400,{},origin);
    await env.trainer_kb.prepare("UPDATE auth_accounts SET password_hash=? WHERE id=?").bind(await bcrypt.hash(password,12),target.auth_user_id).run();
  }else if(action==="set_active"){
    const active=body.active===true?1:0; await env.trainer_kb.batch([env.trainer_kb.prepare("UPDATE auth_accounts SET active=? WHERE id=?").bind(active,target.auth_user_id),env.trainer_kb.prepare("UPDATE trainer_users SET active=?,updated_at=? WHERE id=?").bind(active,new Date().toISOString(),profileId)]);
    if(!active)await env.trainer_kb.prepare("DELETE FROM auth_sessions WHERE user_id=?").bind(target.auth_user_id).run();
  }else if(action==="delete"){
    await env.trainer_kb.batch([env.trainer_kb.prepare("DELETE FROM auth_sessions WHERE user_id=?").bind(target.auth_user_id),env.trainer_kb.prepare("DELETE FROM auth_accounts WHERE id=?").bind(target.auth_user_id),env.trainer_kb.prepare("DELETE FROM trainer_users WHERE id=?").bind(profileId)]);
  }else return json({error:"Unsupported action"},400,{},origin);
  return json({ok:true},200,{},origin);
}

async function signedObjectUrl(env,url,bucket,path,seconds=300){
  const expires=Math.floor(Date.now()/1000)+Math.max(30,Math.min(Number(seconds)||300,86400)), value=`${bucket}/${path}:${expires}`, sig=b64url(await hmac(env.AUTH_JWT_SECRET,value));
  return `${url.origin}/storage/v1/object/signed/${encodeURIComponent(bucket)}/${path.split("/").map(encodeURIComponent).join("/")}?expires=${expires}&sig=${sig}`;
}

async function storageRoute(request,env,url){
  const origin=request.headers.get("Origin")||"*", prefix="/storage/v1/object/", rest=decodeURIComponent(url.pathname.slice(prefix.length));
  if(rest.split('/').includes('hr-sick-leaves'))return json({message:'Use the private HR attachment endpoint'},403,{},origin);
  if(url.pathname.startsWith(prefix+"sign/")&&request.method==="POST"){
    if(!(await currentAccount(request,env)))return json({message:"Invalid token"},401,{},origin);
    const key=rest.slice(5), slash=key.indexOf("/"), bucket=key.slice(0,slash), path=key.slice(slash+1), body=await request.json();
    const signedURL=await signedObjectUrl(env,url,bucket,path,body.expiresIn); return json({signedURL},200,{},origin);
  }
  if(url.pathname.startsWith(prefix+"signed/")&&request.method==="GET"){
    const key=rest.slice(7), slash=key.indexOf("/"), bucket=key.slice(0,slash), path=key.slice(slash+1), expires=Number(url.searchParams.get("expires")), sig=url.searchParams.get("sig")||"";
    if(expires<Math.floor(Date.now()/1000)||sig!==b64url(await hmac(env.AUTH_JWT_SECRET,`${bucket}/${path}:${expires}`)))return json({message:"Signed URL expired"},401,{},origin);
    const object=await env.trainer_kb_files.get(`${bucket}/${path}`); if(!object)return json({message:"Object not found"},404,{},origin);
    const headers=new Headers(cors(origin)); object.writeHttpMetadata(headers); headers.set("etag",object.httpEtag); return new Response(object.body,{headers});
  }
  if(url.pathname.startsWith(prefix+"public/")&&request.method==="GET"){
    const key=rest.slice(7), object=await env.trainer_kb_files.get(key); if(!object)return json({message:"Object not found"},404,{},origin);
    const headers=new Headers(cors(origin)); object.writeHttpMetadata(headers); headers.set("etag",object.httpEtag); return new Response(object.body,{headers});
  }
  if(request.method==="DELETE"){
    if(!(await currentAccount(request,env)))return json({message:"Invalid token"},401,{},origin);
    const slash=rest.indexOf("/"), bucket=slash<0?rest:rest.slice(0,slash), body=await request.json(), prefixes=Array.isArray(body.prefixes)?body.prefixes:[];
    await Promise.all(prefixes.map(path=>env.trainer_kb_files.delete(`${bucket}/${path}`))); return json([],200,{},origin);
  }
  return json({message:"Storage route not found"},404,{},origin);
}

async function storageUsage(env){
  let total=0,cursor; do{const page=await env.trainer_kb_files.list({cursor});for(const object of page.objects)total+=object.size;cursor=page.truncated?page.cursor:undefined}while(cursor); return total;
}

function parsePayload(text,contentType=""){
  if(contentType.includes("json"))return JSON.parse(text||"{}");
  try{return JSON.parse(text||"{}") }catch{return Object.fromEntries(new URLSearchParams(text))}
}
function dayBounds(day){const start=new Date(`${day}T00:00:00+03:00`),end=new Date(start);end.setDate(end.getDate()+1);return [start.toISOString(),end.toISOString()]}
async function mappingFor(env,extension){return env.trainer_kb.prepare("SELECT username FROM ucm_agent_mapping WHERE extension=? AND active=1").bind(extension).first()}
async function ucmShiftFor(env,username,day){
  const weekday=['sun','mon','tue','wed','thu','fri','sat'][new Date(day+'T12:00:00Z').getUTCDay()];
  const result=await env.trainer_kb.prepare('SELECT key,value FROM app_control WHERE key IN (?,?)').bind(`shift_${username}_${day}`,`shift_${username}_${weekday}`).all();
  return hrShiftValue(result.results||[],username,day);
}
async function bumpUcmCursor(env,status="ok",errorMessage=null){
  const now=new Date().toISOString();await env.trainer_kb.prepare("INSERT INTO ucm_sync_state(key,value,status,error_message,updated_at) VALUES('change_cursor','1',?,?,?) ON CONFLICT(key) DO UPDATE SET value=CAST(COALESCE(ucm_sync_state.value,'0') AS INTEGER)+1,status=excluded.status,error_message=excluded.error_message,updated_at=excluded.updated_at").bind(status,errorMessage,now).run();
}
async function recomputeAgentDay(env,extension,day){
  const mapping=await mappingFor(env,extension);if(!mapping?.username)return;
  const shift=await ucmShiftFor(env,mapping.username,day),match=shift.match(/(\d{1,2}:\d{2})\s*(?:-|to)\s*(\d{1,2}:\d{2})/i),isOff=shift.toUpperCase()==="OFF";
  const [from,normalTo]=dayBounds(day),overnight=Boolean(match&&match[2]<=match[1]),to=overnight?new Date(new Date(normalTo).getTime()+12*60*60*1000).toISOString():normalTo,eventResult=await env.trainer_kb.prepare("SELECT event_type,reason,occurred_at FROM ucm_queue_events WHERE agent_extension=? AND occurred_at>=? AND occurred_at<? ORDER BY occurred_at").bind(extension,from,to).all();
  const attendance=aggregateQueueDay(eventResult.results||[],{date:day,shiftStart:match?.[1]||null,shiftEnd:match?.[2]||null,graceMinutes:10,isOff});
  const calls=await env.trainer_kb.prepare("SELECT COUNT(*) total_calls,SUM(answered) answered_calls,SUM(CASE WHEN answered=0 THEN 1 ELSE 0 END) missed_calls,SUM(CASE WHEN direction='inbound' THEN 1 ELSE 0 END) inbound_calls,SUM(CASE WHEN direction='outbound' THEN 1 ELSE 0 END) outbound_calls,SUM(talk_seconds) talk_seconds,SUM(wait_seconds) wait_seconds FROM ucm_cdr WHERE agent_extension=? AND started_at>=? AND started_at<?").bind(extension,from,to).first();
  const now=new Date().toISOString();
  await env.trainer_kb.prepare("INSERT INTO ucm_agent_daily(username,agent_extension,day,first_login,last_logout,break_seconds,work_seconds,late_minutes,attendance_status,total_calls,answered_calls,missed_calls,inbound_calls,outbound_calls,talk_seconds,wait_seconds,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(username,day) DO UPDATE SET agent_extension=excluded.agent_extension,first_login=excluded.first_login,last_logout=excluded.last_logout,break_seconds=excluded.break_seconds,work_seconds=excluded.work_seconds,late_minutes=excluded.late_minutes,attendance_status=excluded.attendance_status,total_calls=excluded.total_calls,answered_calls=excluded.answered_calls,missed_calls=excluded.missed_calls,inbound_calls=excluded.inbound_calls,outbound_calls=excluded.outbound_calls,talk_seconds=excluded.talk_seconds,wait_seconds=excluded.wait_seconds,updated_at=excluded.updated_at").bind(mapping.username,extension,day,attendance.first_login,attendance.last_logout,attendance.break_seconds,attendance.work_seconds,attendance.late_minutes,attendance.status,Number(calls?.total_calls||0),Number(calls?.answered_calls||0),Number(calls?.missed_calls||0),Number(calls?.inbound_calls||0),Number(calls?.outbound_calls||0),Number(calls?.talk_seconds||0),Number(calls?.wait_seconds||0),now).run();
}
async function recomputeUcmMonthlyKpi(env,month){
  const periodStart=`${month}-01`,nextDate=new Date(`${periodStart}T00:00:00Z`);nextDate.setUTCMonth(nextDate.getUTCMonth()+1);const nextMonth=nextDate.toISOString().slice(0,10);
  const result=await env.trainer_kb.prepare("SELECT d.*,u.auth_user_id,u.full_name FROM ucm_agent_daily d JOIN trainer_users u ON lower(trim(u.username))=lower(trim(d.username)) WHERE d.day>=? AND d.day<? AND u.active=1 ORDER BY d.username,d.day").bind(periodStart,nextMonth).all(),rows=result.results||[];if(!rows.length)return;
  const groups=new Map();for(const row of rows){if(!groups.has(row.username))groups.set(row.username,[]);groups.get(row.username).push(row)}
  const drafts=[];for(const [username,days] of groups){const total=days.reduce((sum,row)=>sum+Number(row.total_calls||0),0),answered=days.reduce((sum,row)=>sum+Number(row.answered_calls||0),0),missed=days.reduce((sum,row)=>sum+Number(row.missed_calls||0),0),talk=days.reduce((sum,row)=>sum+Number(row.talk_seconds||0),0),wait=days.reduce((sum,row)=>sum+Number(row.wait_seconds||0),0),activeDays=days.filter(row=>Number(row.total_calls||0)>0).length||days.filter(row=>row.first_login).length||1,breakSeconds=days.reduce((sum,row)=>sum+Number(row.break_seconds||0),0);drafts.push({username,days,total,answered,missed,talk,wait,activeDays,breakSeconds,productivity:answered/activeDays,profile:days[0]})}
  const maxProductivity=Math.max(0,...drafts.map(row=>row.productivity)),now=new Date().toISOString();
  for(const draft of drafts){if(!draft.total)continue;const evidence=await env.trainer_kb.prepare("SELECT MIN(started_at) data_from,MAX(ended_at) data_to,SUM(CASE WHEN json_type(raw_json,'$.wait_seconds') IS NOT NULL OR json_type(raw_json,'$.wait') IS NOT NULL THEN 1 ELSE 0 END) wait_known,SUM(CASE WHEN answered=1 AND (json_type(raw_json,'$.billsec') IS NOT NULL OR json_type(raw_json,'$.talk_seconds') IS NOT NULL) THEN 1 ELSE 0 END) talk_known FROM ucm_cdr WHERE username=? AND started_at>=? AND started_at<?").bind(draft.username,new Date(`${periodStart}T00:00:00+03:00`).toISOString(),new Date(`${nextMonth}T00:00:00+03:00`).toISOString()).first();const quality=null,avgWait=draft.total?draft.wait/draft.total:0,avgTalk=draft.answered?draft.talk/draft.answered:0,answerRate=draft.total?draft.answered/draft.total*100:0,result=ucmKpiScores({...draft,maxProductivity,waitKnown:Number(evidence.wait_known)===draft.total,talkKnown:Number(evidence.talk_known)===draft.answered}),{scores,weights,kpi}=result,periodEnd=draft.days.at(-1).day,queue=await env.trainer_kb.prepare("SELECT queue_name,COUNT(*) count FROM ucm_cdr WHERE username=? AND started_at>=? AND started_at<? GROUP BY queue_name ORDER BY count DESC LIMIT 1").bind(draft.username,new Date(`${periodStart}T00:00:00+03:00`).toISOString(),new Date(`${nextMonth}T00:00:00+03:00`).toISOString()).first(),details={source:"ucm_api",automatic:true,daily:draft.days.map(row=>({date:row.day,total:Number(row.total_calls||0),answered:Number(row.answered_calls||0),abandoned:Number(row.missed_calls||0),avgWait:Number(row.total_calls||0)?Number(row.wait_seconds||0)/Number(row.total_calls):0,avgTalk:Number(row.answered_calls||0)?Number(row.talk_seconds||0)/Number(row.answered_calls):0,attendance_status:row.attendance_status,late_minutes:Number(row.late_minutes||0)})),weights,targets:{response:20,handling:300},synced_at:now};
    // Legacy deployed schemas require numeric scores; availability metadata
    // restores unknown values to null at the API boundary, never to a fake 0%.
    details.unavailable_scores=Object.keys(scores).filter(key=>scores[key]===null);
    scores.response??=0;scores.handling??=0;
    await env.trainer_kb.prepare("INSERT INTO agent_kpi_monthly(auth_user_id,username,agent_name,period_start,period_end,data_from,data_to,quality_score,response_score,productivity_score,handling_score,answer_rate_score,kpi_score,total_calls,answered_calls,abandoned_calls,abandoned_rate,average_wait_seconds,average_talk_seconds,active_days,main_queue,total_break_seconds,break_count,details,imported_by,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(username,period_start) DO UPDATE SET quality_score=excluded.quality_score,period_end=excluded.period_end,data_from=excluded.data_from,data_to=excluded.data_to,response_score=excluded.response_score,productivity_score=excluded.productivity_score,handling_score=excluded.handling_score,answer_rate_score=excluded.answer_rate_score,kpi_score=excluded.kpi_score,total_calls=excluded.total_calls,answered_calls=excluded.answered_calls,abandoned_calls=excluded.abandoned_calls,abandoned_rate=excluded.abandoned_rate,average_wait_seconds=excluded.average_wait_seconds,average_talk_seconds=excluded.average_talk_seconds,active_days=excluded.active_days,main_queue=excluded.main_queue,total_break_seconds=excluded.total_break_seconds,break_count=excluded.break_count,details=excluded.details,imported_by=excluded.imported_by,updated_at=excluded.updated_at").bind(draft.profile.auth_user_id,draft.username,draft.profile.full_name||draft.username,periodStart,periodEnd,evidence.data_from,evidence.data_to,quality,scores.response,scores.productivity,scores.handling,scores.answerRate,kpi,draft.total,draft.answered,draft.missed,draft.total?draft.missed/draft.total*100:0,avgWait,avgTalk,draft.activeDays,queue?.queue_name||"Unknown",draft.breakSeconds,draft.days.filter(row=>Number(row.break_seconds||0)>0).length,JSON.stringify(details),draft.profile.auth_user_id,now).run();
  }
}
async function ingestUcm(request,env,kind){
  const origin=request.headers.get("Origin")||"*",bodyText=await request.text();
  const authorization=await authorizeUcmIngest(request,env,bodyText,kind);
  if(!authorization.ok)return json({message:authorization.status===409?'Replay rejected':'Invalid UCM credentials or signature'},authorization.status,{},origin);
  const receiptId=`body:${kind}:${await ucmBodyHash(bodyText)}`;
  if(await env.trainer_kb.prepare('SELECT receipt_id FROM ucm_ingest_receipts WHERE receipt_id=? AND expires_at>?').bind(receiptId,new Date().toISOString()).first())return json({ok:true,duplicate:true,processed:0},202,{},origin);
  const input=parsePayload(bodyText,request.headers.get("Content-Type")||""),items=kind==='cdr'?flattenCdrPayload(input):Array.isArray(input)?input:Array.isArray(input.records)?input.records:[input],now=new Date().toISOString(),affected=new Map();
  try{
    for(const item of items){
      if(kind==="cdr"){
        const row=normalizeCdr(item,now),mapping=row.agent_extension?await mappingFor(env,row.agent_extension):null,day=ammanDateKey(row.started_at);if(row.agent_extension)affected.set(`${row.agent_extension}|${day}`,[row.agent_extension,day]);
        await env.trainer_kb.prepare("INSERT INTO ucm_cdr(external_id,session_id,unique_id,agent_extension,username,queue_name,direction,source_number,destination_number,started_at,answered_at,ended_at,duration_seconds,talk_seconds,wait_seconds,disposition,answered,raw_json,received_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(external_id) DO UPDATE SET session_id=excluded.session_id,unique_id=excluded.unique_id,agent_extension=excluded.agent_extension,username=excluded.username,queue_name=excluded.queue_name,direction=excluded.direction,source_number=excluded.source_number,destination_number=excluded.destination_number,started_at=excluded.started_at,answered_at=excluded.answered_at,ended_at=excluded.ended_at,duration_seconds=excluded.duration_seconds,talk_seconds=excluded.talk_seconds,wait_seconds=excluded.wait_seconds,disposition=excluded.disposition,answered=excluded.answered,raw_json=excluded.raw_json,received_at=excluded.received_at,updated_at=excluded.updated_at").bind(row.external_id,row.session_id,row.unique_id,row.agent_extension,mapping?.username||null,row.queue_name,row.direction,row.source_number,row.destination_number,row.started_at,row.answered_at,row.ended_at,row.duration_seconds,row.talk_seconds,row.wait_seconds,row.disposition,row.answered?1:0,JSON.stringify(row.raw),row.received_at,now).run();
      }else{
        const row=normalizeQueueEvent(item,now),mapping=await mappingFor(env,row.agent_extension),day=ammanDateKey(row.occurred_at);affected.set(`${row.agent_extension}|${day}`,[row.agent_extension,day]);
        await env.trainer_kb.prepare("INSERT INTO ucm_queue_events(event_id,agent_extension,username,queue_name,event_type,reason,occurred_at,raw_json,received_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(event_id) DO UPDATE SET username=excluded.username,queue_name=excluded.queue_name,event_type=excluded.event_type,reason=excluded.reason,occurred_at=excluded.occurred_at,raw_json=excluded.raw_json,received_at=excluded.received_at").bind(row.event_id,row.agent_extension,mapping?.username||null,row.queue_name,row.event_type,row.reason,row.occurred_at,JSON.stringify(row.raw),row.received_at).run();
      }
    }
    for(const [extension,day] of affected.values())await recomputeAgentDay(env,extension,day);
    for(const month of new Set([...affected.values()].map(([,day])=>day.slice(0,7))))await recomputeUcmMonthlyKpi(env,month);
    await env.trainer_kb.prepare('INSERT INTO ucm_ingest_receipts(receipt_id,expires_at) VALUES(?,?) ON CONFLICT(receipt_id) DO UPDATE SET expires_at=excluded.expires_at').bind(receiptId,new Date(Date.now()+7*86400000).toISOString()).run();
    await bumpUcmCursor(env);return json({ok:true,processed:items.length,affected_days:affected.size},202,{"Cache-Control":"no-store"},origin);
  }catch(error){const message=String(error?.message||error).slice(0,500);await env.trainer_kb.prepare("INSERT INTO ucm_ingest_failures(id,kind,error_message,retry_count,payload_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?)").bind(crypto.randomUUID(),kind,message,0,JSON.stringify({record_count:items.length,content_type:request.headers.get("Content-Type")||"unknown"}),now,now).run();await bumpUcmCursor(env,"error",message);throw error}
}
async function ucmDashboard(request,env,url){
  const origin=request.headers.get("Origin")||"*",auth=await currentAccount(request,env);if(!auth)return json({message:"Valid login required"},401,{},origin);
  const profile=await env.trainer_kb.prepare("SELECT username,role FROM trainer_users WHERE auth_user_id=? AND active=1").bind(auth.account.id).first();if(!profile)return json({message:"Profile not found"},403,{},origin);
  const day=url.searchParams.get("day")||ammanDateKey(),requested=url.searchParams.get("username"),username=String(profile.role).toLowerCase()==="admin"&&requested?requested:profile.username;
  let daily=await env.trainer_kb.prepare("SELECT * FROM ucm_agent_daily WHERE username=? AND day=?").bind(username,day).first();const mapping=await env.trainer_kb.prepare("SELECT extension FROM ucm_agent_mapping WHERE username=? AND active=1").bind(username).first();
  const shift=await ucmShiftFor(env,username,day),shiftMatch=shift.match(/(\d{1,2}:\d{2})\s*(?:-|to)\s*(\d{1,2}:\d{2})/i);
  if(!daily&&shiftMatch&&mapping){const start=new Date(`${day}T${shiftMatch[1]}:00+03:00`),now=new Date();if(now>new Date(start.getTime()+10*60000))daily={username,agent_extension:mapping.extension,day,first_login:null,last_logout:null,break_seconds:0,work_seconds:0,late_minutes:Math.max(0,Math.floor((now-start)/60000)-10),attendance_status:"not_logged_in",total_calls:0,answered_calls:0,missed_calls:0,inbound_calls:0,outbound_calls:0,talk_seconds:0,wait_seconds:0,updated_at:now.toISOString(),virtual:true}}
  const current=mapping?await env.trainer_kb.prepare("SELECT event_type,queue_name,reason,occurred_at FROM ucm_queue_events WHERE agent_extension=? ORDER BY occurred_at DESC LIMIT 1").bind(mapping.extension).first():null,cursor=await env.trainer_kb.prepare("SELECT value,status,error_message,updated_at FROM ucm_sync_state WHERE key='change_cursor'").first();
  return json({day,username,shift:shift||null,daily:daily||null,current_state:current||null,sync:cursor||null},200,{"Cache-Control":"no-store"},origin);
}
async function myKpi(request,env,url){
  const origin=request.headers.get("Origin")||"*",auth=await currentAccount(request,env);if(!auth)return json({message:"Valid login required"},401,{},origin);
  const profile=await env.trainer_kb.prepare("SELECT username FROM trainer_users WHERE auth_user_id=? AND active=1").bind(auth.account.id).first();if(!profile?.username)return json({message:"Active profile not found"},403,{},origin);
  const requested=String(url.searchParams.get("months")||"").split(",").map(value=>value.trim()).filter(value=>/^\d{4}-\d{2}$/.test(value)).slice(0,12);
  const monthSql=requested.length?` AND substr(period_start,1,7) IN (${requested.map(()=>"?").join(",")})`:"";
  const result=await env.trainer_kb.prepare(`SELECT * FROM agent_kpi_monthly WHERE lower(trim(username))=lower(trim(?)) AND json_extract(details,'$.source')='ucm_api' AND total_calls>0${monthSql} ORDER BY period_start DESC LIMIT 24`).bind(profile.username,...requested).all();
  return json(normalizeRows("agent_kpi_monthly",result.results||[]),200,{"Cache-Control":"private, no-store"},origin);
}

async function ucmHistory(request,env,connector=false){
  const origin=request.headers.get('Origin')||'*',body=await request.text();
  if(body.length>2048)return json({message:'Request too large'},413,{},origin);
  if(connector){const check=await authorizeUcmIngest(request,env,body,'queue');if(!check.ok)return json({message:'Connector authentication required'},check.status,{},origin)}
  else{
    const auth=await currentAccount(request,env);if(!auth)return json({message:'Valid login required'},401,{},origin);
    const profile=await env.trainer_kb.prepare('SELECT username FROM trainer_users WHERE auth_user_id=? AND active=1').bind(auth.account.id).first();
    if(!profile)return json({message:'Active profile required'},403,{},origin);
  }
  const input=JSON.parse(body),month=String(input.month||''),now=new Date().toISOString();
  if(connector&&input.action==='daily-complete'){
    if(input.previous!==ucmMonthWindow().previous)return json({message:'Current previous month required'},400,{},origin);
    const result=await finishDailyUcmSync(env.trainer_kb);if(result.rotated)await bumpUcmCursor(env);
    return json(result,200,{'Cache-Control':'no-store'},origin);
  }
  if(connector&&input.action==='list'){
    const result=await env.trainer_kb.prepare("SELECT substr(key,9) month FROM ucm_sync_state WHERE key LIKE 'history:%' AND status='pending' ORDER BY updated_at LIMIT 12").all();
    return json({months:(result.results||[]).map(row=>row.month)},200,{'Cache-Control':'no-store'},origin);
  }
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||month<'2000-01'||month>=ammanDateKey().slice(0,7))return json({message:'Select a previous month'},400,{},origin);
  const key='history:'+month;
  if(connector){
    if(input.action!=='complete')return json({message:'Invalid action'},400,{},origin);
    await env.trainer_kb.prepare("UPDATE ucm_sync_state SET status='complete',updated_at=? WHERE key=? AND status='pending'").bind(now,key).run();
  }else await env.trainer_kb.prepare("INSERT INTO ucm_sync_state(key,value,status,updated_at) VALUES(?,'requested','pending',?) ON CONFLICT(key) DO UPDATE SET status='pending',updated_at=excluded.updated_at WHERE ucm_sync_state.status='expired'").bind(key,now).run();
  const result=await env.trainer_kb.prepare('SELECT status,updated_at FROM ucm_sync_state WHERE key=?').bind(key).first();
  return json({month,...result},202,{'Cache-Control':'no-store'},origin);
}

async function cloudflareUsage(request,env){
  const origin=request.headers.get("Origin")||"*",admin=await requireAdmin(request,env);
  if(!admin)return json({message:"Administrator access required"},403,{},origin);
  const tables=["trainer_users","admin_live_pings","admin_live_daily_logs","agent_kpi_monthly","quality_calls","app_control"];
  const [pageCount,pageSize,...counts]=await Promise.all([
    env.trainer_kb.prepare("PRAGMA page_count").first(),env.trainer_kb.prepare("PRAGMA page_size").first(),
    ...tables.map(table=>env.trainer_kb.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first())
  ]);
  const d1Bytes=Number(pageCount?.page_count||0)*Number(pageSize?.page_size||0),r2Bytes=await storageUsage(env);
  const rowCounts=Object.fromEntries(tables.map((table,index)=>[table,Number(counts[index]?.count||0)]));
  const liveRows=(rowCounts.admin_live_pings||0)+(rowCounts.admin_live_daily_logs||0),totalRows=Object.values(rowCounts).reduce((sum,value)=>sum+value,0);
  const storageScore=Math.min(100,Math.round((d1Bytes/(250*1024*1024))*100)),r2Score=Math.min(100,Math.round((r2Bytes/(1024*1024*1024))*100)),rowScore=Math.min(100,Math.round((totalRows/100000)*100));
  const score=Math.max(storageScore,r2Score,rowScore),level=score>=75?"high":score>=40?"moderate":"low";
  return json({d1_bytes:d1Bytes,r2_bytes:r2Bytes,total_rows:totalRows,live_rows:liveRows,row_counts:rowCounts,score,level,checked_at:new Date().toISOString()},200,{"Cache-Control":"no-store"},origin);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request.headers.get("Origin") || "*") });
    try {
      if (url.pathname.startsWith("/auth/v1/")) return authRoute(request,env,url);
      if (url.pathname.startsWith('/functions/v1/hr/'))return await hrRoute(request,env,url);
      if (url.pathname.startsWith("/storage/v1/object/")) return storageRoute(request,env,url);
      if (url.pathname==="/integrations/ucm/cdr"&&request.method==="POST")return await ingestUcm(request,env,"cdr");
      if (url.pathname==='/integrations/ucm/history'&&request.method==='POST')return await ucmHistory(request,env);
      if (url.pathname==='/integrations/ucm/history-jobs'&&request.method==='POST')return await ucmHistory(request,env,true);
      if (url.pathname==="/integrations/ucm/receiver-repair-download")return await ucmRepairDownload(request,env);
      if (url.pathname==="/integrations/ucm/check"&&request.method==="POST"){
        const body=await request.text();
        if(body.length>2048)return json({result:'PROBE_TOO_LARGE'},413,{'Cache-Control':'no-store'});
        const check=await authorizeUcmIngest(request,env,body,'queue',Date.now(),{claimNonce:false});
        return json({result:check.ok?'INGEST_AUTH_OK':check.reason||'INGEST_AUTH_REJECTED'},check.ok?200:check.status,{'Cache-Control':'no-store'});
      }
      if (url.pathname==="/integrations/ucm/queue-events"&&request.method==="POST")return await ingestUcm(request,env,"queue");
      if (url.pathname==="/integrations/ucm/dashboard"&&request.method==="GET")return ucmDashboard(request,env,url);
      if (url.pathname==="/functions/v1/my-kpi"&&request.method==="GET")return myKpi(request,env,url);
      if (url.pathname==="/functions/v1/admin-create-user"&&request.method==="POST")return adminCreateUser(request,env);
      if (url.pathname==="/functions/v1/cloudflare-usage"&&request.method==="GET")return cloudflareUsage(request,env);
      if (url.pathname==="/functions/v1/quality-revisions"&&request.method==="GET")return await qualityRevisions(request,env);
      if (url.pathname==="/rest/v1/rpc/get_storage_usage_bytes"&&request.method==="POST"){
        if(!(await currentAccount(request,env)))return json({message:"Valid login required"},401,{},request.headers.get("Origin")||"*");
        return json(await storageUsage(env),200,{},request.headers.get("Origin")||"*");
      }
      const match = url.pathname.match(/^\/rest\/v1\/([A-Za-z_][A-Za-z0-9_]*)$/);
      if (match) {
        if (match[1] === "admin_live_daily_logs" || match[1] === "admin_live_pings") ctx.waitUntil(cleanupExpiredLiveData(env));
        return rest(request, env, url, match[1]);
      }
      if (url.pathname === "/health") return json({ ok: true, database: "trainer-kb", auth:"cloudflare", storage:"r2" });
      return json({ message: "Not found" }, 404);
    } catch (error) {
      return json({ message: error?.message || "Cloudflare database error" }, 400, {}, request.headers.get("Origin") || "*");
    }
  },
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(cleanupExpiredLiveData(env, true));
    ctx.waitUntil(cleanupHrFiles(env));
  }
};
