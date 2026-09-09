// Source-grounded learner Coach follow-up for Company Knowledge assignments.
// Persists into the same private Coach Chat store used by pilot-data.mjs.

import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { getUser, verifyRequestOrigin } from '@netlify/identity';

const STORE_NAME = 'agentraining-pilot';
const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function reply(status, body) { return new Response(JSON.stringify(body), { status, headers: jsonHeaders }); }
function cleanText(value, max = 6000) { return String(value ?? '').trim().slice(0, max); }
function safeSegment(value, fallback) { const s = cleanText(value, 100).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, ''); return s || fallback; }
function normalizeEmail(value) { return cleanText(value, 254).toLowerCase(); }
function userContext(user) {
  const roles = Array.isArray(user.roles) ? user.roles : [];
  const metadata = user.appMetadata || {};
  return { id: cleanText(user.id, 100), email: normalizeEmail(user.email), roles, isManager: roles.includes('manager') || roles.includes('admin'), teamId: safeSegment(metadata.team_id, 'founding-pilot') };
}
function normalizeContent(text) {
  return String(text || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
function compactContent(text, max = 14000) {
  const t = normalizeContent(text);
  if (t.length <= max) return t;
  const head = Math.floor(max * .72), tail = max - head;
  return t.slice(0, head) + '\n\n[... middle section omitted ...]\n\n' + t.slice(-tail);
}
function terms(value) {
  const stop = new Set(['about','after','again','also','and','are','because','been','before','being','between','but','can','current','does','example','for','from','give','have','help','how','into','its','learner','me','more','my','practice','should','that','the','their','this','through','under','very','what','when','where','which','why','with','would','you','your']);
  return [...new Set(String(value || '').toLowerCase().match(/[a-z0-9]{3,}/g) || [])].filter(x => !stop.has(x)).slice(0,40);
}
function relevantContent(text, query, context = '', max = 14000) {
  const t = normalizeContent(text);
  if (t.length <= max) return t;
  const queryTerms = terms(`${query} ${context}`);
  const chunkSize = 2200;
  const overlap = 350;
  const chunks = [];
  for (let start = 0; start < t.length; start += chunkSize - overlap) {
    const chunk = t.slice(start, Math.min(t.length, start + chunkSize));
    const lower = chunk.toLowerCase();
    let score = 0;
    for (const term of queryTerms) {
      const hits = lower.split(term).length - 1;
      if (hits) score += Math.min(hits, 4);
    }
    chunks.push({ start, chunk, score });
    if (start + chunkSize >= t.length) break;
  }
  const selected = [];
  const seen = new Set();
  const add = item => { if (item && !seen.has(item.start)) { seen.add(item.start); selected.push(item); } };
  add(chunks[0]);
  chunks.slice().sort((a,b) => b.score - a.score || a.start - b.start).slice(0,5).forEach(add);
  const ordered = selected.sort((a,b) => a.start - b.start);
  let out = ordered.map(x => `[SOURCE EXCERPT @${x.start}]\n${x.chunk}`).join('\n\n');
  if (out.length > max) out = out.slice(0,max);
  return out || compactContent(t,max);
}
function coachMessage(role, content, assignmentId, knowledgeId) {
  return { id: crypto.randomUUID(), role, content: cleanText(content, 6000), createdAt: new Date().toISOString(), visibility: 'learner_only', assignmentContextId: assignmentId, sourceKnowledgeId: knowledgeId, groundedIn: 'company_knowledge' };
}
async function listJSON(store, prefix) {
  const { blobs } = await store.list({ prefix });
  const rows = await Promise.all(blobs.map(entry => store.get(entry.key, { type: 'json' })));
  return rows.filter(Boolean);
}
async function callClaude(apiKey, body) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type':'application/json', 'x-api-key':apiKey, 'anthropic-version':'2023-06-01' },
    body: JSON.stringify(body)
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload?.error?.message || 'AI request failed.');
  return payload?.content?.find(item => item.type === 'text')?.text || '';
}
function parseVerifier(text) {
  const raw = String(text || '').trim();
  try { return JSON.parse(raw); } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return { status:'AMBIGUOUS', reason:'Verifier returned invalid output.' };
}

