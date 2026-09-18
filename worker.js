const SUPABASE_ORIGIN = "https://estyiinuotsygtrgtezz.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_NB_aYGgJ7o8RB1ddYWSIOA_Gwj39mfs";
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

async function verifyWrite(request) {
  const auth = request.headers.get("Authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;
  const response = await fetch(`${SUPABASE_ORIGIN}/auth/v1/user`, { headers: { apikey: SUPABASE_ANON_KEY, Authorization: auth } });
  return response.ok;
}

async function rest(request, env, url, table) {
  if (!TABLES.has(table)) return json({ message: "Unknown table" }, 404, {}, request.headers.get("Origin") || "*");
  const origin = request.headers.get("Origin") || "*";
  const allowed = await columnsFor(env.trainer_kb, table);
  const method = request.method;
  const { sql: where, values } = whereFrom(url);
  if (method === "GET" || method === "HEAD") {
    if (!PUBLIC_READ.has(table) && !(await verifyWrite(request))) return json({ message: "Valid login required" }, 401, {}, origin);
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
  if (!(await verifyWrite(request))) return json({ message: "Valid login required" }, 401, {}, origin);
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

async function proxy(request, url) {
  const target = new URL(url.pathname + url.search, SUPABASE_ORIGIN);
  const headers = new Headers(request.headers); headers.set("apikey", SUPABASE_ANON_KEY); headers.delete("host");
  return fetch(target, { method: request.method, headers, body: ["GET","HEAD"].includes(request.method) ? undefined : request.body, redirect: "follow" });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(request.headers.get("Origin") || "*") });
    try {
      if (url.pathname.startsWith("/auth/v1/") || url.pathname.startsWith("/storage/v1/") || url.pathname.startsWith("/functions/v1/")) return proxy(request, url);
      const match = url.pathname.match(/^\/rest\/v1\/([A-Za-z_][A-Za-z0-9_]*)$/);
      if (match) return rest(request, env, url, match[1]);
      if (url.pathname.startsWith("/rest/v1/rpc/")) return proxy(request, url);
      if (url.pathname === "/health") return json({ ok: true, database: "trainer-kb" });
      return json({ message: "Not found" }, 404);
    } catch (error) {
      return json({ message: error?.message || "Cloudflare database error" }, 400, {}, request.headers.get("Origin") || "*");
    }
  }
};
