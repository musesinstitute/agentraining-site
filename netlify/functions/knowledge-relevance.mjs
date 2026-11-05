// Team Training Relevance assessment for one Company Knowledge source.
//
// Deliberately a small, separate endpoint (same pattern as knowledge-analyze.mjs)
// with an explicit upstream deadline and a fast model: running this inside the
// large pilot-data function with claude-sonnet-4-6 consistently exceeded the
// hosting time limit on longer / Chinese sources (Deploy Preview #69).
// Scoring logic lives in lib/knowledge-relevance-core.mjs.
import { getStore } from '@netlify/blobs';
import { getUser, verifyRequestOrigin } from '@netlify/identity';
import { normalizeRelevance, buildRelevancePrompt, competencySnapshot, librarySnapshot } from './lib/knowledge-relevance-core.mjs';
import { updateKnowledgeRecord, knowledgeUpdateFailure } from './lib/knowledge-record.mjs';

const STORE_NAME = 'agentraining-pilot';
const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
// Same upstream deadline as knowledge-analyze.mjs (works within the hosting limit).
function deadlineMs() { return Number(process.env.RELEVANCE_DEADLINE_MS) || 18000; }
const MAX_OUTPUT_TOKENS = 1400;

function reply(status, body) { return new Response(JSON.stringify(body), { status, headers: jsonHeaders }); }
function cleanText(value, max = 500) { return String(value ?? '').trim().slice(0, max); }
function safeSegment(value, fallback) {
  const s = cleanText(value, 100).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return s || fallback;
}
async function listJSON(store, prefix) {
  const { blobs } = await store.list({ prefix });
  const rows = await Promise.all(blobs.map(entry => store.get(entry.key, { type: 'json' })));
  return rows.filter(Boolean);
}
function extractOutputText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();
  const parts = [];
  for (const item of payload?.output || []) for (const c of item?.content || []) if (c?.type === 'output_text' && c?.text) parts.push(c.text);
  return parts.join('\n').trim();
}

async function callModel(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw Object.assign(new Error('AI relevance assessment is not configured.'), { status: 503 });
  const model = process.env.OPENAI_KNOWLEDGE_MODEL || process.env.OPENAI_CHAT_MODEL || 'gpt-5.4-mini';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadlineMs());
  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        instructions: 'Return compact valid JSON only. Assess training relevance of the supplied authorized enterprise material against the supplied team profile. Do not make autonomous HR, legal, licensing, financial, or compliance decisions.',
        input: prompt,
        max_output_tokens: MAX_OUTPUT_TOKENS
      })
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(body?.error?.message || `AI provider returned ${response.status}.`), { status: response.status >= 500 ? 503 : 502 });
    if (body?.status === 'incomplete') throw Object.assign(new Error('Relevance assessment was cut off. Please retry.'), { status: 502 });
    const raw = extractOutputText(body);
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw Object.assign(new Error('Relevance assessment returned an invalid format. Please try again.'), { status: 502 });
    try { return { parsed: JSON.parse(match[0]), model }; }
    catch { throw Object.assign(new Error('Relevance assessment could not be parsed. Please try again.'), { status: 502 }); }
  } catch (error) {
    if (error?.name === 'AbortError') throw Object.assign(new Error('Relevance assessment took too long. Please retry.'), { status: 503 });
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export default async (req) => {
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed.' });
  try {
    verifyRequestOrigin(req);
    const user = await getUser(req);
    if (!user) return reply(401, { error: 'Please sign in to continue.' });
    const roles = Array.isArray(user.roles) ? user.roles : [];
    if (!roles.includes('manager') && !roles.includes('admin')) return reply(403, { error: 'Manager access is required.' });
    const actor = { id: cleanText(user.id, 100), email: cleanText(user.email, 254).toLowerCase(), roles, teamId: safeSegment(user.appMetadata?.team_id, 'founding-pilot') };

    const input = await req.json().catch(() => ({}));
    const id = cleanText(input.id, 100);
    if (!id) return reply(400, { error: 'Knowledge source id is required.' });
    const lang = input.lang === 'zh' ? 'zh' : 'en';

    const store = getStore({ name: STORE_NAME, consistency: 'strong' });
    const prefix = `teams/${actor.teamId}`;
    const key = `${prefix}/knowledge/${id}`;
    const [record, profile, sessions, sources] = await Promise.all([
      store.get(key, { type: 'json' }),
      store.get(`${prefix}/training-profile`, { type: 'json' }),
      listJSON(store, `${prefix}/sessions/`),
      listJSON(store, `${prefix}/knowledge/`)
    ]);
    if (!record) return reply(404, { error: 'Knowledge source not found.' });
    if (!record.consentConfirmed) return reply(400, { error: 'Confirm organizational authorization and AI processing consent first.' });
    if (String(record.content || '').length < 80) return reply(400, { error: 'Add at least 80 characters of transcript or training notes before analysis.' });
    if (!profile?.goals?.length) return reply(400, { error: 'Set the Team Training Profile (at least one training goal) before assessing relevance.' });

    const snapshot = competencySnapshot(sessions);
    const librarySources = librarySnapshot(sources, id);
    const { parsed, model } = await callModel(buildRelevancePrompt(record, { ...profile, lang }, snapshot, librarySources));
    const relevance = normalizeRelevance(parsed, { librarySources, snapshot, profile, model });

    // The model call above can take many seconds. Save against the CURRENT
    // record (ETag-checked), not the snapshot read before the call, so a
    // manager approving / giving feedback / deleting in the meantime is never
    // overwritten or undone. If the source's content or analysis changed, this
    // assessment describes a different document: reject instead of saving it.
    const result = await updateKnowledgeRecord(store, key, current => {
      if (current.content !== record.content || current.analysis?.generatedAt !== record.analysis?.generatedAt) {
        return { error: { status: 409, message: 'This source changed while it was being assessed. Please assess it again.' } };
      }
      return { record: { ...current, relevance, updatedAt: new Date().toISOString() } };
    });
    const failure = knowledgeUpdateFailure(result);
    if (failure) return reply(failure.status, { error: failure.error });
    const updated = result.record;
    const event = { id: crypto.randomUUID(), action: 'knowledge_relevance_assess', outcome: 'success', actorId: actor.id, actorEmail: actor.email, actorRoles: actor.roles, occurredAt: new Date().toISOString(), details: { knowledgeId: id, overall: relevance.overall, priority: relevance.priority, evidenceBasis: relevance.evidenceBasis, model } };
    await store.setJSON(`${prefix}/audit/${event.occurredAt}-${event.id}`, event);
    return reply(200, { source: updated });
  } catch (error) {
    console.error('knowledge-relevance failed', error);
    return reply(error?.status || 500, { error: error?.message || 'Relevance assessment failed.' });
  }
};