export default async function handler(req) {
  try {
    if (req.method !== 'POST') return reply(405, { error: 'POST required.' });
    verifyRequestOrigin(req);
    const user = await getUser();
    if (!user) return reply(401, { error: 'Please sign in to continue.' });
    const actor = userContext(user);
    if (actor.isManager) return reply(403, { error: 'Private Coach Chat is available only to the learner.' });
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return reply(503, { error: 'AI is not configured.' });

    const input = await req.json().catch(() => ({}));
    const assignmentId = cleanText(input.assignmentId, 100);
    const message = cleanText(input.message, 6000);
    if (!assignmentId || !message) return reply(400, { error: 'assignmentId and message are required.' });

    const store = getStore({ name: STORE_NAME, consistency: 'strong' });
    const teamPrefix = `teams/${actor.teamId}`;
    const assignment = await store.get(`${teamPrefix}/assignments/${assignmentId}`, { type: 'json' });
    if (!assignment) return reply(404, { error: 'Assignment not found.' });
    if (normalizeEmail(assignment.assignedTo) !== actor.email) return reply(403, { error: 'This assignment belongs to another learner.' });
    if (assignment.sourceType !== 'company_knowledge' || !assignment.sourceKnowledgeId) return reply(400, { error: 'This assignment is not linked to Company Knowledge.' });

    const knowledgeId = cleanText(assignment.sourceKnowledgeId, 100);
    const record = await store.get(`${teamPrefix}/knowledge/${knowledgeId}`, { type: 'json' });
    if (!record) return reply(404, { error: 'Assigned source document not found.' });
    if (record.status !== 'approved') return reply(403, { error: 'Assigned source document is not approved for learner access.' });

    const prefix = `${teamPrefix}/private-coach/${safeSegment(actor.id, 'learner')}/`;
    const stored = await listJSON(store, prefix);
    const sourceHistory = stored
      .filter(item => item.assignmentContextId === assignmentId && item.groundedIn === 'company_knowledge')
      .sort((a,b) => String(a.createdAt).localeCompare(String(b.createdAt)))
      .slice(-8)
      .map(item => ({ role: item.role === 'assistant' ? 'assistant' : 'user', content: cleanText(item.content, 3000) }));

    const criteria = Array.isArray(assignment.customScenario?.successCriteria) ? assignment.customScenario.successCriteria.filter(Boolean).slice(0,8) : [];
    const retrievalContext = [assignment.scenarioName, assignment.customScenario?.objective, ...criteria].filter(Boolean).join(' ');
    const sourceExcerpt = relevantContent(record.content, message, retrievalContext, 14000);
    const sourceIntro = normalizeContent(record.content).slice(0,2200);
    const isLifeInsurance = /life insurance|banner life|william penn/i.test(`${record.title} ${sourceIntro}`);
    const domainRule = isLifeInsurance
      ? 'DOMAIN LOCK: This approved source is LIFE INSURANCE UNDERWRITING. Never reinterpret underwriting as bank lending, loans, lender credit decisions, borrower creditworthiness, or general credit-score underwriting unless the approved source explicitly discusses that exact point and the learner asks about it.'
      : 'DOMAIN LOCK: Stay inside the domain explicitly established by the approved source.';

    const system = [
      'You are the learner\'s Personal AI Coach for one current manager-assigned Company Knowledge Practice.',
      'Answer ONLY from the authorized source excerpts below and the assignment context.',
      domainRule,
      'Do not use unrelated prior Practice scores, empathy ratings, profile claims, or general insurance knowledge as factual support.',
      'This endpoint contains source-learning context, not current performance evidence. Do not assign a score or claim the learner performed well or poorly unless actual evidence from this specific assignment is explicitly supplied.',
      'If the current assignment is not completed, explain concepts and preparation steps without evaluating the learner.',
      'If the document does not support an answer, say that clearly. Do not invent, infer across industries, or repair missing facts.',
      'Treat short follow-ups such as How?, Why?, What does that mean?, or Give me an example as continuations of this current assignment.',
      'Use the language of the learner\'s message. Be practical and concise.',
      '',
      `ASSIGNMENT: ${cleanText(assignment.scenarioName, 300)}`,
      `ASSIGNMENT STATUS: ${cleanText(assignment.status, 80)}`,
      `OBJECTIVE: ${cleanText(assignment.customScenario?.objective, 1200)}`,
      criteria.length ? `SUCCESS CRITERIA:\n${criteria.map((x,i)=>`${i+1}) ${cleanText(x,500)}`).join('\n')}` : '',
      '',
      `SOURCE TITLE: ${cleanText(record.title, 300)}`,
      'AUTHORIZED SOURCE EXCERPTS:',
      '---',
      sourceExcerpt,
      '---',
      'For every factual claim, stay within this source. Fluency is not evidence.'
    ].filter(Boolean).join('\n');

    const text = await callClaude(apiKey, { model:'claude-sonnet-4-6', max_tokens:1200, system, messages:[...sourceHistory, { role:'user', content:message }] });
    if (!text) return reply(502, { error: 'AI returned no response. Please retry.' });

    const verifierSystem = [
      'You are a strict evidence verifier for an enterprise training system.',
      'Judge whether the CANDIDATE ANSWER is supported by the APPROVED SOURCE EXCERPTS for the learner question.',
      domainRule,
      'Use only these statuses: PASS, CONFLICT, UNSUPPORTED, AMBIGUOUS.',
      'PASS means every material factual claim is supported by or safely paraphrases the source.',
      'CONFLICT means any material claim contradicts the source or changes the domain.',
      'UNSUPPORTED means material claims are not established by the source.',
      'AMBIGUOUS means evidence is insufficient to decide.',
      'Return JSON only: {"status":"PASS|CONFLICT|UNSUPPORTED|AMBIGUOUS","reason":"brief reason"}.',
      '',
      `LEARNER QUESTION: ${message}`,
      `CANDIDATE ANSWER: ${text}`,
      'APPROVED SOURCE EXCERPTS:',
      '---',
      sourceExcerpt,
      '---'
    ].join('\n');
    const verifierRaw = await callClaude(apiKey, { model:'claude-sonnet-4-6', max_tokens:260, system:verifierSystem, messages:[{ role:'user', content:'Verify the candidate answer.' }] });
    const verdict = parseVerifier(verifierRaw);
    const status = String(verdict.status || '').toUpperCase();
    const safeText = status === 'PASS'
      ? text
      : `I can’t support that answer from the approved company source, so I won’t present it as authoritative. ${cleanText(verdict.reason, 500)}`.trim();

    const userMessage = coachMessage('user', message, assignmentId, knowledgeId);
    const assistantMessage = coachMessage('assistant', safeText, assignmentId, knowledgeId);
    assistantMessage.verification = { status: status || 'AMBIGUOUS', reason: cleanText(verdict.reason, 800) };
    await store.setJSON(`${prefix}${userMessage.createdAt}-${userMessage.id}`, userMessage, { onlyIfNew:true });
    await store.setJSON(`${prefix}${assistantMessage.createdAt}-${assistantMessage.id}`, assistantMessage, { onlyIfNew:true });

    return reply(201, { userMessage, assistantMessage, assignmentId, knowledgeId, sourceTitle: record.title, grounded: true, verification: assistantMessage.verification });
  } catch (error) {
    console.error('pilot-coach-source failed', error);
    return reply(error?.status || 500, { error: error?.message || 'Request failed.' });
  }
}
