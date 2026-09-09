(function () {
  const params = new URLSearchParams(window.location.search);
  const enabled = params.get('pilot') === '1';
  const NativeURLSearchParams = window.URLSearchParams;
  if (enabled && !params.get('ref')) {
    class PilotBootstrapSearchParams extends NativeURLSearchParams { get(name) { if (name === 'ref' && !super.get('ref')) return 'demo'; return super.get(name); } }
    window.URLSearchParams = PilotBootstrapSearchParams;
    window.addEventListener('DOMContentLoaded', () => { window.URLSearchParams = NativeURLSearchParams; sessionStorage.setItem('agentraining_ref','pilot'); sessionStorage.setItem('agentraining_name','Pilot User'); sessionStorage.setItem('agentraining_team','pilot'); document.getElementById('gate-welcome')?.style && (document.getElementById('gate-welcome').style.display='none'); document.getElementById('access-gate')?.style && (document.getElementById('access-gate').style.display='none'); }, {once:true});
  }
  let readyPromise, finishReady, switchHandled=false;
  let coachAssignments=[];
  let assignmentCoachContext=null;
  const requestedLang=params.get('lang'); if(requestedLang==='en'||requestedLang==='zh')sessionStorage.setItem('agentraining_lang',requestedLang);
  const currentLang=requestedLang||sessionStorage.getItem('agentraining_lang')||((navigator.language||'').toLowerCase().startsWith('zh')?'zh':'en'); const t=(en,zh)=>currentLang==='zh'?zh:en;
  function currentUser(){return window.netlifyIdentity&&window.netlifyIdentity.currentUser()} function roles(user){return user?.app_metadata?.roles||[]}
  function removeAccountControls(){document.getElementById('pilot-account-controls')?.remove()}
  async function signOut(){removeAccountControls();try{await window.netlifyIdentity.logout()}catch(e){try{localStorage.removeItem('gotrue.user')}catch(x){}}readyPromise=null;finishReady=null;window.location.reload()}
  function mountAccountControls(user){if(!enabled||!user)return;let c=document.getElementById('pilot-account-controls');if(!c){c=document.createElement('div');c.id='pilot-account-controls';c.style.cssText='position:fixed;right:14px;bottom:14px;z-index:19000;display:flex;align-items:center;gap:9px;padding:9px 10px;background:#fff;border:1px solid #cbd5e1;border-radius:11px;box-shadow:0 8px 28px rgba(15,23,42,.18);font:12px Arial,sans-serif;color:#475569';c.innerHTML='<span id="pilot-account-email"></span><button id="pilot-sign-out" type="button" style="border:1px solid #bfdbfe;border-radius:8px;background:#eff6ff;color:#1d4ed8;padding:7px 10px;font-weight:700;cursor:pointer">'+t('Sign out','退出登录')+'</button>';document.body.appendChild(c);c.querySelector('button').onclick=signOut}c.querySelector('span').textContent=user.email||t('Signed in','已登录')}
  function showGate(message){let g=document.getElementById('pilot-auth-gate');if(!g){g=document.createElement('div');g.id='pilot-auth-gate';g.style.cssText='position:fixed;inset:0;z-index:20000;background:rgba(15,23,42,.94);display:flex;align-items:center;justify-content:center;padding:24px;font-family:Arial,sans-serif';g.innerHTML='<div style="width:100%;max-width:460px;background:#fff;border-radius:18px;padding:32px"><h1 style="text-align:center">AgentTraining.ai Pilot</h1><p id="pilot-auth-message" style="color:#64748b;text-align:center"></p><form id="pilot-auth-form"><input id="pilot-auth-email" type="email" placeholder="Email" required style="width:100%;padding:12px;margin:8px 0"><input id="pilot-auth-password" type="password" placeholder="Password" required style="width:100%;padding:12px;margin:8px 0"><button type="submit" style="width:100%;padding:13px;background:#1a56db;color:white;border:0;border-radius:9px">'+t('Sign in securely','安全登录')+'</button><p id="pilot-auth-status" style="color:#b91c1c;text-align:center"></p></form></div>';document.body.appendChild(g);g.querySelector('form').onsubmit=async e=>{e.preventDefault();try{const u=await window.netlifyIdentity.gotrue.login(g.querySelector('#pilot-auth-email').value.trim(),g.querySelector('#pilot-auth-password').value,true);await u.jwt();if(finishReady)finishReady(u);else location.reload()}catch(err){g.querySelector('#pilot-auth-status').textContent=err.message||t('Sign-in failed','登录失败')}}}g.querySelector('#pilot-auth-message').textContent=message;g.style.display='flex'}
  function hideGate(){const g=document.getElementById('pilot-auth-gate');if(g)g.style.display='none'}
  async function ready(requiredRole){if(!enabled)return null;if(!window.netlifyIdentity)throw new Error(t('Pilot sign-in could not be loaded.','无法载入试用登录功能。'));if(!switchHandled&&params.get('switch')==='1'){switchHandled=true;window.netlifyIdentity.init();try{await window.netlifyIdentity.logout()}catch(e){}readyPromise=null;finishReady=null}if(!readyPromise){readyPromise=new Promise(resolve=>{window.netlifyIdentity.init();const finish=user=>{hideGate();mountAccountControls(user);resolve(user)};finishReady=finish;const u=currentUser();if(u)Promise.resolve(u.jwt()).then(()=>finish(u)).catch(()=>showGate(t('Please sign in again.','请重新登录。')));else showGate(t('Please sign in with your invited Pilot account.','请使用受邀请的试用账号登录。'))})}const u=await readyPromise;if(requiredRole&&!roles(u).includes(requiredRole)&&!roles(u).includes('admin'))throw new Error(t('This page requires the '+requiredRole+' role.','此页面需要相应权限。'));return u}
  async function token(requiredRole){const user=await ready(requiredRole);if(!user||typeof user.jwt!=='function')throw new Error(t('Secure Pilot token is unavailable.','安全访问凭证不可用。'));return user.jwt()}
  function isPreparePrompt(value){const s=String(value||'').toLowerCase();return /help me prepare|prepare (for|me)|practice preparation|准备.{0,10}(练习|任务|情境|场景|作业)|帮.{0,6}准备/.test(s)}
  function isAssignmentFollowUp(value){const s=String(value||'').trim();if(!s||isPreparePrompt(s))return false;const lower=s.toLowerCase();return s.length<220||/\bhow\b|\bwhy\b|what does|what is|meaning|important|importance|example|explain|clarify|怎么|如何|为什么|什么意思|意义|重要|举例|解释|说明/.test(lower)}
  function activeCoachAssignment(){return [...coachAssignments].filter(x=>x&&x.status!=='Completed').sort((a,b)=>String(b.createdAt||'').localeCompare(String(a.createdAt||'')))[0]||null}
  function assignmentPrepText(a,zh){
    if(!a)return '';
    const title=a.scenarioName||a.customScenario?.title||'Assigned Practice';
    const source=a.sourceLabel||'the assigned company knowledge';
    const objective=a.customScenario?.objective||'';
    const criteria=Array.isArray(a.customScenario?.successCriteria)?a.customScenario.successCriteria.filter(Boolean).slice(0,4):[];
    assignmentCoachContext={assignmentId:a.id,title,source,objective,criteria,startedAt:Date.now()};
    if(zh){
      let out=`准备当前主管指定的练习——“${title}”。\n\n这次准备只依据当前 Assignment 的信息，不会把过去其他练习的分数当成本次表现。`;
      out+=`\n\n相关资料：${source}`;
      if(objective)out+=`\n练习目标：${objective}`;
      if(criteria.length)out+=`\n\n本次应重点掌握：\n${criteria.map((x,i)=>`${i+1}) ${x}`).join('\n')}`;
      out+=`\n\n您尚未完成这项练习，因此现在没有足够证据评价或给这项 Underwriting Practice 打分。完成后，我再根据这一次练习的实际证据提供反馈。`;
      return out;
    }
    let out=`Preparation for your current manager-assigned Practice — “${title}.”\n\nThis preparation uses the current Assignment context only. I will not treat scores from unrelated past Practices as evidence for this assignment.`;
    out+=`\n\nRelated source: ${source}`;
    if(objective)out+=`\nPractice objective: ${objective}`;
    if(criteria.length)out+=`\n\nFocus on:\n${criteria.map((x,i)=>`${i+1}) ${x}`).join('\n')}`;
    out+=`\n\nYou have not completed this assigned Practice yet, so there is not enough evidence to evaluate or score your performance on it. After completion, I can coach you from the evidence produced by this specific Practice.`;
    return out;
  }
  function assignmentFollowUpText(a,question,zh){
    const title=a.scenarioName||a.customScenario?.title||'Assigned Practice';
    const source=a.sourceLabel||'the assigned company knowledge';
    const objective=a.customScenario?.objective||'';
    const criteria=Array.isArray(a.customScenario?.successCriteria)?a.customScenario.successCriteria.filter(Boolean).slice(0,6):[];
    const q=String(question||'').trim();
    const first=criteria[0]||'';
    if(zh){
      let out=`您现在仍然是在问当前的“${title}”，不是前一次销售练习。`;
      if(/importance|important|meaning|why|意义|重要|为什么/i.test(q)) out+=`\n\n它的重要性在于：这项任务首先检查您是否理解这份 Underwriting Guide 的整体框架，而不是只记住零散规则。理解总体框架以后，年龄、金额、tobacco、accelerated underwriting、Lab Lift 等具体规则才有位置。`;
      if(/how|怎么|如何/i.test(q)&&first) out+=`\n\n对于“${first}”，回答时可以按三步：\n1) 先用自己的话说明这份资料所强调的总体 underwriting approach；\n2) 再用资料中的具体主题或规则说明这个 approach 如何落到实际判断；\n3) 最后说明这是一份 reference guide，并非穷尽所有核保规则。`;
      if(objective) out+=`\n\n当前练习目标：${objective}`;
      out+=`\n相关资料：${source}`;
      out+=`\n\n我不会在这里把旧的“I Can't Afford It Right Now”分数或 empathy 35/100 当作这个 Underwriting 问题的依据。`;
      return out;
    }
    let out=`You are still asking about the current “${title}” assignment, not your earlier sales Practice.`;
    if(/importance|important|meaning|why/i.test(q)) out+=`\n\nWhy it matters: this criterion checks whether you understand the guide's overall underwriting framework before memorizing isolated rules. Once the framework is clear, details such as age/amount limits, tobacco rules, accelerated underwriting, and Lab Lift have a coherent place.`;
    if(/how/i.test(q)&&first) out+=`\n\nFor “${first},” answer in three steps:\n1) State the overall underwriting approach in your own words;\n2) Use concrete themes or rules from the assigned guide to show how that approach affects decisions;\n3) Make clear that the field guide is a reference, not an exhaustive statement of every underwriting rule.`;
    if(objective) out+=`\n\nCurrent Practice objective: ${objective}`;
    out+=`\nRelated source: ${source}`;
    out+=`\n\nI will not use the old “I Can't Afford It Right Now” score or empathy 35/100 as evidence for this Underwriting question.`;
    return out;
  }
  function applyCoachAssignmentGuardrail(resource,fetchOptions,body){
    if(resource!=='coach-messages'||!body)return body;
    const method=String(fetchOptions.method||'GET').toUpperCase();
    if(Array.isArray(body.assignments))coachAssignments=body.assignments;
    const current=activeCoachAssignment();
    if(!current)return body;
    if(method==='POST'){
      let sent={};try{sent=JSON.parse(fetchOptions.body||'{}')}catch(e){}
      const zh=/[\u3400-\u9fff]/.test(String(sent.content||''))||currentLang==='zh';
      if(isPreparePrompt(sent.content)&&body.assistantMessage){
        body.assistantMessage={...body.assistantMessage,content:assignmentPrepText(current,zh),contentZh:zh?assignmentPrepText(current,true):body.assistantMessage.contentZh,assignmentContextId:current.id};
      } else if(assignmentCoachContext?.assignmentId===current.id&&isAssignmentFollowUp(sent.content)&&body.assistantMessage){
        body.assistantMessage={...body.assistantMessage,content:assignmentFollowUpText(current,sent.content,zh),contentZh:zh?assignmentFollowUpText(current,sent.content,true):body.assistantMessage.contentZh,assignmentContextId:current.id};
      }
    } else if(Array.isArray(body.messages)){
      const rows=body.messages;
      let contextual=false;
      for(let i=0;i<rows.length-1;i++){
        if(rows[i]?.role==='user'&&isPreparePrompt(rows[i].content)&&rows[i+1]?.role==='assistant'){
          const zh=/[\u3400-\u9fff]/.test(String(rows[i].content||''))||currentLang==='zh';
          rows[i+1]={...rows[i+1],content:assignmentPrepText(current,zh),contentZh:zh?assignmentPrepText(current,true):rows[i+1].contentZh,assignmentContextId:current.id};
          contextual=true;
        } else if(contextual&&rows[i]?.role==='user'&&isAssignmentFollowUp(rows[i].content)&&rows[i+1]?.role==='assistant'){
          const zh=/[\u3400-\u9fff]/.test(String(rows[i].content||''))||currentLang==='zh';
          rows[i+1]={...rows[i+1],content:assignmentFollowUpText(current,rows[i].content,zh),contentZh:zh?assignmentFollowUpText(current,rows[i].content,true):rows[i+1].contentZh,assignmentContextId:current.id};
        }
      }
    }
    return body;
  }
  async function request(resource,options={}){const {requiredRole,query,...fetchOptions}=options;const authToken=await token(requiredRole);const q=new URLSearchParams({resource});Object.entries(query||{}).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=='')q.set(k,String(v))});const response=await fetch('/.netlify/functions/pilot-data?'+q,{...fetchOptions,headers:{'content-type':'application/json',authorization:'Bearer '+authToken,...(fetchOptions.headers||{})}});let body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.error||t('Pilot cloud request failed ('+response.status+').','试用云端请求失败（'+response.status+'）。'));body=applyCoachAssignmentGuardrail(resource,fetchOptions,body);return body}
  window.PilotCloud={enabled,ready,token,request,currentUser,signOut};
  if(enabled){const s=document.createElement('script');s.src='/openai-voice.js?v=20260817-openai1';s.defer=true;document.head.appendChild(s)}
})();