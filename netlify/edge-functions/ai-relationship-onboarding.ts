export default async (_request: Request, context: any) => {
  const response = await context.next();
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) return response;
  let html = await response.text();
  const injection = String.raw`
<style>
.relationship-onboarding{margin:0 0 14px;padding:18px;border:1px solid #bfdbfe;border-radius:14px;background:linear-gradient(135deg,#eff6ff,#ecfdf5);box-shadow:0 8px 24px rgba(15,23,42,.06)}
.relationship-onboarding h3{margin:0 0 7px;font-size:18px}.relationship-onboarding p{margin:0 0 10px;color:#475569;line-height:1.6}.relationship-onboarding .privacy{font-size:11px;color:#64748b}.relationship-onboarding .begin{border:0;border-radius:9px;background:#1a56db;color:white;padding:10px 14px;font-weight:800;cursor:pointer}.voice-dictate{align-self:flex-end;border:1px solid #93c5fd!important;background:#eff6ff!important;color:#1d4ed8!important;border-radius:9px!important;padding:12px 13px!important;font-weight:800!important;cursor:pointer}.voice-dictate.listening{background:#dbeafe!important}.voice-status{font-size:11px;color:#64748b;padding:0 13px 9px;display:none}.voice-status.show{display:block}
</style>
<script>
(()=>{
 const zh=()=>((new URLSearchParams(location.search).get('lang')||sessionStorage.getItem('agentraining_lang')||navigator.language||'en').toLowerCase().startsWith('zh'));
 const t=(en,cn)=>zh()?cn:en;
 function install(){
   const form=document.getElementById('composer'), input=document.getElementById('messageInput'); if(!form||!input)return;
   const params=new URLSearchParams(location.search);
   const isManager=location.pathname.includes('manager-chat');
   if(params.get('onboarding')==='1' && !document.querySelector('.relationship-onboarding')){
     const card=document.createElement('div');card.className='relationship-onboarding';
     card.innerHTML='<h3>'+t(isManager?'Before we work together, I’d like to know you a little.':'Before we begin, I’d like to know you as a person.','开始之前，我想先认识一下您。')+'</h3><p>'+t('We can start naturally: how would you like me to address you, what work are you doing now, and what is the biggest challenge or growth goal on your mind? You do not need to answer everything at once.','我们可以很自然地开始：我该怎么称呼您？您目前主要从事什么工作？最近在工作或职业成长中，最希望解决的问题是什么？不用一次回答完，我们可以慢慢聊。')+'</p><p class="privacy">'+t('With your knowledge, useful information from this conversation can help build your growth profile so your AI partner can support you more personally over time. You can skip anything you do not want to share.','在您知情的情况下，对未来有帮助的信息可以逐步形成您的成长档案，让 AI 以后更了解您、更有针对性地帮助您。任何不想回答的问题都可以跳过。')+'</p><button class="begin" type="button">'+t('Start with my introduction','从介绍我自己开始')+'</button>';
     const panel=form.closest('.panel'); if(panel) panel.insertBefore(card,panel.firstElementChild?.nextSibling||panel.firstChild);
     card.querySelector('.begin').addEventListener('click',()=>{input.value=t('I’d like to introduce myself. Please get to know me one question at a time.','我想先介绍一下自己。请一次问我一个问题，慢慢了解我。');input.focus();card.scrollIntoView({behavior:'smooth',block:'nearest'});});
   }
   if(document.getElementById('voiceDictate'))return;
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
