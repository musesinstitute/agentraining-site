import { getStore } from '@netlify/blobs';
import { sendEmail, EmailNotConfiguredError } from './lib/send-email.mjs';

const STORE_NAME='agentraining-pilot';
const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const clean=(v,n=500)=>String(v??'').trim().slice(0,n);
const email=v=>clean(v,254).toLowerCase();
const EMAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});

export default async (request)=>{
  if(request.method!=='POST') return reply(405,{error:'Method not allowed.'});
  try{
    const origin=request.headers.get('origin')||'';
    const host=request.headers.get('host')||'';
    if(origin && host){
      try{if(new URL(origin).host!==host)return reply(403,{error:'Request origin not allowed.'})}catch{return reply(403,{error:'Request origin not allowed.'})}
    }
    const body=await request.json().catch(()=>({}));
    const name=clean(body.name,120), managerEmail=email(body.email), organization=clean(body.organization,160), teamSize=clean(body.teamSize,40);
    if(!name||!organization||!EMAIL_RE.test(managerEmail)) return reply(400,{error:'Please provide your name, organization, and a valid Manager email.'});
    const now=new Date().toISOString();
    const id=crypto.randomUUID();
    const record={id,name,email:managerEmail,organization,teamSize,status:'requested',createdAt:now};
    const store=getStore(STORE_NAME);
    await store.setJSON('pilot-requests/'+now+'-'+id,record,{onlyIfNew:true});

    let notification='sent';
    try{
      const subject='New 14-Day Pilot Request — '+organization;
      const text=['New AgentTraining.ai 14-Day Pilot request','',`Name: ${name}`,`Organization: ${organization}`,`Manager email: ${managerEmail}`,`Team size: ${teamSize||'Not provided'}`,`Requested: ${now}`,'','Next step: review the request, then use Platform Admin → Invite Manager to create the secure Manager invitation.'].join('\n');
      const html='<h2>New AgentTraining.ai 14-Day Pilot request</h2><p><b>Name:</b> '+name.replace(/[&<>]/g,'')+'<br><b>Organization:</b> '+organization.replace(/[&<>]/g,'')+'<br><b>Manager email:</b> '+managerEmail.replace(/[&<>]/g,'')+'<br><b>Team size:</b> '+(teamSize||'Not provided').replace(/[&<>]/g,'')+'<br><b>Requested:</b> '+now+'</p><p>Next step: review the request, then use Platform Admin → Invite Manager to create the secure Manager invitation.</p>';
      await sendEmail({to:'sales@agentraining.ai',subject,html,text,replyTo:managerEmail});
    }catch(err){
      notification=err instanceof EmailNotConfiguredError?'not_configured':'failed';
      console.warn('pilot request notification',notification,err?.message||err);
    }
    return reply(201,{status:'received',requestId:id,notification});
  }catch(err){
    console.error('pilot request failed',err);
    return reply(500,{error:'Could not submit your pilot request right now. Please try again.'});
  }
};