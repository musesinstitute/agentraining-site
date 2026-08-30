export default async (_request: Request, context: any) => {
  const response = await context.next();
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) return response;
  let html = await response.text();
  const injection = String.raw`
<style>
.relationship-onboarding{margin:0 0 14px;padding:18px;border:1px solid #bfdbfe;border-radius:14px;background:linear-gradient(135deg,#eff6ff,#ecfdf5);box-shadow:0 8px 24px rgba(15,23,42,.06)}
.relationship-onboarding h3{margin:0 0 7px;font-size:18px}.relationship-onboarding p{margin:0 0 10px;color:#475569;line-height:1.6}.relationship-onboarding .privacy{font-size:11px;color:#64748b}.relationship-onboarding .begin{border:0;border-radius:9px;background:#1a56db;color:white;padding:10px 14px;font-weight:800;cursor:pointer}.relationship-onboarding .test-badge{display:inline-block;margin-bottom:8px;padding:4px 8px;border-radius:99px;background:#fef3c7;color:#92400e;font-size:11px;font-weight:800}.voice-dictate{align-self:flex-end;border:1px solid #93c5fd!important;background:#eff6ff!important;color:#1d4ed8!important;border-radius:9px!important;padding:12px 13px!important;font-weight:800!important;cursor:pointer}.voice-dictate.listening{background:#dbeafe!important}.voice-status{font-size:11px;color:#64748b;padding:0 13px 9px;display:none}.voice-status.show{display:block}
</style>
<script>
(()=>{
 const zh=()=>((new URLSearchParams(location.search).get('lang')||sessionStorage.getItem('agentraining_lang')||navigator.language||'en').toLowerCase().startsWith('zh'));
 const t=(en,cn)=>zh()?cn:en;
 function install(){
   const form=document.getElementById('composer');
   const input=document.getElementById('messageInput')||document.getElementById('chat-input');
   if(!form||!input)return;
   const params=new URLSearchParams(location.search);
   const isManager=location.pathname.includes('manager-chat');
   const testMode=params.get('test_onboarding')==='1';
   const showOnboarding=params.get('onboarding')==='1'||testMode;
   if(showOnboarding && !document.querySelector('.relationship-onboarding')){
     const card=document.createElement('div');card.className='relationship-onboarding';
     const learnerTitle=t('Welcome. I’m glad to be your AI coach.','欢迎您。很高兴成为您的 AI 教练。');
     const learnerBody=t('Here, we believe every learner is unique. My goal is not simply to evaluate you, but to understand your experience and goals, work with you as a long-term learning partner, and help you keep improving your professional skills. We can begin naturally with a few simple questions, one at a time.','在这里，我们相信每一位学员都是独一无二的。我的目标不只是评价您，而是了解您的经验和目标，成为您长期的学习伙伴，陪伴您持续成长，帮助您不断提升专业能力。接下来，我们可以很自然地从几个简单的问题开始，一次聊一个问题。');
     const managerTitle=t('Welcome. I’m glad to support you in leading your team.','欢迎您。很高兴能支持您带领团队。');
     const managerBody=t('My role is not to replace your judgment. I’m here as your AI copilot—to help you understand your team’s learning progress more fully, identify each member’s strengths and areas for growth, and provide useful evidence and recommendations for your decisions. You remain the leader; I’m here to help you develop people and achieve stronger training outcomes.','我的角色不是取代您的判断，而是作为您的 AI 副手，帮助您更全面地了解团队的学习情况，发现每位成员的优势和需要加强的地方，并为您的判断提供有用的证据和建议。您始终是团队的领导者；我会协助您培养人才，帮助团队取得更好的培训成果。');
     const testBadge=testMode?'<div class="test-badge">'+t('TEST MODE · onboarding preview','测试模式 · 首次体验预览')+'</div>':'';
     card.innerHTML=testBadge+'<h3>'+(isManager?managerTitle:learnerTitle)+'</h3><p>'+(isManager?managerBody:learnerBody)+'</p><p class="privacy">'+t('With your knowledge, useful information from this conversation can help build your growth profile so your AI partner can support you more personally over time. You can skip anything you do not want to share.','在您知情的情况下，对未来有帮助的信息可以逐步形成您的成长档案，让 AI 以后更了解您、更有针对性地帮助您。任何不想回答的问题都可以跳过。')+'</p><button class="begin" type="button">'+t(isManager?'Start our conversation':'Start with my introduction',isManager?'开始我们的交流':'从介绍我自己开始')+'</button>';
     const panel=form.closest('.panel'); if(panel) panel.insertBefore(card,panel.firstElementChild?.nextSibling||panel.firstChild);
     card.querySelector('.begin').addEventListener('click',()=>{input.value=isManager?t('I’d like to introduce my team and our training goals. Please get to know our situation one question at a time.','我想先介绍一下我的团队和培训目标。请一次问我一个问题，逐步了解我们的情况。'):t('I’d like to introduce myself. Please get to know me one question at a time.','我想先介绍一下自己。请一次问我一个问题，慢慢了解我。');input.focus();card.scrollIntoView({behavior:'smooth',block:'nearest'});});
   }
   if(!isManager && window.PilotCloud && !window.__learnerAiGatewayInstalled){
     window.__learnerAiGatewayInstalled=true;
     const originalRequest=window.PilotCloud.request.bind(window.PilotCloud);
     window.PilotCloud.request=async(name,options={})=>{
       if(name==='coach-messages' && String(options.method||'GET').toUpperCase()==='POST'){
         let body={};try{body=JSON.parse(options.body||'{}')}catch{}
         const message=String(body.content||'').trim();
         if(!message)throw new Error(t('Message is required.','请输入消息。'));
         const res=await fetch('/api/ai-chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({role:'learner',lang:zh()?'zh':'en',message})});
         let data={};try{data=await res.json()}catch{}
         if(!res.ok)throw new Error(data.error||t('AI conversation failed.','AI 对话暂时无法完成。'));
         return {userMessage:data.userMessage,assistantMessage:data.assistantMessage};
       }
       return originalRequest(name,options);
     };
   }
   if(document.getElementById('voiceDictate')||document.getElementById('mic-btn'))return;
   const btn=document.createElement('button');btn.type='button';btn.id='voiceDictate';btn.className='voice-dictate';btn.textContent='🎙 '+t('Speak','语音输入');
   const send=form.querySelector('button[type="submit"]');form.insertBefore(btn,send);
   const status=document.createElement('div');status.className='voice-status';status.textContent=t('Listening… speak naturally. Your words will appear in the message box.','正在聆听…请自然说话，识别出的文字会出现在输入框中。');form.parentNode.insertBefore(status,form.nextSibling);
   const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
   if(!SR){btn.addEventListener('click',()=>alert(t('Voice dictation is not supported by this browser yet. You can continue typing.','这个浏览器目前不支持语音听写，您仍然可以使用文字输入。')));return;}
   let recognition=null;
   btn.addEventListener('click',()=>{
     if(recognition){recognition.stop();return;}
     recognition=new SR();recognition.lang=zh()?'zh-CN':'en-US';recognition.interimResults=true;recognition.continuous=true;
     let base=input.value?input.value.trim()+' ':'';
     recognition.onstart=()=>{btn.classList.add('listening');btn.textContent='■ '+t('Stop','停止');status.classList.add('show')};
     recognition.onresult=e=>{let final='',interim='';for(let i=e.resultIndex;i<e.results.length;i++){const s=e.results[i][0].transcript;if(e.results[i].isFinal)final+=s;else interim+=s}if(final){base+=final+' ';input.value=base.trim()}else input.value=(base+interim).trim()};
     recognition.onerror=e=>{status.textContent=t('Voice input stopped: ','语音输入已停止：')+e.error};
     recognition.onend=()=>{recognition=null;btn.classList.remove('listening');btn.textContent='🎙 '+t('Speak','语音输入');status.classList.remove('show');input.focus()};
     recognition.start();
   });
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
</script>`;
  html=html.replace('</body>',injection+'\n</body>');
  const headers=new Headers(response.headers);headers.delete('content-length');headers.set('cache-control','no-store');
  return new Response(html,{status:response.status,statusText:response.statusText,headers});
};