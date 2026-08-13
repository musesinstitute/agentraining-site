import { getStore } from '@netlify/blobs';
import { getUser, verifyRequestOrigin } from '@netlify/identity';

const STORE_NAME = 'agentraining-pilot';
const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const COMPETENCIES = [
  { key: 'empathy', label: 'Empathy and trust-building' },
  { key: 'accuracy', label: 'Knowledge and explanation' },
  { key: 'closing', label: 'Next-step confirmation' }
];

function reply(status, body) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function cleanText(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizeEmail(value) {
  return cleanText(value, 254).toLowerCase();
}

function safeSegment(value, fallback) {
  const segment = cleanText(value, 100).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return segment || fallback;
}

function userContext(user) {
  const roles = Array.isArray(user.roles) ? user.roles : [];
  const metadata = user.appMetadata || {};
  return {
    id: cleanText(user.id, 100),
    email: normalizeEmail(user.email),
    roles,
    isManager: roles.includes('manager') || roles.includes('admin'),
    teamId: safeSegment(metadata.team_id, 'founding-pilot')
  };
}

function assignmentRecord(input, actor) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(), teamId: actor.teamId,
    learner: cleanText(input.learner, 120),
    assignedTo: normalizeEmail(input.assignedTo || input.learner),
    scenarioId: cleanText(input.scenarioId, 120),
    scenarioName: cleanText(input.scenarioName, 300),
    mode: ['quick', 'standard', 'full'].includes(input.mode) ? input.mode : 'standard',
    dueDate: cleanText(input.dueDate, 20), status: 'Assigned',
    createdAt: now, createdBy: actor.email
  };
}

function sessionRecord(input, actor) {
  const scores = input.scores || {};
  const transcript = Array.isArray(input.transcript) ? input.transcript.slice(0, 100).map((turn, index) => ({
    index: index + 1,
    speaker: turn?.speaker === 'agent' ? 'agent' : 'client',
    text: cleanText(turn?.text, 5000)
  })) : [];
  return {
    id: crypto.randomUUID(), teamId: actor.teamId, userId: actor.id,
    learner: actor.email,
    learnerName: cleanText(input.learner || input.name || actor.email, 120),
    savedAt: new Date().toISOString(), assignmentId: cleanText(input.assignmentId, 100),
    practiceMode: ['quick', 'standard', 'full'].includes(input.practiceMode) ? input.practiceMode : 'full',
    scenario: cleanText(input.scenario, 300), industry: cleanText(input.industry, 80),
    lang: input.lang === 'zh' ? 'zh' : 'en',
    rubricVersion: cleanText(input.rubricVersion, 40) || 'practice-v1',
    scores: {
      overall: Number(scores.overall) || 0,
      empathy: Number(scores.empathy) || 0,
      accuracy: Number(scores.accuracy) || 0,
      closing: Number(scores.closing) || 0
    },
    strengths: Array.isArray(input.strengths) ? input.strengths.slice(0, 10).map(x => cleanText(x, 500)) : [],
    tips: Array.isArray(input.tips) ? input.tips.slice(0, 10).map(x => cleanText(x, 500)) : [],
    summary: cleanText(input.summary, 5000), transcript,
    sourceType: cleanText(input.sourceType, 80), sourceLabel: cleanText(input.sourceLabel, 120),
    aiClientName: cleanText(input.aiClientName, 120), linkedCaseId: cleanText(input.linkedCaseId, 100),
    clientCaseName: cleanText(input.clientCaseName, 120)
  };
}

function confidenceFor(count) {
  if (count >= 3) return { level: 'high', score: 0.86 };
  if (count === 2) return { level: 'medium', score: 0.68 };
  return { level: 'low', score: 0.45 };
}

function claimStatement(type, label, score, count) {
  if (count >= 3) return type === 'strength'
    ? `Recent evidence consistently shows ${label.toLowerCase()} as a demonstrated strength.`
    : `Recent evidence consistently shows ${label.toLowerCase()} as a growth area.`;
  if (count === 2) return type === 'strength'
    ? `A developing pattern suggests strength in ${label.toLowerCase()}.`
    : `A developing pattern suggests an opportunity to improve ${label.toLowerCase()}.`;
  return type === 'strength'
    ? `In this session, ${label.toLowerCase()} was the strongest demonstrated area (${score}/100).`
    : `In this session, ${label.toLowerCase()} was the clearest growth area (${score}/100).`;
}

