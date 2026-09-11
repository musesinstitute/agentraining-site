(function(){
'use strict';
// Start Menu — shared learner-facing primary navigation.
// UI-only: renders into an existing "#start-menu-mount" element on each
// learner page. Does not touch PilotCloud, auth, or any training-engine
// logic. Routes reused as-is (see AGENTS.md / delivery notes for the
// documented mapping); no new pages or backend endpoints are introduced.
var mount=document.getElementById('start-menu-mount');
if(!mount)return;

var params=new URLSearchParams(location.search);
var qLang=params.get('lang');
if(qLang==='en'||qLang==='zh'){try{sessionStorage.setItem('agentraining_lang',qLang)}catch(e){}}
var lang=qLang==='en'||qLang==='zh'?qLang:((function(){try{return sessionStorage.getItem('agentraining_lang')}catch(e){return null}})()||((navigator.language||'').toLowerCase().indexOf('zh')===0?'zh':'en'));
var zh=lang==='zh';
function t(en,zhText){return zh?zhText:en}

// pilot=1 / lang keep the same convention every existing learner-page link
// already uses (see pilot.html, coach-chat.html, knowledge.html, etc.).
var qs='?pilot=1'+(qLang?'&lang='+qLang:'');

var items=[
  {key:'home',icon:'🏠',label:t('Home','首页'),href:'pilot.html'+qs},
  {key:'assignments',icon:'📋',label:t('My Assignments','我的任务'),href:'coach-chat.html'+qs+'#assignments'},
  {key:'practice',icon:'🎯',label:t('Practice','练习'),href:'simulator.html?ref=demo&pilot=1'+(qLang?'&lang='+qLang:'')},
  {key:'knowledge',icon:'📚',label:t('Company Knowledge','企业知识库'),href:'knowledge.html'+qs},
  {key:'coach',icon:'🤝',label:t('My AI Coach','我的 AI 教练'),href:'coach-chat.html'+qs},
  {key:'messages',icon:'💬',label:t('Messages','团队消息'),href:'team-messages.html'+qs}
];

// Which item is "current": matched by page filename, with coach-chat.html
// disambiguated between "My Assignments" and "My AI Coach" by the
// #assignments fragment (the Assignment Inbox lives inside Coach Chat).
var path=(location.pathname.split('/').pop()||'pilot.html').replace(/\.html$/,'');
var activeKey=null;
if(path===''||path==='pilot')activeKey='home';
else if(path==='coach-chat')activeKey=location.hash==='#assignments'?'assignments':'coach';
else if(path==='simulator')activeKey='practice';
else if(path==='knowledge'||path==='knowledge-chat')activeKey='knowledge';
else if(path==='team-messages')activeKey='messages';

var html='<nav id="start-menu" aria-label="Start Menu"><div class="sm-inner">'+items.map(function(item){
  return '<a class="sm-item'+(item.key===activeKey?' active':'')+'" href="'+item.href+'"'+(item.key===activeKey?' aria-current="page"':'')+'><span class="sm-icon">'+item.icon+'</span><span class="sm-label">'+item.label+'</span></a>';
}).join('')+'</div></nav>';
mount.outerHTML=html;
})();
