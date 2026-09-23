import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { getStore, __resetAllStores } from './stubs/netlify-blobs.mjs';
import { __setUser } from './stubs/netlify-identity.mjs';
import groundedHandler from '../netlify/functions/pilot-coach-source.mjs';
import dataHandler from '../netlify/functions/pilot-data.mjs';
import aiHandler from '../netlify/functions/ai-chat.mjs';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const assignment={id:'assignment-a',assignedTo:'learner@example.test',sourceType:'company_knowledge',sourceKnowledgeId:'source-a',scenarioName:'Underwriting Field Guide Reference Summary',sourceLabel:'Company Knowledge · underwriting-field-guide',status:'Assigned',createdAt:'2026-09-10'};
const questions=['How should I explain the holistic underwriting philosophy?','Why is that important?','Give me an example.'];
const verified={role:'assistant',content:'Synthetic verified answer',groundedIn:'company_knowledge',sourceKnowledgeId:'source-a',assignmentContextId:'assignment-a',sourceLabel:assignment.sourceLabel,verification:{status:'PASS'}};
const tick=()=>new Promise(r=>setImmediate(r));
function harness({voice=false,rows=[assignment],getError=false,postError=false,response=verified,edge=read('netlify/edge-functions/ai-relationship-onboarding.ts')}={}){
  const elements=new Map(), calls=[], events={};
  function element(id){if(elements.has(id))return elements.get(id);const e={id,value:'',disabled:false,hidden:false,style:{},dataset:{},classList:{values:new Set(),add(x){this.values.add(x)},remove(x){this.values.delete(x)}},addEventListener(n,f){this[n]=f},dispatchEvent(e){this[e.type]?.(e)},appendChild(){},remove(){},focus(){},insertBefore(){},querySelector(selector){return element(id+' '+selector)},closest(){return null},scrollIntoView(){}};e.parentNode=e;elements.set(id,e);return e;}
  if(!voice)element('voiceDictate');
  const speechInstances=[];
  class SpeechRecognition{constructor(){speechInstances.push(this)} start(){this.onstart?.()} stop(){this.onend?.()}}
  const document={readyState:'loading',head:{appendChild(){}},body:{appendChild(){}},getElementById:id=>{if(voice&&['voiceDictate','mic-btn'].includes(id))return [...elements.values()].find(e=>e.id===id)||null;return element(id)},querySelector(){return null},querySelectorAll(){return []},createElement:()=>element('new-'+Math.random()),addEventListener(n,f){(events[n]??=[]).push(f)}};
  const location={search:'?pilot=1',pathname:'/coach-chat.html',reload(){}};
  const user={email:'learner@example.test',app_metadata:{roles:['learner']},jwt:async()=>'synthetic-test-token'};
  const context=vm.createContext({document,location,URLSearchParams,navigator:{language:'en'},sessionStorage:{getItem(){return null},setItem(){}},localStorage:{removeItem(){}},console,Date,setTimeout,clearTimeout,Event,SpeechRecognition});
  context.window=context;context.addEventListener=document.addEventListener;context.netlifyIdentity={init(){},currentUser:()=>user};
  context.fetch=async(url,options={})=>{calls.push({url,options});const post=options.method==='POST';let body,status=200;
    if(url==='/api/ai-chat')body={assistantMessage:{role:'assistant',content:'lending decisions'},userMessage:{role:'user',content:questions[0]}};
    else if(!post){status=getError?503:200;body=getError?{error:'Assignment unavailable'}:{assignments:rows,messages:[]};}
    else {status=postError?503:201;body=postError?{error:'Grounding unavailable'}:{grounded:url.includes('pilot-coach-source'),assistantMessage:response,userMessage:{role:'user',content:JSON.parse(options.body).message}};}
    return {ok:status<400,status,json:async()=>body};};
  vm.runInContext(read('pilot-cloud.js'),context);
  const html=read('coach-chat.html');for(const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g))vm.runInContext(m[1],context);
  const injected=edge.match(/const injection = String.raw`([\s\S]*?)`;/)?.[1];assert.ok(injected);
  for(const m of injected.matchAll(/<script>([\s\S]*?)<\/script>/g))vm.runInContext(m[1],context);
  for(const cb of events.DOMContentLoaded||[])cb();
  return {context,calls,elements,speechInstances,send:q=>context.sendMessage(q)};
}

