import bcrypt from "bcryptjs";
const TABLES = new Set([
  "admin_live_daily_logs","admin_live_pings","agent_kpi_monthly","agent_sessions","app_control",
  "cases","ebook_permissions","ebook_sessions","groups","icon7_items","knowledge_change_requests",
  "live_agent_sessions","live_agents","passkeys","quality_access_requests","quality_calls",
  "quality_presence","saraya_kb_items","saraya_kb_sections","schedule_month_archive",
  "schedule_week_archive","sections","shift_swap_requests","solutions","trainer_users"
]);
const PUBLIC_READ = new Set(["app_control","sections","groups","cases","solutions","icon7_items","saraya_kb_items","saraya_kb_sections"]);
const BOOLEAN_COLUMNS = {
  agent_sessions:["is_visible"], cases:["escalation","refund"], ebook_permissions:["is_allowed"],
  ebook_sessions:["is_visible"], icon7_items:["is_active"], live_agents:["is_visible"],
  quality_presence:["page_visible"], saraya_kb_items:["escalation_required","active"],
  saraya_kb_sections:["active"], trainer_users:["active"]
};
const JSON_COLUMNS = {
  agent_kpi_monthly:["details"], agent_sessions:["device_info"], ebook_sessions:["device_info"],
  knowledge_change_requests:["proposed_data"], live_agents:["device_info"],
  schedule_month_archive:["weeks","schedule_json"], schedule_week_archive:["schedule_json"]
};
const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function cors(origin = "*") {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization,apikey,content-type,prefer,range,x-client-info,x-quality-token",
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
    if (table === "saraya_kb_items" && "keywords" in row) row.keywords = postgresArray(row.keywords);
    return row;
  });
}

async function verifyWrite(request, env) { return Boolean(await currentAccount(request,env)); }

async function rest(request, env, url, table) {
  if (!TABLES.has(table)) return json({ message: "Unknown table" }, 404, {}, request.headers.get("Origin") || "*");
  const origin = request.headers.get("Origin") || "*";
  const allowed = await columnsFor(env.trainer_kb, table);
  const method = request.method;
  const { sql: where, values } = whereFrom(url);
  if (method === "GET" || method === "HEAD") {
    if (!PUBLIC_READ.has(table) && !(await verifyWrite(request,env))) return json({ message: "Valid login required" }, 401, {}, origin);
    const select = selectedColumns(url, allowed);
    let sql = `SELECT ${select} FROM ${table}${where}`;
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
  if (method === "POST") {
    const input = await request.json();
    const rows = Array.isArray(input) ? input : [input];
    const written = [];
    for (const source of rows) {
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

async function adminCreateUser(request,env){
  const origin=request.headers.get("Origin")||"*", admin=await requireAdmin(request,env);
  if(!admin)return json({error:"Administrator access required"},403,{},origin);
  const body=await request.json(), action=String(body.action||"create");
  if(action==="create"){
    const username=String(body.username||"").trim().toLowerCase(), password=String(body.password||""), fullName=String(body.full_name||"").trim(), role=String(body.role||"agent").toLowerCase();
    if(!/^[a-z0-9._-]{3,50}$/.test(username))return json({error:"Invalid username"},400,{},origin);
    if(password.length<10)return json({error:"Password must be at least 10 characters"},400,{},origin);
    if(!["agent","trainer","quality","admin"].includes(role))return json({error:"Invalid role"},400,{},origin);
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request.headers.get("Origin") || "*") });
    try {
      if (url.pathname.startsWith("/auth/v1/")) return authRoute(request,env,url);
      if (url.pathname.startsWith("/storage/v1/object/")) return storageRoute(request,env,url);
      if (url.pathname==="/functions/v1/admin-create-user"&&request.method==="POST")return adminCreateUser(request,env);
      if (url.pathname==="/rest/v1/rpc/get_storage_usage_bytes"&&request.method==="POST"){
        if(!(await currentAccount(request,env)))return json({message:"Valid login required"},401,{},request.headers.get("Origin")||"*");
        return json(await storageUsage(env),200,{},request.headers.get("Origin")||"*");
      }
      const match = url.pathname.match(/^\/rest\/v1\/([A-Za-z_][A-Za-z0-9_]*)$/);
      if (match) return rest(request, env, url, match[1]);
      if (url.pathname === "/health") return json({ ok: true, database: "trainer-kb", auth:"cloudflare", storage:"r2" });
      return json({ message: "Not found" }, 404);
    } catch (error) {
      return json({ message: error?.message || "Cloudflare database error" }, 400, {}, request.headers.get("Origin") || "*");
    }
  }
};
