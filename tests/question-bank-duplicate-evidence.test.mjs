import {test} from 'node:test';
import assert from 'node:assert/strict';
import {getStore,__resetAllStores} from '@netlify/blobs';
import {__setUser} from '@netlify/identity';
import handler from '../netlify/functions/knowledge-question-bank-v2.mjs';

const team='duplicate-evidence-test',knowledgeId='knowledge-1',bankId='bank-1';
const priorQuestion='Which source rule applies to the prior accepted case?';
const candidateQuestion='Why does the source rule matter when evaluating this new case?';
const aiResponse=value=>new Response(JSON.stringify({output_text:JSON.stringify(value)}),{status:200,headers:{'content-type':'application/json'}});
function generated(){return{questions:[{knowledgePointId:'K001',type:'mcq',difficulty:'Intermediate',depth:'Understanding',question:candidateQuestion,options:['It preserves the stated source condition.','It replaces the source condition.'],answer:'A',explanation:'The source condition must remain part of the evaluation.',sourceReference:'Document concept 1'}]}}
function priorQuestions(){return Array.from({length:20},(_,i)=>({id:i+1,type:'mcq',difficulty:'Basic',depth:'Recall',trainingPhase:'broad_coverage',knowledgePointId:'K001',knowledgePointTitle:'Training concept 1',question:i?`Previously accepted source question number ${i+1}?`:priorQuestion,options:['Yes','No'],answer:'A',explanation:'The saved source supports this prior question.',sourceReference:'Document concept 1',sensitiveClaim:false}))}
async function seed(){
  __resetAllStores();__setUser({email:'manager@example.test',roles:['manager'],appMetadata:{team_id:team}});process.env.OPENAI_API_KEY='test-only';
  const store=getStore({name:'agentraining-pilot'}),prefix=`teams/${team}`,questions=priorQuestions();
  await store.setJSON(`${prefix}/knowledge/${knowledgeId}`,{id:knowledgeId,title:'Duplicate evidence fixture',consentConfirmed:true});
  await store.setJSON(`${prefix}/knowledge-maps/${knowledgeId}`,{id:'map-1',knowledgeId,version:3,points:[{id:'K001',label:'Training concept 1',summary:'If the stated condition applies, the source rule must remain part of the evaluation because it controls the supported outcome.',sourceReference:'Document concept 1',eligibleDepths:['Recall','Understanding','Application'],trainingWorthiness:6}]});
  await store.setJSON(`${prefix}/question-banks/${bankId}`,{id:bankId,engineVersion:2,knowledgeId,knowledgeMapId:'map-1',knowledgeMapVersion:3,teamId:team,title:'Fixture bank',difficulty:'Mixed',targetQuestions:21,totalQuestions:20,batchSize:5,status:'generating',questions,coverage:{availableKnowledgePoints:1,coveredKnowledgePoints:1,percent:100},quality:{accepted:20,rejected:0,reasons:{},lastRejected:[]},adaptive:{pointRejects:{}},createdAt:'2026-09-11T00:00:00Z',updatedAt:'2026-09-11T00:00:00Z'});
}
async function run(verdicts){
  await seed();const calls=[];const original=globalThis.fetch;globalThis.fetch=async(_url,init)=>{const body=JSON.parse(init.body);calls.push(body);const next=calls.length===1?generated():verdicts[calls.length-2];if(next instanceof Error)throw next;return aiResponse(next);};
  try{const response=await handler(new Request('https://example.test/.netlify/functions/knowledge-question-bank-v2',{method:'POST',body:JSON.stringify({action:'generate_batch',knowledgeId,bankId})}));return{status:response.status,body:await response.json(),calls};}finally{globalThis.fetch=original;delete process.env.OPENAI_API_KEY;}
}

test('valid duplicate verdict is tied to an exact persisted prior question',{concurrency:false},async()=>{
  const primary={verdicts:[{candidateId:0,status:'rejected_duplicate',reason:'Same source condition and same cognitive operation.',duplicateOfQuestionId:'1',priorQuestionText:priorQuestion,duplicateEvidence:'Both questions ask the learner to retrieve the same controlling source condition.'}]};
  const result=await run([primary]);assert.equal(result.status,200);assert.equal(result.calls.length,2,'valid evidence must not trigger secondary review');
  assert.equal(result.body.rejectedThisBatch,1);assert.equal(result.body.questionBank.quality.reasons.rejected_duplicate,1);
  const rejected=result.body.questionBank.quality.lastRejected[0];assert.equal(rejected.priorQuestionId,1);assert.equal(rejected.priorQuestionText,priorQuestion);assert.match(rejected.duplicateEvidence,/same controlling source condition/);assert.equal(rejected.reviewStage,'primary');
  const primaryInput=result.calls[1].input;assert.match(primaryInput,/"questionId":1/);assert.match(primaryInput,/duplicateOfQuestionId/);
});