test('reproduce original Edge override: formal send bypasses grounded router',async()=>{
  // Exact pre-fix interception block from 6ec19bd; independent of clone depth.
  const old="const injection = String.raw`<script>const isManager=false; const t=en=>en; const zh=()=>false;   if(!isManager && window.PilotCloud && !window.__learnerAiGatewayInstalled){\n     window.__learnerAiGatewayInstalled=true;\n     const originalRequest=window.PilotCloud.request.bind(window.PilotCloud);\n     window.PilotCloud.request=async(name,options={})=>{\n       if(name==='coach-messages' && String(options.method||'GET').toUpperCase()==='POST'){\n         let body={};try{body=JSON.parse(options.body||'{}')}catch{}\n         const message=String(body.content||'').trim();\n         if(!message)throw new Error(t('Message is required.','\u8bf7\u8f93\u5165\u6d88\u606f\u3002'));\n         const res=await fetch('/api/ai-chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({role:'learner',lang:zh()?'zh':'en',message})});\n         let data={};try{data=await res.json()}catch{}\n         if(!res.ok)throw new Error(data.error||t('AI conversation failed.','AI \u5bf9\u8bdd\u6682\u65f6\u65e0\u6cd5\u5b8c\u6210\u3002'));\n         return {userMessage:data.userMessage,assistantMessage:data.assistantMessage};\n       }\n       return originalRequest(name,options);\n     };\n   }\n</script>`;";
  const h=harness({edge:old});await tick();await h.send(questions[0]);
  assert.equal(h.calls.filter(c=>c.options.method==='POST')[0].url,'/api/ai-chat');
  assert.match(h.elements.get('messages').innerHTML,/lending decisions/);
  assert.doesNotMatch(h.elements.get('messages').innerHTML,/Verifier: PASS/);
});
test('formal page + current Edge sends all three turns to source endpoint with explicit IDs and trace',async()=>{
  const h=harness();await tick();for(const q of questions)await h.send(q);
  const posts=h.calls.filter(c=>c.options.method==='POST');assert.equal(posts.length,3);
  for(let i=0;i<posts.length;i++){assert.equal(posts[i].url,'/.netlify/functions/pilot-coach-source');assert.deepEqual(JSON.parse(posts[i].options.body),{assignmentId:assignment.id,sourceKnowledgeId:assignment.sourceKnowledgeId,message:questions[i]});assert.match(posts[i].options.headers.authorization,/^Bearer /);}
  assert.match(h.elements.get('messages').innerHTML,/Grounded in: Company Knowledge · underwriting-field-guide · Verifier: PASS/);
});
test('assignment loading failure blocks formal send',async()=>{const h=harness({getError:true});await tick();await h.send(questions[0]);assert.equal(h.calls.filter(c=>c.options.method==='POST').length,0);assert.equal(h.elements.get('sendButton').disabled,true)});
test('grounded HTTP failure does not fall back or render verified status',async()=>{const h=harness({postError:true});await tick();await h.send(questions[0]);assert.equal(h.calls.filter(c=>c.options.method==='POST').length,1);assert.match(h.elements.get('messages').innerHTML,/Grounding unavailable/);assert.doesNotMatch(h.elements.get('messages').innerHTML,/Verifier: PASS/)});
test('wrong source response is not rendered',async()=>{const h=harness({response:{...verified,sourceKnowledgeId:'wrong-source',content:'wrong answer'}});await tick();await h.send(questions[0]);assert.doesNotMatch(h.elements.get('messages').innerHTML,/wrong answer|Verifier: PASS/);assert.match(h.elements.get('messages').innerHTML,/did not confirm/)});
test('generic results preserve generic route without source badges',async()=>{const h=harness({response:{role:'assistant',content:'Your Practice evidence',coachPath:'generic'}});await tick();h.elements.get('coachContext').value='generic';await h.send('Explain my latest Practice result and the evidence behind it.');const p=h.calls.find(c=>c.options.method==='POST');assert.match(p.url,/pilot-data\?resource=coach-messages/);assert.deepEqual(JSON.parse(p.options.body),{content:'Explain my latest Practice result and the evidence behind it.',coachMode:'generic'});assert.match(h.elements.get('messages').innerHTML,/Path: Generic Coach/);assert.doesNotMatch(h.elements.get('messages').innerHTML,/Verifier: PASS/)});
test('selected assignment is preserved across refresh; removing it fails closed',async()=>{const rows=[assignment,{...assignment,id:'assignment-b',sourceKnowledgeId:'source-b'}];const h=harness({rows});await tick();h.elements.get('coachContext').value='assignment-b';await h.context.loadCoach();assert.equal(h.elements.get('coachContext').value,'assignment-b');rows.pop();await h.context.loadCoach();assert.equal(h.elements.get('coachContext').value,'');await h.send(questions[0]);assert.equal(h.calls.filter(c=>c.options.method==='POST').length,0)});
test('legacy unscoped POST is rejected by router, not sent generically',async()=>{const h=harness();await tick();await assert.rejects(h.context.PilotCloud.request('coach-messages',{method:'POST',body:JSON.stringify({content:questions[0]})}),/context is missing/)});

