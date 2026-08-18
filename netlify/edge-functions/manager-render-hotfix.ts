export default async (_request: Request, context: any) => {
  const response = await context.next();
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  let html = await response.text();
  const before = "transcript.map(t=>'<div class=\"turn '+(t.speaker==='agent'?'agent':'client')+'\"><b>'+esc(t.speaker==='agent'?t('Learner','学员'):t('AI role-play partner','AI 情境角色'))+'</b>'+esc(t.text)+'</div>')";
  const after = "transcript.map(turn=>'<div class=\"turn '+(turn.speaker==='agent'?'agent':'client')+'\"><b>'+esc(turn.speaker==='agent'?t('Learner','学员'):t('AI role-play partner','AI 情境角色'))+'</b>'+esc(turn.text)+'</div>')";
  html = html.replace(before, after);

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store');
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
};
