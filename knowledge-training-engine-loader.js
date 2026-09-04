(function(){
'use strict';
// Compatibility bridge for the restored rich Knowledge Library page.
// Preserve the page's existing UI and state; expose only the selected document
// so the standalone Training Engine can power Question Bank V2 + Practice Scenarios.
var originalOpen=window.openDocument;
if(typeof originalOpen==='function'&&!originalOpen.__kteBridge){
  var bridged=async function(src){
    if(src) window.currentDoc=src;
    var result=await originalOpen.apply(this,arguments);
    if(src) window.currentDoc=src;
    return result;
  };
  bridged.__kteBridge=true;
  window.openDocument=bridged;
}
var script=document.createElement('script');
script.src='/knowledge-training-engine.js?v=20260904-depth1';
script.defer=true;
document.head.appendChild(script);
})();