async function seed(){__resetAllStores();__setUser({id:'learner-a',email:assignment.assignedTo,roles:['learner'],appMetadata:{team_id:'test-team'}});process.env.ANTHROPIC_API_KEY='synthetic';const store=getStore({name:'agentraining-pilot'});await store.setJSON('teams/test-team/assignments/assignment-a',assignment);await store.setJSON('teams/test-team/knowledge/source-a',{title:'underwriting-field-guide',status:'approved',content:'Banner Life life insurance underwriting. We underwrite individuals, not impairments.'});return store;}
function req(input,path='pilot-coach-source'){return new Request('https://example.test/.netlify/functions/'+path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)})}
test('server rejects source mismatch, other learner, manager, unapproved source and missing auth before generation',async()=>{
  const store=await seed();const input={assignmentId:assignment.id,sourceKnowledgeId:'wrong-source',message:questions[0]};assert.equal((await groundedHandler(req(input))).status,409);input.sourceKnowledgeId='source-a';
  __setUser({id:'other',email:'other@example.test',roles:['learner'],appMetadata:{team_id:'test-team'}});assert.equal((await groundedHandler(req(input))).status,403);
  __setUser({id:'manager',email:assignment.assignedTo,roles:['manager']});assert.equal((await groundedHandler(req(input))).status,403);
  __setUser({id:'learner-a',email:assignment.assignedTo,roles:['learner'],appMetadata:{team_id:'test-team'}});await store.setJSON('teams/test-team/knowledge/source-a',{status:'draft'});assert.equal((await groundedHandler(req(input))).status,403);
  __setUser(null);assert.equal((await groundedHandler(req(input))).status,401);
});
test('generic backend refuses assignment-tagged or unscoped requests; explicit skill coaching works',async()=>{
  await seed();for(const input of [{content:questions[0]},{content:questions[0],coachMode:'generic',assignmentId:assignment.id}])assert.equal((await dataHandler(req(input,'pilot-data?resource=coach-messages'))).status,409);
  const r=await dataHandler(req({content:'What should I practice next?',coachMode:'generic'},'pilot-data?resource=coach-messages'));assert.equal(r.status,201);const b=await r.json();assert.equal(b.assistantMessage.coachPath,'generic');assert.equal(b.assistantMessage.verification,undefined);
});
test('grounded history stays learner/assignment scoped; failed verifier withholds candidate',async()=>{
  const store=await seed(),prefix='teams/test-team/private-coach/learner-a/';
  await store.setJSON(prefix+'generic',{role:'assistant',content:'lending decisions',createdAt:'2026-09-01'});
  await store.setJSON(prefix+'other-assignment',{role:'assistant',content:'other assignment private',assignmentContextId:'assignment-b',groundedIn:'company_knowledge',createdAt:'2026-09-01'});
  const original=globalThis.fetch,calls=[];globalThis.fetch=async(_url,options)=>{const b=JSON.parse(options.body);calls.push(b);return new Response(JSON.stringify({content:[{type:'text',text:calls.length%2?'Synthetic unsupported candidate':JSON.stringify({status:'UNSUPPORTED',reason:'No evidence'})}]}),{status:200})};
  try{const r=await groundedHandler(req({assignmentId:assignment.id,sourceKnowledgeId:'source-a',message:questions[0]}));assert.equal(r.status,201);const b=await r.json();assert.equal(b.verification.status,'UNSUPPORTED');assert.doesNotMatch(b.assistantMessage.content,/Synthetic unsupported candidate/);assert.equal(b.assistantMessage.sourceLabel,assignment.sourceLabel);assert.doesNotMatch(JSON.stringify(calls[0].messages),/lending decisions|other assignment private/);assert.match(calls[0].system,/We underwrite individuals, not impairments/)}finally{globalThis.fetch=original}
});

