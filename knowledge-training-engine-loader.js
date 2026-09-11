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
// The Edge function loads the engine in the next parser-ordered script tag.
// Keeping this file bridge-only prevents a dynamic-script race where the
// Question Bank modal can open before the recovery engine installs.
})();
