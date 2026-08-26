export default async (_request: Request, context: any) => {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  let html = await response.text();
  const injection = String.raw`
<style>
#firstImpression{display:none;margin:0 0 18px;background:linear-gradient(135deg,#ffffff 0%,#eff6ff 52%,#ecfdf5 100%);border:1px solid #bfdbfe;border-radius:20px;padding:24px;box-shadow:0 14px 38px rgba(15,23,42,.08);position:relative;overflow:hidden}
#firstImpression:before{content:'';position:absolute;width:180px;height:180px;border-radius:50%;background:rgba(255,255,255,.55);right:-65px;top:-85px}.fi-grid{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(280px,.75fr);gap:22px;position:relative}.fi-kicker{font-size:11px;font-weight:900;letter-spacing:.7px;text-transform:uppercase;color:#1d4ed8;margin-bottom:8px}.fi-title{font-size:27px;line-height:1.2;margin:0 0 9px}.fi-copy{color:#475569;line-height:1.65;margin:0;max-width:720px}.fi-question{margin:16px 0 9px;font-weight:800;color:#1e293b}.fi-actions{display:flex;gap:8px;flex-wrap:wrap}.fi-btn{border:1px solid #bfdbfe;background:#fff;color:#1d4ed8;border-radius:10px;padding:10px 13px;font-weight:800;text-decoration:none;cursor:pointer;font:inherit}.fi-btn.primary{background:#1a56db;color:#fff;border-color:#1a56db}.fi-side{background:rgba(255,255,255,.8);border:1px solid rgba(191,219,254,.9);border-radius:14px;padding:16px}.fi-side b{display:block;margin-bottom:9px}.fi-side a{display:block;color:#334155;text-decoration:none;padding:9px 0;border-top:1px solid #e2e8f0}.fi-side a:first-of-type{border-top:0}.fi-side a span{color:#1d4ed8;font-weight:900;float:right}.fi-note{font-size:11px;color:#64748b;line-height:1.5;margin-top:11px}@media(max-width:800px){.fi-grid{grid-template-columns:1fr}.fi-title{font-size:23px}#firstImpression{padding:19px}}
</style>
<script>
(()=>{
 const lang=()=>((new URLSearchParams(location.search).get('lang')||sessionStorage.getItem('agentraining_lang')||navigator.language||'en').toLowerCase().startsWith('zh')?'zh':'en');
 const tr=(en,zh)=>lang()==='zh'?zh:en;
 const esc=s=>String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 async function install(){
   if(!window.PilotCloud?.enabled)return;
   let me;try{me=await PilotCloud.request('me')}catch{return}
   const manager=(me.roles||[]).some(r=>r==='manager'||r==='admin');
   const app=document.getElementById('app');if(!app)return;
   for(let i=0;i<40&&app.querySelector('.status');i++)await new Promise(r=>setTimeout(r,100));
   if(document.getElementById('firstImpression'))return;
   const first=document.createElement('section');first.id='firstImpression';
   const chatHref=manager?'manager-chat.html?pilot=1':'coach-chat.html?pilot=1';
   const title=manager?tr('Welcome — I’m your AI Copilot.','欢迎您。我是您的 AI 副驾驶。'):tr('Welcome — I’m your Personal AI Coach.','欢迎您。我是您的私人 AI 教练。');
   const copy=manager?tr('I’m here to understand your team, your priorities, and how you prefer to lead — then help you turn real Practice evidence into useful coaching action.','我希望先了解您本人、您的团队、当前重点，以及您习惯怎样带团队。了解得越多，我就越能根据真实练习证据，帮助您做出有用的辅导行动。'):tr('Before we talk about scores or assignments, I’d like to know you as a person — what you do, what you want to improve, and what would make this training genuinely useful to you.','在谈分数和任务以前，我更想先认识您这个人：您现在做什么、最想提升什么，以及怎样的训练才真正对您有帮助。');
   const question=manager?tr('Where would you like to begin?','您想从哪里开始？'):tr('May I get to know you first?','可以先让我认识一下您吗？');
   first.innerHTML='<div class="fi-grid"><div><div class="fi-kicker">'+tr('Start with a conversation','从对话开始')+'</div><h2 class="fi-title">'+esc(title)+'</h2><p class="fi-copy">'+esc(copy)+'</p><div class="fi-question">'+esc(question)+'</div><div class="fi-actions"><a class="fi-btn primary" href="'+chatHref+'">'+tr('Start a conversation','开始对话')+'</a><a class="fi-btn" href="simulator.html?ref=demo&pilot=1">'+tr('Start a Practice','开始练习')+'</a><a class="fi-btn" href="knowledge.html?pilot=1">'+tr('Explore company knowledge','看看企业知识库')+'</a></div><div class="fi-note">'+(manager?tr('Your Copilot works from authorized team evidence. Private learner–coach conversations stay private.','AI 副驾驶只使用经授权的团队工作证据；学员与私人 AI 教练的对话始终保持私密。'):tr('Your private Coach conversation is learner-only. Your manager sees authorized Practice evidence, not this private conversation.','您的私人 AI 教练对话仅您本人可见；主管只能看到经授权的练习证据，看不到这段私人对话。'))+'</div></div><aside class="fi-side"><b>'+tr('Your workspace','您的工作区')+'</b><a href="team-messages.html?pilot=1">'+tr('Team Messages','团队消息')+'<span>→</span></a><a href="'+chatHref+'">'+(manager?tr('AI Copilot','AI 副驾驶'):tr('My Personal AI Coach','我的私人 AI 教练'))+'<span>→</span></a><a href="learner-profile.html?pilot=1">'+(manager?tr('Learner Profiles','学员档案'):tr('My Success Profile','我的成长档案'))+'<span>→</span></a><a href="simulator.html?ref=demo&pilot=1">'+tr('Practice Studio','练习工作室')+'<span>→</span></a><a href="knowledge.html?pilot=1">'+tr('Company Knowledge','企业知识库')+'<span>→</span></a></aside></div>';
   app.prepend(first);first.style.display='block';
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
</script>`;
  html = html.replace('</body>', injection + '\n</body>');
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store');
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
};
