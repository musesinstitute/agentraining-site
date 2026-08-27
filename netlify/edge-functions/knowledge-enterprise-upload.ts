export default async (_request: Request, context: any) => {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  let html = await response.text();

  html = html.replace(
    '<b data-en="Supported transcript files:" data-zh="支援的逐字稿文件：">Supported transcript files:</b> TXT, MD, VTT, SRT · <span data-en="up to 1 MB. Direct video upload and automatic transcription are not included in this Pilot." data-zh="最大1MB。本Pilot暫不包括直接上傳影片及自動轉錄。">up to 1 MB. Direct video upload and automatic transcription are not included in this Pilot.</span>',
    '<b data-en="Supported company files:" data-zh="支援的企業文件：">Supported company files:</b> PDF, Word (.docx), PowerPoint (.pptx), TXT, MD, VTT, SRT · <span data-en="up to 10 MB per file. The browser extracts readable text for manager review before saving. Direct video upload and automatic transcription are not included in this Pilot." data-zh="每份最大10MB。瀏覽器會先擷取可讀文字供主管檢查，再儲存。本Pilot暫不包括直接上傳影片及自動轉錄。">up to 10 MB per file. The browser extracts readable text for manager review before saving. Direct video upload and automatic transcription are not included in this Pilot.</span>'
  );

  html = html.replace(
    '<label for="transcriptFile" data-en="Upload text transcript (optional)" data-zh="上傳文字逐字稿（可選）">Upload text transcript (optional)</label><input id="transcriptFile" type="file" accept=".txt,.md,.vtt,.srt,text/plain"><small data-en="Accepted: TXT, MD, VTT, SRT up to 1 MB. The text is reviewed before saving." data-zh="接受TXT、MD、VTT、SRT，最大1MB；儲存前可先檢查文字。">Accepted: TXT, MD, VTT, SRT up to 1 MB. The text is reviewed before saving.</small>',
    '<label for="transcriptFile" data-en="Upload company file (optional)" data-zh="上傳企業文件（可選）">Upload company file (optional)</label><input id="transcriptFile" type="file" accept=".pdf,.docx,.pptx,.txt,.md,.vtt,.srt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain"><small data-en="Accepted: PDF, DOCX, PPTX, TXT, MD, VTT, SRT up to 10 MB. Readable text is extracted locally for review before saving." data-zh="接受PDF、DOCX、PPTX、TXT、MD、VTT、SRT，最大10MB；儲存前會在瀏覽器本機擷取可讀文字供您檢查。">Accepted: PDF, DOCX, PPTX, TXT, MD, VTT, SRT up to 10 MB. Readable text is extracted locally for review before saving.</small>'
  );

  // Remove the old text-only file listener so the enhanced parser below is the
  // sole handler for local uploads.
  html = html.replace(
    "document.getElementById('transcriptFile').addEventListener('change',async function(){var file=this.files&&this.files[0];if(!file)return;if(file.size>1048576){setFormStatus(tr('Transcript file must be 1 MB or smaller.','逐字稿文件必須為1MB或以下。'),'error');this.value='';return}try{var text=await file.text();document.getElementById('sourceContent').value=text.slice(0,30000);document.getElementById('sourceContent').dispatchEvent(new Event('input'));setFormStatus(tr('Loaded: ','已載入：')+file.name+tr('. Review the text before saving.','。請在儲存前檢查文字。'),'ok')}catch(error){setFormStatus(tr('Transcript could not be read.','無法讀取逐字稿文件。'),'error')}});",
    ''
  );

  const enhancedUpload = `
<script src="https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js" integrity="sha512-XMVd28F1oH/O71fzwBnV7HucLxVwtx3vVMEy1Kz3ifkPHLYtQzTx8HqFDRUvlV5oQJwyh1uTS2f+QJ4cHOjYXA==" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js" crossorigin="anonymous" referrerpolicy="no-referrer"></script>
<script>
(function(){
 var MAX_FILE_BYTES=10*1024*1024,MAX_TEXT_CHARS=30000;
 function xmlText(xml){
  var doc=new DOMParser().parseFromString(xml,'application/xml');
  return Array.from(doc.querySelectorAll('t')).map(function(n){return n.textContent||''}).join(' ');
 }
 function cleanExtracted(text){return String(text||'').replace(/\\u0000/g,'').replace(/[ \\t]+\\n/g,'\\n').replace(/\\n{4,}/g,'\\n\\n\\n').trim()}
 async function readDocx(buffer){
  if(!window.JSZip)throw new Error('Document parser did not load.');
  var zip=await JSZip.loadAsync(buffer),names=Object.keys(zip.files).filter(function(name){return /^word\\/(document|header[0-9]*|footer[0-9]*)\\.xml$/i.test(name)}),parts=[];
  names.sort();
  for(var i=0;i<names.length;i++){var xml=await zip.file(names[i]).async('string');var text=xmlText(xml);if(text)parts.push(text)}
  return parts.join('\\n\\n');
 }
 async function readPptx(buffer){
  if(!window.JSZip)throw new Error('Presentation parser did not load.');
  var zip=await JSZip.loadAsync(buffer),names=Object.keys(zip.files).filter(function(name){return /^ppt\\/slides\\/slide[0-9]+\\.xml$/i.test(name)});
  names.sort(function(a,b){return Number((a.match(/slide([0-9]+)/i)||[])[1]||0)-Number((b.match(/slide([0-9]+)/i)||[])[1]||0)});
  var parts=[];
  for(var i=0;i<names.length;i++){var xml=await zip.file(names[i]).async('string');var text=xmlText(xml);if(text)parts.push('Slide '+(i+1)+'\\n'+text)}
  return parts.join('\\n\\n');
 }
 async function readPdf(buffer){
  if(!window.pdfjsLib)throw new Error('PDF parser did not load.');
  pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  var pdf=await pdfjsLib.getDocument({data:new Uint8Array(buffer)}).promise,parts=[];
  for(var pageNum=1;pageNum<=pdf.numPages;pageNum++){
   var page=await pdf.getPage(pageNum),content=await page.getTextContent(),text=content.items.map(function(item){return item.str||''}).join(' ').trim();
   if(text)parts.push('Page '+pageNum+'\\n'+text);
   if(parts.join('\\n\\n').length>MAX_TEXT_CHARS*1.4)break;
  }
  return parts.join('\\n\\n');
 }
 async function extractFile(file){
  var name=String(file.name||''),ext=(name.toLowerCase().match(/\\.[^.]+$/)||[''])[0];
  if(ext==='.txt'||ext==='.md'||ext==='.vtt'||ext==='.srt')return file.text();
  var buffer=await file.arrayBuffer();
  if(ext==='.docx')return readDocx(buffer);
  if(ext==='.pptx')return readPptx(buffer);
  if(ext==='.pdf')return readPdf(buffer);
  throw new Error('Unsupported file type.');
 }
 var input=document.getElementById('transcriptFile');
 if(!input)return;
 input.addEventListener('change',async function(){
  var file=this.files&&this.files[0];if(!file)return;
  if(file.size>MAX_FILE_BYTES){setFormStatus(tr('File must be 10 MB or smaller.','文件必須為10MB或以下。'),'error');this.value='';return}
  setFormStatus(tr('Reading “'+file.name+'”…','正在讀取「'+file.name+'」……'),'');
  try{
   var extracted=cleanExtracted(await extractFile(file));
   if(!extracted)throw new Error(tr('No readable text was found in this file. Scanned/image-only PDFs require OCR and are not supported in this Pilot yet.','此文件沒有找到可讀文字。掃描／純圖片PDF需要OCR，目前Pilot尚未支援。'));
   var truncated=extracted.length>MAX_TEXT_CHARS,text=extracted.slice(0,MAX_TEXT_CHARS),content=document.getElementById('sourceContent');
   content.value=text;content.dispatchEvent(new Event('input'));
   document.getElementById('sourceType').value='document_notes';
   var title=document.getElementById('sourceTitle');if(!title.value.trim())title.value=file.name.replace(/\\.(pdf|docx|pptx|txt|md|vtt|srt)$/i,'').slice(0,240);
   content.scrollIntoView({behavior:'smooth',block:'center'});
   setFormStatus(tr('Loaded: ','已載入：')+file.name+(truncated?tr('. Text exceeded the 30,000-character Pilot analysis limit and was truncated. Review it before saving.','。文字超過30,000字元的Pilot分析上限，已截斷；請在儲存前檢查。'):tr('. Review the extracted text before saving.','。請在儲存前檢查擷取的文字。')),'ok');
  }catch(error){setFormStatus((error&&error.message)||tr('This file could not be read.','無法讀取此文件。'),'error');this.value=''}
 });
})();
</script>`;

  html = html.replace('</body>', enhancedUpload + '\n</body>');

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store');
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
};