function upsertClaim(claims, type, competency, session) {
  const id = `${type}-${competency.key}`;
  const existing = claims.find(x => x.claimId === id && x.status !== 'disputed');
  const evidence = {
    evidenceId: `practice-${session.id}`,
    type: 'practice', sessionId: session.id, scenario: session.scenario,
    observedAt: session.savedAt, score: session.scores[competency.key],
    overall: session.scores.overall, rubricVersion: session.rubricVersion
  };
  const priorRefs = Array.isArray(existing?.evidenceRefs) ? existing.evidenceRefs : [];
  const evidenceRefs = [...priorRefs.filter(x => x.sessionId !== session.id), evidence].slice(-5);
  const confidence = confidenceFor(evidenceRefs.length);
  const claim = {
    claimId: id, claimType: type, competency: competency.key,
    statement: claimStatement(type, competency.label, session.scores[competency.key], evidenceRefs.length),
    evidenceRefs, confidence, observedAt: session.savedAt,
    validUntil: new Date(Date.parse(session.savedAt) + 90 * 86400000).toISOString(),
    visibility: 'manager_summary', status: 'active', generatedBy: 'learner-intelligence-rules-v1'
  };
  return [...claims.filter(x => x.claimId !== id), claim];
}

async function updateLearnerProfile(store, teamPrefix, actor, session) {
  const profileKey = `${teamPrefix}/profiles/${safeSegment(actor.id, 'learner')}`;
  const current = await store.get(profileKey, { type: 'json' });
  const ranked = [...COMPETENCIES].sort((a, b) => session.scores[b.key] - session.scores[a.key]);
  let claims = Array.isArray(current?.claims) ? current.claims : [];
  claims = upsertClaim(claims, 'strength', ranked[0], session);
  claims = upsertClaim(claims, 'growth_area', ranked[ranked.length - 1], session);
  const profile = {
    profileId: current?.profileId || crypto.randomUUID(),
    teamId: actor.teamId, learnerId: actor.id, learnerEmail: actor.email,
    preferredName: current?.preferredName || session.learnerName || actor.email,
    background: { ...(current?.background || {}), language: session.lang },
    goals: Array.isArray(current?.goals) ? current.goals : [],
    claims, latestSessionId: session.id, updatedAt: session.savedAt,
    schemaVersion: 'learner-success-profile-v1'
  };
  await store.setJSON(profileKey, profile);
  return profile;
}

async function listJSON(store, prefix) {
  const { blobs } = await store.list({ prefix });
  const rows = await Promise.all(blobs.map(entry => store.get(entry.key, { type: 'json' })));
  return rows.filter(Boolean);
}

async function backfillProfiles(store, teamPrefix, actor, requestedEmail) {
  const sessions = await listJSON(store, `${teamPrefix}/sessions/`);
  const eligible = sessions.filter(session => actor.isManager
    ? (!requestedEmail || normalizeEmail(session.learner) === requestedEmail)
    : session.userId === actor.id);
  eligible.sort((a, b) => String(a.savedAt).localeCompare(String(b.savedAt)));
  for (const session of eligible) {
    await updateLearnerProfile(store, teamPrefix, {
      id: session.userId,
      email: normalizeEmail(session.learner),
      teamId: actor.teamId
    }, session);
  }
}

