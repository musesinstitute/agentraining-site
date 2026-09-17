import { getUser, verifyRequestOrigin } from '@netlify/identity';

const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store'};
const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});
const clean=(v,n=1600)=>String(v??'').trim().slice(0,n);

function outputText(payload){
  if(typeof payload?.output_text==='string')return payload.output_text.trim();
  const out=[];
  for(const item of payload?.output||[])for(const c of item?.content||[])if(c?.type==='output_text'&&c?.text)out.push(c.text);
  return out.join('\n').trim();
}
function parseJson(raw){
  let text=String(raw||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,'').trim();
  try{return JSON.parse(text)}catch{}
  const a=text.indexOf('{'),b=text.lastIndexOf('}');
  if(a>=0&&b>a)return JSON.parse(text.slice(a,b+1));
  throw new Error('Translation returned unreadable JSON.');
}

export default async function handler(req){
  try{
    if(req.method!=='POST')return reply(405,{error:'POST required.'});
    verifyRequestOrigin(req);
    const user=await getUser(req);
    if(!user)return reply(401,{error:'Please sign in.'});
    const roles=Array.isArray(user.roles)?user.roles:[];
    if(!roles.includes('manager')&&!roles.includes('admin'))return reply(403,{error:'Manager access is required.'});
    const body=await req.json().catch(()=>({}));
    const questions=Array.isArray(body.questions)?body.questions.slice(0,10):[];
    if(!questions.length)return reply(400,{error:'Questions are required.'});
    const key=process.env.OPENAI_API_KEY;
    if(!key)return reply(503,{error:'Translation AI is not configured.'});
    const compact=questions.map((q,i)=>({i,question:clean(q.question),options:Array.isArray(q.options)?q.options.slice(0,4).map(x=>clean(x,600)):[],answer:clean(q.answer,40),explanation:clean(q.explanation),knowledgePointTitle:clean(q.knowledgePointTitle,500)}));
    const instructions='Translate enterprise insurance training Question Bank display text into clear Simplified Chinese. Preserve meaning, numbers, qualifiers, answer correctness, and option order exactly. Do not add outside knowledge. Do not translate answer letters A/B/C/D or True/False answer tokens. Return compact valid JSON only.';
    const input='Translate each item. Return {"questions":[{"i":0,"question":"...","options":["..."],"answer":"A","explanation":"...","knowledgePointTitle":"..."}]}.\n'+JSON.stringify(compact);
    const response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${key}`},body:JSON.stringify({model:process.env.OPENAI_KNOWLEDGE_MODEL||process.env.OPENAI_CHAT_MODEL||'gpt-5.4-mini',instructions,input,max_output_tokens:5000})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)return reply(502,{error:data?.error?.message||'Translation provider failed.'});
    const parsed=parseJson(outputText(data));
    return reply(200,{questions:Array.isArray(parsed.questions)?parsed.questions:[]});
  }catch(error){
    console.error('question-bank-translate failed',error?.message||error);
    return reply(error?.status||500,{error:error?.message||'Question Bank translation failed.'});
  }
}
