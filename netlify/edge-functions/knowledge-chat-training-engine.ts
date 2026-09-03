export default async (_request: Request, context: any) => {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  let html = await response.text();
  const patch = `
<script>
(function(){
  async function qbRequest(payload){
    var token=await PilotCloud.token('manager');
    var res=await fetch('/.netlify/functions/knowledge-question-bank',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(payload)});
    var data=await res.json().catch(function(){return {}});
    if(!res.ok)throw new Error(data.error||t('Question Bank request failed.','题库请求失败。'));
    return data;
  }

  window.generateQB=async function(){
    if(!currentDoc)return;
    var count=parseInt(document.getElementById('qb-count').value)||20;
    var difficulty=document.getElementById('qb-difficulty').value;
    var errEl=document.getElementById('qb-error');
    var progressEl=document.getElementById('qb-progress');
    var generateBtn=document.getElementById('qb-generate-btn');
    var cancelBtn=document.getElementById('qb-cancel-btn');
    errEl.style.display='none';generateBtn.disabled=true;cancelBtn.style.display='none';
    progressEl.style.display='block';
    progressEl.textContent=t('Preparing question bank…','正在准备题库……');

    try{
      var started=await qbRequest({action:'start',knowledgeId:currentDoc.id,count:count,difficulty:difficulty});
      var bank=started.questionBank;
      while(bank&&bank.status!=='complete'){
        var completed=bank.totalQuestions||0,target=bank.targetQuestions||count;
        progressEl.textContent=t('Generating Question Bank — '+completed+' / '+target+' completed. Completed batches are saved automatically.','正在生成题库 — 已完成 '+completed+' / '+target+'。每批完成后都会自动保存。');
        var batch=await qbRequest({action:'generate_batch',knowledgeId:currentDoc.id,bankId:bank.id});
        bank=batch.questionBank;
      }
      currentQB=bank;
      progressEl.textContent=t('Question Bank complete — '+(bank.totalQuestions||0)+' / '+(bank.targetQuestions||count)+' saved.','题库已完成 — '+(bank.totalQuestions||0)+' / '+(bank.targetQuestions||count)+' 已保存。');
      setTimeout(function(){progressEl.style.display='none';renderQBResults(currentQB)},450);
    }catch(e){
      errEl.textContent=(currentLang==='zh'&&String(e.message||'').includes('completed batches are safe'))?'本批生成时间过长。已完成的题目已经保存，请再次点击“生成题目”继续。':friendlyError(e.message);
      errEl.style.display='block';
      progressEl.textContent=t('Generation paused. Completed batches remain saved. You can retry safely.','生成已暂停。已完成批次不会丢失，可以安全重试。');
      progressEl.style.display='block';
      generateBtn.disabled=false;cancelBtn.style.display='';
    }
  };
})();
</script>`;

  html = html.replace('</body>', patch + '\n</body>');
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control','no-store');
  return new Response(html,{status:response.status,statusText:response.statusText,headers});
};
