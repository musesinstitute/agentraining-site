import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {getStore,__resetAllStores} from '@netlify/blobs';
import {__setUser} from '@netlify/identity';
import handler from '../netlify/functions/knowledge-question-bank-v2.mjs';

const team='question-bank-recovery-test',knowledgeId='recovery-knowledge',bankId='recovery-bank';
const prior=Array.from({length:20},(_,i)=>({id:i+1,type:'mcq',difficulty:'Basic',depth:'Recall',trainingPhase:'broad_coverage',knowledgePointId:'K001',knowledgePointTitle:'Source rule',question:`Saved accepted question ${i+1} about source evidence?`,options:['Supported','Unsupported'],answer:'A',explanation:'The approved source supports the saved answer.',sourceReference:'Source p. 1',sensitiveClaim:false}));
const generated={questions:[{knowledgePointId:'K001',type:'mcq',difficulty:'Intermediate',depth:'Understanding',question:'Why does the approved source rule matter in this supported situation?',options:['It preserves the source condition.','It removes the source condition.'],answer:'A',explanation:'The condition controls the supported outcome.',sourceReference:'Source p. 1'}]};
const ai=value=>new Response(JSON.stringify({output_text:typeof value==='string'?value:JSON.stringify(value)}),{status:200,headers:{'content-type':'application/json'}});

async function seed(){
  __resetAllStores();__setUser({email:'manager@example.test',roles:['manager'],appMetadata:{team_id:team}});process.env.OPENAI_API_KEY='test-only';
  const store=getStore({name:'agentraining-pilot'}),prefix=`teams/${team}`;
  await store.setJSON(`${prefix}/knowledge/${knowledgeId}`,{id:knowledgeId,title:'Recovery fixture',consentConfirmed:true});
  await store.setJSON(`${prefix}/knowledge-maps/${knowledgeId}`,{id:'map-1',knowledgeId,version:3,points:[{id:'K001',label:'Source rule',summary:'When the supported condition applies, the source rule matters because it controls the outcome.',sourceReference:'Source p. 1',eligibleDepths:['Recall','Understanding','Application']}]});
  const bank={id:bankId,engineVersion:2,qualityGateVersion:8,duplicateEvidenceVersion:1,knowledgeId,knowledgeMapId:'map-1',knowledgeMapVersion:3,teamId:team,title:'Recovery bank',difficulty:'Mixed',targetQuestions:21,totalQuestions:20,batchSize:5,status:'generating',questions:prior,coverage:{availableKnowledgePoints:1,coveredKnowledgePoints:1,percent:100},quality:{accepted:20,rejected:0,reasons:{},lastRejected:[]},adaptive:{pointRejects:{}},createdAt:'2026-09-11T00:00:00Z',updatedAt:'2026-09-11T00:00:00Z'};
  await store.setJSON(`${prefix}/question-banks/${bankId}`,bank);return{store,key:`${prefix}/question-banks/${bankId}`,bank};
}
async function run(responses){const seeded=await seed(),original=globalThis.fetch,calls=[];globalThis.fetch=async(_url,init)=>{calls.push(JSON.parse(init.body));return ai(responses[calls.length-1])};try{const response=await handler(new Request('https://example.test/.netlify/functions/knowledge-question-bank-v2',{method:'POST',body:JSON.stringify({action:'generate_batch',knowledgeId,bankId,batchRequestId:'batch-evidence-1',retryAttempt:2})}));return{response,body:await response.json(),saved:await seeded.store.get(seeded.key),before:seeded.bank,calls}}finally{globalThis.fetch=original;delete process.env.OPENAI_API_KEY}}

test('malformed candidate JSON persists stage-aware evidence without losing accepted questions',{concurrency:false},async()=>{
  const secret='not-json-company-sensitive-placeholder',result=await run([secret]);
  assert.equal(result.response.status,502);assert.equal(result.saved.status,'interrupted');assert.equal(result.saved.recoverable,true);assert.deepEqual(result.saved.questions,result.before.questions);assert.equal(result.saved.totalQuestions,20);
  assert.equal(result.saved.lastFailure.stage,'candidate_generation');assert.equal(result.saved.lastFailure.errorCategory,'unreadable_json');assert.equal(result.saved.lastFailure.batchRequestId,'batch-evidence-1');assert.equal(result.saved.lastFailure.retryAttempt,2);assert.equal(result.saved.lastFailure.responseBytes,Buffer.byteLength(secret));assert.match(result.saved.lastFailure.responseSha256,/^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(result.saved),new RegExp(secret));assert.equal(result.body.recovery.totalQuestions,20);
});

