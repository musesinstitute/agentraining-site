// Dedicated Manager AI endpoint.
// Keeping this separate from the learner ai-chat route makes Preview deployments
// and diagnostics unambiguous while the Pilot is evolving quickly.
import aiChat from './ai-chat.mjs';

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST required.', dataVersion: 'manager-evidence-v2' }), {
      status: 405,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    });
  }

  // Force the role server-side; the browser cannot accidentally fall back to learner mode.
  let input;
  try { input = await req.clone().json(); }
  catch { input = {}; }
  input.role = 'manager';

  const rewritten = new Request(req.url, {
    method: 'POST',
    headers: req.headers,
    body: JSON.stringify(input)
  });
  const response = await aiChat(rewritten);
  const body = await response.json().catch(() => ({}));
  body.dataVersion = 'manager-evidence-v2';
  return new Response(JSON.stringify(body), {
    status: response.status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-agentraining-manager-ai': 'manager-evidence-v2' }
  });
}
