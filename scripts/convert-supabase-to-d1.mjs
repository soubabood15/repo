import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const schemaSource = fs.readFileSync(path.join(root, 'supabase_schema.sql'), 'utf8');
const dataSource = fs.readFileSync(path.join(root, 'supabase_data.sql'), 'utf8');
const outDir = path.join(root, 'd1-migration');
fs.mkdirSync(outDir, { recursive: true });

const primaryKeys = new Map();
for (const match of schemaSource.matchAll(/ALTER TABLE ONLY public\.([\w]+)[\s\S]*?ADD CONSTRAINT [\w]+ PRIMARY KEY \(([^)]+)\);/g)) {
  primaryKeys.set(match[1], match[2].trim());
}

function splitDefinitions(body) {
  const parts = [];
  let start = 0, depth = 0, quote = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "'" && body[i - 1] !== '\\') quote = !quote;
    if (!quote && c === '(') depth++;
    if (!quote && c === ')') depth--;
    if (!quote && depth === 0 && c === ',') {
      parts.push(body.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(body.slice(start).trim());
  return parts.filter(Boolean);
}

function sqliteColumn(def) {
  if (/^CONSTRAINT\s/i.test(def)) return null;
  let s = def.replace(/\s+/g, ' ').trim();
  s = s.replace(/timestamp (?:with|without) time zone/gi, 'TEXT')
    .replace(/\bjsonb\b/gi, 'TEXT')
    .replace(/\btext\[\]/gi, 'TEXT')
    .replace(/\buuid\b/gi, 'TEXT')
    .replace(/\bnumeric(?:\([^)]*\))?/gi, 'REAL')
    .replace(/\bbigint\b/gi, 'INTEGER')
    .replace(/\bboolean\b/gi, 'INTEGER')
    .replace(/\bdate\b/gi, 'TEXT')
    .replace(/\btext\b/gi, 'TEXT')
    .replace(/DEFAULT gen_random_uuid\(\)/gi, "DEFAULT (lower(hex(randomblob(16))))")
    .replace(/DEFAULT now\(\)/gi, 'DEFAULT CURRENT_TIMESTAMP')
    .replace(/DEFAULT true\b/gi, 'DEFAULT 1')
    .replace(/DEFAULT false\b/gi, 'DEFAULT 0')
    .replace(/'([^']*)'::(?:text|jsonb)/gi, "'$1'")
    .replace(/\(0\)::REAL/g, '0');
  return s;
}

const ddl = ['PRAGMA foreign_keys=OFF;'];
for (const match of schemaSource.matchAll(/CREATE TABLE public\.([\w]+) \(([\s\S]*?)\n\);/g)) {
  const [, table, body] = match;
  const columns = splitDefinitions(body).map(sqliteColumn).filter(Boolean);
  const pk = primaryKeys.get(table);
  if (pk) columns.push(`PRIMARY KEY (${pk})`);
  ddl.push(`CREATE TABLE IF NOT EXISTS ${table} (\n  ${columns.join(',\n  ')}\n);`);
}
ddl.push('PRAGMA foreign_keys=ON;');
fs.writeFileSync(path.join(outDir, '001_schema.sql'), ddl.join('\n\n') + '\n');

const inserts = [];
for (const match of dataSource.matchAll(/INSERT INTO public\.[\s\S]*?;\n/g)) {
  inserts.push(match[0]
    .replace(/INSERT INTO public\./g, 'INSERT OR REPLACE INTO ')
    .replace(/ OVERRIDING SYSTEM VALUE/g, '')
    .replace(/\btrue\b/g, '1')
    .replace(/\bfalse\b/g, '0'));
}
fs.writeFileSync(path.join(outDir, '002_data.sql'), `PRAGMA foreign_keys=OFF;\n${inserts.join('\n')}\nPRAGMA foreign_keys=ON;\n`);

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function sqlValue(value) {
  if (value === '') return 'NULL';
  return `'${value.replaceAll("'", "''")}'`;
}

for (const month of ['jul', 'aug', 'sep']) {
  const rows = parseCsv(fs.readFileSync(path.join(root, `admin_live_daily_logs_${month}.csv`), 'utf8'));
  const header = rows.shift();
  const output = ['PRAGMA foreign_keys=OFF;'];
  for (let i = 0; i < rows.length; i += 100) {
    const values = rows.slice(i, i + 100).map(row => `(${row.map(sqlValue).join(',')})`).join(',\n');
    output.push(`INSERT OR REPLACE INTO admin_live_daily_logs (${header.join(',')}) VALUES\n${values};`);
  }
  output.push('PRAGMA foreign_keys=ON;');
  fs.writeFileSync(path.join(outDir, `003_logs_${month}.sql`), output.join('\n') + '\n');
}

console.log(`Created D1 migration in ${outDir}`);
