import "./accounting-auth.js?v=newtel-publish-20261121";
const preferences=globalThis.AccountingAuth.preferences,viewState=globalThis.AccountingAuth.viewState;
const $ = (s) => document.querySelector(s), el = (tag, cls, value) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (value !== void 0) e.textContent = value;
  return e;
};
const workspaceOptions=new URLSearchParams(location.search);
const explicitWorkspace=workspaceOptions.has("demo")||workspaceOptions.get("workspace")==="real";
let demoMode=workspaceOptions.get("demo")==="1";
let base = globalThis.AccountingAuth.apiOrigin + (demoMode?"/functions/v1/accounting-demo":"/functions/v1/accounting");
let boot, view = "dashboard", offset = 0, query = "", chart, rows = [], lang = preferences.getItem("ac-language") || "en", submitHandler, loadVersion = 0;
const today = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Amman", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(/* @__PURE__ */ new Date()).map((p2) => [p2.type, p2.value]));
  return `${p.year}-${p.month}-${p.day}`;
};
const dictionary = { "Sign out":"تسجيل الخروج", Overview: "نظرة عامة", Accounts: "دليل الحسابات", Journals: "القيود اليومية", Documents: "الفواتير والمستندات", Payments: "المدفوعات", Partners: "العملاء والموردون", Banking: "الحسابات البنكية", Statements: "الكشوف البنكية", Reconciliation: "التسوية البنكية", "Cost centers": "مراكز التكلفة", Projects: "المشاريع", Budgets: "الموازنات", Assets: "الأصول الثابتة", Schedules: "القيود المتكررة", Taxes: "الضرائب", Currencies: "العملات", "Exchange rates": "أسعار الصرف", Periods: "الفترات المالية", Imports: "الاستيراد", Attachments: "المرفقات", Users: "المستخدمون", Audit: "سجل التدقيق", Settings: "الإعدادات", Reports: "التقارير", New: "جديد", Search: "بحث", Save: "حفظ", Cancel: "إلغاء", Refresh: "تحديث", "Trial balance": "ميزان المراجعة", "Income statement": "قائمة الدخل", "Balance sheet": "الميزانية العمومية", "Cash flow": "التدفق النقدي", Aging: "أعمار الديون", Ledger: "الأستاذ العام", Profitability: "الربحية", "Budget comparison": "مقارنة الموازنة", "Tax report": "تقرير الضريبة", "Partner statement": "كشف الشريك", workspace: "مساحة العمل", ledger: "شركة واحدة · دفتر الأستاذ المرحّل", portal: "العودة للبوابة", eyebrow: "مساحة عملك المالية", precision: "مبالغ دقيقة · اعتماد مستقل", Revenue: "الإيرادات", Expenses: "المصروفات", "Net income": "صافي الدخل", Assets: "الأصول", "Financial activity": "النشاط المالي", "Needs attention": "يتطلب الانتباه", "Recent journals": "أحدث القيود", "No records yet": "لا توجد سجلات بعد", "Create your first record to get started.": "أنشئ السجل الأول للبدء.", Approve: "اعتماد", Post: "ترحيل", Reverse: "عكس", View: "عرض", Lock: "قفل", Pay: "دفع", Depreciation: "إهلاك", Dispose: "استبعاد", Run: "تشغيل", Export: "تصدير", "Save draft": "حفظ مسودة", Previous: "السابق", Next: "التالي", From: "من", To: "إلى", Compare: "مقارنة", name: "الاسم", code: "الرمز", type: "النوع", day: "التاريخ", description: "الوصف", amount: "المبلغ", debit: "مدين", credit: "دائن", currency: "العملة", rate: "سعر الصرف", status: "الحالة", number: "الرقم", due_date: "تاريخ الاستحقاق", total: "الإجمالي", balance: "الرصيد", account_id: "الحساب", partner_id: "الشريك", cost_center_id: "مركز التكلفة", project_id: "المشروع", period_id: "الفترة", start_date: "تاريخ البداية", end_date: "تاريخ النهاية", kind: "النوع", control_account_id: "حساب المراقبة", original_id: "المستند الأصلي", cash_account_id: "الحساب النقدي", document_id: "المستند", bank_id: "الحساب البنكي", reference: "المرجع", opening: "رصيد البداية", closing: "رصيد النهاية", basis_points: "المعدل بالنقاط الأساسية", parent_id: "الحساب الأب", cash_flow: "تصنيف التدفق", months: "الأشهر", cost: "التكلفة", residual: "القيمة المتبقية", acquired_on: "تاريخ الشراء", asset_account_id: "حساب الأصل", expense_account_id: "حساب المصروف", accumulated_account_id: "مجمع الإهلاك", acquisition_journal_id: "قيد الشراء", retained_account_id: "الأرباح المحتجزة", user_id: "معرّف المستخدم", role: "الدور", proceeds: "متحصلات البيع", gain_loss_account_id: "حساب الربح أو الخسارة", journal_id: "القيد", tax_code_id: "رمز الضريبة", email: "البريد الإلكتروني", decimals: "المنازل العشرية", template: "قالب القيد", active: "نشط", memo: "ملاحظة" };
const t = (s) => lang === "ar" ? dictionary[s] || s.replaceAll("_", " ") : s.replaceAll("_", " ");
const modules = [["dashboard", "Overview", "◫"], ["accounts", "Accounts", "▦"], ["journals", "Journals", "≡"], ["documents", "Documents", "▤"], ["payments", "Payments", "↔"], ["partners", "Partners", "♧"], ["banks", "Banking", "▥"], ["statements", "Statements", "▧"], ["reconciliations", "Reconciliation", "✓"], ["reports", "Reports", "◷"], ["cost-centers", "Cost centers", "◇"], ["projects", "Projects", "▣"], ["budgets", "Budgets", "◴"], ["assets", "Assets", "▱"], ["schedules", "Schedules", "⟳"], ["taxes", "Taxes", "%"], ["currencies", "Currencies", "¤"], ["rates", "Exchange rates", "⇄"], ["periods", "Periods", "▦"], ["imports", "Imports", "⇧"], ["attachments", "Attachments", "⌁"], ["users", "Users", "♧"], ["audit", "Audit", "☷"], ["settings", "Settings", "⚙"]];
const reports = { "trial-balance": "Trial balance", income: "Income statement", "balance-sheet": "Balance sheet", "cash-flow": "Cash flow", aging: "Aging", ledger: "Ledger", "partner-statement": "Partner statement", profitability: "Profitability", budgets: "Budget comparison", tax: "Tax report" };
let report = "trial-balance", from = today().slice(0, 4) + "-01-01", to = today();
async function requestApi(path, { method = "GET", body, blob = false } = {}) {
  const headers = { Authorization: "Bearer " + await globalThis.AccountingAuth.token() };
  if (body && !(body instanceof FormData)) headers["Content-Type"] = "application/json";
  const r = await fetch(base + path, { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : void 0, cache: "no-store" });
  if (blob && r.ok) return r.blob();
  const data = await r.json();
  if (!r.ok) {if(r.status===401){globalThis.AccountingAuth.clear();showLogin();}throw Error(data.message || "Request failed");}
  return data;
}
let bootDirty=false;
const caches=new Map();
function dataCache(){const scope=base+":"+globalThis.AccountingAuth.cacheScope();if(!caches.has(scope))caches.set(scope,globalThis.AccountingCache.create({storage:viewState,scope:()=>scope,readRevision:async()=> (await requestApi("/revision")).revision}));return caches.get(scope);}
async function api(path,options={}){if(options.method&&options.method!=="GET"){const result=await requestApi(path,options);dataCache().invalidate();bootDirty=true;return result;}if(options.blob)return requestApi(path,options);return dataCache().get(path,()=>requestApi(path,options));}
const lookupKeys=["accounts","currencies","partners","periods","taxes","cost_centers","projects","banks"];
let loadedLookups=new Set();
async function compactBootstrap(){boot=await api("/bootstrap?compact=1");for(const key of lookupKeys)boot[key]=[];loadedLookups.clear();bootDirty=false;}
async function ensureLookups(keys){const missing=[...new Set(keys)].filter(k=>!loadedLookups.has(k));if(!missing.length)return;Object.assign(boot,await api("/lookups?keys="+missing.sort().join(",")));missing.forEach(k=>loadedLookups.add(k));}
async function prepareFields(fields){const keys=new Set();for(const f of fields){if(f.includes("account_id"))keys.add("accounts");if(f==="partner_id")keys.add("partners");if(f==="currency")keys.add("currencies");if(f==="bank_id")keys.add("banks");if(f==="tax_code_id")keys.add("taxes");if(f==="period_id")keys.add("periods");if(f==="cost_center_id")keys.add("cost_centers");if(f==="project_id")keys.add("projects");}await ensureLookups([...keys]);}
let toastTimer;
function toast(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 4500);
}
function button(label, action, cls = "") {
  const b = el("button", cls, t(label));
  b.type = "button";
  b.addEventListener("click", () => Promise.resolve().then(action).catch((e) => toast(e.message)));
  return b;
}
function titleCase(s) {
  return t(s).replace(/^\w/, (c) => c.toUpperCase());
}
function money(value) {
  const [whole, fraction = "0000"] = String(value ?? "0.0000").split(".");
  return (String(value).startsWith("-") ? "-" : "") + BigInt(whole.replace("-", "")).toLocaleString(lang === "ar" ? "ar-JO" : "en-US") + "." + fraction;
}
function applyLanguage() {
  document.title=lang==="ar"?"نيو تيل · المحاسبة":"New Tel · Accounting";
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
  $("#language").textContent = lang === "ar" ? "English" : "العربية";
  document.querySelectorAll("[data-i18n]").forEach((e) => e.textContent = t(e.getAttribute("data-i18n") || ""));
  renderNav();
}
function renderNav() {
  $("#navigation").replaceChildren(...modules.filter(([key]) => key !== "users" || boot?.permissions.includes("users")).map(([key, label, icon]) => {
    const b = button(label, () => navigate(key), key === view ? "active" : "");
    if(icon!=="♧")b.prepend(el("span", "nav-icon", icon));
    return b;
  }));
}
function navigate(next) {
  view = next;
  offset = 0;
  query = "";
  location.hash = next;
  renderNav();
  return load();
}
function filters(container, { dates = false } = {}) {
  const bar = el("div", "filters");
  if (dates) {
    for (const [label, value, set] of [["From", from, (v) => from = v], ["To", to, (v) => to = v]]) {
      const l = el("label", "", t(label)), input = el("input");
      input.type = "date";
      input.value = value;
      input.onchange = () => {
        set(input.value);
        load();
      };
      l.append(input);
      bar.append(l);
    }
  } else {
    const search = el("input");
    search.type = "search";
    search.placeholder = t("Search");
    search.value = query;
    let timer;
    search.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        query = search.value;
        offset = 0;
        load();
      }, 350);
    };
    bar.append(search);
  }
  bar.append(button("Refresh",async()=>{if(await dataCache().validate(true))bootDirty=true;await load();}));
  container.append(bar);
  return bar;
}
function table(data, columns, actions) {
  const wrap = el("div", "table-wrap");
  if (!data.length) {
    const empty = el("div", "empty");
    empty.append(el("div", "", "◇"), el("h2", "", t("No records yet")), el("p", "", t("Create your first record to get started.")));
    wrap.append(empty);
    return wrap;
  }
  const table2 = el("table"), head = el("thead"), tr = el("tr");
  for (const c of columns) tr.append(el("th", "", titleCase(c)));
  if (actions) tr.append(el("th", "", ""));
  head.append(tr);
  table2.append(head);
  const body = el("tbody");
  for (const r of data) {
    const row = el("tr");
    for (const c of columns) {
      const td = el("td");
      if (c === "status") td.append(el("span", "badge " + r[c], r[c]));
      else if (c === "account_id") {
        const a = boot.accounts.find((a2) => a2.id === r[c]);
        td.textContent = a ? a.code + " · " + a.name : r[c] || "—";
      } else if (c === "partner_id") td.textContent = boot.partners.find((p) => p.id === r[c])?.name || r[c] || "—";
      else td.textContent = typeof r[c] === "object" ? JSON.stringify(r[c]) : String(r[c] ?? "—");
      row.append(td);
    }
    if (actions) {
      const td = el("td");
      actions(r, td);
      row.append(td);
    }
    body.append(row);
  }
  table2.append(body);
  wrap.append(table2);
  return wrap;
}
function pagination(result) {
  const p = el("div", "pagination");
  p.append(el("span", "", `${offset + 1}–${Math.min(offset + result.rows.length, result.count)} / ${result.count}`));
  const prev = button("Previous", () => {
    offset = Math.max(0, offset - 50);
    load();
  }), next = button("Next", () => {
    offset += 50;
    load();
  });
  prev.disabled = !offset;
  next.disabled = offset + 50 >= result.count;
  p.append(prev, next);
  return p;
}
function exportButtons() {
  return [button("CSV", () => download(new Blob(["\uFEFF" + toCsv(rows)], { type: "text/csv" }), view + ".csv")), button("XLSX", exportXlsx), button("PDF", () => window.print())];
}
function toCsv(data) {
  if (!data.length) return "";
  const cols = Object.keys(data[0]), cell = (v) => '"' + String(v ?? "").replace(/^[=+@\-\t\r]/, "'$&").replaceAll('"', '""') + '"';
  return [cols, ...data.map((r) => cols.map((c) => typeof r[c] === "object" ? JSON.stringify(r[c]) : r[c]))].map((r) => r.map(cell).join(",")).join("\r\n");
}
function download(blob, name) {
  const url = URL.createObjectURL(blob), a = el("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2e3);
}
async function exportXlsx() {
  if (!rows.length) return;
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet("Accounting");
  ws.columns = Object.keys(rows[0]).map((key) => ({ header: key, key, width: 24 }));
  for (const r of rows) ws.addRow(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v ?? "")])));
  ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF17243C" } };
  download(new Blob([await wb.xlsx.writeBuffer()]), view + ".xlsx");
}
async function load() {
  const version = ++loadVersion;
  const label = modules.find((m) => m[0] === view)?.[1] || "Overview";
  $("#subtitle").textContent = lang === "ar" ? "رؤية واضحة لأعمالك، مستمدة من دفتر الأستاذ." : "A clear view of your business, grounded in your ledger.";
  $("#title").textContent = t(label);
  $("#crumb").textContent = t(label);
  $("#actions").replaceChildren();
  $("#content").replaceChildren(el("div", "skeleton"));
  try {
    if(await dataCache().validate())bootDirty=true;
    if(bootDirty)await compactBootstrap();
    if(view==="reports")await ensureLookups(["accounts","partners"]);
    else if(["journals","documents","payments","banks","assets","budgets","schedules","taxes","rates","reconciliations"].includes(view))await ensureLookups(["accounts","partners"]);
    let content;
    if (view === "dashboard") content = await dashboard();
    else if (view === "reports") content = await reportView();
    else if (view === "settings") content = settingsView();
    else content = await resourceView();
    if (version !== loadVersion) return;
    $("#content").replaceChildren(content);
    $("#content").style.animation = "none";
    void $("#content").offsetHeight;
    $("#content").style.animation = "";
  } catch (e) {
    if (version !== loadVersion) return;
    const panel = el("div", "panel");
    panel.append(el("h2", "", "Unable to load accounting"), el("p", "muted", e.message), button("Refresh", load));
    if (!boot) panel.append(el("a", "", "Sign in to eBook"));
    const link = panel.querySelector("a");
    if (link) link.href = "accounting.html";
    $("#content").replaceChildren(panel);
  }
}
async function dashboard() {
  const [data, recent, alerts] = await Promise.all([api("/reports/dashboard?from=" + from + "&to=" + to), api("/journals?limit=5"), api("/notifications")]);
  const root = el("div"), cards = el("div", "cards");
  for (const [label, key, icon] of [["Revenue", "revenue", "↗"], ["Expenses", "expense", "↙"], ["Net income", "net", "◴"], ["Assets", "assets", "▱"]]) {
    const c = el("article", "card"), l = el("div", "card-label", t(label));
    l.append(el("span", "card-icon", icon));
    const amount = el("div", "amount", money(data.totals[key]));
    amount.append(el("small", "", boot.settings.base_currency));
    c.append(l, amount, el("div", "card-note", `As of ${to} · posted ledger`));
    cards.append(c);
  }
  root.append(cards);
  const panels = el("div", "panels"), trend = el("section", "panel"), heading = el("div", "panel-heading");
  heading.append(el("h2", "", t("Financial activity")), el("span", "badge", boot.settings.base_currency));
  trend.append(heading);
  const chartWrap = el("div", "chart"), canvas = el("canvas");
  canvas.setAttribute("aria-label", "Monthly revenue and expenses");
  canvas.setAttribute("role", "img");
  chartWrap.append(canvas);
  trend.append(chartWrap);
  const attention = el("section", "panel");
  attention.append(el("h2", "", t("Needs attention")));
  for (const [icon, label, note] of [["≡", alerts.drafts + " draft journals", "Review and approve before posting."], ["◷", (alerts.overdue?.count || 0) + " overdue documents", "Open aging for the unpaid balances."], ["✓", "Ledger integrity", data.totals.balance === "0.0000" ? "Debits and credits agree." : "Review the trial balance."]]) {
    const row = el("div", "alert-row"), text = el("div", "", label);
    text.append(el("p", "", note));
    row.append(el("span", "alert-icon", icon), text);
    attention.append(row);
  }
  panels.append(trend, attention);
  root.append(panels);
  const panel = el("section", "panel"), h = el("div", "panel-heading");
  h.append(el("h2", "", t("Recent journals")), button("View", () => navigate("journals"), "quiet"));
  panel.append(h, table(recent.rows, ["day", "description", "status", "sequence"], (r, td) => td.append(button("View", () => showJournal(r.id), "row-action"))));
  root.append(panel);
  requestAnimationFrame(() => {
    if (!canvas.isConnected) return;
    chart?.destroy();
    chart = new Chart(canvas, { type: "line", data: { labels: data.trend.map((r) => r.month), datasets: [{ label: t("Revenue"), data: data.trend.map((r) => Number(r.revenue)), borderColor: "#2465e9", backgroundColor: "#2465e915", fill: true, tension: 0.35, borderWidth: 2, pointRadius: 3 }, { label: t("Expenses"), data: data.trend.map((r) => Number(r.expense)), borderColor: "#99b0d1", borderDash: [4, 4], tension: 0.35, borderWidth: 2, pointRadius: 2 }] }, options: { responsive: true, maintainAspectRatio: false, animation: matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 450 }, plugins: { legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 8 } } }, scales: { x: { grid: { display: false } }, y: { beginAtZero: true, grid: { color: "#7b8da315" } } } } });
  });
  $("#actions").append(button("New journal", () => newJournal(), "primary"));
  return root;
}
const columnMap = { accounts: ["code", "name", "type", "active"], journals: ["sequence", "day", "description", "currency", "status"], documents: ["number", "kind", "day", "due_date", "total", "currency", "status"], payments: ["day", "document_id", "amount", "cash_account_id"], partners: ["name", "kind", "email"], banks: ["name", "account_id", "currency"], statements: ["reference", "day", "opening", "closing"], reconciliations: ["bank_line_id", "journal_line_id", "created_at"], "cost-centers": ["code", "name"], projects: ["code", "name", "cost_center_id"], budgets: ["account_id", "period_id", "amount"], assets: ["name", "acquired_on", "cost", "residual", "months"], schedules: ["name", "kind", "start_date", "end_date"], taxes: ["code", "name", "basis_points", "account_id"], currencies: ["code", "decimals"], rates: ["currency", "day", "rate"], periods: ["name", "start_date", "end_date", "locked"], imports: ["id", "kind", "status", "created_at"], attachments: ["name", "mime", "bytes", "created_at"], users: ["username", "full_name", "role", "active"], audit: ["created_at", "actor", "action", "target"] };
async function resourceView() {
  const key = view, result = await api("/" + key + "?limit=50&offset=" + offset + "&q=" + encodeURIComponent(query));
  rows = result.rows;
  const root = el("div");
  filters(root);
  root.append(table(rows, columnMap[key] || ["id"], (r, td) => rowActions(key, r, td)), pagination(result));
  $("#actions").append(...exportButtons());
  if (key === "statements" && boot.permissions.includes("draft")) $("#actions").prepend(button("Import XLSX / CSV", bankImportForm));
  if (key !== "audit" && (boot.permissions.includes("manage") || boot.permissions.includes("draft"))) $("#actions").prepend(button("New", () => createFor(key), "primary"));
  return root;
}
function rowActions(key, r, td) {
  if(demoMode&&key!=="users"){
    td.append(button("تعديل",()=>editDemo(key,r),"row-action"));
    td.append(button("حذف",()=>confirmAction("حذف هذا السجل والسجلات المرتبطة به؟",()=>api("/"+key+"/"+encodeURIComponent(key==="currencies"?r.code:r.id),{method:"DELETE"})),"row-action"));
  }
  if(key==="users"){
    if(r.protected){td.append(el("span","badge","أدمن المحاسبة — محمي"));return;}
    td.append(button(r.active?"تعطيل":"تفعيل",()=>confirmAction("تغيير حالة حساب المحاسبة؟",()=>api("/users/"+r.user_id,{method:"PATCH",body:{active:!r.active}})),"row-action"));
    td.append(button("الصلاحيات",()=>openForm("صلاحيات المحاسب",["role"],b=>api("/users/"+r.user_id,{method:"PATCH",body:b}),{role:r.role}),"row-action"));
    td.append(button("كلمة المرور",()=>{openForm("تغيير كلمة مرور المحاسب",["password"],b=>api("/users/"+r.user_id,{method:"PATCH",body:b}));$("#fields [name=password]").type="password";},"row-action"));return;
  }
  const add = (label, fn) => td.append(button(label, fn, "row-action"));
  if (key === "journals") add("View", () => showJournal(r.id));
  if (key === "partners") add("Statement", () => {
    report = "partner-statement";
    viewState.setItem("ac-report-partner", r.id);
    return navigate("reports");
  });
  if (key === "documents") {
    add("View", () => showDocument(r.id));
    if (r.status === "posted" && ["invoice", "bill"].includes(r.kind)) add("Pay", () => newPayment(r));
  }
  if (key === "periods" && !r.locked) {
    add("Lock", () => confirmAction("Lock this period permanently?", () => api("/periods/" + r.id + "/lock", { method: "POST", body: {} })));
    add("Closing draft", () => openForm("Year-end closing", ["retained_account_id"], (b) => api("/periods/" + r.id + "/closing-draft", { method: "POST", body: b })));
  }
  if (key === "assets") {
    add("Depreciation", () => openForm("Depreciation", ["day"], (b) => api("/assets/" + r.id + "/depreciation", { method: "POST", body: b }), { day: today() }));
    add("Dispose", () => openForm("Dispose", ["day", "proceeds", "cash_account_id", "gain_loss_account_id"], (b) => api("/assets/" + r.id + "/dispose", { method: "POST", body: b }), { day: today(), proceeds: "0" }));
  }
  if (key === "schedules") add("Run", () => openForm("Run", ["day"], (b) => api("/schedules/" + r.id + "/run", { method: "POST", body: b }), { day: today() }));
  if (key === "statements") add("View", () => showStatement(r.id));
  if (key === "imports") add("View", () => showImport(r.id));
  if (key === "attachments") add("Download", async () => download(await api("/attachments/" + r.id + "/file", { blob: true }), r.name));
  if (!demoMode && key === "accounts" && boot.permissions.includes("manage")) add("Edit", () => openForm("Edit", ["name", "active"], (b) => api("/accounts/" + r.id, { method: "PATCH", body: { ...b, active: Number(b.active) } }), r));
}
async function reportView() {
  const root = el("div"), bar = filters(root, { dates: true }), select = el("select");
  select.style.width = "auto";
  for (const [key, label] of Object.entries(reports)) {
    const o = el("option", "", t(label));
    o.value = key;
    select.append(o);
  }
  select.value = report;
  select.onchange = () => {
    report = select.value;
    offset = 0;
    load();
  };
  bar.prepend(select);
  const account = el("select");
  account.style.width = "auto";
  account.append(new Option("All accounts", ""));
  for (const a of boot.accounts) account.append(new Option(a.code + " " + a.name, a.id));
  account.value = viewState.getItem("ac-report-account") || "";
  account.onchange = () => {
    viewState.setItem("ac-report-account", account.value);
    load();
  };
  bar.append(account);
  const partner = el("select");
  partner.style.width = "auto";
  partner.append(new Option("All partners", ""));
  for (const p of boot.partners) partner.append(new Option(p.name, p.id));
  partner.value = viewState.getItem("ac-report-partner") || "";
  partner.onchange = () => {
    viewState.setItem("ac-report-partner", partner.value);
    offset = 0;
    load();
  };
  bar.append(partner);
  const data = await api("/reports/" + report + "?from=" + from + "&to=" + to + "&offset=" + offset + "&limit=50&account_id=" + encodeURIComponent(account.value) + "&partner_id=" + encodeURIComponent(partner.value));
  rows = data.rows;
  $("#actions").append(...exportButtons());
  if (data.totals) {
    const cards = el("div", "cards");
    for (const k of report === "income" ? ["revenue", "expense", "net"] : ["assets", "liabilities", "equity", "balance"]) {
      const c = el("div", "card");
      c.append(el("div", "card-label", titleCase(k)), el("div", "amount", money(data.totals[k])));
      cards.append(c);
    }
    root.append(cards);
  }
  if (data.opening !== void 0) root.append(el("p", "notice", `Opening: ${data.opening} · Closing: ${data.closing} ${boot.settings.base_currency}`));
  if (data.method) root.append(el("p", "notice", data.method));
  if (rows.length) root.append(table(rows, report === "ledger" || report === "partner-statement" || report === "tax" ? ["day", "sequence", "code", "name", "debit", "credit", "partner_id"] : Object.keys(rows[0]).filter((k) => !["created_by", "created_at", "journal_id", "rate"].includes(k)).slice(0, 10), (r, td) => {
    if (r.journal_id) td.append(button("View", () => showJournal(r.journal_id), "row-action"));
    if (r.account_id) td.append(button("Ledger", () => {
      viewState.setItem("ac-report-account", r.account_id);
      report = "ledger";
      load();
    }, "row-action"));
  }));
  else root.append(table([], []));
  if (data.count !== void 0) root.append(pagination(data));
  bar.append(button("Compare", async () => {
    const end = /* @__PURE__ */ new Date(to + "T00:00:00Z"), start = /* @__PURE__ */ new Date(from + "T00:00:00Z"), length = end - start + 864e5;
    const priorTo = new Date(start - 864e5).toISOString().slice(0, 10), priorFrom = new Date(start - length).toISOString().slice(0, 10), comparison = await api("/reports/" + report + "?from=" + priorFrom + "&to=" + priorTo + "&account_id=" + encodeURIComponent(account.value) + "&partner_id=" + encodeURIComponent(partner.value));
    root.append(el("h3", "", priorFrom + " – " + priorTo), comparison.totals ? table(Object.entries(comparison.totals).map(([metric, value]) => ({ metric, value })), ["metric", "value"]) : table(comparison.rows, Object.keys(comparison.rows[0] || {}).slice(0, 8)));
  }));
  return root;
}
function field(name, value = "", options = {}) {
  const l = el("label", options.full ? "full" : "", titleCase(name)), accountFields = ["account_id", "parent_id", "control_account_id", "cash_account_id", "asset_account_id", "expense_account_id", "accumulated_account_id", "gain_loss_account_id", "retained_account_id", "from_account_id", "to_account_id"];
  let values = accountFields.includes(name) ? boot.accounts.map((a) => [a.id, a.code + " · " + a.name]) : name === "currency" ? boot.currencies.map((c) => [c.code, c.code]) : name === "bank_id" ? boot.banks.map((b) => [b.id, b.name]) : name === "partner_id" ? boot.partners.map((p) => [p.id, p.name]) : name === "tax_code_id" ? boot.taxes.map((p) => [p.id, p.code]) : name === "period_id" ? boot.periods.map((p) => [p.id, p.name]) : name === "cost_center_id" ? boot.cost_centers.map((p) => [p.id, p.name]) : name === "project_id" ? boot.projects.map((p) => [p.id, p.name]) : name === "flow_category" ? ["operating", "investing", "financing", "transfer"].map((v) => [v, t(v)]) : options.choices;
  let input;
  if (values) {
    input = el("select");
    input.append(new Option("—", ""));
    for (const [v, label] of values) input.append(new Option(t(label), v));
  } else if (["template", "lines", "rows", "mapping"].includes(name)) {
    input = el("textarea");
    input.spellcheck = false;
    l.className = "full";
  } else {
    input = el("input");
    if (name === "day" || name.endsWith("_date") || name === "acquired_on") input.type = "date";
    else if (name === "email") input.type = "email";
    else input.type = "text";
  }
  input.name = name;
  input.value = typeof value === "object" ? JSON.stringify(value, null, 2) : value ?? "";
  input.required = options.required !== false;
  l.append(input);
  return l;
}
function modal(title, onSubmit) {
  $("#modal-title").textContent = t(title);
  $("#fields").replaceChildren();
  $("#form-error").textContent = "";
  $("#save").hidden = false;
  $("#save").textContent = t("Save");
  submitHandler = onSubmit;
  if (!$("#modal").open) $("#modal").showModal();
}
async function openForm(title, fields, handler, defaults = {}, options = {}) {
  await prepareFields(fields);
  modal(title, async () => {
    const b = Object.fromEntries(new FormData($("#editor")));
    for (const f of ["template", "lines", "rows", "mapping"]) if (b[f]) b[f] = JSON.parse(b[f]);
    return handler(b);
  });
  for (const name of fields) $("#fields").append(field(name, defaults[name] ?? (name === "currency" ? boot.settings.base_currency : ""), { required: !(options.optional || []).includes(name), choices: choices(name, title) }));
}
function choices(name, title) {
  const map = { type: ["asset", "liability", "equity", "revenue", "expense"], cash_flow: ["operating", "investing", "financing"], role: ["viewer", "clerk", "approver", "accountant"], kind: title === "FX adjustment" ? ["realized", "unrealized"] : title === "partners" ? ["customer", "vendor", "both"] : title === "schedules" ? ["recurring", "prepaid", "accrual", "allocation"] : ["invoice", "bill", "credit_note", "vendor_credit", "expense", "receipt"], active: ["0", "1"] };
  return map[name]?.map((v) => [v, v]);
}
function lineEditor({ document: document2 = false, initial = [] } = {}) {
  const section = el("div", "full"), heading = el("h3", "", document2 ? "Document lines" : "Journal lines"), list = el("div");
  section.append(heading);
  function add(values = {}) {
    const row = el("div", "line-editor");
    const a = field("account_id", "", { required: true });
    row.append(a);
    if (document2) {
      row.append(field("description"), field("amount"), field("tax_code_id", "", { required: false }));
    } else row.append(field("debit", "0"), field("credit", "0"));
    for (const name of ["partner_id", "cost_center_id", "project_id", "flow_category"]) row.append(field(name, "", { required: false }));
    row.append(button("×", () => row.remove(), "quiet"));
    for (const input of row.querySelectorAll("[name]")) if (values[input.name] !== void 0) input.value = values[input.name] ?? "";
    list.append(row);
  }
  if (initial.length) initial.forEach(add);
  else {
    add();
    if (!document2) add();
  }
  section.append(list, button("Add line", () => add(), "quiet"));
  section.getLines = () => [...list.children].map((row) => Object.fromEntries([...row.querySelectorAll("[name]")].map((i) => [i.name, i.value])));
  $("#fields").append(section);
  return section;
}
async function newJournal(defaults = {}) {
  await ensureLookups(["accounts","currencies","partners","cost_centers","projects"]);
  let lines;
  const requestKey = defaults.idempotency_key || crypto.randomUUID();
  modal("New journal", () => {
    const b = Object.fromEntries(new FormData($("#editor")));
    b.lines = lines.getLines();
    b.idempotency_key = requestKey;
    return api("/journals" + (defaults._id ? "/" + defaults._id : ""), { method: defaults._id ? "PATCH" : "POST", body: b });
  });
  for (const f of ["day", "description", "currency", "rate"]) $("#fields").append(field(f, defaults[f] || (f === "day" ? today() : f === "currency" ? boot.settings.base_currency : f === "rate" ? "1" : "")));
  lines = lineEditor({ initial: (defaults.lines || []).map(l=>({...l,debit:l.foreign_debit??l.debit,credit:l.foreign_credit??l.credit})) });
}
async function newDocument(defaults={}) {
  await ensureLookups(["accounts","currencies","partners","cost_centers","projects","taxes"]);
  let lines;
  modal("New document", () => {
    const b = Object.fromEntries(new FormData($("#editor")));
    b.lines = lines.getLines();
    return api("/documents"+(defaults._id?"/"+defaults._id:""), { method: defaults._id?"PATCH":"POST", body: b });
  });
  for (const f of ["kind", "number", "partner_id", "day", "due_date", "currency", "rate", "control_account_id", "original_id"]) $("#fields").append(field(f, defaults[f]??(f === "day" || f === "due_date" ? today() : f === "currency" ? boot.settings.base_currency : f === "rate" ? "1" : ""), { required: !["partner_id", "original_id"].includes(f), choices: f === "kind" ? choices("kind") : void 0 }));
  lines = lineEditor({ document: true,initial:defaults.lines||[] });
}
function newPayment(d = {}) {
  const requestKey = crypto.randomUUID();
  openForm("New payment", ["document_id", "day", "amount", "cash_account_id"], (b) => api("/payments", { method: "POST", body: { ...b, idempotency_key: requestKey } }), { document_id: d.id || "", day: today() });
}
function createFor(key) {
  if (key === "journals") return newJournal();
  if (key === "documents") return newDocument();
  if (key === "payments") return newPayment();
  if (key === "imports") return importForm();
  if (key === "attachments") return attachmentForm();
  if (key === "users") return userForm();
  if (key === "reconciliations") return openForm("Reconciliation", ["bank_line_id", "journal_line_id"], (b) => api("/reconciliations", { method: "POST", body: b }));
  if (key === "statements") return openForm("Statement", ["bank_id", "reference", "day", "opening", "closing", "lines"], (b) => api("/statements", { method: "POST", body: b }), { day: today(), opening: "0", closing: "0", lines: [{ external_id: "", day: today(), description: "", amount: "0" }] });
  const c = boot.resources[key];
  if (c?.fields) return openForm(key, c.fields, (b) => api("/" + key, { method: "POST", body: b }), {}, { optional: c.fields.filter((f) => !c.required.includes(f)) });
}
async function editDemo(key,row){
  if(key==="journals"){if(row.source_type==="document")return editDemo("documents",await api("/documents/"+row.source_id));if(row.source_type==="payment"){const payment=await api("/payments/"+row.source_id);return editDemo("payments",payment);}const j=await api("/journals/"+row.id);return newJournal({...j,_id:j.id});}
  if(key==="documents"){const d=await api("/documents/"+row.id);return newDocument({...d,_id:d.id});}
  if(key==="payments")return openForm("تعديل دفعة ",["day","amount","cash_account_id"],b=>api("/payments/"+row.id,{method:"PATCH",body:b}),row);
  if(key==="statements"){const s=await api("/statements/"+row.id);return openForm("تعديل كشف ",["bank_id","reference","day","opening","closing","lines"],b=>api("/statements/"+row.id,{method:"PATCH",body:b}),{...s.statement,lines:s.lines.map(l=>({external_id:l.external_id,day:l.day,description:l.description,amount:l.amount}))});}
  const extra={reconciliations:["bank_line_id","journal_line_id"],attachments:["name"],imports:["mapping"],audit:["action","target","details"]},config=boot.resources[key],fields=config?.fields||extra[key];if(!fields)throw Error("يمكن حذف هذا السجل أو تعديل مستنده المرتبط");
  return openForm("تعديل بيانات ",fields,b=>api("/"+key+"/"+encodeURIComponent(key==="currencies"?row.code:row.id),{method:"PATCH",body:b}),row,{optional:fields.filter(f=>!(config?.required||fields).includes(f))});
}
async function confirmAction(message, action) {
  modal(message, action);
  $("#fields").append(el("p", "notice full", message));
  $("#save").textContent = t("Confirm");
}
async function showJournal(id) {
  const j = await api("/journals/" + id);
  modal("Journal " + (j.sequence || "draft"), () => {
  });
  $("#save").hidden = true;
  const root = $("#fields"), details = el("div", "detail-grid full");
  for (const k of ["day", "description", "currency", "rate", "status", "created_by", "prepared_by", "approved_by", "posted_by"]) {
    const item = el("div", "muted", titleCase(k));
    item.append(el("strong", "", j[k] || "—"));
    details.append(item);
  }
  root.append(details);
  const lines = table(j.lines, ["account_id", "debit", "credit", "foreign_debit", "foreign_credit"]);
  lines.classList.add("full");
  root.append(lines);
  const actions = el("div", "actions full");
  if (j.status === "draft" && boot.permissions.includes("draft")) {
    if (["manual", "import"].includes(j.source_type)) actions.append(button("Edit", () => {
      $("#modal").close();
      newJournal({ ...j, _id: j.id });
    }));
    if (["manual", "import", "document", "payment"].includes(j.source_type)) actions.append(button("Void draft", () => confirmAction("Void this unapproved draft and preserve its history?", () => api("/journals/" + id + "/void", { method: "POST", body: {} }))));
  }
  if (j.status === "draft" && boot.permissions.includes("approve")) actions.append(button("Approve", () => confirmAction("Approve this journal independently?", () => api("/journals/" + id + "/approve", { method: "POST", body: {} })), "primary"));
  if (j.status === "approved" && boot.permissions.includes("approve")) actions.append(button("Reject approval", () => confirmAction("Return this journal to draft and require a new approval?", () => api("/journals/" + id + "/reject", { method: "POST", body: {} }))));
  if (j.status === "approved" && boot.permissions.includes("post")) actions.append(button("Post", () => confirmAction("Post permanently to the general ledger?", () => api("/journals/" + id + "/post", { method: "POST", body: {} })), "primary"));
  if (j.status === "posted" && ["manual", "import", "fx"].includes(j.source_type) && boot.permissions.includes("draft")) actions.append(button("Reverse", () => {
    $("#modal").close();
    openForm("Reverse", ["day"], (b) => api("/journals/" + id + "/reverse", { method: "POST", body: b }), { day: today() });
  }));
  actions.append(button("Attach", () => {
    $("#modal").close();
    attachmentForm({ journal_id: id });
  }));
  root.append(actions);
}
async function showDocument(id) {
  const d = await api("/documents/" + id);
  modal(d.number, () => {
  });
  $("#save").hidden = true;
  const info = el("div", "notice full", `${d.kind} · ${d.status} · ${d.total} ${d.currency}`);
  $("#fields").append(info);
  const tableEl = table(d.lines, ["description", "account_id", "amount", "tax_amount"]);
  tableEl.classList.add("full");
  $("#fields").append(tableEl, button("View journal", () => showJournal(d.journal?.id || d.journal_id)));
}
async function matchBankLine(bankLineId) {
  const data = await api("/reconciliation-candidates?bank_line_id=" + encodeURIComponent(bankLineId));
  modal("Match bank statement line", () => {
  });
  $("#save").hidden = true;
  const candidates = table(data.rows, ["day", "sequence", "description", "foreign_debit", "foreign_credit"], (r, td) => td.append(button("Match", () => confirmAction("Reconcile this bank line with the selected posted ledger line?", () => api("/reconciliations", { method: "POST", body: { bank_line_id: bankLineId, journal_line_id: r.id } })))));
  candidates.classList.add("full");
  $("#fields").append(candidates);
}
function userForm() {
  openForm("إنشاء حساب محاسب",["username","full_name","password","role"],b=>api("/users",{method:"POST",body:b}),{role:"accountant"});
  const password=$("#fields [name=password]");password.type="password";password.autocomplete="new-password";password.minLength=10;
}
async function showStatement(id) {
  const d = await api("/statements/" + id);
  modal("Statement", () => {
  });
  $("#save").hidden = true;
  const v = table(d.lines, ["id", "day", "description", "amount", "journal_line_id"], (r, td) => {
    if (!r.journal_line_id) td.append(button("Match", () => matchBankLine(r.id)));
  });
  v.classList.add("full");
  $("#fields").append(v);
}
async function showImport(id) {
  const d = await api("/imports/" + id);
  modal("Import preview", () => {
  });
  $("#save").hidden = true;
  const v = table(d.rows.map((r) => ({ row: r.row_number, description: r.data.description, error: r.error || "Valid", journal_id: r.journal_id })), ["row", "description", "error", "journal_id"]);
  v.classList.add("full");
  $("#fields").append(v);
  if (d.status === "preview" && boot.permissions.includes("approve")) $("#fields").append(button("Approve import", () => confirmAction("Create draft journals from this validated preview?", () => api("/imports/" + id + "/approve", { method: "POST", body: {} }))));
}
function parseCsv(text) {
  const records = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some(Boolean)) records.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw Error("Unclosed CSV quote");
  row.push(cell);
  if (row.some(Boolean)) records.push(row);
  return records;
}
function importForm() {
  let parsed = [];
  modal("Import journals", async () => {
    const mapping2 = JSON.parse($("#import-mapping").value), groups = /* @__PURE__ */ new Map();
    for (const raw of parsed) {
      const r = Object.fromEntries(Object.entries(mapping2).map(([target, source]) => [target, raw[source] ?? ""]));
      const key = r.reference;
      if (!key) throw Error("Every row needs a reference");
      if (!groups.has(key)) groups.set(key, { day: r.day, description: r.description, currency: r.currency, rate: r.rate || "1", lines: [] });
      groups.get(key).lines.push({ account_id: r.account_id, debit: r.debit || "0", credit: r.credit || "0" });
    }
    return api("/imports/preview", { method: "POST", body: { rows: [...groups.values()], mapping: mapping2 } });
  });
  const notice = el("p", "notice full", "Import creates a validation preview only. Another user must approve it; each resulting journal still requires approval and explicit posting. Map headers to reference, day, description, currency, rate, account_id, debit, credit. Amounts must be decimal text.");
  const file = el("input");
  file.type = "file";
  file.accept = ".xlsx,.csv";
  file.className = "full";
  file.required = true;
  const mapping = field("mapping", { reference: "reference", day: "day", description: "description", currency: "currency", rate: "rate", account_id: "account_id", debit: "debit", credit: "credit" });
  mapping.querySelector("textarea").id = "import-mapping";
  const preview = el("div", "full");
  file.onchange = async () => {
    try {
      const f = file.files[0];
      if (f.size > 2 * 1024 * 1024) throw Error("Import maximum is 2 MB");
      let data;
      if (f.name.toLowerCase().endsWith(".xlsx")) {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(await f.arrayBuffer());
        data = [];
        wb.worksheets[0].eachRow((row) => data.push(row.values.slice(1).map((v) => {
          if (v && typeof v === "object") throw Error("Formula or rich cells are not accepted; use plain text values");
          return String(v ?? "");
        })));
      } else data = parseCsv((await f.text()).replace(/^\uFEFF/, ""));
      const headers = data.shift();
      parsed = data.map((values) => Object.fromEntries(headers.map((h, i) => [h, values[i] || ""])));
      if (parsed.length > 400) throw Error("Maximum 400 source lines");
      preview.replaceChildren(table(parsed.slice(0, 8), headers));
    } catch (e) {
      parsed = [];
      $("#form-error").textContent = e.message;
    }
  };
  $("#fields").append(notice, file, mapping, preview);
}
function bankImportForm() {
  let parsed = [];
  modal("Import bank statement", async () => {
    const b = Object.fromEntries(new FormData($("#editor"))), mapping2 = JSON.parse(b.mapping);
    b.lines = parsed.map((raw) => Object.fromEntries(Object.entries(mapping2).map(([target, source]) => [target, raw[source] ?? ""])));
    delete b.file;
    delete b.mapping;
    return api("/statements", { method: "POST", body: b });
  });
  for (const f of ["bank_id", "reference", "day", "opening", "closing"]) $("#fields").append(field(f, f === "day" ? today() : f === "opening" || f === "closing" ? "0" : ""));
  const notice = el("p", "notice full", "Preview the mapped bank lines before saving. Positive amounts are deposits; negative amounts are withdrawals. Saving a statement never posts a journal or automatically reconciles it.");
  const mapping = field("mapping", { external_id: "external_id", day: "day", description: "description", amount: "amount" }), file = el("input"), preview = el("div", "full");
  file.type = "file";
  file.name = "file";
  file.accept = ".csv,.xlsx";
  file.className = "full";
  file.required = true;
  file.onchange = async () => {
    try {
      const f = file.files[0];
      if (f.size > 2 * 1024 * 1024) throw Error("Import maximum is 2 MB");
      let data;
      if (f.name.toLowerCase().endsWith(".xlsx")) {
        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(await f.arrayBuffer());
        data = [];
        wb.worksheets[0].eachRow((row) => data.push(row.values.slice(1).map((v) => {
          if (v && typeof v === "object") throw Error("Use plain text cells, without formulas");
          return String(v ?? "");
        })));
      } else data = parseCsv((await f.text()).replace(/^\uFEFF/, ""));
      const headers = data.shift();
      parsed = data.map((values) => Object.fromEntries(headers.map((h, i) => [h, values[i] || ""])));
      if (parsed.length > 200) throw Error("Maximum 200 bank lines");
      preview.replaceChildren(table(parsed.slice(0, 8), headers));
    } catch (e) {
      parsed = [];
      $("#form-error").textContent = e.message;
    }
  };
  $("#fields").append(notice, file, mapping, preview);
}
function attachmentForm(defaults = {}) {
  modal("Attachment", () => {
    const data = new FormData($("#editor"));
    if (!data.get("journal_id")) data.delete("journal_id");
    if (!data.get("document_id")) data.delete("document_id");
    return api("/attachments", { method: "POST", body: data });
  });
  for (const f of ["journal_id", "document_id"]) $("#fields").append(field(f, defaults[f] || "", { required: false }));
  const label = el("label", "file-label full", "PDF, PNG or JPEG · maximum 5 MB"), file = el("input");
  file.type = "file";
  file.name = "file";
  file.required = true;
  file.accept = ".pdf,.png,.jpg,.jpeg";
  label.append(file);
  $("#fields").append(label);
}
function settingsView() {
  const root = el("div", "panel");
  if(demoMode)root.append(button("تعديل اسم الشركة",()=>openForm("الشركة",["name"],b=>api("/settings",{method:"PATCH",body:b}),{name:boot.settings.name})));
  root.append(el("h2", "", "New Tel"), el("p", "muted", "Base currency: " + boot.settings.base_currency), el("p", "notice", "No accounting data is invented. Set up your company, currencies, fiscal periods and chart of accounts. Opening balances are approved double-entry journals. Tax settings require independent local validation."));
  if (!boot.settings.initialized && boot.permissions.includes("users")) root.append(button("Set up company", () => openForm("Set up company", ["name", "base_currency", "decimals"], (b) => api("/setup", { method: "POST", body: b }), { base_currency: "JOD", decimals: "3" }), "primary"));
  root.append(button("FX adjustment", () => openForm("FX adjustment", ["kind", "day", "currency", "closing_rate", "account_id", "gain_loss_account_id", "payment_id"], (b) => api("/fx-adjustments", { method: "POST", body: b }), { day: today(), kind: "unrealized", closing_rate: "1" }, { optional: ["payment_id"] })));
  root.append(button("Bank transfer", () => openForm("Bank transfer", ["day", "description", "currency", "rate", "from_account_id", "to_account_id", "amount"], (b) => api("/transfers", { method: "POST", body: { ...b, idempotency_key: crypto.randomUUID() } }), { day: today(), rate: "1" })));
  return root;
}
$("#editor").onsubmit = async (e) => {
  e.preventDefault();
  const save = $("#save");
  save.disabled = true;
  $("#form-error").textContent = "";
  try {
    const result = await submitHandler();
    $("#modal").close();
    toast(result?.status === "posted" ? "Posted successfully" : result?.message || "Saved successfully");
    await compactBootstrap();
    $("#company").textContent = "New Tel";
    await load();
  } catch (error) {
    $("#form-error").textContent = error.message;
  } finally {
    save.disabled = false;
  }
};
for (const id of ["dismiss", "cancel"]) $("#" + id).onclick = () => $("#modal").close();
$("#collapse").onclick = () => document.body.classList.toggle("collapsed");
$("#theme").onclick = () => {
  document.body.classList.toggle("dark");
  preferences.setItem("ac-theme", document.body.classList.contains("dark") ? "dark" : "light");
};
$("#language").onclick = () => {
  lang = lang === "en" ? "ar" : "en";
  preferences.setItem("ac-language", lang);
  applyLanguage();
  load();
};
if (preferences.getItem("ac-theme") === "dark") document.body.classList.add("dark");
async function init() {
  if(!globalThis.AccountingAuth.hasSession()){showLogin();return;}
  try {
    await dataCache().validate(true);
    await compactBootstrap();
    if(!explicitWorkspace&&!demoMode&&boot.demo_available){demoMode=true;base=globalThis.AccountingAuth.apiOrigin+"/functions/v1/accounting-demo";await dataCache().validate(true);await compactBootstrap();}
    document.body.classList.remove("signed-out");

    $("#role").textContent = boot.role;
    const user=globalThis.AccountingAuth.currentUser();$("#current-user").textContent=user?.full_name||user?.username||"";
    $("#company").textContent = "New Tel";
    view = modules.some((m) => m[0] === location.hash.slice(1)) ? location.hash.slice(1) : "dashboard";
    applyLanguage();
    await load();
  } catch (e) {
    $("#content").replaceChildren(el("p", "notice", e.message));
    throw e;
  }
}
function showLogin(){location.replace(globalThis.AccountingAuth.usesEbookLogin()?"ebook.html":"https://soubabood15.github.io/repo/ebook.html");}
$("#accounting-logout").onclick=async()=>{try{await globalThis.AccountingAuth.logout();}finally{showLogin();}};

init().catch(error=>{if(!globalThis.AccountingAuth.hasSession()){showLogin();return;}document.body.classList.remove("signed-out");console.error(error);});

let checkingChanges=false;
async function checkChanges(){if(document.visibilityState!=="visible"||!boot||checkingChanges||!globalThis.AccountingAuth.hasSession())return;checkingChanges=true;try{if(await dataCache().validate(true)){bootDirty=true;await load();}}catch(error){console.error(error);}finally{checkingChanges=false;}}
document.addEventListener?.("visibilitychange",checkChanges);
globalThis.setInterval?.(checkChanges,60000);
