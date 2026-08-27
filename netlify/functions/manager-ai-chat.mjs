// Dedicated Manager AI endpoint.
import aiChat from './ai-chat.mjs';

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST required.', dataVersion: 'manager-evidence-v3' }), {
      status: 405,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
    });
  }

  let input;
  try { input = await req.clone().json(); }
  catch { input = {}; }
  input.role = 'manager';

  const spoken = String(input.message || '').toLowerCase();
  const compact = spoken.replace(/\s+/g, '');
  const hasLiteralEmail = /[a-z0-9._+%-]+@[a-z0-9.-]+\.[a-z]{2,}/.test(compact);
  const hasDictatedEmail = /\b(?:at|@)\s*(?:gmail|outlook|hotmail|yahoo)\s*(?:\.\s*|dot\s*)?com\b/i.test(spoken) || /gmail\.com|outlook\.com|hotmail\.com|yahoo\.com/i.test(spoken);

  // A member named in the current turn must outrank a stale UI selection.
  if (hasLiteralEmail || hasDictatedEmail) delete input.learnerEmail;

  // IMPORTANT: do not append internal evidence instructions to input.message.
  // ai-chat.mjs already injects the authorized Manager evidence into the system
  // instructions. Mutating input.message caused the internal rule to appear in
  // the visible transcript and be stored as if the Manager had typed it.

  const rewritten = new Request(req.url, {
    method: 'POST',
    headers: req.headers,
    body: JSON.stringify(input)
  });

  const response = await aiChat(rewritten);
  const body = await response.json().catch(() => ({}));
  body.dataVersion = 'manager-evidence-v3';

  return new Response(JSON.stringify(body), {
    status: response.status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-agentraining-manager-ai': 'manager-evidence-v3'
    }
  });
}
