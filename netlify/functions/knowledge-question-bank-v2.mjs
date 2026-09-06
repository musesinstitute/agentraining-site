import { getStore } from '@netlify/blobs';
import { getUser, verifyRequestOrigin } from '@netlify/identity';
const STORE_NAME='agentraining-pilot',BATCH_SIZE=5,TIMEOUT_MS=30000,VERIFY_TIMEOUT_MS=30000;
const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store'},reply=(s,b)=>new Response(JSON.stringify(b),{status:s,headers});
const clean=(v,n=500)=>String(v??'').trim().slice(0,n),seg=(v,f='founding-pilot')=>clean(v,100).toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'')||f,fp=v=>clean(v,1400).toLowerCase().replace(/[^a-z0-9\u3400-\u9fff]+/g,' ').replace(/\s+/g,' ').trim();
function text(p){if(typeof p?.output_text==='string')return p.output_text.trim();const a=[];for(const x of p?.output||[])for(const c of x?.content||[])if(c?.type==='output_text'&&c?.text)a.push(c.text);return a.join('\n').trim()}
function json(raw){let t=String(raw||'').trim().replace(/^```(?:json)?\s*/i,'').replace(/```\s*$/,'').trim();try{return JSON.parse(t)}catch{}const a=t.indexOf('{'),b=t.lastIndexOf('}');if(a>=0&&b>a)try{return JSON.parse(t.slice(a,b+1))}catch{}throw Object.assign(new Error('AI returned unreadable JSON. Retry this batch.'),{status:502})}
async function actor(req){verifyRequestOrigin(req);const u=await getUser(req);if(!u)throw Object.assign(new Error('Please sign in.'),{status:401});const r=Array.isArray(u.roles)?u.roles:[];if(!r.includes('manager')&&!r.includes('admin'))throw Object.assign(new Error('Manager access is required.'),{status:403});return{teamId:seg(u.appMetadata?.team_id),email:clean(u.email,254).toLowerCase()}}
function phaseFor(p){if(p<=20)return{key:'broad_coverage',depths:['Recall','Understanding'],types:['mcq','truefalse','scenario']};if(p<=35)return{key:'understanding',depths:['Understanding'],types:['mcq','scenario']};return{key:'application',depths:['Application'],types:['scenario','mcq']}}
function allowedDepths(p,phase){const e=p.eligibleDepths?.length?p.eligibleDepths:['Recall','Understanding','Application'],x=phase.depths.filter(d=>e.includes(d));if(x.length)return x;if(phase.key==='application')return[];if(phase.key==='understanding')return e.includes('Understanding')?['Understanding']:[];return e}
function evidence(p){return clean([p.label,p.summary,p.sourceReference,p.evidenceExcerpt,p.sourceExcerpt].filter(Boolean).join(' '),2400)}
function depthScore(p){const s=evidence(p).toLowerCase();let n=0;if(/\b(vs\.?|versus|compare|difference|temporary|permanent|whole life|universal life|term life)\b/.test(s))n+=3;if(/\$|%|\b\d+[,.]?\d*\b|age\s+\d+|years?|monthly|annual|total|calculate|cost|premium|benefit/.test(s))n+=3;if(/if |when |qualif|eligib|impair|2 of 6|activities of daily living|rule|condition|example|scenario/.test(s))n+=3;if(/because|purpose|support|protect|choice|responsibil|need|income replacement|mortgage|education|debt/.test(s))n+=2;if(/internal training purposes only|series/.test(s)&&s.length<500)n-=5;return n}
function understandingEligible(p){const e=p.eligibleDepths?.length?p.eligibleDepths:['Recall','Understanding','Application'];return depthScore(p)>=2&&e.includes('Understanding')}
function applicationEligible(p){const e=p.eligibleDepths?.length?p.eligibleDepths:['Recall','Understanding','Application'];return depthScore(p)>=3&&e.includes('Application')}
function pressure(bank,id){return Number(bank?.adaptive?.pointRejects?.[id]||0)}
function choosePoints(map,current,count,start,bank){const used=new Map();for(const q of current){const s=used.get(q.knowledgePointId)||new Set();s.add(q.depth||'Understanding');used.set(q.knowledgePointId,s)}const pts=map.points||[],out=[];for(let o=0;o<count;o++){const pos=start+o,phase=phaseFor(pos),broad=pos<=20;const eligible=p=>broad?true:phase.key==='understanding'?understandingEligible(p):applicationEligible(p);let pool=pts.filter(p=>{if(!eligible(p))return false;const seen=used.get(p.id)||new Set(),ds=allowedDepths(p,phase);return (broad?!used.has(p.id):ds.some(d=>!seen.has(d)))&&!out.some(x=>x.point.id===p.id)});if(!pool.length&&!broad)pool=pts.filter(p=>eligible(p)&&!out.some(x=>x.point.id===p.id));if(!pool.length&&broad)pool=pts.filter(p=>!out.some(x=>x.point.id===p.id));pool.sort((a,b)=>broad?(pressure(bank,a.id)-pressure(bank,b.id)):((depthScore(b)-pressure(bank,b.id))-(depthScore(a)-pressure(bank,a.id))));const p=pool[0];if(!p)break;const seen=used.get(p.id)||new Set(),ds=allowedDepths(p,phase),preferredDepth=ds.find(d=>!seen.has(d))||ds[0];if(!preferredDepth&&!broad)continue;out.push({point:p,phase,preferredDepth,retryCount:pressure(bank,p.id),depthEligibilityScore:depthScore(p)});seen.add(preferredDepth||'Understanding');used.set(p.id,seen)}return out}
function normalize(q,i,a){const {point,phase,preferredDepth}=a,type=['mcq','truefalse','scenario'].includes(q?.type)?q.type:'mcq',allowed=allowedDepths(point,phase),depth=allowed.includes(q?.depth)?q.depth:preferredDepth||allowed[0]||'Understanding';let options=Array.isArray(q?.options)?q.options.slice(0,4).map(x=>clean(x,500)).filter(Boolean):[],answer=clean(q?.answer,40);if(type==='truefalse'){options=['True','False'];const z=answer.toLowerCase();answer=(z==='true'||z==='a'||z==='1')?'True':(z==='false'||z==='b'||z==='0')?'False':answer}return{id:i,type,difficulty:['Basic','Intermediate','Advanced'].includes(q?.difficulty)?q.difficulty:'Basic',depth,trainingPhase:phase.key,knowledgePointId:point.id,knowledgePointTitle:point.label,question:clean(q?.question,1200),options,answer,explanation:clean(q?.explanation,1200),sourceReference:clean(q?.sourceReference||point.sourceReference,300),sensitiveClaim:!!point.sensitiveClaim}}
function validate(q,current,phase){const r=[];if(!q.question||q.question.length<12)r.push('question_too_short');if(!q.sourceReference)r.push('missing_source_reference');if(!q.explanation||q.explanation.length<8)r.push('missing_explanation');if(phase.key==='understanding'&&q.depth!=='Understanding')r.push('wrong_training_depth_for_understanding_phase');if(phase.key==='application'&&q.depth!=='Application')r.push('wrong_training_depth_for_application_phase');if(phase.key!=='broad_coverage'&&q.type==='truefalse')r.push('shallow_format_after_q20');if(q.type==='truefalse'){if(!['True','False'].includes(q.answer)||q.options.length!==2)r.push('invalid_truefalse_format')}else{const a=q.answer.toUpperCase(),idx=/^[A-D]$/.test(a)?a.charCodeAt(0)-65:-1;if(q.options.length<2||idx<0||idx>=q.options.length)r.push('invalid_answer_options')}if(current.some(x=>fp(x.question)===fp(q.question)))r.push('exact_duplicate');if(current.some(x=>x.knowledgePointId===q.knowledgePointId&&(x.depth||'Understanding')===q.depth))r.push('same_canonical_point_same_depth');return r}
async function aiCall(input,instructions,maxOutput=3000,timeout=TIMEOUT_MS){const key=process.env.OPENAI_API_KEY;if(!key)throw Object.assign(new Error('Question Bank AI is not configured.'),{status:503});const model=process.env.OPENAI_KNOWLEDGE_MODEL||process.env.OPENAI_CHAT_MODEL||'gpt-5.4-mini',c=new AbortController(),timer=setTimeout(()=>c.abort(),timeout);try{const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',signal:c.signal,headers:{'content-type':'application/json',authorization:`Bearer ${key}`},body:JSON.stringify({model,instructions,input,max_output_tokens:maxOutput})}),b=await r.json().catch(()=>({}));if(!r.ok)throw Object.assign(new Error(b?.error?.message||`AI provider returned ${r.status}.`),{status:r.status>=500?503:502});if(b?.status==='incomplete')throw Object.assign(new Error('AI response incomplete; accepted questions remain safe.'),{status:502});return{parsed:json(text(b)),model}}catch(e){if(e?.name==='AbortError')throw Object.assign(new Error('AI quality check timed out; accepted questions remain safe.'),{status:503});throw e}finally{clearTimeout(timer)}}
async function generate(asgs,difficulty,current,bank){const rows=asgs.map(a=>({id:a.point.id,title:a.point.label,summary:a.point.summary,sourceReference:a.point.sourceReference,sensitiveClaim:!!a.point.sensitiveClaim,requiredPhase:a.phase.key,requiredDepth:a.preferredDepth,allowedTypes:a.phase.types,retryCount:a.retryCount,depthEligibilityScore:a.depthEligibilityScore}));const input=['Generate exactly one enterprise training question for each assignment.','Q1-20 are the stable Broad Coverage baseline. Preserve that behavior.','Q21-35 are Understanding only: require interpretation, comparison, distinction, relationship, supported calculation, or explanation of why a source rule matters. Do not create mere recall with new wording.','Q36-50 are Application only: the learner must use source-supported facts/rules to make a decision, choose between alternatives, calculate a supported outcome, or apply multiple source attributes to a genuinely new case.','SCENARIO IS NOT APPLICATION. A client wrapper around recall is not Application. Removing the client wrapper must not leave a direct definition/list/identification question.','Do not repeat an earlier list, number, definition or product identification in substantially the same retrieval form.','Do not force depth from weak source facts. The system already filtered for phase eligibility; remain within supplied evidence.','ADAPTIVE RETRY: retryCount>0 means change cognitive operation, wording and preferably question type.','Preserve source direction, numbers, qualifiers, exceptions and scope exactly. Do not correct source claims with outside knowledge. Sensitive claims must be source-framed.','ASSIGNMENTS:\n'+JSON.stringify(rows),'RECENT REJECTIONS:\n'+JSON.stringify((bank?.quality?.lastRejected||[]).slice(-10)),'PRIOR ACCEPTED:\n'+JSON.stringify(current.slice(-60).map(q=>({k:q.knowledgePointId,depth:q.depth,type:q.type,q:q.question,explanation:q.explanation}))),'Difficulty: '+difficulty,'Return ONLY JSON: {"questions":[{"knowledgePointId":"K001","type":"mcq|truefalse|scenario","difficulty":"Basic|Intermediate|Advanced","depth":"Recall|Understanding|Application","question":"...","options":["..."],"answer":"A|B|C|D|True|False","explanation":"...","sourceReference":"..."}]}'].join('\n\n');const out=await aiCall(input,'Compact valid JSON only. Every Question Must Earn Its Place.',3400);return{rows:Array.isArray(out.parsed?.questions)?out.parsed.questions:[],model:out.model}}
// ── Diagnostics (read-only) ──────────────────────────────────────────────
// Everything below only ever READS the outcome that validate(),
// verifyCandidates() and choosePoints() already decided. It never changes
// which candidates are accepted or rejected, never touches the Quality
// Gate, the 20-question baseline, or the capacity formula - it exists to
// explain, after the fact, exactly where a generation run's candidates
// went and why.
//
// PRIMARY vs SECONDARY: validate() can push more than one reason for a
// single candidate (e.g. missing_source_reference AND
// same_canonical_point_same_depth on the same question). We only count the
// FIRST reason it found as this candidate's PRIMARY rejection - the one
// that alone would have blocked it - so the headline "rejected" total is
// never double-counted (exactly one PRIMARY reason per rejected
// candidate). Every other reason it also failed is recorded separately as
// SECONDARY, for visibility into compounding failures without inflating
// the total. The AI verifier and the pre-validate unknown-knowledge-point
// check each only ever produce a single reason per candidate, so they
// never contribute a SECONDARY reason.
const PHASE_LABEL={broad_coverage:'coverage',understanding:'understanding',application:'application'};

function blankPhaseDiag(){return{attempted:0,accepted:0,rejected:0,primaryReasons:{},secondaryReasons:{}}}
function blankDiagnostics(){return{totalGenerated:0,totalAccepted:0,totalRejected:0,primaryReasons:{},secondaryReasons:{},byPhase:{coverage:blankPhaseDiag(),understanding:blankPhaseDiag(),application:blankPhaseDiag(),unknown:blankPhaseDiag()},knowledgePoints:{}}}

// phaseKey is null for a candidate whose knowledgePointId never matched any
// assignment (wrong_or_unknown_knowledge_point) - there is no reliable way
// to attribute that candidate to a specific phase from the data available,
// so it is counted in the run-wide totals only, under the 'unknown' phase
// bucket, rather than guessed into coverage/understanding/application.
function diagPhase(phaseKey){return PHASE_LABEL[phaseKey]||'unknown'}

function recordAttempt(diag,phaseKey){diag.totalGenerated++;diag.byPhase[diagPhase(phaseKey)].attempted++}
function recordAccepted(diag,phaseKey,pointId,depth){
  diag.totalAccepted++;diag.byPhase[diagPhase(phaseKey)].accepted++;
  const kp=diag.knowledgePoints[pointId]||(diag.knowledgePoints[pointId]={Recall:0,Understanding:0,Application:0});
  if(kp[depth]==null)kp[depth]=0;kp[depth]++;
}
function recordRejected(diag,phaseKey,reasons){
  const list=Array.isArray(reasons)&&reasons.length?reasons:['other'],[primary,...secondary]=list,bucket=diag.byPhase[diagPhase(phaseKey)];
  diag.totalRejected++;
  diag.primaryReasons[primary]=(diag.primaryReasons[primary]||0)+1;
  bucket.rejected++;bucket.primaryReasons[primary]=(bucket.primaryReasons[primary]||0)+1;
  for(const r of secondary){diag.secondaryReasons[r]=(diag.secondaryReasons[r]||0)+1;bucket.secondaryReasons[r]=(bucket.secondaryReasons[r]||0)+1}
}
// Merges this batch's fresh counts into whatever diagnostics were already
// accumulated on the bank from prior batches, so the report reflects the
// whole generation run, not just the most recent batch.
function mergeDiagnostics(prior,fresh){
  const out=prior?JSON.parse(JSON.stringify(prior)):blankDiagnostics();
  const addCounts=(target,source)=>{for(const k of Object.keys(source))target[k]=(target[k]||0)+source[k]};
  out.totalGenerated+=fresh.totalGenerated;out.totalAccepted+=fresh.totalAccepted;out.totalRejected+=fresh.totalRejected;
  addCounts(out.primaryReasons,fresh.primaryReasons);addCounts(out.secondaryReasons,fresh.secondaryReasons);
  for(const p of Object.keys(fresh.byPhase)){
    if(!out.byPhase[p])out.byPhase[p]=blankPhaseDiag();
    out.byPhase[p].attempted+=fresh.byPhase[p].attempted;out.byPhase[p].accepted+=fresh.byPhase[p].accepted;out.byPhase[p].rejected+=fresh.byPhase[p].rejected;
    addCounts(out.byPhase[p].primaryReasons,fresh.byPhase[p].primaryReasons);addCounts(out.byPhase[p].secondaryReasons,fresh.byPhase[p].secondaryReasons);
  }
  for(const id of Object.keys(fresh.knowledgePoints)){
    const t=out.knowledgePoints[id]||(out.knowledgePoints[id]={Recall:0,Understanding:0,Application:0}),s=fresh.knowledgePoints[id];
    for(const d of Object.keys(s))t[d]=(t[d]||0)+s[d];
  }
  return out;
}
// Computes acceptance-rate percentages and knowledge-point utilization
// against the current Knowledge Map, without mutating the stored
// diagnostics (rates are cheap to derive, so they are recomputed on read
// rather than persisted).
function withRates(diag,map){
  const rate=(a,b)=>b?Math.round(a/b*1000)/10:0,out=JSON.parse(JSON.stringify(diag));
  out.acceptanceRate=rate(diag.totalAccepted,diag.totalGenerated);
  for(const p of Object.keys(out.byPhase)){
    const ph=out.byPhase[p];
    ph.acceptanceRate=rate(ph.accepted,ph.attempted);
    ph.topRejectionReasons=Object.entries(ph.primaryReasons).sort((a,b)=>b[1]-a[1]).slice(0,5).map(([reason,count])=>({reason,count}));
  }
  const allPoints=(map?.points||[]),usedIds=new Set(Object.keys(diag.knowledgePoints));
  out.knowledgePointUtilization={
    totalCanonicalKnowledgePoints:allPoints.length,
    used:usedIds.size,
    neverUsed:Math.max(0,allPoints.length-usedIds.size),
    neverUsedIds:allPoints.map(p=>p.id).filter(id=>!usedIds.has(id))
  };
  return out;
}
function logRejectionSummary(diag){
  console.log('QUESTION BANK REJECTION SUMMARY',JSON.stringify({
    totalGenerated:diag.totalGenerated,totalAccepted:diag.totalAccepted,totalRejected:diag.totalRejected,acceptanceRate:diag.acceptanceRate,
    primaryReasons:diag.primaryReasons,secondaryReasons:diag.secondaryReasons,
    byPhase:Object.fromEntries(Object.entries(diag.byPhase).map(([k,v])=>[k,{attempted:v.attempted,accepted:v.accepted,rejected:v.rejected,acceptanceRate:v.acceptanceRate,topRejectionReasons:v.topRejectionReasons}])),
    knowledgePointUtilization:diag.knowledgePointUtilization
  }));
}

async function verifyCandidates(candidates,asgs,current){if(!candidates.length)return{accepted:[],rejected:[]};const m=new Map(asgs.map(a=>[a.point.id,a])),payload=candidates.map((q,i)=>({candidateId:i,question:q,canonicalPoint:m.get(q.knowledgePointId)?.point||null,phase:m.get(q.knowledgePointId)?.phase||null,depthEligibilityScore:m.get(q.knowledgePointId)?.depthEligibilityScore||0}));const input=['Independent enterprise Question Quality Gate.','Infer actual cognitive work; do not trust the declared depth or type.','For Q21-35 accept only genuine Understanding: comparison, interpretation, meaningful distinction, relationship, supported calculation, or explanation. Reject direct recall/paraphrase.','For Q36-50 accept only genuine Application: source-supported decision, choice among alternatives, supported calculation, or application of multiple source attributes/rules to a new case.','Scenario is not synonymous with Application. If removing the client wrapper leaves a direct recall question, reject as rejected_depth.','Reject semantic restatements of prior questions even when wording/type/difficulty changes. Same fact/list/number retrieved the same way = rejected_duplicate.','Accept only when K-ID, answer/options/explanation, arithmetic/logic, source fidelity, semantic uniqueness and format are sound. Judge fidelity against canonical source point, not outside knowledge. Ambiguous support => needs_review. Sensitive claims must be source-framed.','CANDIDATES:\n'+JSON.stringify(payload),'PRIOR ACCEPTED:\n'+JSON.stringify(current.slice(-80).map(q=>({knowledgePointId:q.knowledgePointId,depth:q.depth,type:q.type,question:q.question,explanation:q.explanation}))),'Return ONLY JSON: {"verdicts":[{"candidateId":0,"status":"accepted|rejected_duplicate|rejected_logic|rejected_grounding|rejected_sensitive_claim|rejected_wrong_knowledge_point|rejected_depth|rejected_format|needs_review","reason":"brief reason"}]}'].join('\n\n');const out=await aiCall(input,'Compact valid JSON only. Be conservative. Scenario is not synonymous with Application.',3000,VERIFY_TIMEOUT_MS),vs=out.parsed?.verdicts||[],vm=new Map(vs.map(v=>[Number(v.candidateId),v])),accepted=[],rejected=[];candidates.forEach((q,i)=>{const v=vm.get(i);if(v?.status==='accepted')accepted.push(q);else rejected.push({knowledgePointId:q.knowledgePointId,question:clean(q.question,220),reasons:[clean(v?.status||'needs_review',80)],reviewReason:clean(v?.reason||'Verifier did not accept.',300)})});return{accepted,rejected}}
export default async req=>{if(req.method!=='POST')return reply(405,{error:'POST required.'});try{const a=await actor(req),input=await req.json().catch(()=>({})),knowledgeId=clean(input.knowledgeId||input.id,100),action=clean(input.action,40)||'start';if(!knowledgeId)return reply(400,{error:'knowledgeId is required.'});const store=getStore({name:STORE_NAME,consistency:'strong'}),prefix=`teams/${a.teamId}`,source=await store.get(`${prefix}/knowledge/${knowledgeId}`,{type:'json'}),map=await store.get(`${prefix}/knowledge-maps/${knowledgeId}`,{type:'json'});if(!source)return reply(404,{error:'Knowledge source not found.'});
      // Retrieval only - no generation, no AI call, no gate/formula touched.
      // Placed before the consentConfirmed/Knowledge-Map checks below on
      // purpose: those are preconditions for being ALLOWED to generate new
      // content, not for reading back a bank that already exists. Scoped to
      // the caller's own team twice over: physically, by only listing under
      // this team's own `${prefix}/question-banks/` key prefix (so another
      // team's banks are never even fetched), and again by checking
      // bank.teamId itself, so a bank record can never be returned unless
      // both the key it was found under AND its own stored teamId agree
      // with the authenticated caller - matching exactly how every other
      // action here derives teamId from the verified manager, never from
      // client input.
      if(action==='latest'){
        const {blobs}=await store.list({prefix:`${prefix}/question-banks/`});
        const banks=(await Promise.all(blobs.map(entry=>store.get(entry.key,{type:'json'})))).filter(Boolean);
        const matches=banks.filter(b=>b.teamId===a.teamId&&b.knowledgeId===knowledgeId);
        if(!matches.length)return reply(404,{error:'No Question Bank found for this document.'});
        matches.sort((x,y)=>String(y.updatedAt||y.createdAt||'').localeCompare(String(x.updatedAt||x.createdAt||'')));
        return reply(200,{questionBank:matches[0]});
      }
      if(!source.consentConfirmed)return reply(400,{error:'Confirm organizational authorization and AI processing consent first.'});if(!map?.points?.length)return reply(409,{error:'Build the canonical Knowledge Map before generating questions.',needsKnowledgeMap:true});if(action==='capacity'){const target=Math.min(Math.max(parseInt(input.count)||20,5),100),total=(map.points||[]).length,uEligible=(map.points||[]).filter(understandingEligible).length,aEligible=(map.points||[]).filter(applicationEligible).length,p1Cap=20,p2Cap=15,p3Cap=65,p1Safe=Math.min(p1Cap,total),p2Safe=Math.min(p2Cap,uEligible),p3Safe=Math.min(p3Cap,aEligible),recommended=p1Safe+p2Safe+p3Safe;return reply(200,{capacity:{knowledgeMapId:map.id,knowledgeMapVersion:map.version||1,recommendedTotal:recommended,maxRequestable:100,byPhase:{coverage:{targetCap:p1Cap,available:total,safe:p1Safe},understanding:{targetCap:p2Cap,available:uEligible,safe:p2Safe},application:{targetCap:p3Cap,available:aEligible,safe:p3Safe}},knowledgePoints:{total,understandingEligible:uEligible,applicationEligible:aEligible},requested:target,requestedExceedsRecommended:target>recommended,message:{en:`This document supports approximately ${recommended} high-quality questions (Coverage ${p1Safe} · Understanding ${p2Safe} · Application ${p3Safe}). Requesting more may cause generation to stop early with fewer accepted questions.`,zh:`这份文件大约可支持 ${recommended} 道高质量题目（覆盖 ${p1Safe} · 理解 ${p2Safe} · 应用 ${p3Safe}）。要求更多题数可能导致生成提前结束、通过题目更少。`}}})}if(action==='start'){const target=Math.min(Math.max(parseInt(input.count)||20,5),100),difficulty=['Basic','Intermediate','Advanced','Mixed'].includes(input.difficulty)?input.difficulty:'Mixed',id=crypto.randomUUID(),now=new Date().toISOString(),understandingEligibleCount=(map.points||[]).filter(understandingEligible).length,applicationEligibleCount=(map.points||[]).filter(applicationEligible).length,bank={id,engineVersion:2,depthProgressionVersion:5,qualityGateVersion:7,depthEligibilityVersion:2,adaptiveRegenerationVersion:1,knowledgeId,knowledgeMapId:map.id,knowledgeMapVersion:map.version||1,teamId:a.teamId,title:clean(source.title,240)+' — Question Bank',difficulty,targetQuestions:target,totalQuestions:0,batchSize:BATCH_SIZE,status:'generating',questions:[],coverage:{availableKnowledgePoints:map.points.length,coveredKnowledgePoints:0,percent:0,understandingEligibleKnowledgePoints:understandingEligibleCount,applicationEligibleKnowledgePoints:applicationEligibleCount},quality:{accepted:0,rejected:0,reasons:{},lastRejected:[]},adaptive:{pointRejects:{}},createdAt:now,updatedAt:now,createdBy:a.email};await store.setJSON(`${prefix}/question-banks/${id}`,bank);return reply(200,{questionBank:bank,next:{action:'generate_batch',bankId:id}})}const bankId=clean(input.bankId,100);if(!bankId)return reply(400,{error:'bankId is required.'});const key=`${prefix}/question-banks/${bankId}`;let bank=await store.get(key,{type:'json'});if(!bank||bank.knowledgeId!==knowledgeId)return reply(404,{error:'Question Bank not found.'});if(action==='status')return reply(200,{questionBank:bank});if(action!=='generate_batch')return reply(400,{error:'Unsupported action.'});if(bank.status==='complete')return reply(200,{questionBank:bank,complete:true});const current=bank.questions||[],remaining=Math.max(0,bank.targetQuestions-current.length);if(!remaining)return reply(200,{questionBank:{...bank,status:'complete'},complete:true});const asgs=choosePoints(map,current,Math.min(BATCH_SIZE,remaining),current.length+1,bank);if(!asgs.length)return reply(409,{error:'No phase-eligible grounded knowledge points remain for safe generation. Existing accepted questions are saved.',questionBank:bank});const out=await generate(asgs,bank.difficulty,current,bank),byId=new Map(asgs.map(a=>[a.point.id,a])),det=[],rejected=[];for(const row of out.rows){const asg=byId.get(clean(row?.knowledgePointId,20));if(!asg){rejected.push({reasons:['wrong_or_unknown_knowledge_point']});continue}const q=normalize(row,current.length+det.length+1,asg),reasons=validate(q,[...current,...det],asg.phase);if(reasons.length)rejected.push({knowledgePointId:asg.point.id,question:clean(q.question,220),reasons});else det.push(q)}const verified=await verifyCandidates(det,asgs,current);rejected.push(...verified.rejected);const accepted=verified.accepted,merged=[...current,...accepted].map((q,i)=>({...q,id:i+1})),covered=new Set(merged.map(q=>q.knowledgePointId).filter(Boolean)),reasonCounts={...(bank.quality?.reasons||{})},pointRejects={...(bank.adaptive?.pointRejects||{})};for(const r of rejected){for(const reason of r.reasons||[])reasonCounts[reason]=(reasonCounts[reason]||0)+1;if(r.knowledgePointId)pointRejects[r.knowledgePointId]=(pointRejects[r.knowledgePointId]||0)+1}for(const q of accepted)if(pointRejects[q.knowledgePointId])pointRejects[q.knowledgePointId]=Math.max(0,pointRejects[q.knowledgePointId]-1);
      // Diagnostics: purely observational, reads the SAME `rejected`/
      // `accepted` arrays the Quality Gate already produced above - cannot
      // change which candidates were accepted or rejected.
      const batchDiag=blankDiagnostics();
      for(const r of rejected){const rPhase=byId.get(r.knowledgePointId)?.phase?.key||null;recordAttempt(batchDiag,rPhase);recordRejected(batchDiag,rPhase,r.reasons)}
      for(const q of accepted){const qPhase=byId.get(q.knowledgePointId)?.phase?.key||null;recordAttempt(batchDiag,qPhase);recordAccepted(batchDiag,qPhase,q.knowledgePointId,q.depth)}
      const diagnostics=withRates(mergeDiagnostics(bank.diagnostics,batchDiag),map);
      logRejectionSummary(diagnostics);
      const now=new Date().toISOString(),understandingEligibleCount=(map.points||[]).filter(understandingEligible).length,applicationEligibleCount=(map.points||[]).filter(applicationEligible).length;bank={...bank,depthProgressionVersion:5,qualityGateVersion:7,depthEligibilityVersion:2,questions:merged,totalQuestions:merged.length,status:merged.length>=bank.targetQuestions?'complete':'generating',coverage:{availableKnowledgePoints:map.points.length,coveredKnowledgePoints:covered.size,percent:Math.round(covered.size/Math.max(1,map.points.length)*100),understandingEligibleKnowledgePoints:understandingEligibleCount,applicationEligibleKnowledgePoints:applicationEligibleCount},quality:{accepted:(bank.quality?.accepted||0)+accepted.length,rejected:(bank.quality?.rejected||0)+rejected.length,reasons:reasonCounts,lastRejected:rejected.slice(-10)},adaptive:{pointRejects},diagnostics,model:out.model,updatedAt:now,lastSuccessfulBatchAt:accepted.length?now:bank.lastSuccessfulBatchAt};await store.setJSON(key,bank);return reply(200,{questionBank:bank,complete:bank.status==='complete',acceptedThisBatch:accepted.length,rejectedThisBatch:rejected.length,diagnostics})}catch(e){console.error('knowledge-question-bank-v2',e);return reply(e.status||500,{error:e.message||'Question Bank generation failed.'})}};
