// Dedicated Manager AI endpoint.
import { getStore } from '@netlify/blobs';
import { getUser } from '@netlify/identity';
import aiChat from './ai-chat.mjs';

const STORE_NAME = 'agentraining-pilot';
const clean = value => String(value ?? '').trim();
const normalizeEmail = value => clean(value).toLowerCase();
const safeSegment = (value, fallback) => clean(value).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || fallback;

async function listJSON(store, prefix) {
  const { blobs } = await store.list({ prefix });
  return (await Promise.all(blobs.map(entry => store.get(entry.key, { type: 'json' })))).filter(Boolean);
}

function editDistance(a, b) {
  a = String(a); b = String(b);
  const d = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) d[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return d[a.length][b.length];
}

function asciiCompact(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

async function resolveDictatedLearner(req, message) {
  const user = await getUser();
  if (!user) return '';
  const teamId = safeSegment(user.appMetadata?.team_id, 'founding-pilot');
  const store = getStore({ name: STORE_NAME, consistency: 'strong' });
  const [profiles, roster] = await Promise.all([
    listJSON(store, `teams/${teamId}/profiles/`),
    listJSON(store, `teams/${teamId}/roster/`)
  ]);
  const emails = new Set();
  for (const row of profiles) if (row?.learnerEmail) emails.add(normalizeEmail(row.learnerEmail));
  for (const row of roster) if (row?.isLearner && row?.email) emails.add(normalizeEmail(row.email));
  if (!emails.size) return '';

  const raw = String(message || '').toLowerCase();
  for (const email of emails) if (raw.includes(email)) return email;

  // Dictation commonly turns '+' into '加', '@' into 'at', and introduces
  // small spelling errors such as learner -> lerner or muses -> music.
  // Compare the spoken ASCII local-part against every authorized roster email.
  const spokenBeforeDomain = raw
    .replace(/\b(?:at|@)\s*(gmail|outlook|hotmail|yahoo)\s*(?:\.|dot)?\s*com\b.*$/i, '')
    .replace(/(gmail|outlook|hotmail|yahoo)\.com.*$/i, '');
  const spokenLocal = asciiCompact(spokenBeforeDomain);
  if (!spokenLocal) return '';

  let best = null;
  for (const email of emails) {
    const local = asciiCompact(email.split('@')[0]);
    if (!local) continue;
    // Compare against the tail too, because the utterance may contain Chinese
    // words before the email-like phrase which disappear during ASCII cleanup.
    const candidates = [spokenLocal, spokenLocal.slice(-Math.max(local.length + 6, 12))];
    for (const candidate of candidates) {
      const distance = editDistance(candidate, local);
      const ratio = distance / Math.max(candidate.length, local.length);
      if (!best || ratio < best.ratio) best = { email, ratio, candidate, local };
    }
  }
  return best && best.ratio <= 0.38 ? best.email : '';
}

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

  if (hasLiteralEmail || hasDictatedEmail) {
    const resolved = await resolveDictatedLearner(req, input.message).catch(() => '');
    if (resolved) input.learnerEmail = resolved;
    else delete input.learnerEmail;
  }

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