test('malformed primary verifier JSON is attributed to primary_quality_gate',{concurrency:false},async()=>{
  const result=await run([generated,'not-json-verifier-output']);
  assert.equal(result.response.status,502);assert.equal(result.calls.length,2);assert.equal(result.saved.lastFailure.stage,'primary_quality_gate');assert.equal(result.saved.lastFailure.errorCategory,'unreadable_json');assert.deepEqual(result.saved.questions,result.before.questions);assert.equal(result.saved.totalQuestions,20);
});

test('frontend open recovers and renders latest partial bank without regenerating or overwriting it',async()=>{
  const source=readFileSync(new URL('../knowledge-training-engine.js',import.meta.url),'utf8'),elements=new Map(),requests=[],rendered=[];
  class Element{constructor(id=''){this.children=[];this.style={};this.classList={add(){},remove(){}};this.parentNode=null;this.options=[];this.value='';this._id='';if(id)this.id=id}set id(v){this._id=v;if(v)elements.set(v,this)}get id(){return this._id}appendChild(x){x.parentNode=this;this.children.push(x);return x}insertBefore(x){return this.appendChild(x)}querySelector(sel){return sel==='.qb-results-header'?elements.get('qb-results-header'):null}addEventListener(){}remove(){elements.delete(this.id)}}
  const add=id=>new Element(id),results=add('qb-results'),header=add('qb-results-header');header.parentNode=results;add('kte-style');add('scenario-modal');add('qb-capacity-banner');const count=add('qb-count');count.value='50';count.options=[{value:'20'},{value:'30'},{value:'50'}];const difficulty=add('qb-difficulty');difficulty.value='Mixed';const actions=add('qb-result-actions'),close=add('qb-close-btn'),regenerate=add('qb-regenerate-btn');close.parentNode=actions;regenerate.parentNode=actions;
  const partial={id:'persisted-partial',knowledgeId:'doc-1',title:'Pacific partial',difficulty:'Mixed',targetQuestions:50,totalQuestions:49,status:'interrupted',questions:[{id:1,question:'Persisted question'}],updatedAt:'2026-09-11T00:00:00Z'};
  const response=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}}),session=new Map();
  const document={readyState:'complete',documentElement:{lang:'en',dataset:{}},head:new Element(),body:new Element(),getElementById:id=>elements.get(id)||null,createElement:()=>new Element(),addEventListener(){}};
  const context={document,console,Response,Blob,URL,Math,Date,Array,JSON,Promise,crypto:{randomUUID:()=>`request-${requests.length+1}`},sessionStorage:{getItem:k=>session.get(k)||null,setItem:(k,v)=>session.set(k,v),removeItem:k=>session.delete(k)},setInterval(){},clearInterval(){},setTimeout:fn=>queueMicrotask(fn),PilotCloud:{token:async()=> 'manager-token'},fetch:async(endpoint,init)=>{const body=JSON.parse(init.body);requests.push({endpoint,body});if(endpoint.includes('knowledge-map'))return response({knowledgeMap:{points:[{}]}});if(body.action==='capacity')return response({capacity:{recommendedTotal:57,byPhase:{}}});if(body.action==='latest')return response({questionBank:partial});throw new Error(`Unexpected mutation ${body.action}`)},openQBModal(){},renderQBResults:bank=>rendered.push(bank),currentDoc:{id:'doc-1'},currentLang:'en',canManage:true};context.window=context;
  vm.runInNewContext(source,context,{filename:'knowledge-training-engine.js'});await new Promise(resolve=>setImmediate(resolve));context.openQBModal();await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setImmediate(resolve));
  assert.equal(rendered.at(-1).id,partial.id);assert.ok(elements.get('qb-resume-btn'),'partial recovery must expose an explicit resume action');assert.equal(elements.get('qb-resume-btn').style.display,'');assert.equal(regenerate.style.display,'none','partial recovery must hide the conflicting Generate Again action');assert.equal(context.currentQB.id,partial.id);assert.deepEqual(requests.filter(x=>x.endpoint.includes('question-bank')).map(x=>x.body.action).sort(),['capacity','latest']);assert.equal(requests.some(x=>['start','generate_batch'].includes(x.body.action)),false);assert.equal(JSON.parse(session.get('kte_active_bank')).bankId,partial.id);
});
