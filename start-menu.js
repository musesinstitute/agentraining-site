(function(){
'use strict';
// Start Menu — shared learner/manager primary navigation.
// UI-only: renders into every element carrying the "start-menu-mount"
// class on the page (there may be one at the top and one at the bottom -
// both get the identical, role-correct menu). Does not touch PilotCloud,
// auth, or any training-engine logic - routes are reused as-is (see the
// PR description for the documented mapping). No new pages or backend
// endpoints are introduced.
var mounts=document.querySelectorAll('.start-menu-mount');
if(!mounts.length)return;

var params=new URLSearchParams(location.search);
var qLang=params.get('lang');
if(qLang==='en'||qLang==='zh'){try{sessionStorage.setItem('agentraining_lang',qLang)}catch(e){}}
var lang=qLang==='en'||qLang==='zh'?qLang:((function(){try{return sessionStorage.getItem('agentraining_lang')}catch(e){return null}})()||((navigator.language||'').toLowerCase().indexOf('zh')===0?'zh':'en'));
var zh=lang==='zh';
function t(en,zhText){return zh?zhText:en}

// pilot=1 / lang keep the same convention every existing learner-page link
// already uses (see pilot.html, coach-chat.html, knowledge.html, etc.).
var qs='?pilot=1'+(qLang?'&lang='+qLang:'');
var practiceHref='simulator.html?ref=demo&pilot=1'+(qLang?'&lang='+qLang:'');

// Learner order matches the actual learner workflow: an assignment leads
// you to the relevant Company Knowledge, then Practice, then (if needed)
// the AI Coach, then Messages back to your manager.
function learnerItems(){
  return [
    {key:'home',icon:'🏠',label:t('Home','首页'),href:'pilot.html'+qs},
    {key:'assignments',icon:'📋',label:t('My Assignments','我的任务'),href:'coach-chat.html'+qs+'#assignments'},
    {key:'knowledge',icon:'📚',label:t('Company Knowledge','企业知识库'),href:'knowledge.html'+qs},
    {key:'practice',icon:'🎯',label:t('Practice','练习'),href:practiceHref},
    {key:'coach',icon:'🤝',label:t('My AI Coach','我的 AI 教练'),href:'coach-chat.html'+qs},
    {key:'messages',icon:'💬',label:t('Messages','团队消息'),href:'team-messages.html'+qs}
  ];
}
// Manager order mirrors the same real destinations manager.html's own nav
// already uses (Assignments/Results are anchors within that one page) -
// no new manager pages are introduced.
function managerItems(){
  return [
    {key:'home',icon:'🏠',label:t('Home','首页'),href:'pilot.html'+qs},
    {key:'assignments',icon:'📋',label:t('Assignments','练习指派'),href:'manager.html'+qs+'#assignments'},
    {key:'team',icon:'👥',label:t('Team','团队'),href:'learner-profile.html'+qs},
    {key:'results',icon:'📊',label:t('Results','结果'),href:'manager.html'+qs+'#records'},
    {key:'knowledge',icon:'📚',label:t('Company Knowledge','企业知识库'),href:'knowledge.html'+qs},
    {key:'practice',icon:'🎯',label:t('Practice','练习'),href:practiceHref},
    {key:'messages',icon:'💬',label:t('Messages','团队消息'),href:'team-messages.html'+qs}
  ];
}

// Which item is "current": matched by page filename. coach-chat.html is
// disambiguated between "My Assignments" and "My AI Coach" by the
// #assignments fragment (the Assignment Inbox lives inside Coach Chat);
// manager.html is disambiguated between "Assignments" and "Results" by
// the #assignments / #records fragment the same way.
var path=(location.pathname.split('/').pop()||'pilot.html').replace(/\.html$/,'');
function activeKeyFor(isManager){
  if(path===''||path==='pilot')return 'home';
  if(path==='coach-chat')return isManager?null:(location.hash==='#assignments'?'assignments':'coach');
  if(path==='manager')return location.hash==='#records'?'results':'assignments';
  if(path==='learner-profile')return isManager?'team':null;
  if(path==='simulator')return 'practice';
  if(path==='knowledge'||path==='knowledge-chat')return 'knowledge';
  if(path==='team-messages')return 'messages';
  return null;
}

function buildNav(items,activeKey,bottom){
  var lead=bottom?'<span class="sm-continue">'+t('Up next','下一步')+'</span>':'';
  var links=items.map(function(item){
    return '<a class="sm-item'+(item.key===activeKey?' active':'')+'" href="'+item.href+'"'+(item.key===activeKey?' aria-current="page"':'')+'><span class="sm-icon">'+item.icon+'</span><span class="sm-label">'+item.label+'</span></a>';
  }).join('');
  return '<nav class="start-menu'+(bottom?' start-menu-bottom':'')+'" aria-label="'+(bottom?t('Continue navigation','继续导航'):t('Start Menu','主导航'))+'"><div class="sm-inner">'+lead+links+'</div></nav>';
}

function render(items,activeKey){
  mounts.forEach(function(el){
    var bottom=el.getAttribute('data-position')==='bottom';
    el.outerHTML=buildNav(items,activeKey,bottom);
  });
}

// Role resolution: PilotCloud.request('me') is the SAME authoritative,
// server-verified role source pilot.html's own Home page already uses
// (never inferred from the current page's URL). Mounts render nothing
// until this resolves, rather than showing the learner menu first and
// possibly swapping to manager a moment later.
function resolveIsManager(){
  if(!window.PilotCloud||!PilotCloud.enabled)return Promise.resolve(false);
  return PilotCloud.request('me').then(function(me){
    return (me.roles||[]).some(function(r){return r==='manager'||r==='admin'});
  }).catch(function(){return false});
}

resolveIsManager().then(function(isManager){
  var items=isManager?managerItems():learnerItems();
  render(items,activeKeyFor(isManager));
}).catch(function(){
  render(learnerItems(),activeKeyFor(false));
});
})();
