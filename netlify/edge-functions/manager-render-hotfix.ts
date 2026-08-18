export default async (_request: Request, context: any) => {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  let html = await response.text();

  const transcriptBefore = "transcript.map(t=>'<div class=\"turn '+(t.speaker==='agent'?'agent':'client')+'\"><b>'+esc(t.speaker==='agent'?t('Learner','学员'):t('AI role-play partner','AI 情境角色'))+'</b>'+esc(t.text)+'</div>')";
  const transcriptAfter = "transcript.map(turn=>'<div class=\"turn '+(turn.speaker==='agent'?'agent':'client')+'\"><b>'+esc(turn.speaker==='agent'?t('Learner','学员'):t('AI role-play partner','AI 情境角色'))+'</b>'+esc(turn.text)+'</div>')";
  html = html.replace(transcriptBefore, transcriptAfter);

  html = html.replace(
    "if(!learnerEmail||!learnerInput.checkValidity()){setAssignStatus(t('Please enter a valid invited Learner email.','请输入有效且已受邀请的 Learner 邮箱。'),'error');learnerInput.focus();return}",
    "if(!learnerEmail||!learnerInput.checkValidity()){setAssignStatus(t('Please enter a valid Learner email.','请输入有效的 Learner 邮箱。'),'error');learnerInput.focus();return}"
  );

  html = html.replace(
    "document.getElementById('managerLearnerOptions').innerHTML=cloudProfiles.map(profile=>'<option value=\"'+esc(profile.learnerEmail)+'\">'+esc(profile.preferredName||profile.learnerEmail)+'</option>').join('');",
    "const learnerRoster=new Map();cloudProfiles.forEach(profile=>{const email=String(profile.learnerEmail||'').trim().toLowerCase();if(email)learnerRoster.set(email,profile.preferredName||email)});cloudAssignments.forEach(item=>{const email=String(item.assignedTo||item.learner||'').trim().toLowerCase();if(email&&!learnerRoster.has(email))learnerRoster.set(email,item.learner||email)});cloudResults.forEach(item=>{const email=String(item.learner||'').trim().toLowerCase();if(email&&!learnerRoster.has(email))learnerRoster.set(email,item.learnerName||email)});document.getElementById('managerLearnerOptions').innerHTML=[...learnerRoster.entries()].map(([email,name])=>'<option value=\"'+esc(email)+'\">'+esc(name)+'</option>').join('');"
  );

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store');
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
};
