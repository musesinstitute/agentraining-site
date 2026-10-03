(function(){
'use strict';
var activeBankId=null,activeKnowledgeId=null,activeCount=null,activeDifficulty=null;
// ── Active-bank durability (sessionStorage is a pointer cache only) ────────
// Netlify Blobs remains the sole authoritative source for the Question
// Bank itself - this only remembers WHICH bank/document the tab was last
// working on, so a reload doesn't lose the ability to resume via the
// existing 'status'/'latest' actions. The values stored (an opaque bank
// UUID and knowledgeId) are meaningless without a valid authenticated
// manager session, since team ownership is always re-derived server-side
// from the caller's own JWT, never from these client-supplied ids - same
// trust model as every other id already passed around this page.
// sessionStorage is already an established pattern in this codebase (see
// the existing agentraining_lang key), same-origin and cleared when the
// tab closes.
var ACTIVE_BANK_STORAGE_KEY='kte_active_bank';
function persistActiveBank(){
  try{
    if(activeBankId&&activeKnowledgeId)sessionStorage.setItem(ACTIVE_BANK_STORAGE_KEY,JSON.stringify({bankId:activeBankId,knowledgeId:activeKnowledgeId,count:activeCount,difficulty:activeDifficulty}));
    else sessionStorage.removeItem(ACTIVE_BANK_STORAGE_KEY);
  }catch(e){}
}
function restoreActiveBank(){
  try{
    var raw=sessionStorage.getItem(ACTIVE_BANK_STORAGE_KEY);
    if(!raw)return;
    var saved=JSON.parse(raw);
    if(saved&&saved.bankId&&saved.knowledgeId){activeBankId=saved.bankId;activeKnowledgeId=saved.knowledgeId;activeCount=saved.count||null;activeDifficulty=saved.difficulty||null}
  }catch(e){}
}
function tr(en,zh){return (window.currentLang==='zh'||document.documentElement.lang.toLowerCase().startsWith('zh'))?zh:en}
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;')}
function sleep(ms){return new Promise(function(resolve){setTimeout(resolve,ms)})}
function requestId(){try{return crypto.randomUUID()}catch(e){return'DEB-'+Date.now()+'-'+Math.random().toString(36).slice(2)}}
async function direct(endpoint,payload,opts){opts=opts||{};var tries=opts.retries==null?0:opts.retries,last;for(var i=0;i<=tries;i++){try{var token=await PilotCloud.token('manager'),body=payload?.batchRequestId?Object.assign({},payload,{retryAttempt:i}):payload;var r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(body)});var d=await r.json().catch(function(){return{}});if(!r.ok){var e=new Error(d.error||'Request failed.');e.data=d;e.status=r.status;throw e}return d}catch(e){last=e;var transient=e.status===502||e.status===503||e.status===504||/unreadable json|incomplete|timed out|timeout|provider/i.test(String(e.message||''));if(!transient||i>=tries)throw e;await sleep(700+i*600)}}throw last}
// ── Adaptive Depth / Recommended Capacity ─────────────────────────────────────
var capacityCache={};
async function fetchCapacity(docId,count){
  if(!docId)return null;
  var cached=capacityCache[docId];
  if(cached&&cached._fetchedFor===count)return cached;
  try{
    await ensureMapSilent(docId);
    var d=await direct('/.netlify/functions/knowledge-question-bank-v2',{action:'capacity',knowledgeId:docId,count:count},{retries:1});
    d.capacity._fetchedFor=count;
    capacityCache[docId]=d.capacity;
    return d.capacity;
  }catch(e){return null}
}
async function ensureMapSilent(docId){
  try{await direct('/.netlify/functions/knowledge-map',{action:'build',knowledgeId:docId},{retries:1})}catch(e){}
}
function ensureCapacityBanner(){
  if(document.getElementById('qb-capacity-banner'))return;
  var s=document.createElement('style');
  s.textContent='#qb-capacity-banner{background:#f0f9ff;border:1px solid #93c5fd;border-radius:8px;padding:10px 12px;margin:12px 0;font-size:12px;line-height:1.55;color:#1e3a8a}#qb-capacity-banner.warn{background:#fef3c7;border-color:#f59e0b;color:#78350f}#qb-capacity-banner.loading{background:#f8fafc;border-color:#e2e8f0;color:#64748b;font-style:italic}.qb-cap-title{font-weight:700;margin-bottom:4px}.qb-cap-phases{display:flex;gap:12px;margin-top:6px;font-size:11px;opacity:.85}.qb-cap-phase{white-space:nowrap}';
  document.head.appendChild(s);
  var banner=document.createElement('div');
  banner.id='qb-capacity-banner';
  banner.className='loading';
  banner.textContent=tr('Checking document capacity…','正在分析文件容量……');
  var form=document.getElementById('qb-form');
  var controls=form?form.querySelector('.qb-controls'):null;
  if(controls&&controls.parentNode)controls.parentNode.insertBefore(banner,controls);
  else if(form)form.insertBefore(banner,form.firstChild);
}
function renderCapacityBanner(cap,requested){
  var el=document.getElementById('qb-capacity-banner');if(!el)return;
  if(!cap){el.className='';el.textContent=tr('Could not check document capacity. You can still proceed — the system will stop safely if needed.','无法分析文件容量。您仍可继续生成——如遇到瓶颈系统会安全停止。');return}
  var rec=cap.recommendedTotal||0,phases=cap.byPhase||{},cov=phases.coverage||{},und=phases.understanding||{},app=phases.application||{};
  var exceeds=requested>rec;
  el.className=exceeds?'warn':'';
  var lead=exceeds
    ?tr('⚠️ You requested '+requested+' questions, but this document supports approximately '+rec+' high-quality questions.','⚠️ 您选择了 '+requested+' 道，但这份文件大约仅可支持 '+rec+' 道高质量题目。')
    :tr('✓ Recommended: up to '+rec+' high-quality questions for this document.','✓ 推荐上限：这份文件大约可支持 '+rec+' 道高质量题目。');
  var phasesLine=tr(
    'Coverage: '+(cov.safe||0)+' available · Understanding: '+(und.safe||0)+' available · Application: '+(app.safe||0)+' available',
    '覆盖阶段：可生 '+(cov.safe||0)+' 道 · 理解阶段：可生 '+(und.safe||0)+' 道 · 应用阶段：可生 '+(app.safe||0)+' 道'
  );
  var tail=exceeds
    ?tr(' Requesting more may cause earlier stop. AgentTraining.ai prefers quality over quantity.',' 要求更多可能提前结束。AgentTraining.ai 以质量为先。')
    :'';
  el.innerHTML='<div class="qb-cap-title">'+lead+tail+'</div><div class="qb-cap-phases"><span class="qb-cap-phase">'+phasesLine+'</span></div>';
}
async function updateCapacityBanner(){
  var doc=window.currentDoc;if(!doc)return;
  ensureCapacityBanner();
  var countEl=document.getElementById('qb-count');
  var requested=countEl?parseInt(countEl.value)||20:20;
  var banner=document.getElementById('qb-capacity-banner');
  if(banner){banner.className='loading';banner.textContent=tr('Checking document capacity…','正在分析文件容量……')}
  var cap=await fetchCapacity(doc.id,requested);
  renderCapacityBanner(cap,requested);
}
function wireCapacityUpdates(){
  var countEl=document.getElementById('qb-count');
  if(countEl&&!countEl.__capWired){countEl.__capWired=true;countEl.addEventListener('change',function(){var cap=capacityCache[window.currentDoc?.id];renderCapacityBanner(cap,parseInt(this.value)||20)})}
}
function exportQBv2(){var bank=window.currentQB;if(!bank||!Array.isArray(bank.questions)||!bank.questions.length){alert(tr('No Question Bank to export.','没有可导出的题库。'));return}var lines=[];lines.push(bank.title||'Question Bank');lines.push('Generated: '+(bank.updatedAt||bank.createdAt||new Date().toISOString()));lines.push('Questions: '+bank.questions.length+' / '+(bank.targetQuestions||bank.questions.length));if(bank.coverage)lines.push('Coverage: '+(bank.coverage.coveredKnowledgePoints||0)+' / '+(bank.coverage.availableKnowledgePoints||0)+' knowledge points ('+(bank.coverage.percent||0)+'%)');lines.push('Engine: V2 · Depth progression '+(bank.depthProgressionVersion||'')+' · Quality Gate '+(bank.qualityGateVersion||''));lines.push('');bank.questions.forEach(function(q,i){lines.push('Q'+(i+1)+' | '+(q.knowledgePointId||'')+' | '+(q.trainingPhase||'')+' | '+(q.depth||'')+' | '+(q.type||'')+' | '+(q.difficulty||''));lines.push(q.question||'');if(Array.isArray(q.options)&&q.options.length)q.options.forEach(function(o,j){lines.push(String.fromCharCode(65+j)+'. '+o)});lines.push('Answer: '+(q.answer||''));lines.push('Explanation: '+(q.explanation||''));lines.push('Source: '+(q.sourceReference||''));lines.push('')});var blob=new Blob([lines.join('\n')],{type:'text/plain;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a'),safe=(bank.title||'question-bank').replace(/[\\/:*?"<>|]+/g,'-');a.href=url;a.download=safe+'.txt';document.body.appendChild(a);a.click();a.remove();setTimeout(function(){URL.revokeObjectURL(url)},1000)}
function style(){if(document.getElementById('kte-style'))return;var s=document.createElement('style');s.id='kte-style';s.textContent='.training-engine-actions{display:flex;gap:6px;align-items:center}.scenario-trigger-btn{background:#7c3aed;color:#fff;border:0;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap}#scenario-modal{display:none;position:fixed;inset:0;z-index:60;align-items:center;justify-content:center}#scenario-modal.show{display:flex}.scenario-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.5)}.scenario-box{position:relative;background:#fff;border-radius:16px;padding:26px;width:92%;max-width:720px;max-height:90vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.25)}.scenario-sub,.scenario-meta{font-size:12px;color:#64748b}.scenario-controls{display:flex;gap:10px;align-items:end;margin:14px 0}.scenario-progress,.scenario-error{display:none;padding:8px 0;font-size:12px}.scenario-error{color:#b91c1c}.scenario-card{border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin:10px 0}.scenario-card p{font-size:12.5px;line-height:1.55;margin:5px 0}.scenario-select{background:#1a56db;color:#fff;border:0;border-radius:7px;padding:7px 11px;font-weight:700;cursor:pointer}.scenario-footer,.scenario-card-actions{display:flex;justify-content:flex-end;margin-top:10px}#qb-recovery-notice{margin:12px 0;padding:10px 12px;border:1px solid #f59e0b;border-radius:8px;background:#fffbeb;color:#78350f;font-size:12px;line-height:1.5}#qb-recovery-notice.complete{border-color:#86efac;background:#f0fdf4;color:#166534}#qb-resume-btn{margin-left:8px}';document.head.appendChild(s)}
function ensureUI(){style();var qb=document.getElementById('qb-trigger-btn');if(qb&&!document.getElementById('scenario-trigger-btn')){var wrap=document.createElement('div');wrap.className='training-engine-actions';qb.parentNode.insertBefore(wrap,qb);wrap.appendChild(qb);var b=document.createElement('button');b.id='scenario-trigger-btn';b.className='scenario-trigger-btn';b.style.display='none';b.innerHTML='🎭 <span>'+tr('Practice Scenarios','实战情境')+'</span>';b.onclick=openScenario;wrap.appendChild(b)}if(!document.getElementById('scenario-modal')){var m=document.createElement('div');m.id='scenario-modal';m.innerHTML='<div class="scenario-backdrop"></div><div class="scenario-box"><h3>'+tr('Generate Practice Scenarios','生成实战训练情境')+'</h3><div class="scenario-sub">'+tr('Create source-grounded practice situations. Manager review is required before assignment.','根据企业文件生成实战训练情境。指派前必须由主管审核。')+'</div><div class="scenario-error" id="scenario-error"></div><div class="scenario-progress" id="scenario-progress"></div><div class="scenario-controls"><div><label>'+tr('Number of scenarios','情境数量')+'</label><select id="scenario-count"><option>3</option><option selected>5</option><option>8</option></select></div><button class="btn-primary" id="scenario-generate">'+tr('Generate Scenarios','生成情境')+'</button></div><div id="scenario-results"></div><div class="scenario-footer"><button class="btn-cancel" id="scenario-close">'+tr('Close','关闭')+'</button></div></div>';document.body.appendChild(m);m.querySelector('.scenario-backdrop').onclick=closeScenario;document.getElementById('scenario-close').onclick=closeScenario;document.getElementById('scenario-generate').onclick=generateScenarios}}
function syncScenarioButton(){var q=document.getElementById('qb-trigger-btn'),s=document.getElementById('scenario-trigger-btn');if(s&&q)s.style.display=(window.canManage!==false&&q.style.display!=='none')?'':'none'}
function openScenario(){if(!window.currentDoc)return;document.getElementById('scenario-error').style.display='none';document.getElementById('scenario-modal').classList.add('show')}
function closeScenario(){document.getElementById('scenario-modal')?.classList.remove('show')}
async function generateScenarios(){if(!window.currentDoc)return;var btn=document.getElementById('scenario-generate'),err=document.getElementById('scenario-error'),prog=document.getElementById('scenario-progress');btn.disabled=true;err.style.display='none';prog.style.display='block';prog.textContent=tr('AI is creating source-grounded Practice Scenarios…','AI 正在根据企业文件生成实战训练情境……');try{var d=await direct('/.netlify/functions/knowledge-practice-scenarios',{action:'generate',knowledgeId:window.currentDoc.id,count:parseInt(document.getElementById('scenario-count').value)||5},{retries:1});renderScenarios(d.scenarioPack);prog.style.display='none'}catch(e){err.textContent=e.message;err.style.display='block';prog.style.display='none'}finally{btn.disabled=false}}
function renderScenarios(pack){var out=document.getElementById('scenario-results');out.innerHTML='';(pack?.scenarios||[]).forEach(function(x){var c=document.createElement('div');c.className='scenario-card';c.innerHTML='<h4>'+esc(x.title)+'</h4><div class="scenario-meta">'+esc(x.difficulty||'')+(x.sourceReference?' · '+esc(x.sourceReference):'')+'</div><p><b>'+tr('Situation:','情境：')+'</b> '+esc(x.situation)+'</p><p><b>'+tr('Objective:','目标：')+'</b> '+esc(x.objective)+'</p><p><b>'+tr('Client opens with:','客户开场：')+'</b> '+esc(x.clientOpening)+'</p><div class="scenario-card-actions"><button class="scenario-select">'+tr('Select for Manager Review →','选择并进入主管审核 →')+'</button></div>';c.querySelector('button').onclick=async function(){this.disabled=true;try{var d=await direct('/.netlify/functions/knowledge-practice-scenarios',{action:'promote',knowledgeId:window.currentDoc.id,packId:pack.id,scenarioId:x.id});location.href=d.handoffUrl||'/knowledge.html?pilot=1'}catch(e){this.disabled=false;document.getElementById('scenario-error').textContent=e.message;document.getElementById('scenario-error').style.display='block'}};out.appendChild(c)})}
async function ensureMap(id,progress){progress.textContent=tr('Preparing Knowledge Map…','正在准备知识地图……');var d=await direct('/.netlify/functions/knowledge-map',{action:'build',knowledgeId:id},{retries:2});if(!d.knowledgeMap?.points?.length)throw new Error(tr('Knowledge Map could not be prepared.','无法准备知识地图。'));return d.knowledgeMap}
async function generateQBv2(){if(!window.currentDoc)return;var id=window.currentDoc.id,count=parseInt(document.getElementById('qb-count').value)||20,difficulty=document.getElementById('qb-difficulty').value,err=document.getElementById('qb-error'),prog=document.getElementById('qb-progress'),go=document.getElementById('qb-generate-btn'),cancel=document.getElementById('qb-cancel-btn');err.style.display='none';go.disabled=true;cancel.style.display='none';prog.style.display='block';try{var bank;if(activeBankId&&activeKnowledgeId===id&&activeCount===count&&activeDifficulty===difficulty){bank=(await direct('/.netlify/functions/knowledge-question-bank-v2',{action:'status',knowledgeId:id,bankId:activeBankId},{retries:2})).questionBank}else{activeBankId=null;persistActiveBank();await ensureMap(id,prog);bank=(await direct('/.netlify/functions/knowledge-question-bank-v2',{action:'start',knowledgeId:id,count:count,difficulty:difficulty},{retries:2})).questionBank;activeBankId=bank.id;activeKnowledgeId=id;activeCount=count;activeDifficulty=difficulty;persistActiveBank()}var target=bank.targetQuestions||count,noProgress=0,last=bank.totalQuestions||0,attempt=0,maxAttempts=count<=20?35:50,maxNoProgress=count<=20?6:5,lastRejected=bank.quality?.rejected||0,stage=Math.min(3,bank.totalQuestions<20?1:bank.totalQuestions<35?2:3),stageRejects=0;while(bank.status!=='complete'&&attempt<maxAttempts&&noProgress<maxNoProgress){attempt++;var cov=bank.coverage||{},nowStage=bank.totalQuestions<20?1:bank.totalQuestions<35?2:3;if(nowStage!==stage){stage=nowStage;noProgress=0;stageRejects=0}var stageName=stage===1?tr('Coverage','覆盖'):stage===2?tr('Understanding','理解'):tr('Application','应用');var retryNote=noProgress?tr(' · Recovering automatically ('+noProgress+'/'+maxNoProgress+')',' · 正在自动恢复（'+noProgress+'/'+maxNoProgress+'）'):'';prog.textContent=tr('Generating '+stageName+' — '+(bank.totalQuestions||0)+' / '+target+' accepted · '+(cov.coveredKnowledgePoints||0)+' / '+(cov.availableKnowledgePoints||0)+' knowledge points.','正在生成'+stageName+'阶段 — 已通过 '+(bank.totalQuestions||0)+' / '+target+' · 已覆盖 '+(cov.coveredKnowledgePoints||0)+' / '+(cov.availableKnowledgePoints||0)+' 个知识点。')+retryNote;if(noProgress)await sleep(Math.min(2200,600+noProgress*250));var result=await direct('/.netlify/functions/knowledge-question-bank-v2',{action:'generate_batch',knowledgeId:id,bankId:bank.id,batchRequestId:requestId()},{retries:count<=20?2:1});bank=result.questionBank;var now=bank.totalQuestions||0,rejected=bank.quality?.rejected||0,deltaRejected=Math.max(0,rejected-lastRejected);lastRejected=rejected;stageRejects+=deltaRejected;if(now>last){last=now;noProgress=0}else noProgress++;if(count>20&&stage>1&&stageRejects>=30&&noProgress>=2)break}window.currentQB=bank;if(bank.totalQuestions>0&&typeof window.renderQBResults==='function')window.renderQBResults(bank);if(bank.status!=='complete'){var q=bank.quality||{},rejected=q.rejected||0;showRecoveredBank(bank,tr('Generation stopped safely. The accepted questions below remain saved.','生成已安全停止。下方已经通过的题目仍已保存。'));throw new Error(tr('Generation stopped safely. '+(bank.totalQuestions||0)+' / '+target+' accepted questions are saved'+(rejected?' ('+rejected+' rejected).':'')+' You can still review and export the accepted baseline.','生成已安全停止。目前 '+(bank.totalQuestions||0)+' / '+target+' 道合格题已保存'+(rejected?'，拦截 '+rejected+' 道不合格题。':'')+' 您仍可查看并导出已经通过的 Baseline。'))}activeBankId=null;persistActiveBank();prog.style.display='none';window.renderQBResults(bank);reconcileRecoveryNotice(bank)}catch(e){var recovered=e?.data?.questionBank||null;if(!recovered)recovered=await recoverLatestBank(id,true);if(recovered?.questions?.length)showRecoveredBank(recovered,tr('Generation was interrupted. The accepted questions below were recovered from persistent storage.','生成被中断。下方已通过的题目已从持久化存储恢复。'));err.textContent=e.message;err.style.display='block';prog.style.display='block';prog.textContent=recovered?.questions?.length?tr((recovered.totalQuestions||recovered.questions.length)+' / '+(recovered.targetQuestions||count)+' accepted questions are saved. Resume only when you choose.','已有 '+(recovered.totalQuestions||recovered.questions.length)+' / '+(recovered.targetQuestions||count)+' 道合格题保存。仅在您选择时继续生成。'):tr('Generation stopped safely. Accepted questions remain available.','生成已安全停止。已经通过的题目仍可查看和导出。');go.disabled=false;cancel.style.display=''}}
// ── 50/50 completion notice reconciliation (UI state only) ────────────────
// If an earlier partial/interrupted state already rendered the
// #qb-recovery-notice banner (with its "Resume generation" button) during
// this session, a later successful completion (e.g. clicking Resume and
// reaching targetQuestions) must update that leftover banner instead of
// leaving it showing a stale "did not complete" warning. Does nothing when
// no banner is present, so normal one-shot completions are unaffected.
function reconcileRecoveryNotice(bank){
  var notice=document.getElementById('qb-recovery-notice');
  if(!notice||!bank)return;
  var target=bank.targetQuestions||0,total=bank.totalQuestions||0;
  var complete=bank.status==='complete'||(target>0&&total>=target);
  if(!complete)return;
  notice.className='complete';
  notice.textContent=tr('Recovered the latest saved Question Bank.','已恢复最近保存的题库。');
  var resume=document.getElementById('qb-resume-btn'),regenerate=document.getElementById('qb-regenerate-btn');
  if(resume)resume.style.display='none';
  if(regenerate)regenerate.style.display=''
}
function rememberBank(bank){activeBankId=bank.id;activeKnowledgeId=bank.knowledgeId;activeCount=bank.targetQuestions||bank.totalQuestions;activeDifficulty=bank.difficulty||'Mixed';var countEl=document.getElementById('qb-count'),diffEl=document.getElementById('qb-difficulty');if(countEl&&Array.from(countEl.options||[]).some(function(o){return parseInt(o.value)===activeCount}))countEl.value=String(activeCount);if(diffEl)diffEl.value=activeDifficulty;persistActiveBank()}
function showRecoveredBank(bank,message){if(!bank||!Array.isArray(bank.questions)||!bank.questions.length)return null;window.currentQB=bank;rememberBank(bank);if(typeof window.renderQBResults==='function')window.renderQBResults(bank);var results=document.getElementById('qb-results'),notice=document.getElementById('qb-recovery-notice');if(!notice){notice=document.createElement('div');notice.id='qb-recovery-notice';var header=results?.querySelector('.qb-results-header');if(header?.parentNode)header.parentNode.insertBefore(notice,header.nextSibling)}var complete=bank.status==='complete'||bank.totalQuestions>=bank.targetQuestions;notice.className=complete?'complete':'';notice.textContent=message||(complete?tr('Recovered the latest saved Question Bank.','已恢复最近保存的题库。'):tr('Recovered a partial Question Bank from persistent storage. Generation did not complete; accepted questions remain saved.','已从持久化存储恢复部分题库。生成尚未完成；已通过题目仍然保存。'));var resume=document.getElementById('qb-resume-btn'),regenerate=document.getElementById('qb-regenerate-btn'),close=document.getElementById('qb-close-btn');if(!complete){if(!resume){resume=document.createElement('button');resume.id='qb-resume-btn';resume.className='btn-primary';resume.textContent=tr('Resume generation','继续生成');resume.onclick=generateQBv2;if(close?.parentNode)close.parentNode.insertBefore(resume,regenerate)}resume.style.display='';if(regenerate)regenerate.style.display='none'}else{if(resume)resume.style.display='none';if(regenerate)regenerate.style.display=''}return bank}
async function recoverLatestBank(knowledgeId,silent){try{var data=await direct('/.netlify/functions/knowledge-question-bank-v2',{action:'latest',knowledgeId:knowledgeId},{retries:1}),bank=data.questionBank;if(bank?.questions?.length&&!silent)showRecoveredBank(bank);return bank}catch(e){if(!silent&&e.status!==404){var err=document.getElementById('qb-error');if(err){err.textContent=tr('Could not recover the latest saved Question Bank.','无法恢复最近保存的题库。');err.style.display='block'}}return null}}
// Minimal developer retrieval path: no generation, no gate/formula
// touched - just calls the new read-only 'latest' action and logs the
// persisted bank (including its diagnostics/quality/adaptive fields
// exactly as stored). Usable from the browser console as, e.g.:
//   await getLatestQuestionBank()                    // for the open document
//   await getLatestQuestionBank('some-knowledge-id')  // for any document id
window.getLatestQuestionBank=async function(knowledgeId){
  var id=knowledgeId||window.currentDoc?.id;
  if(!id){console.error('No knowledgeId available - pass one explicitly, or open a document first.');return null}
  try{
    var data=await direct('/.netlify/functions/knowledge-question-bank-v2',{action:'latest',knowledgeId:id},{retries:1});
    console.log('Latest Question Bank for',id,data.questionBank);
    return data.questionBank;
  }catch(e){console.error('Could not retrieve latest Question Bank:',e.message);return null}
};
function install(){restoreActiveBank();ensureUI();window.generateQB=generateQBv2;window.exportQB=exportQBv2;window.recoverLatestQuestionBank=recoverLatestBank;var originalOpen=window.openDocument;if(typeof originalOpen==='function'&&!originalOpen.__kte){var wrapped=async function(){var r=await originalOpen.apply(this,arguments);syncScenarioButton();return r};wrapped.__kte=true;window.openDocument=wrapped}var originalOpenQB=window.openQBModal;if(typeof originalOpenQB==='function'&&!originalOpenQB.__kteCap){var wrappedQB=function(){var r=originalOpenQB.apply(this,arguments);setTimeout(function(){ensureCapacityBanner();wireCapacityUpdates();updateCapacityBanner();if(window.currentDoc?.id)recoverLatestBank(window.currentDoc.id,false)},60);return r};wrappedQB.__kteCap=true;window.openQBModal=wrappedQB}setInterval(syncScenarioButton,700);document.documentElement.dataset.trainingEngine='v2-direct-capacity1-recovery2'}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',function(){setTimeout(install,0)});else setTimeout(install,0);
})();
