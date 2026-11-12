/* Client-focused Practice: client/coach modes and learner-owned local transcript history. */
(function(){
'use strict';
const txt=(en,zh)=>currentLang==='zh'?zh:en;
const mk=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e};
const btn=(label,fn,cls)=>{const b=mk('button',label,cls||'cp-button');b.type='button';b.addEventListener('click',fn);return b};
const findCase=id=>typeof getClientCases==='function'?getClientCases().find(c=>c.id===id):null;
window.clientCaseCoachHistory=[];
window.showLinkedCasePracticeTools=function(sc){
 let root=document.getElementById('cp-practice-panel');
 const anchor=document.getElementById('linked-case-banner');
 if(!anchor)return;
 if(!root){root=mk('section');root.id='cp-practice-panel';root.className='cp-panel';anchor.insertAdjacentElement('afterend',root)}
 root.replaceChildren();
 if(!sc||!sc.linkedCaseId){root.hidden=true;return}
 const c=findCase(sc.linkedCaseId);
 if(!c){root.hidden=true;return}
 root.hidden=false;
 window.clientCaseCoachHistory=[];
 root.appendChild(mk('h3',txt('Personalized practice with ','与客户个性化练习：')+c.clientName));
 root.appendChild(mk('p',txt('Client mode simulates this prospect. Coach mode advises you using this case and the current conversation.','客户模式模拟这位客户；教练模式根据客户档案及当前对话给出指导。')));
 const facts=c.clientDiscovery&&Array.isArray(c.clientDiscovery.facts)?c.clientDiscovery.facts:[];
 if(facts.length)root.appendChild(mk('p',txt('Reported background: ','学员已陈述的背景：')+facts.slice(0,4).join('；')));
 const controls=mk('div',undefined,'cp-row');
 const clientBtn=btn(txt('Client mode','客户模式'),()=>change(false),'cp-active');
 controls.appendChild(clientBtn);
 let coachBtn;
 if(!activeAssignment){coachBtn=btn(txt('Coach mode','教练模式'),()=>change(true),'cp-button');controls.appendChild(coachBtn)}
 else controls.appendChild(mk('small',txt('Formal assessment: coaching disabled.','正式考核不提供实时教练帮助。')));
 root.appendChild(controls);
 if(activeAssignment)return;
 const coach=mk('div',undefined,'cp-coach');
 coach.hidden=true;
 coach.appendChild(mk('p',txt('Ask about the best next approach or how to reply. Return to Client mode to continue the conversation.','可询问下一步如何接触客户、下一句该怎么说。返回客户模式继续模拟对话。')));
 const log=mk('div',undefined,'cp-log');log.setAttribute('aria-live','polite');coach.appendChild(log);
 const row=mk('div',undefined,'cp-row');
 const input=mk('textarea');input.rows=2;input.maxLength=800;input.placeholder=txt('Ask your private AI Coach…','向私人 AI 教练提问…');
 const send=btn(txt('Ask Coach','请教练指导'),()=>ask(),'cp-active');
 row.appendChild(input);row.appendChild(send);coach.appendChild(row);root.appendChild(coach);
 function change(isCoach){
  if(isLoading)return;
  coach.hidden=!isCoach;clientBtn.className=isCoach?'cp-button':'cp-active';coachBtn.className=isCoach?'cp-active':'cp-button';
  clientBtn.setAttribute('aria-pressed',String(!isCoach));coachBtn.setAttribute('aria-pressed',String(isCoach));
  const main=document.getElementById('chat-input'),submit=document.getElementById('send-btn');
  if(main)main.disabled=isCoach;if(submit)submit.disabled=isCoach;
  if(isCoach)input.focus();else if(main)main.focus();
 }
 function addChat(who,words){const block=mk('div',undefined,'cp-log-message');block.appendChild(mk('strong',who));block.appendChild(mk('p',words));log.appendChild(block);log.scrollTop=log.scrollHeight}
 async function ask(){
  const question=input.value.trim().slice(0,800);if(!question||send.disabled)return;
  send.disabled=true;input.value='';addChat(txt('You','你'),question);
  try{
   const d=c.clientDiscovery||{},dialogue=(conversationHistory||[]).map(m=>(m.role==='user'?'Learner: ':'Prospect: ')+m.content).join('\n').slice(-9500);
   const prompt=['Prospect alias: '+c.clientName,
    'Learner-reported background, not independently verified: '+JSON.stringify(d.facts||[c.need||'']),
    'Unknown facts: '+JSON.stringify(d.unknowns||[]),
    'Hypotheses: '+JSON.stringify(d.hypotheses||[]),
    'Suggested approach: '+(d.approach||''),
    'Current Practice transcript:\n'+dialogue,
    'Learner question: '+question,
    'Provide concise, personalized coaching; suggest one next line to say. Never invent client facts or make product suitability claims. Reply in '+(currentLang==='zh'?'Traditional Chinese':'English')+'.'].join('\n\n');
   const response=await callClaude([{role:'user',content:prompt}],'You are a helpful private coach of the learner, never the simulated client. Be concise.');
   addChat(txt('AI Coach','AI 教练'),response);
   window.clientCaseCoachHistory.push({question:question,answer:response});
  }catch(e){input.value=question;addChat(txt('System','系统'),txt('Coach unavailable. Your question has been restored.','教练暂时不可用；问题已恢复，可重试。'))}
  finally{send.disabled=false}
 }
 input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();ask()}});
};
window.renderCasePracticeHistory=function(c){
 const body=document.getElementById('cs-detail-body');if(!body||!c)return;
 const root=mk('section',undefined,'cp-history');
 root.appendChild(mk('h3',txt('Practice history and transcripts','练习历史及完整对话记录')));
 const hist=Array.isArray(c.practiceHistory)?c.practiceHistory.slice().reverse():[];
 if(!hist.length)root.appendChild(mk('p',txt('No recorded practice yet.','目前还没有训练记录。')));
 hist.forEach(r=>{
  const d=mk('details'),summary=mk('summary',(r.date||'')+' · '+(r.scenarioTitle||txt('Client conversation','客户对话'))+' · '+(r.score||0)+'/100');
  d.appendChild(summary);
  d.appendChild(mk('p',txt('Coach summary: ','教练总结：')+(r.summary||txt('Not available','暂无'))));
  if(Array.isArray(r.tips)&&r.tips.length)d.appendChild(mk('p',txt('Suggestions: ','建议：')+r.tips.join('；')));
  if(Array.isArray(r.transcript)&&r.transcript.length){
   d.appendChild(mk('h4',txt('Complete transcript','完整对话')));
   r.transcript.forEach(line=>d.appendChild(mk('p',(line.speaker==='agent'?txt('You','你'):c.clientName)+': '+String(line.text||''),'cp-transcript-line')));
  }else d.appendChild(mk('p',txt('This earlier record has no saved transcript.','这条旧记录没有保存完整对话。')));
  if(Array.isArray(r.coachHistory)&&r.coachHistory.length){
   d.appendChild(mk('h4',txt('Private AI Coach notes','私人 AI 教练指导')));
   r.coachHistory.forEach(n=>{d.appendChild(mk('p',txt('Question: ','提问：')+n.question));d.appendChild(mk('p',txt('Coach: ','教练：')+n.answer))});
  }
  if(r.isSelfPractice===true&&r.isFormal!==true&&r.localOnly===true&&r.id){
   d.appendChild(btn(txt('Delete this local self-practice','删除这条本地自主练习记录'),()=>remove(c.id,r.id),'cp-delete'));
  }else d.appendChild(mk('small',txt('Formal, synced, and legacy records cannot be deleted here.','正式、已同步或旧版记录不能在此删除。')));
  root.appendChild(d);
 });
 root.appendChild(btn(txt('Practice again with ','再次与客户练习：')+c.clientName,()=>startPracticeFromCase(c.id),'cp-active'));
 body.appendChild(root);
};
function remove(caseId,id){
 if(!confirm(txt('Permanently delete only this local self-practice record?','确定永久删除这条本地自主练习记录？')))return;
 const cases=getClientCases(),i=cases.findIndex(x=>x.id===caseId);if(i<0)return;
 const h=cases[i].practiceHistory||[],r=h.find(x=>x.id===id);
 if(!r||r.isFormal||!r.isSelfPractice||!r.localOnly)return;
 cases[i].practiceHistory=h.filter(x=>x.id!==id);
 cases[i].lastPractice=cases[i].practiceHistory.length?cases[i].practiceHistory[cases[i].practiceHistory.length-1]:null;
 cases[i].updatedAt=new Date().toISOString();saveClientCasesList(cases);openCaseDetail(caseId);
}
function style(){
 if(document.getElementById('cp-style'))return;
 const e=mk('style');e.id='cp-style';
 e.textContent='.cp-panel,.cp-history{border:1px solid #bfdbfe;border-radius:12px;padding:14px;margin:12px 0;background:#eff6ff;color:#1e293b}.cp-panel h3,.cp-history h3{font-size:16px;margin:0 0 8px}.cp-panel p,.cp-history p{font-size:13px;line-height:1.5;margin:8px 0;overflow-wrap:anywhere}.cp-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:10px 0}.cp-active,.cp-button,.cp-delete{border-radius:8px;border:1px solid #2563eb;padding:9px 12px;font-size:13px;font-weight:700;cursor:pointer}.cp-active{background:#1d4ed8;color:#fff}.cp-button{background:#fff;color:#1d4ed8}.cp-delete{border-color:#b91c1c;background:#fff1f2;color:#b91c1c;margin:8px 0}.cp-coach,.cp-history details{background:#fff;border:1px solid #dbeafe;border-radius:9px;margin:10px 0;padding:10px}.cp-coach textarea{flex:1;min-width:160px;border:1px solid #cbd5e1;border-radius:8px;padding:8px;font:inherit}.cp-log{max-height:230px;overflow-y:auto}.cp-log-message{padding:8px;border-bottom:1px solid #e2e8f0}.cp-history summary{cursor:pointer;font-weight:700;padding:8px}.cp-history h4{font-size:13px;margin:10px 0}.cp-history .cp-transcript-line{white-space:pre-wrap}.cp-history small{display:block;color:#64748b;margin:10px 0}';
 document.head.appendChild(e);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',style,{once:true});else style();
})();