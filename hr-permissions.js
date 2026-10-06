export const HR_RESOURCES=['attendance','online','schedule','actions','leaves','performance','analysis','export','staff'];
export function defaultHrPermissions(role){
  return Object.fromEntries(HR_RESOURCES.map(key=>[key,role==='admin'||role==='hr_admin'?( ['online','performance','analysis','export'].includes(key)?'read':'write'):role==='hr'&&key!=='staff'?'read':'none']));
}
export function validHrPermissions(input){return !!input&&typeof input==='object'&&!Array.isArray(input)&&Object.keys(input).length===HR_RESOURCES.length&&HR_RESOURCES.every(key=>['none','read','write'].includes(input[key]))}
export async function hrPermissions(db,profile){
  const defaults=defaultHrPermissions(profile.role);if(profile.role==='admin')return defaults;
  if(!['hr','hr_admin'].includes(profile.role))return defaults;
  const row=await db.prepare('SELECT permissions_json FROM hr_staff_permissions WHERE username=?').bind(profile.username).first();
  if(!row)return defaults;
  try{const permissions=JSON.parse(row.permissions_json);return validHrPermissions(permissions)?permissions:Object.fromEntries(HR_RESOURCES.map(key=>[key,'none']))}catch{return Object.fromEntries(HR_RESOURCES.map(key=>[key,'none']))}
}
export const hrAllowed=(permissions,key,write=false)=>write?permissions[key]==='write':['read','write'].includes(permissions[key]);
export function hrRouteResource(path){
  if(path.startsWith('/staff'))return 'staff';
  if(path.startsWith('/attendance'))return 'attendance';
  if(path==='/export')return 'export';
  if(path==='/schedule')return 'schedule';
  if(path.startsWith('/actions'))return 'actions';
  if(path.startsWith('/sick-leaves')||path.startsWith('/requests'))return 'leaves';
  if(path==='/analytics')return 'analysis';
  return null;
}