test('old already-open Edge gateway cannot keep generating unscoped learner answers',async()=>{
  await seed();process.env.OPENAI_API_KEY='synthetic';
  for(const input of [{role:'learner',message:questions[0]},{role:'learner',message:questions[0],coachMode:'generic',sourceKnowledgeId:'source-a'}])assert.equal((await aiHandler(req(input,'ai-chat'))).status,409);
});

test('formal form submit event sends the typed draft',async()=>{
  const h=harness();await tick();h.elements.get('messageInput').value=questions[0];h.elements.get('composer').submit({preventDefault(){}});await tick();
  const posts=h.calls.filter(c=>c.options.method==='POST');assert.equal(posts.length,1);assert.equal(JSON.parse(posts[0].options.body).message,questions[0]);
});
test('empty context disables Send with a visible reason and preserves draft',async()=>{
  const h=harness();await tick();h.elements.get('coachContext').value='';h.elements.get('coachContext').change();
  assert.equal(h.elements.get('sendButton').disabled,true);assert.match(h.elements.get('composerStatus').textContent,/Choose a coaching context/);
});
test('typed generic question uses generic even from an active Company Knowledge context',async()=>{
  const h=harness({response:{role:'assistant',content:'Practice your next skill.',coachPath:'generic'}});await tick();await h.send('What should I practice next?');
  assert.match(h.calls.find(c=>c.options.method==='POST').url,/pilot-data/);assert.equal(h.elements.get('coachContext').value,'generic');
});
test('SpeechRecognition controls transcribe to the draft, stop safely, and do not submit automatically',async()=>{
  const h=harness({voice:true});await tick();const btn=[...h.elements.values()].find(e=>e.id==='voiceDictate');assert.ok(btn);btn.click();
  assert.equal(h.elements.get('sendButton').disabled,true);const sr=h.speechInstances[0];const result=[{transcript:'How should I explain the holistic underwriting philosophy?'}];result.isFinal=true;sr.onresult({resultIndex:0,results:[result]});
  assert.equal(h.elements.get('messageInput').value,questions[0]);assert.equal(h.calls.filter(c=>c.options.method==='POST').length,0);btn.click();assert.equal(h.elements.get('sendButton').disabled,false);
});
test('microphone denial remains visible and text Send recovers',async()=>{
  const h=harness({voice:true});await tick();const btn=[...h.elements.values()].find(e=>e.id==='voiceDictate');btn.click();const sr=h.speechInstances[0];sr.onerror({error:'not-allowed'});sr.onend();
  const status=[...h.elements.values()].find(e=>e.className==='voice-status');assert.match(status.textContent,/not-allowed/);assert.equal(status.classList.values.has('show'),true);assert.equal(h.elements.get('sendButton').disabled,false);await h.send(questions[0]);assert.equal(h.calls.filter(c=>c.options.method==='POST').length,1);
});
