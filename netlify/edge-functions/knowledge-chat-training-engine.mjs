export default async (request, context) => {
  const response = await context.next();
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) return response;
  const html = await response.text();
  if (html.includes('knowledge-training-engine-loader.js')) return new Response(html, response);
  const injected = html.replace('</body>', '<script src="/knowledge-training-engine-loader.js?v=20260904-fix1"></script></body>');
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  return new Response(injected, { status: response.status, statusText: response.statusText, headers });
};
