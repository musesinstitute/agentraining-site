// Opt-in OpenAI Realtime voice prototype. Never send OPENAI_API_KEY to the browser.
// This endpoint is disabled unless OPENAI_REALTIME_ENABLED=1 in the preview environment.
import { createHash } from 'node:crypto';
import { getUser, verifyRequestOrigin } from '@netlify/identity';
import { getStore } from '@netlify/blobs';

const WINDOW_MS = 60 * 60 * 1000;
const MAX_STARTS = 5; // pilot sessions/user/hour; client also stops at 5 minutes
const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const respond = (status, data) => new Response(JSON.stringify(data), { status, headers });

async function reserveSession(userId) {
  // Fail CLOSED on rate-store errors: paid voice sessions must never bypass cost limits.
  const store = getStore({ name: 'agentraining-realtime-rate', consistency: 'strong' });
  const key = createHash('sha256').update(String(userId)).digest('hex');
  const now = Date.now();
  const existing = await store.get(key, { type: 'json' });
  const recent = (Array.isArray(existing) ? existing : [])
    .filter(t => typeof t === 'number' && t > now - WINDOW_MS);
  if (recent.length >= MAX_STARTS) return false;
  recent.push(now);
  await store.setJSON(key, recent);
  return true;
}

export default async function handler(req) {
  if (req.method !== 'POST') return respond(405, { error: 'POST only' });
  try {
    verifyRequestOrigin(req);
  } catch (_) {
    return respond(403, { error: 'Request origin not permitted' });
  }
  const user = await getUser().catch(() => null);
  if (!user || !user.id) return respond(401, { error: 'Sign in to the private pilot first.' });
  const roles = Array.isArray(user.roles) ? user.roles : [];
  if (!roles.some(r => ['learner', 'manager', 'admin'].includes(r))) {
    return respond(403, { error: 'An invited Pilot learner or manager account is required.' });
  }
  if (process.env.OPENAI_REALTIME_ENABLED !== '1') {
    return respond(503, { error: 'Realtime voice testing has not been enabled for this deploy.' });
  }
  const key = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_REALTIME_MODEL === 'gpt-realtime-2.1-mini' ? 'gpt-realtime-2.1-mini' : 'gpt-realtime-2.1';
  if (!key) return respond(503, { error: 'OPENAI_API_KEY is not configured on Netlify.' });
  try {
    const allowed = await reserveSession(user.id);
    if (!allowed) return respond(429, { error: 'Voice test limit reached: 5 sessions per hour.' });
  } catch (error) {
    console.error('Realtime rate store unavailable', error);
    return respond(503, { error: 'Voice usage limiter unavailable; no session was started.' });
  }

  const safetyId = createHash('sha256').update('agentraining:' + user.id).digest('hex');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        authorization: 'Bearer ' + key,
        'content-type': 'application/json',
        'OpenAI-Safety-Identifier': safetyId
      },
      body: JSON.stringify({
        expires_after: { anchor: 'created_at', seconds: 60 },
        session: {
          type: 'realtime',
          model,
          instructions: 'You are a natural, patient, respectful sales-practice conversation partner. Let users pause, self-correct, and mix Chinese and English. Keep responses brief and specific. Do not lecture about business books or named sales doctrines. Never invent product guarantees or legal claims.',
          audio: {
            input: {
              transcription: { model: 'gpt-4o-mini-transcribe' },
              turn_detection: {
                type: 'semantic_vad', eagerness: 'low',
                create_response: true, interrupt_response: true
              }
            },
            output: { voice: 'marin' }
          },
          max_output_tokens: 500
        }
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || typeof data.value !== 'string') {
      console.error('OpenAI Realtime secret creation failed', response.status, data?.error?.code || '');
      return respond(502, { error: 'Realtime voice provider is unavailable. Check model access/billing/configuration.' });
    }
    return respond(200, { value: data.value, expires_at: data.expires_at, maxSeconds: 300 });
  } catch (error) {
    console.error('Realtime voice token error', error);
    return respond(502, { error: 'Could not initialize realtime voice.' });
  } finally {
    clearTimeout(timeout);
  }
}