test('unsupported duplicate is accepted only after an independent full-gate PASS',{concurrency:false},async()=>{
  const unsupported={verdicts:[{candidateId:0,status:'rejected_duplicate',reason:'Prior content supposedly covered this.',duplicateOfQuestionId:'999',priorQuestionText:'A question that was never accepted.',duplicateEvidence:'This assertion cannot be linked to the persisted bank.'}]};
  const secondary={verdicts:[{candidateId:0,status:'accepted',reason:'Source grounded, correct, phase appropriate, and semantically distinct from every listed prior question.'}]};
  const result=await run([unsupported,secondary]);assert.equal(result.status,200);assert.equal(result.calls.length,3);assert.equal(result.body.acceptedThisBatch,1);assert.equal(result.body.rejectedThisBatch,0);assert.equal(result.body.questionBank.totalQuestions,21);assert.equal(result.body.questionBank.status,'complete');
  assert.equal(result.body.questionBank.qualityGateVersion,8);assert.equal(result.body.questionBank.duplicateEvidenceVersion,1);
  assert.match(result.calls[2].input,/first verifier claimed duplicate but did not provide a valid link/i);assert.match(result.calls[2].input,/Re-check ALL quality requirements independently/);
});

test('secondary-review outage preserves the batch and fails closed as needs_review',{concurrency:false},async()=>{
  const unsupported={verdicts:[{candidateId:0,status:'rejected_duplicate',reason:'Unlinked duplicate claim.',duplicateOfQuestionId:'999',priorQuestionText:'Missing prior',duplicateEvidence:'No actual prior record supports this duplicate claim.'}]};
  const result=await run([unsupported,new Error('simulated secondary provider outage')]);assert.equal(result.status,200);assert.equal(result.body.acceptedThisBatch,0);assert.equal(result.body.questionBank.quality.reasons.needs_review,1);assert.equal(result.body.questionBank.quality.reasons.rejected_duplicate,undefined);assert.match(result.body.questionBank.quality.lastRejected[0].reviewReason,/requires review/);
});

test('unsupported duplicate remains safely rejected as needs_review when secondary evidence is invalid',{concurrency:false},async()=>{
  const unsupported={verdicts:[{candidateId:0,status:'rejected_duplicate',reason:'Duplicate.',duplicateOfQuestionId:'404',priorQuestionText:'Missing',duplicateEvidence:'Claims a prior match which does not exist in storage.'}]};
  const stillUnsupported={verdicts:[{candidateId:0,status:'rejected_duplicate',reason:'Still duplicate.',duplicateOfQuestionId:'404',priorQuestionText:'Missing',duplicateEvidence:'Still cannot identify an actual saved prior question.'}]};
  const result=await run([unsupported,stillUnsupported]);assert.equal(result.status,200);assert.equal(result.calls.length,3);assert.equal(result.body.acceptedThisBatch,0);assert.equal(result.body.rejectedThisBatch,1);assert.equal(result.body.questionBank.quality.reasons.rejected_duplicate,undefined);assert.equal(result.body.questionBank.quality.reasons.needs_review,1);
  const rejected=result.body.questionBank.quality.lastRejected[0];assert.deepEqual(rejected.reasons,['needs_review']);assert.equal(rejected.reviewStage,'secondary');assert.match(rejected.reviewReason,/lacked verifiable prior-question evidence/);
});

test('non-duplicate Quality Gate rejection is unchanged and never sent to secondary review',{concurrency:false},async()=>{
  const primary={verdicts:[{candidateId:0,status:'rejected_grounding',reason:'The answer is not supported by the supplied canonical point.'}]};
  const result=await run([primary]);assert.equal(result.status,200);assert.equal(result.calls.length,2);assert.equal(result.body.questionBank.quality.reasons.rejected_grounding,1);assert.equal(result.body.questionBank.quality.lastRejected[0].reviewStage,'primary');
});
