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
  if (hasLiteralEmail || hasDictatedEmail) delete input.learnerEmail;

  // Manager chat is durable, so earlier assistant turns can contain statements made
  // before evidence plumbing was fixed (for example, "recentSessions is unavailable").
  // The current server-side evidence injected by ai-chat is authoritative and must
  // override those stale conversational claims.
  const originalMessage = String(input.message || '');
  input.message = `${originalMessage}\n\n[Manager evidence rule: Answer this request from the CURRENT server-injected resolvedMember and selectedMember.recentSessions. Current platform evidence overrides any earlier assistant statement that records were unavailable. If recentSessions contains records, use their savedAt, scenario, scores, strengths, tips, and summary directly; do not ask the manager to paste them.]`;

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
