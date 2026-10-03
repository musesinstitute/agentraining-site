export default async (request, context) => {
  const response = await context.next();
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) return response;
  const html = await response.text();
  if (html.includes('data-kte-runtime="recovery2"')) return new Response(html, response);
  const runtime = '<script data-kte-runtime="recovery2" src="/knowledge-training-engine-loader.js?v=20260911-recovery2"></script><script src="/knowledge-training-engine.js?v=20260911-recovery2"></script>';
  const injected = html.replace('</body>', runtime + '</body>');
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  headers.set('cache-control','no-store');
  return new Response(injected, { status: response.status, statusText: response.statusText, headers });
};
