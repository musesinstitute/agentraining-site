// Historical evidence preservation and deterministic replay, NOT a live AI
// generation benchmark. Private source text stays outside the repository.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {getStore, __resetAllStores} from '@netlify/blobs';
import {__setUser} from '@netlify/identity';
import handler from '../netlify/functions/knowledge-question-bank-v2.mjs';

const manifest=JSON.parse(readFileSync(new URL('./fixtures/question-bank/gold-baselines.json',import.meta.url)));
const sha=value=>createHash('sha256').update(value).digest('hex');
const request=(knowledgeId,extra={})=>new Request('https://example.test/.netlify/functions/knowledge-question-bank-v2',{method:'POST',body:JSON.stringify({action:'latest',knowledgeId,...extra})});
const manager=()=>__setUser({email:'manager@example.test',roles:['manager'],appMetadata:{team_id:'baseline-test'}});

for(const [name,fixture] of Object.entries(manifest.cases)){
  test(`${name}: archived counts reconcile without conflating accepted and requested`,()=>{
    const {bank,questions,quality}=fixture,d=bank.diagnostics;
    assert.equal(bank.targetQuestions,50);
    assert.equal(bank.totalQuestions,name==='banner'?50:24);
    assert.equal(questions.length,bank.totalQuestions);
    assert.equal(d.totalGenerated,d.totalAccepted+d.totalRejected);
    assert.equal(d.totalAccepted,quality.accepted);
    assert.equal(d.totalRejected,quality.rejected);
    assert.equal(Object.values(d.primaryReasons).reduce((a,b)=>a+b,0),d.totalRejected);
    assert.equal(Object.values(d.byPhase).reduce((a,p)=>a+p.accepted,0),questions.length);
    assert.equal(new Set(questions.map(q=>q.knowledgePointId)).size,bank.coverage.coveredKnowledgePoints);
    assert.equal(new Set(questions.map(q=>q.knowledgePointId+':'+q.depth)).size,questions.length);
    for(const [phase,diag] of Object.entries(d.byPhase)){
      assert.equal(diag.attempted,diag.accepted+diag.rejected);
      assert.equal(questions.filter(q=>(q.trainingPhase==='broad_coverage'?'coverage':q.trainingPhase)===phase).length,diag.accepted);
    }
  });
  test(`${name}: latest preserves the stored bank, ignores foreign-team bank, and never calls AI`,async()=>{
    __resetAllStores();manager();const store=getStore({name:'agentraining-pilot'}),id=fixture.bank.knowledgeId;
    const saved={...fixture.bank,questions:fixture.questions,quality:fixture.quality,teamId:'baseline-test'};
    // Deliberately no consent/map: latest must remain a pure recovery read.
    await store.setJSON(`teams/baseline-test/knowledge/${id}`,{id});
    await store.setJSON(`teams/baseline-test/question-banks/${saved.id}`,saved);
    await store.setJSON('teams/other-team/question-banks/newer',{...saved,id:'foreign',teamId:'other-team',updatedAt:'2099-01-01'});
    await store.setJSON('teams/baseline-test/question-banks/misfiled',{...saved,id:'misfiled',teamId:'other-team',updatedAt:'2099-01-01'});
    const fetchBefore=globalThis.fetch;globalThis.fetch=()=>{throw new Error('Recovery must not call AI');};
    try{const response=await handler(request(id));assert.equal(response.status,200);assert.deepEqual((await response.json()).questionBank,saved);assert.deepEqual(await store.get(`teams/baseline-test/question-banks/${saved.id}`),saved);}finally{globalThis.fetch=fetchBefore;}
  });
}

test('saved-bank access requires a manager and cannot select another team via input',async()=>{
  __resetAllStores();__setUser({email:'learner@example.test',roles:['learner'],appMetadata:{team_id:'baseline-test'}});
  assert.equal((await handler(request('private'))).status,403);
  const store=getStore({name:'agentraining-pilot'});await store.setJSON('teams/other-team/knowledge/private',{id:'private'});
  manager();assert.equal((await handler(request('private',{teamId:'other-team'}))).status,404);
});

const evidenceDir=process.env.QB_EVIDENCE_DIR;
test('required private evidence is configured',()=>{if(process.env.QB_REQUIRE_EVIDENCE==='1')assert.ok(evidenceDir,'Set QB_EVIDENCE_DIR to the extracted private evidence archive.');});
function internals(file){const context=vm.createContext({});const source=readFileSync(new URL('../netlify/functions/'+file,import.meta.url),'utf8');vm.runInContext(source.replace(/^import .*;\n/gm,'').split('export default')[0],context);return context;}
for(const [name,fixture] of Object.entries(manifest.cases)){
  test(`${name}: private saved source reproduces map and all accepted questions survive deterministic gate`,{skip:!evidenceDir},()=>{
    const bytes=readFileSync(`${evidenceDir}/${name}.json`);assert.equal(sha(bytes),fixture.snapshotSha256,'Historical snapshot changed; never replace Gold with a new run.');
    const snapshot=JSON.parse(bytes),engine=internals('knowledge-question-bank-v2.mjs'),mapEngine=internals('knowledge-map.mjs');
    assert.equal(sha(snapshot.source.content),fixture.sourceSha256);
    const rebuilt=mapEngine.provisionalPoints(snapshot.source);
    assert.deepEqual(JSON.parse(JSON.stringify(rebuilt)),snapshot.knowledgeMap.points);
    const points=snapshot.knowledgeMap.points,bank=snapshot.questionBank;
    assert.equal(points.filter(p=>engine.understandingEligible(p)).length,bank.coverage.understandingEligibleKnowledgePoints);
    assert.equal(points.filter(p=>engine.applicationEligible(p)).length,bank.coverage.applicationEligibleKnowledgePoints);
    bank.questions.forEach((q,i)=>{
      assert.equal(sha(q.question),fixture.questions[i].questionSha256);
      assert.equal(engine.validate(q,bank.questions.slice(0,i),{key:q.trainingPhase}).length,0,`${name} Q${q.id} regressed`);
    });
    // Intentionally no AI verdict replay: original verifier request/response
    // bodies were not persisted, and deterministic PASS cannot certify depth.
  });
}
