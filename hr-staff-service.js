import {HR_RESOURCES,hrPermissions,validHrPermissions} from './hr-permissions.js';
export async function hrStaffRoute({path,request,db,profile,respond,audit,now,hashPassword}){
  if(!path.startsWith('/staff'))return null;
  if(path==='/staff'&&request.method==='GET'){
    const users=(await db.prepare("SELECT id,username,full_name,role,active FROM trainer_users WHERE role IN ('hr','hr_admin') ORDER BY full_name").all()).results||[];
    return respond({resources:HR_RESOURCES,users:await Promise.all(users.map(async user=>({...user,permissions:await hrPermissions(db,user)})))});
  }
  const body=await request.json();
  if(!validHrPermissions(body.permissions)||body.permissions.staff!=='none')return respond({message:'Provide a complete permission matrix. Staff administration is reserved for HR Admin accounts.'},400);
  if(path==='/staff'&&request.method==='POST'){
    const username=String(body.username||'').trim().toLowerCase(),name=String(body.full_name||'').trim(),password=String(body.password||'');
    if(!/^[a-z0-9._-]{3,50}$/.test(username)||!name||name.length>150||password.length<10||password.length>200)return respond({message:'Enter a name, valid username and a temporary password of 10–200 characters.'},400);
    const email=username+'@ebook.com';if(await db.prepare('SELECT id FROM auth_accounts WHERE email=?').bind(email).first()||await db.prepare('SELECT username FROM trainer_users WHERE username=?').bind(username).first())return respond({message:'Username already exists'},409);
    const id=crypto.randomUUID(),profileId=crypto.randomUUID(),hash=await hashPassword(password);
    await db.batch([
      db.prepare('INSERT INTO auth_accounts(id,email,password_hash,user_metadata,created_at,active) VALUES(?,?,?,?,?,1)').bind(id,email,hash,JSON.stringify({username,full_name:name,role:'hr'}),now),
      db.prepare('INSERT INTO trainer_users(id,username,full_name,role,active,created_at,updated_at,auth_user_id) VALUES(?,?,?,\'hr\',1,?,?,?)').bind(profileId,username,name,now,now,id),
      db.prepare('INSERT INTO hr_staff_permissions(username,permissions_json,updated_by,updated_at) VALUES(?,?,?,?)').bind(username,JSON.stringify(body.permissions),profile.username,now),
      audit(db,profile,'create_hr_staff',username,{permissions:body.permissions},now)
    ]);return respond({ok:true,username},201);
  }
  const match=path.match(/^\/staff\/([^/]+)$/);
  if(match&&request.method==='PATCH'){
    const username=decodeURIComponent(match[1]),target=await db.prepare('SELECT username,role FROM trainer_users WHERE username=?').bind(username).first();
    if(!target||target.role!=='hr'||username===profile.username)return respond({message:'Only HR employee permissions can be edited here. Your own account cannot be edited.'},403);
    const previous=await hrPermissions(db,target);
    await db.batch([db.prepare('INSERT INTO hr_staff_permissions(username,permissions_json,updated_by,updated_at) VALUES(?,?,?,?) ON CONFLICT(username) DO UPDATE SET permissions_json=excluded.permissions_json,updated_by=excluded.updated_by,updated_at=excluded.updated_at').bind(username,JSON.stringify(body.permissions),profile.username,now),audit(db,profile,'hr_permissions',username,{previous,permissions:body.permissions},now)]);
    return respond({ok:true});
  }
  return respond({message:'Staff route not found'},404);
}
