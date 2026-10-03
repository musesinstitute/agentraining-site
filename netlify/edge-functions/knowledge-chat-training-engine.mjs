export default async (request, context) => {
  const response = await context.next();
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) return response;

  try {
    const html = await response.text();
    const headers = new Headers(response.headers);
    headers.delete('content-length');
    headers.delete('content-encoding');
    headers.set('cache-control','no-store');

    if (html.includes('data-kte-runtime="recovery2"')) {
      return new Response(html, { status: response.status, statusText: response.statusText, headers });
    }

    const runtime = '<script data-kte-runtime="recovery2" src="/knowledge-training-engine-loader.js?v=20260911-recovery2"></script><script src="/knowledge-training-engine.js?v=20260911-recovery2"></script>';
    const injected = html.replace('</body>', runtime + '</body>');
    return new Response(injected, { status: response.status, statusText: response.statusText, headers });
  } catch (error) {
    console.error('Knowledge training edge enhancement failed; returning origin response.', error);
    return response;
  }
};
