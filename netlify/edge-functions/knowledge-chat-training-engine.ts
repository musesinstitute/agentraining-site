export default async (_request: Request, context: any) => {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  let html = await response.text();
  const patch = `
<style>
.training-engine-actions{display:flex;gap:6px;align-items:center}.scenario-trigger-btn{background:#7c3aed;color:#fff;border:none;border-radius:8px;padding:6px 12px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap}.scenario-trigger-btn:hover{background:#6d28d9}#scenario-modal{display:none;position:fixed;inset:0;z-index:55;align-items:center;justify-content:center}#scenario-modal.show{display:flex}.scenario-backdrop{position:absolute;inset:0;background:rgba(0,0,0,.5)}.scenario-box{position:relative;background:#fff;border-radius:16px;padding:26px;width:92%;max-width:720px;max-height:90vh;overflow:auto;box-shadow:0 20px 60px rgba(0,0,0,.25)}.scenario-box h3{font-size:18px;margin-bottom:5px}.scenario-sub{font-size:13px;color:#64748b;margin-bottom:15px}.scenario-controls{display:flex;gap:10px;align-items:end;margin-bottom:14px}.scenario-controls label{display:block;font-size:12px;font-weight:700;color:#64748b;margin-bottom:5px}.scenario-controls select{border:1px solid #e2e8f0;border-radius:8px;padding:8px 10px}.scenario-progress,.scenario-error{display:none;padding:10px 0;font-size:12px}.scenario-progress{color:#64748b}.scenario-error{color:#b91c1c}.scenario-card{border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin:10px 0;background:#fff}.scenario-card h4{font-size:14px;margin-bottom:6px}.scenario-meta{font-size:11px;color:#64748b;margin-bottom:8px}.scenario-card p{font-size:12.5px;line-height:1.55;margin:5px 0}.scenario-success{padding-left:18px;font-size:12px;line-height:1.5}.scenario-card-actions{display:flex;justify-content:flex-end;margin-top:10px}.scenario-select{background:#1a56db;color:#fff;border:none;border-radius:7px;padding:7px 11px;font-size:12px;font-weight:700;cursor:pointer}.scenario-footer{display:flex;justify-content:flex-end;gap:8px;margin-top:15px}
</style>
<script>
(function(){
  var activeBankId=null,activeKnowledgeId=null,activeCount=null,activeDifficulty=null;
  function clearActiveBank(){activeBankId=null;activeKnowledgeId=null;activeCount=null;activeDifficulty=null}

  function ensureScenarioUI(){
    if(document.getElementById('scenario-modal'))return;
    var qb=document.getElementById('qb-trigger-btn');
    if(qb){var wrap=document.createElement('div');wrap.className='training-engine-actions';qb.parentNode.insertBefore(wrap,qb);wrap.appendChild(qb);var b=document.createElement('button');b.id='scenario-trigger-btn';b.className='scenario-trigger-btn';b.style.display='none';b.innerHTML='🎭 <span id="scenario-btn-label">Practice Scenarios</span>';b.onclick=openScenarioModal;wrap.appendChild(b)}
    var modal=document.createElement('div');modal.id='scenario-modal';modal.innerHTML='<div class="scenario-backdrop"></div><div class="scenario-box"><h3 id="scenario-title">Generate Practice Scenarios</h3><div class="scenario-sub" id="scenario-sub">Create realistic practice situations grounded in this company document. Manager review is required before assignment.</div><div class="scenario-error" id="scenario-error"></div><div class="scenario-progress" id="scenario-progress"></div><div id="scenario-form" class="scenario-controls"><div><label id="scenario-count-label">Number of scenarios</label><select id="scenario-count"><option value="3">3</option><option value="5" selected>5</option><option value="8">8</option></select></div><button class="btn-primary" id="scenario-generate">Generate Scenarios</button></div><div id="scenario-results"></div><div class="scenario-footer"><button class="btn-cancel" id="scenario-close">Close</button></div></div>';document.body.appendChild(modal);
    modal.querySelector('.scenario-backdrop').onclick=closeScenarioModal;document.getElementById('scenario-close').onclick=closeScenarioModal;document.getElementById('scenario-generate').onclick=generateScenarios;
  }
  function localizeScenarioUI(){var z=currentLang==='zh';var set=function(id,en,zh){var e=document.getElementById(id);if(e)e.textContent=z?zh:en};set('scenario-btn-label','Practice Scenarios','实战情境');set('scenario-title','Generate Practice Scenarios','生成实战训练情境');set('scenario-sub','Create realistic practice situations grounded in this company document. Manager review is required before assignment.','根据这份企业文件生成真实训练情境。指派给学员前必须由主管审核。');set('scenario-count-label','Number of scenarios','情境数量');set('scenario-generate','Generate Scenarios','生成情境');set('scenario-close','Close','关闭')}
  window.openScenarioModal=function(){if(!currentDoc||!canManage)return;ensureScenarioUI();localizeScenarioUI();document.getElementById('scenario-error').style.display='none';document.getElementById('scenario-modal').classList.add('show')};
  window.closeScenarioModal=function(){var m=document.getElementById('scenario-modal');if(m)m.classList.remove('show')};
  async function direct(endpoint,payload){var token=await PilotCloud.token('manager');var r=await fetch(endpoint,{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(payload)});var d=await r.json().catch(function(){return {}});if(!r.ok)throw new Error(d.error||'Request failed.');return d}
  window.generateScenarios=async function(){if(!currentDoc)return;var count=parseInt(document.getElementById('scenario-count').value)||5,err=document.getElementById('scenario-error'),prog=document.getElementById('scenario-progress'),btn=document.getElementById('scenario-generate');err.style.display='none';btn.disabled=true;prog.textContent=t('AI is creating source-grounded Practice Scenarios…','AI 正在根据企业文件生成实战训练情境……');prog.style.display='block';try{var d=await direct('/.netlify/functions/knowledge-practice-scenarios',{action:'generate',knowledgeId:currentDoc.id,count:count});renderScenarios(d.scenarioPack);prog.style.display='none'}catch(e){err.textContent=friendlyError(e.message);err.style.display='block';prog.style.display='none'}finally{btn.disabled=false}};
  function renderScenarios(pack){var out=document.getElementById('scenario-results');out.innerHTML='';(pack.scenarios||[]).forEach(function(s){var card=document.createElement('div');card.className='scenario-card';var criteria=(s.successCriteria||[]).map(function(x){return '<li>'+escHtml(x)+'</li>'}).join('');card.innerHTML='<h4>'+escHtml(s.title)+'</h4><div class="scenario-meta">'+escHtml(s.difficulty||'')+(s.sourceReference?' · '+escHtml(s.sourceReference):'')+'</div><p><b>'+t('Situation:','情境：')+'</b> '+escHtml(s.situation)+'</p><p><b>'+t('Objective:','目标：')+'</b> '+escHtml(s.objective)+'</p><p><b>'+t('Client opens with:','客户开场：')+'</b> '+escHtml(s.clientOpening)+'</p>'+(criteria?'<ul class="scenario-success">'+criteria+'</ul>':'')+'<div class="scenario-card-actions"><button class="scenario-select">'+t('Select for Manager Review →','选择并进入主管审核 →')+'</button></div>';card.querySelector('.scenario-select').onclick=function(){promoteScenario(pack.id,s.id,this)};out.appendChild(card)})}
  async function promoteScenario(packId,scenarioId,button){button.disabled=true;button.textContent=t('Preparing review…','正在准备审核……');try{var d=await direct('/.netlify/functions/knowledge-practice-scenarios',{action:'promote',knowledgeId:currentDoc.id,packId:packId,scenarioId:scenarioId});location.href=d.handoffUrl||('/knowledge.html?pilot=1')}catch(e){var err=document.getElementById('scenario-error');err.textContent=friendlyError(e.message);err.style.display='block';button.disabled=false;button.textContent=t('Select for Manager Review →','选择并进入主管审核 →')}}

  async function qbRequest(payload){return direct('/.netlify/functions/knowledge-question-bank',payload)}
  function sameActiveRequest(knowledgeId,count,difficulty){return !!activeBankId&&activeKnowledgeId===knowledgeId&&activeCount===count&&activeDifficulty===difficulty}

  window.generateQB=async function(){
    if(!currentDoc)return;
    var knowledgeId=currentDoc.id,count=parseInt(document.getElementById('qb-count').value)||20,difficulty=document.getElementById('qb-difficulty').value,errEl=document.getElementById('qb-error'),progressEl=document.getElementById('qb-progress'),generateBtn=document.getElementById('qb-generate-btn'),cancelBtn=document.getElementById('qb-cancel-btn');
    errEl.style.display='none';generateBtn.disabled=true;cancelBtn.style.display='none';progressEl.style.display='block';progressEl.textContent=t('Preparing question bank…','正在准备题库……');
    try{
      var bank;
      if(sameActiveRequest(knowledgeId,count,difficulty)){
        var status=await qbRequest({action:'status',knowledgeId:knowledgeId,bankId:activeBankId});
        bank=status.questionBank;
        progressEl.textContent=t('Resuming saved Question Bank — '+(bank.totalQuestions||0)+' / '+(bank.targetQuestions||count)+' completed.','正在继续已保存的题库 — 已完成 '+(bank.totalQuestions||0)+' / '+(bank.targetQuestions||count)+'。');
      }else{
        clearActiveBank();
        var started=await qbRequest({action:'start',knowledgeId:knowledgeId,count:count,difficulty:difficulty});
        bank=started.questionBank;activeBankId=bank.id;activeKnowledgeId=knowledgeId;activeCount=count;activeDifficulty=difficulty;
      }
      var target=bank.targetQuestions||count,batchSize=bank.batchSize||5,maxAttempts=Math.min(60,Math.ceil(target/batchSize)*5+5),attempts=0,noProgressRounds=0,lastCompleted=bank.totalQuestions||0;
      while(bank&&bank.status!=='complete'&&attempts<maxAttempts&&noProgressRounds<5){
        attempts++;
        var completed=bank.totalQuestions||0,rejected=(bank.quality&&bank.quality.rejected)||0;
        progressEl.textContent=t('Generating Question Bank — '+completed+' / '+target+' accepted'+(rejected?' · '+rejected+' rejected by Quality Gate':'')+'.','正在生成题库 — 已通过 '+completed+' / '+target+(rejected?' · Quality Gate 已淘汰 '+rejected+' 题':'')+'。');
        var batch=await qbRequest({action:'generate_batch',knowledgeId:knowledgeId,bankId:bank.id});
        bank=batch.questionBank;activeBankId=bank.id;
        var nowCompleted=bank.totalQuestions||0;if(nowCompleted>lastCompleted){noProgressRounds=0;lastCompleted=nowCompleted}else noProgressRounds++;
      }
      if(!bank||bank.status!=='complete'){
        var qRejected=(bank&&bank.quality&&bank.quality.rejected)||0;
        throw new Error(t('Generation paused because the Quality Gate rejected too many questions in a row. '+(bank?bank.totalQuestions||0:0)+' accepted questions are saved'+(qRejected?' and '+qRejected+' rejected questions were discarded':'')+'. Click Generate Questions again to continue refilling the bank.','由于 Quality Gate 连续淘汰了较多题目，生成已暂停。已保存 '+(bank?bank.totalQuestions||0:0)+' 道合格题'+(qRejected?'，并淘汰了 '+qRejected+' 道不合格题':'')+'。再次点击“生成题目”即可继续补足题库。'));
      }
      currentQB=bank;clearActiveBank();
      var finalRejected=(bank.quality&&bank.quality.rejected)||0,finalKP=(bank.coverage&&bank.coverage.knowledgePoints)||0;
      progressEl.textContent=t('Question Bank complete — '+(bank.totalQuestions||0)+' accepted · '+finalKP+' knowledge points'+(finalRejected?' · '+finalRejected+' rejected':'')+'.','题库完成 — '+(bank.totalQuestions||0)+' 道合格题 · 覆盖 '+finalKP+' 个知识点'+(finalRejected?' · 淘汰 '+finalRejected+' 道不合格题':'')+'。');
      setTimeout(function(){progressEl.style.display='none';renderQBResults(currentQB)},650);
    }catch(e){
      errEl.textContent=friendlyError(e.message);errEl.style.display='block';
      progressEl.textContent=t('Generation paused. Accepted questions remain saved. Click Generate Questions again to continue this same Question Bank.','生成已暂停。已通过质量检查的题目不会丢失。再次点击“生成题目”即可继续同一个题库。');
      progressEl.style.display='block';generateBtn.disabled=false;cancelBtn.style.display='';
    }
  };

  if(typeof window.resetQBModal==='function'){
    var originalResetQBModal=window.resetQBModal;
    window.resetQBModal=function(){clearActiveBank();return originalResetQBModal.apply(this,arguments)};
  }

  ensureScenarioUI();localizeScenarioUI();
  var observer=new MutationObserver(function(){var q=document.getElementById('qb-trigger-btn'),s=document.getElementById('scenario-trigger-btn');if(s&&q)s.style.display=(canManage&&q.style.display!=='none')?'':'none'});var pane=document.getElementById('split-pane');if(pane)observer.observe(pane,{attributes:true,subtree:true,attributeFilter:['style','class']});
  document.addEventListener('click',function(){setTimeout(function(){var q=document.getElementById('qb-trigger-btn'),s=document.getElementById('scenario-trigger-btn');if(s&&q)s.style.display=(canManage&&q.style.display!=='none')?'':'none'},0)},true);
})();
</script>`;

  html = html.replace('</body>', patch + '\n</body>');
  const headers = new Headers(response.headers);headers.delete('content-length');headers.set('cache-control','no-store');
  return new Response(html,{status:response.status,statusText:response.statusText,headers});
};
