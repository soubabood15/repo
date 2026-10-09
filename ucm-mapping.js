const employeeRoles=new Set(['agent','quality','trainer']);
const isEmployee=user=>Number(user.active)===1&&employeeRoles.has(String(user.role||'').toLowerCase());

// Explicit mappings (including disabled entries) override the numeric default.
// No auto-mapping rows are stored, so new accounts work without recurring writes.
export function effectiveUcmMappings(manual,employees){
  const eligible=new Set(employees.filter(isEmployee).map(user=>String(user.username))),blocked=new Set(manual.map(row=>String(row.extension))),assigned=new Set(manual.filter(row=>Number(row.active)===1).map(row=>String(row.username)));
  const result=manual.filter(row=>Number(row.active)===1&&eligible.has(String(row.username))).map(row=>({extension:String(row.extension),username:String(row.username),source:'manual'}));
  for(const username of eligible)if(/^\d{2,10}$/.test(username)&&!blocked.has(username)&&!assigned.has(username))result.push({extension:username,username,source:'automatic'});
  return result.sort((a,b)=>a.extension.localeCompare(b.extension));
}

export async function resolveUcmEmployee(db,extension){
  extension=String(extension||'');if(!/^\d{2,10}$/.test(extension))return null;
  // One indexed lookup per event; never infer from a display name or a session.
  const rows=(await db.prepare("SELECT u.username FROM trainer_users u WHERE u.active=1 AND u.role IN ('agent','quality','trainer') AND (EXISTS(SELECT 1 FROM ucm_agent_mapping m WHERE m.extension=? AND m.active=1 AND m.username=u.username) OR (u.username=? AND NOT EXISTS(SELECT 1 FROM ucm_agent_mapping m WHERE m.extension=?) AND NOT EXISTS(SELECT 1 FROM ucm_agent_mapping m WHERE m.username=u.username AND m.active=1))) LIMIT 2").bind(extension,extension,extension).all()).results||[];
  return rows.length===1?{extension,username:rows[0].username}:null;
}

export async function loadUcmMappings(db){
  const [manual,employees]=await Promise.all([db.prepare('SELECT extension,username,active FROM ucm_agent_mapping').all(),db.prepare("SELECT username,full_name,role,active FROM trainer_users WHERE active=1 AND role IN ('agent','quality','trainer')").all()]);
  return {mappings:effectiveUcmMappings(manual.results||[],employees.results||[]),employees:employees.results||[]};
}
