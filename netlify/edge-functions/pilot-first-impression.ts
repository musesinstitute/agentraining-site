export default async (_request: Request, context: any) => {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  let html = await response.text();
  const injection = String.raw`
<style>
#firstImpression{display:none;margin:0 0 18px;background:linear-gradient(135deg,#fff 0%,#eff6ff 52%,#ecfdf5 100%);border:1px solid #bfdbfe;border-radius:20px;padding:24px;box-shadow:0 14px 38px rgba(15,23,42,.08);position:relative;overflow:hidden}#firstImpression:before{content:'';position:absolute;width:190px;height:190px;border-radius:50%;background:rgba(255,255,255,.55);right:-65px;top:-90px}.fi-grid{display:grid;grid-template-columns:minmax(0,1.45fr) minmax(280px,.75fr);gap:22px;position:relative}.fi-kicker{font-size:11px;font-weight:900;letter-spacing:.7px;text-transform:uppercase;color:#1d4ed8;margin-bottom:8px}.fi-title{font-size:27px;line-height:1.2;margin:0 0 9px}.fi-copy{color:#475569;line-height:1.65;margin:0;max-width:760px}.fi-question{margin:16px 0 9px;font-weight:800;color:#1e293b}.fi-actions{display:grid;grid-template-columns:1fr 1fr;gap:9px}.fi-btn{border:1px solid #bfdbfe;background:#fff;color:#1d4ed8;border-radius:11px;padding:11px 13px;font-weight:800;text-decoration:none;cursor:pointer;font:inherit;line-height:1.35}.fi-btn:hover{background:#eff6ff}.fi-btn.primary{background:#1a56db;color:#fff;border-color:#1a56db}.fi-side{background:rgba(255,255,255,.82);border:1px solid rgba(191,219,254,.9);border-radius:14px;padding:16px}.fi-side b{display:block;margin-bottom:4px}.fi-side p{font-size:11px;color:#64748b;line-height:1.5;margin:0 0 8px}.fi-side a{display:block;color:#334155;text-decoration:none;padding:9px 0;border-top:1px solid #e2e8f0}.fi-side a span{color:#1d4ed8;font-weight:900;float:right}.fi-note{font-size:11px;color:#64748b;line-height:1.5;margin-top:12px}@media(max-width:800px){.fi-grid{grid-template-columns:1fr}.fi-title{font-size:23px}#firstImpression{padding:19px}}@media(max-width:520px){.fi-actions{grid-template-columns:1fr}}
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
   const copy=manager?tr('I want to understand you, your team, and what matters today. We can examine a member’s Practice evidence, prepare a coaching conversation, assign a focused Practice, or simply think through a management question together.','我希望先了解您本人、您的团队，以及今天什么事情最重要。我们可以一起查看成员的练习证据、准备一次辅导沟通、安排有针对性的练习，也可以先讨论您正在考虑的管理问题。'):tr('I want to know you as a person and help you grow. We can work on a manager assignment, understand new company knowledge, practice a realistic scenario, review your progress, or simply talk through a problem you are facing. Whatever you choose, I can work through it with you.','我希望认识您这个人，也真正帮助您成长。我们可以一起完成主管交给您的任务、理解公司新上传的知识资料、挑一个真实情境来练习、看看您的成长与下一步，也可以直接谈谈您现在遇到的问题。无论您选择什么，我都可以陪您一起完成。');
   const question=manager?tr('What would be most useful right now?','现在什么对您最有帮助？'):tr('What would you like us to do together today?','今天您最想让我陪您一起做什么？');
   const learnerActions='<a class="fi-btn primary" href="'+chatHref+'">'+tr('Talk with my AI Coach','先和我的 AI 教练聊聊')+'</a><a class="fi-btn" href="'+chatHref+'">'+tr('Work on my manager assignment','一起解决主管交给我的任务')+'</a><a class="fi-btn" href="knowledge.html?pilot=1">'+tr('Understand new company knowledge','一起理解公司新上传的知识')+'</a><a class="fi-btn" href="simulator.html?ref=demo&pilot=1">'+tr('Practice a classic scenario','挑一个经典 Scenario 来练习')+'</a><a class="fi-btn" href="learner-profile.html?pilot=1">'+tr('Review my growth and next step','看看我的成长与下一步')+'</a><a class="fi-btn" href="team-messages.html?pilot=1">'+tr('Talk about a manager message','看看主管消息，一起想怎么处理')+'</a>';
   const managerActions='<a class="fi-btn primary" href="'+chatHref+'">'+tr('Think with my AI Copilot','先和我的 AI 副驾驶聊聊')+'</a><a class="fi-btn" href="manager-chat.html?pilot=1">'+tr('Understand one team member','一起了解一名团队成员')+'</a><a class="fi-btn" href="manager.html?pilot=1">'+tr('Review assignments and results','查看练习任务和结果')+'</a><a class="fi-btn" href="knowledge.html?pilot=1">'+tr('Use company knowledge for coaching','用企业知识准备辅导')+'</a><a class="fi-btn" href="team-messages.html?pilot=1">'+tr('Follow up with my team','跟进团队消息')+'</a><a class="fi-btn" href="simulator.html?ref=demo&pilot=1">'+tr('Explore a Practice scenario','看看可用的训练 Scenario')+'</a>';
   first.innerHTML='<div class="fi-grid"><div><div class="fi-kicker">'+tr('People first · Grow together','以人为本 · 一起成长')+'</div><h2 class="fi-title">'+esc(title)+'</h2><p class="fi-copy">'+esc(copy)+'</p><div class="fi-question">'+esc(question)+'</div><div class="fi-actions">'+(manager?managerActions:learnerActions)+'</div><div class="fi-note">'+(manager?tr('You remain the decision-maker. Your Copilot helps you understand evidence, consider options, and take the next useful action.','您始终保留判断和决定。AI 副驾驶帮助您理解证据、考虑不同选择，并一起完成下一项有用的行动。'):tr('You choose the direction. Your AI Coach listens first, respects your choices, and helps turn each conversation into useful growth.','方向由您选择。AI 教练先听懂您、尊重您的选择，并努力让每一次对话都带来真正有用的成长。'))+'</div></div><aside class="fi-side"><b>'+tr('Your workspace','您的工作区')+'</b><p>'+tr('You can also open any area directly. Your AI partner remains the conversational guide.','您也可以直接进入任何区域；AI 伙伴始终是帮助您连接这些工作的对话入口。')+'</p><a href="team-messages.html?pilot=1">'+tr('Team Messages','团队消息')+'<span>→</span></a><a href="'+chatHref+'">'+(manager?tr('AI Copilot','AI 副驾驶'):tr('My Personal AI Coach','我的私人 AI 教练'))+'<span>→</span></a><a href="learner-profile.html?pilot=1">'+(manager?tr('Learner Profiles','学员档案'):tr('My Success Profile','我的成长档案'))+'<span>→</span></a><a href="simulator.html?ref=demo&pilot=1">'+tr('Practice Studio','练习工作室')+'<span>→</span></a><a href="knowledge.html?pilot=1">'+tr('Company Knowledge','企业知识库')+'<span>→</span></a></aside></div>';
   app.prepend(first);first.style.display='block';
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
</script>`;
  html = html.replace('</body>', injection + '\n</body>');
  const headers = new Headers(response.headers);headers.delete('content-length');headers.set('cache-control','no-store');
  return new Response(html,{status:response.status,statusText:response.statusText,headers});
};
