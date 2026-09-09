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
function compactContent(text, max = 14000) {
  const t = String(text || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  if (t.length <= max) return t;
  const head = Math.floor(max * .72), tail = max - head;
  return t.slice(0, head) + '\n\n[... middle section omitted ...]\n\n' + t.slice(-tail);
}
function coachMessage(role, content, assignmentId, knowledgeId) {
  return { id: crypto.randomUUID(), role, content: cleanText(content, 6000), createdAt: new Date().toISOString(), visibility: 'learner_only', assignmentContextId: assignmentId, sourceKnowledgeId: knowledgeId, groundedIn: 'company_knowledge' };
}
async function listJSON(store, prefix) {
  const { blobs } = await store.list({ prefix });
  const rows = await Promise.all(blobs.map(entry => store.get(entry.key, { type: 'json' })));
  return rows.filter(Boolean);
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
    const system = [
      'You are the learner\'s Personal AI Coach for one current manager-assigned Company Knowledge Practice.',
      'Answer ONLY from the authorized source document below and the assignment context.',
      'Do not use unrelated prior Practice scores, empathy ratings, profile claims, or general insurance knowledge as factual support.',
      'If the document does not support an answer, say that clearly. Do not invent or repair missing facts.',
      'Treat short follow-ups such as How?, Why?, What does that mean?, or Give me an example as continuations of this current assignment.',
      'Use the language of the learner\'s message. Be practical and concise.',
      '',
      `ASSIGNMENT: ${cleanText(assignment.scenarioName, 300)}`,
      `OBJECTIVE: ${cleanText(assignment.customScenario?.objective, 1200)}`,
      criteria.length ? `SUCCESS CRITERIA:\n${criteria.map((x,i)=>`${i+1}) ${cleanText(x,500)}`).join('\n')}` : '',
      '',
      `SOURCE TITLE: ${cleanText(record.title, 300)}`,
      'SOURCE CONTENT:',
      '---',
      compactContent(record.content, 14000),
      '---',
      'For factual claims, stay within this source.'
    ].filter(Boolean).join('\n');

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type':'application/json', 'x-api-key':apiKey, 'anthropic-version':'2023-06-01' },
      body: JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:1200, system, messages:[...sourceHistory, { role:'user', content:message }] })
    });
    const payload = await response.json();
    if (!response.ok) return reply(502, { error: payload?.error?.message || 'AI request failed.' });
    const text = payload?.content?.find(item => item.type === 'text')?.text || '';
    if (!text) return reply(502, { error: 'AI returned no response. Please retry.' });

    const userMessage = coachMessage('user', message, assignmentId, knowledgeId);
    const assistantMessage = coachMessage('assistant', text, assignmentId, knowledgeId);
    await store.setJSON(`${prefix}${userMessage.createdAt}-${userMessage.id}`, userMessage, { onlyIfNew:true });
    await store.setJSON(`${prefix}${assistantMessage.createdAt}-${assistantMessage.id}`, assistantMessage, { onlyIfNew:true });

    return reply(201, { userMessage, assistantMessage, assignmentId, knowledgeId, sourceTitle: record.title, grounded: true });
  } catch (error) {
    console.error('pilot-coach-source failed', error);
    return reply(error?.status || 500, { error: error?.message || 'Request failed.' });
  }
}
