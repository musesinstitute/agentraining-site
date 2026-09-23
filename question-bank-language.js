(function(){
'use strict';
var original=null,translated=null,busy=false;
function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function ensure(){
  if(document.getElementById('qb-lang-toggle'))return;
  var style=document.createElement('style');style.textContent='#qb-lang-toggle{display:none;gap:6px;align-items:center;margin:8px 0}.qb-lang-btn{border:1px solid #cbd5e1;background:#fff;border-radius:7px;padding:6px 10px;font-size:12px;font-weight:700;cursor:pointer}.qb-lang-btn.active{background:#1a56db;color:#fff;border-color:#1a56db}#qb-lang-status{font-size:12px;color:#64748b;margin-left:4px}';document.head.appendChild(style);
  var bar=document.createElement('div');bar.id='qb-lang-toggle';bar.innerHTML='<span style="font-size:12px;font-weight:700">Question language:</span><button class="qb-lang-btn active" data-lang="en">English</button><button class="qb-lang-btn" data-lang="zh">中文</button><span id="qb-lang-status"></span>';
  var results=document.getElementById('qb-results');if(results&&results.parentNode)results.parentNode.insertBefore(bar,results);
  bar.querySelector('[data-lang="en"]').onclick=function(){showEnglish()};bar.querySelector('[data-lang="zh"]').onclick=function(){showChinese()};
}
function active(lang){document.querySelectorAll('#qb-lang-toggle .qb-lang-btn').forEach(function(b){b.classList.toggle('active',b.dataset.lang===lang)})}
function showEnglish(){if(!original)return;window.renderQBResults(original);active('en');document.getElementById('qb-lang-status').textContent=''}
async function showChinese(){
  if(!original||busy)return;if(translated){window.renderQBResults(translated);active('zh');return}
  busy=true;var status=document.getElementById('qb-lang-status');status.textContent='正在准备中文显示…';
  try{
    var token=await PilotCloud.token('manager'),out=[],qs=original.questions||[];
    for(var i=0;i<qs.length;i+=10){var slice=qs.slice(i,i+10);status.textContent='正在翻译 '+(i+1)+'–'+Math.min(i+10,qs.length)+' / '+qs.length+'…';var r=await fetch('/.netlify/functions/question-bank-translate',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({questions:slice})});var d=await r.json().catch(function(){return{}});if(!r.ok)throw new Error(d.error||'中文翻译失败');(d.questions||[]).forEach(function(x){var base=slice[x.i];if(base)out.push(Object.assign({},base,{question:x.question||base.question,options:Array.isArray(x.options)&&x.options.length?x.options:base.options,answer:x.answer||base.answer,explanation:x.explanation||base.explanation,knowledgePointTitle:x.knowledgePointTitle||base.knowledgePointTitle}))})}
    if(out.length!==qs.length)throw new Error('中文题目数量不完整，请重试。');translated=Object.assign({},original,{title:(original.title||'Question Bank')+' — 中文',questions:out});window.renderQBResults(translated);active('zh');status.textContent='中文显示';
  }catch(e){status.textContent=e.message;active('en')}finally{busy=false}
}
function hook(){ensure();if(typeof window.renderQBResults!=='function'||window.renderQBResults.__qbLang)return false;var base=window.renderQBResults;var wrapped=function(bank){var isTranslated=translated&&bank===translated;if(!isTranslated){original=bank;translated=null}var result=base.apply(this,arguments);var bar=document.getElementById('qb-lang-toggle');if(bar)bar.style.display=bank&&Array.isArray(bank.questions)&&bank.questions.length?'flex':'none';if(!isTranslated)active('en');return result};wrapped.__qbLang=true;window.renderQBResults=wrapped;return true}
function install(){ensure();if(!hook()){var tries=0,t=setInterval(function(){tries++;if(hook()||tries>30)clearInterval(t)},100)}}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();
