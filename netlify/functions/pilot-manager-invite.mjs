import { getStore } from '@netlify/blobs';
import { getUser, verifyRequestOrigin, admin } from '@netlify/identity';

const STORE_NAME='agentraining-pilot';
const TTL=7*24*60*60*1000;
const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});
const clean=(v,n=500)=>String(v??'').trim().slice(0,n);
const email=v=>clean(v,254).toLowerCase();
const seg=(v,f='pilot')=>clean(v,100).toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'')||f;
const EMAIL=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const tokenKey=t=>`manager-invites/by-token/${t}`;
const emailKey=e=>`manager-invites/by-email/${seg(e,'manager')}`;

function isAdmin(user){const roles=Array.isArray(user?.roles)?user.roles:[];return roles.includes('admin')}
function expected(invite){return{app_metadata:{roles:['manager',`team-${invite.teamId}`],team_id:invite.teamId},user_metadata:invite.name?{full_name:invite.name}:{}}}
function provisioned(user,invite){const roles=Array.isArray(user?.roles)?user.roles:[];return roles.includes('manager')&&roles.includes(`team-${invite.teamId}`)&&user?.appMetadata?.team_id===invite.teamId}
async function save(store,invite){await store.setJSON(tokenKey(invite.token),invite);await store.setJSON(emailKey(invite.email),invite)}
function publicView(i){return{id:i.id,email:i.email,name:i.name,teamId:i.teamId,organization:i.organization,status:i.status,createdAt:i.createdAt,expiresAt:i.expiresAt}}

export default async function handler(req){
 try{
  const url=new URL(req.url),action=clean(url.searchParams.get('action'),40),store=getStore({name:STORE_NAME,consistency:'strong'});
  if(req.method==='POST'&&action==='create'){
   verifyRequestOrigin(req);const user=await getUser();if(!user)return reply(401,{error:'Please sign in to continue.'});if(!isAdmin(user))return reply(403,{error:'Platform admin access is required to invite a manager.'});
   const input=await req.json().catch(()=>({})),managerEmail=email(input.email),name=clean(input.name,120),organization=clean(input.organization,160),teamId=seg(input.teamId||organization,'pilot-team');
   if(!managerEmail||!EMAIL.test(managerEmail))return reply(400,{error:'Enter a valid manager email address.'});if(!teamId)return reply(400,{error:'Enter a team id.'});
   const old=await store.get(emailKey(managerEmail),{type:'json'});if(old&&old.status==='pending'&&Date.parse(old.expiresAt)>Date.now()){return reply(200,{invite:publicView(old),link:`${url.origin}/pilot-manager-accept.html?token=${encodeURIComponent(old.token)}`,reused:true})}
   const now=Date.now(),invite={id:crypto.randomUUID(),token:crypto.randomUUID(),email:managerEmail,name,organization,teamId,invitedBy:email(user.email),status:'pending',createdAt:new Date(now).toISOString(),expiresAt:new Date(now+TTL).toISOString(),acceptedAt:'',acceptedUserId:''};await save(store,invite);
   return reply(201,{invite:publicView(invite),link:`${url.origin}/pilot-manager-accept.html?token=${encodeURIComponent(invite.token)}`,reused:false});
  }
  if(req.method==='GET'&&action==='lookup'){
   const token=clean(url.searchParams.get('token'),100);if(!token)return reply(400,{error:'Missing invitation link.'});const invite=await store.get(tokenKey(token),{type:'json'});if(!invite)return reply(404,{error:'This manager invitation is invalid.'});if(invite.status==='accepted')return reply(200,{status:'accepted',email:invite.email});if(Date.parse(invite.expiresAt)<Date.now())return reply(410,{error:'This manager invitation has expired.'});return reply(200,{status:'pending',email:invite.email,name:invite.name,organization:invite.organization,teamId:invite.teamId});
  }
  if(req.method==='POST'&&action==='accept'){
   verifyRequestOrigin(req);const input=await req.json().catch(()=>({})),token=clean(input.token,100),password=String(input.password||'');if(!token)return reply(400,{error:'Missing invitation link.'});if(password.length<8)return reply(400,{error:'Choose a password with at least 8 characters.'});
   let invite=await store.get(tokenKey(token),{type:'json'});if(!invite)return reply(404,{error:'This manager invitation is invalid.'});if(invite.status==='accepted')return reply(200,{status:'already_accepted',email:invite.email});if(Date.parse(invite.expiresAt)<Date.now())return reply(410,{error:'This manager invitation has expired.'});
   let userId=invite.acceptedUserId||'';if(!userId){let created;try{created=await admin.createUser({email:invite.email,password,data:expected(invite)})}catch(error){const msg=error?.message||'';if(/already exist|already (been )?registered/i.test(msg))return reply(409,{error:'An account already exists for this email. Contact the platform administrator.'});console.error('manager invite create user failed',error);return reply(502,{error:'Could not create the manager account right now.'})}userId=created.id;invite={...invite,acceptedUserId:userId};await save(store,invite)}
   try{await admin.updateUser(userId,expected(invite));const verified=await admin.getUser(userId);if(!provisioned(verified,invite))throw new Error('Manager metadata did not verify.')}catch(error){console.error('manager invite metadata failed',error);return reply(502,{error:'The account was created but manager access is still finishing setup. Please retry.'})}
   invite={...invite,status:'accepted',acceptedAt:new Date().toISOString(),acceptedUserId:userId};await save(store,invite);return reply(201,{status:'created',email:invite.email,teamId:invite.teamId});
  }
  return reply(405,{error:'Unsupported manager invitation action.'});
 }catch(error){console.error('pilot-manager-invite failed',error);return reply(500,{error:error?.message||'Manager invitation failed.'})}
}
