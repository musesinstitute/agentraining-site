// Authenticated diagnostic for tracing a learner assignment to its Company Knowledge source.
// Returns metadata and a short content preview only; it never exposes another learner's assignment.

import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { getUser, verifyRequestOrigin } from '@netlify/identity';

const STORE_NAME = 'agentraining-pilot';
const headers = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const reply = (status, body) => new Response(JSON.stringify(body), { status, headers });
const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);
const normalizeEmail = value => clean(value, 254).toLowerCase();
const safeSegment = (value, fallback) => clean(value, 100).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || fallback;

function actorFrom(user) {
  const roles = Array.isArray(user.roles) ? user.roles : [];
  return {
    email: normalizeEmail(user.email),
    roles,
    isManager: roles.includes('manager') || roles.includes('admin'),
    teamId: safeSegment(user.appMetadata?.team_id, 'founding-pilot')
  };
}

function preview(text, max = 1800) {
  return String(text || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);
}

function fingerprint(text) {
  return crypto.createHash('sha256').update(String(text || ''), 'utf8').digest('hex');
}

export default async function handler(req) {
  try {
    if (req.method !== 'GET') return reply(405, { error: 'GET required.' });
    verifyRequestOrigin(req);
    const user = await getUser();
    if (!user) return reply(401, { error: 'Please sign in to continue.' });
    const actor = actorFrom(user);
    const url = new URL(req.url);
    const assignmentId = clean(url.searchParams.get('assignmentId'), 100);
    if (!assignmentId) return reply(400, { error: 'assignmentId is required.' });

    const store = getStore({ name: STORE_NAME, consistency: 'strong' });
    const teamPrefix = `teams/${actor.teamId}`;
    const assignment = await store.get(`${teamPrefix}/assignments/${assignmentId}`, { type: 'json' });
    if (!assignment) return reply(404, { error: 'Assignment not found.' });
    if (!actor.isManager && normalizeEmail(assignment.assignedTo) !== actor.email) return reply(403, { error: 'This assignment belongs to another learner.' });

    const knowledgeId = clean(assignment.sourceKnowledgeId, 100);
    if (assignment.sourceType !== 'company_knowledge' || !knowledgeId) return reply(400, { error: 'Assignment is not linked to Company Knowledge.' });
    const record = await store.get(`${teamPrefix}/knowledge/${knowledgeId}`, { type: 'json' });
    if (!record) return reply(404, { error: 'Linked Company Knowledge record not found.', assignmentId, sourceKnowledgeId: knowledgeId });

    const content = String(record.content || '');
    return reply(200, {
      trace: {
        assignmentId: clean(assignment.id, 100),
        assignmentName: clean(assignment.scenarioName, 300),
        assignedTo: normalizeEmail(assignment.assignedTo),
        sourceType: clean(assignment.sourceType, 80),
        sourceLabel: clean(assignment.sourceLabel, 240),
        sourceKnowledgeId: knowledgeId,
        knowledgeTitle: clean(record.title, 300),
        knowledgeStatus: clean(record.status, 80),
        contentLength: content.length,
        contentSha256: fingerprint(content),
        contentPreview: preview(content)
      }
    });
  } catch (error) {
    console.error('pilot-source-trace failed', error);
    return reply(error?.status || 500, { error: error?.message || 'Source trace failed.' });
  }
}