export default async function handler(req) {
  try {
    const user = await getUser();
    if (!user) return reply(401, { error: 'Please sign in to continue.' });
    const actor = userContext(user);
    const url = new URL(req.url);
    const resource = url.searchParams.get('resource');
    const store = getStore({ name: STORE_NAME, consistency: 'strong' });
    const teamPrefix = `teams/${actor.teamId}`;

    if (req.method === 'GET' && resource === 'me') return reply(200, { email: actor.email, roles: actor.roles, teamId: actor.teamId });

    if (req.method === 'GET' && resource === 'assignments') {
      const rows = await listJSON(store, `${teamPrefix}/assignments/`);
      const visible = actor.isManager ? rows : rows.filter(row => normalizeEmail(row.assignedTo) === actor.email);
      visible.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return reply(200, { assignments: visible });
    }

    if (req.method === 'POST' && resource === 'assignments') {
      verifyRequestOrigin(req);
      if (!actor.isManager) return reply(403, { error: 'Manager access is required.' });
      const input = await req.json();
      const record = assignmentRecord(input, actor);
      if (!record.assignedTo || !record.scenarioId || !record.scenarioName) return reply(400, { error: 'Learner email and curriculum scenario are required.' });
      await store.setJSON(`${teamPrefix}/assignments/${record.id}`, record, { onlyIfNew: true });
      return reply(201, { assignment: record });
    }

    if (req.method === 'PATCH' && resource === 'assignments') {
      verifyRequestOrigin(req);
      const input = await req.json();
      const id = cleanText(input.id, 100);
      if (!id) return reply(400, { error: 'Assignment id is required.' });
      const key = `${teamPrefix}/assignments/${id}`;
      const record = await store.get(key, { type: 'json' });
      if (!record) return reply(404, { error: 'Assignment not found.' });
      if (!actor.isManager && normalizeEmail(record.assignedTo) !== actor.email) return reply(403, { error: 'This assignment belongs to another learner.' });
      const status = ['Assigned', 'In Progress', 'Completed'].includes(input.status) ? input.status : record.status;
      const updated = { ...record, status,
        startedAt: status === 'In Progress' ? (record.startedAt || new Date().toISOString()) : record.startedAt,
        completedAt: status === 'Completed' ? new Date().toISOString() : record.completedAt,
        score: status === 'Completed' ? (Number(input.score) || 0) : record.score,
        transcript: status === 'Completed' && Array.isArray(input.transcript)
          ? input.transcript.slice(0, 100).map((turn, index) => ({ index: index + 1, speaker: turn?.speaker === 'agent' ? 'agent' : 'client', text: cleanText(turn?.text, 5000) }))
          : record.transcript };
      await store.setJSON(key, updated);
      return reply(200, { assignment: updated });
    }

    if (req.method === 'POST' && resource === 'sessions') {
      verifyRequestOrigin(req);
      const input = await req.json();
      const record = sessionRecord(input, actor);
      await store.setJSON(`${teamPrefix}/sessions/${record.id}`, record, { onlyIfNew: true });
      const profile = await updateLearnerProfile(store, teamPrefix, actor, record);
      return reply(201, { session: record, profile });
    }

    if (req.method === 'GET' && resource === 'sessions') {
      const rows = await listJSON(store, `${teamPrefix}/sessions/`);
      const visible = actor.isManager ? rows : rows.filter(row => row.userId === actor.id);
      visible.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
      return reply(200, { sessions: visible });
    }

    if (req.method === 'GET' && resource === 'profiles') {
      const requested = normalizeEmail(url.searchParams.get('learner'));
      await backfillProfiles(store, teamPrefix, actor, requested);
      const rows = await listJSON(store, `${teamPrefix}/profiles/`);
      const visible = actor.isManager
        ? (requested ? rows.filter(row => normalizeEmail(row.learnerEmail) === requested) : rows)
        : rows.filter(row => row.learnerId === actor.id);
      visible.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      return reply(200, { profiles: visible });
    }

    if (req.method === 'PATCH' && resource === 'profiles') {
      verifyRequestOrigin(req);
      const input = await req.json();
      const profileKey = `${teamPrefix}/profiles/${safeSegment(actor.id, 'learner')}`;
      const profile = await store.get(profileKey, { type: 'json' });
      if (!profile) return reply(404, { error: 'Learner profile not found.' });
      const claimId = cleanText(input.claimId, 100);
      const claims = (profile.claims || []).map(claim => claim.claimId === claimId
        ? { ...claim, status: 'disputed', disputedAt: new Date().toISOString(), disputeNote: cleanText(input.note, 1000) }
        : claim);
      const updated = { ...profile, claims, updatedAt: new Date().toISOString() };
      await store.setJSON(profileKey, updated);
      return reply(200, { profile: updated });
    }

    return reply(404, { error: 'Unknown pilot data operation.' });
  } catch (error) {
    console.error('pilot-data failed', error);
    return reply(error?.status || 500, { error: error?.message || 'Pilot data request failed.' });
  }
}
