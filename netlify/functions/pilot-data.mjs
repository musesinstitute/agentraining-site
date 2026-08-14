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

async function writeAudit(store, teamPrefix, actor, action, outcome, details = {}) {
  const event = {
    id: crypto.randomUUID(), action, outcome,
    actorId: actor.id, actorEmail: actor.email, actorRoles: actor.roles,
    occurredAt: new Date().toISOString(), details
  };
  await store.setJSON(`${teamPrefix}/audit/${event.occurredAt}-${event.id}`, event, { onlyIfNew: true });
}

function privateCoachPrefix(teamPrefix, actor) {
  return `${teamPrefix}/private-coach/${safeSegment(actor.id, 'learner')}/`;
}

function coachMessage(role, content) {
  return {
    id: crypto.randomUUID(), role,
    content: cleanText(content, 6000),
    createdAt: new Date().toISOString(),
    visibility: 'learner_only'
  };
}

function activeClaims(profile, type) {
  return (profile?.claims || []).filter(claim => claim.claimType === type && claim.status === 'active');
}

function initialCoachMessage(profile, assignments) {
  const name = cleanText(profile?.preferredName, 80) || 'there';
  const strength = activeClaims(profile, 'strength')[0];
  const growth = activeClaims(profile, 'growth_area')[0];
  const next = assignments.find(item => item.status !== 'Completed');
  let text = `Welcome, ${name}. From today forward, I will be your Personal AI Coach. I can help you practice, understand feedback, prepare for a client conversation, and choose the next skill to strengthen.`;
  if (strength || growth) {
    text += ' Based on your current Practice evidence:';
    if (strength) text += ` ${strength.statement}`;
    if (growth) text += ` ${growth.statement}`;
  } else {
    text += ' There is not yet enough Practice evidence to identify a reliable pattern.';
  }
  text += next
    ? ` Your next assigned action is “${next.scenarioName}.” Would you like a short preparation tip before you begin?`
    : ' What would make the biggest difference for you right now?';
  return coachMessage('assistant', text);
}

function fallbackCoachReply(profile, sessions, assignments) {
  const strength = activeClaims(profile, 'strength')[0];
  const growth = activeClaims(profile, 'growth_area')[0];
  const latest = sessions[0];
  const next = assignments.find(item => item.status !== 'Completed');
  const evidence = latest
    ? `Your latest Practice was “${latest.scenario}” on ${new Date(latest.savedAt).toLocaleDateString('en-US')} with an overall score of ${latest.scores?.overall || 0}/100.`
    : 'There is not yet enough completed Practice evidence to make a reliable assessment.';
  const insight = growth ? ` ${growth.statement}` : strength ? ` ${strength.statement}` : '';
  const action = next
    ? `Next action: open your assigned “${next.scenarioName}” Practice and focus on the assigned behavior.`
    : growth
      ? `Next action: complete one short Practice focused on ${growth.competency.replace(/_/g, ' ')}.`
      : 'Next action: complete one short Practice so I can coach from evidence.';
  return `${evidence}${insight} ${action}`;
}

function managerChatPrefix(teamPrefix, actor) {
  return `${teamPrefix}/manager-chat/${safeSegment(actor.id, 'manager')}/`;
}

function managerChatMessage(role, content, learnerEmail, extras = {}) {
  return {
    id: crypto.randomUUID(), role, content: cleanText(content, 6000),
    learnerEmail: normalizeEmail(learnerEmail), createdAt: new Date().toISOString(),
    visibility: 'manager_work_intelligence', ...extras
  };
}

function assignmentEventMessage(event, audience) {
  const content = audience === 'manager'
    ? event.managerContent
    : event.learnerContent;
  return {
    id: `assignment-event-${event.id}-${audience}`,
    role: 'assistant', content, learnerEmail: event.assignedTo,
    createdAt: event.createdAt, visibility: audience === 'manager' ? 'manager_work_intelligence' : 'learner_only',
    assignmentEvent: true, assignmentId: event.assignmentId, eventType: event.type,
    evidenceIds: event.evidenceIds || []
  };
}

async function writeAssignmentEvent(store, teamPrefix, input) {
  const event = {
    id: `${cleanText(input.assignmentId, 100)}-${cleanText(input.type, 40)}`,
    assignmentId: cleanText(input.assignmentId, 100), type: cleanText(input.type, 40),
    assignedTo: normalizeEmail(input.assignedTo), learner: cleanText(input.learner, 120),
    scenarioId: cleanText(input.scenarioId, 120), scenarioName: cleanText(input.scenarioName, 300),
    createdAt: input.createdAt || new Date().toISOString(), score: Number(input.score) || 0,
    sessionId: cleanText(input.sessionId, 100), evidenceIds: Array.isArray(input.evidenceIds) ? input.evidenceIds.slice(0, 20) : [],
    learnerContent: cleanText(input.learnerContent, 6000), managerContent: cleanText(input.managerContent, 6000)
  };
  await store.setJSON(`${teamPrefix}/assignment-events/${event.id}`, event);
  return event;
}

function sessionEvidence(profile, sessions) {
  const byId = new Map(sessions.map(session => [session.id, session]));
  const rows = [];
  for (const claim of (profile?.claims || []).filter(item => item.status === 'active' && item.visibility === 'manager_summary')) {
    for (const ref of (claim.evidenceRefs || []).slice(-3)) {
      const session = byId.get(ref.sessionId);
      const excerptTurn = (session?.transcript || []).find(turn => turn.speaker === 'agent');
      rows.push({
        evidenceId: ref.evidenceId, sessionId: ref.sessionId,
        activity: ref.scenario || session?.scenario || 'Practice', date: ref.observedAt || session?.savedAt,
        competency: claim.competency, claimType: claim.claimType, score: ref.score,
        overall: ref.overall, transcriptExcerpt: cleanText(excerptTurn?.text || session?.summary, 500),
        sourceLink: `learner-profile.html?pilot=1&learner=${encodeURIComponent(profile.learnerEmail)}#${encodeURIComponent(claim.claimId)}`,
        confidence: claim.confidence?.level || 'low',
        limitations: (claim.evidenceRefs || []).length < 2 ? 'Based on one Practice session; not a durable trait.' : 'Based only on recent recorded Practice evidence.'
      });
    }
  }
  const unique = new Map(rows.map(row => [`${row.evidenceId}-${row.competency}-${row.claimType}`, row]));
  return [...unique.values()].sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 8);
}

function managerIntelligence(profile, sessions, assignments, question) {
  const claims = (profile?.claims || []).filter(item => item.status === 'active' && item.visibility === 'manager_summary');
  const strength = claims.find(item => item.claimType === 'strength');
  const growth = claims.find(item => item.claimType === 'growth_area');
  const evidence = sessionEvidence(profile, sessions);
  const latest = sessions[0];
  const activeAssignment = assignments.find(item => item.status !== 'Completed');
  if (!latest || !claims.length) {
    return {
      content: `There is not enough recorded Practice evidence to assess ${profile?.preferredName || profile?.learnerEmail || 'this learner'} reliably. No strength or weakness should be inferred yet. Next step: assign one short, job-relevant Practice and review the resulting transcript.`,
      evidence, assignmentDraft: null
    };
  }
  const focus = growth?.competency || 'closing';
  const content = [
    `${profile.preferredName || profile.learnerEmail} has ${sessions.length} recorded Practice session${sessions.length === 1 ? '' : 's'}. The latest was “${latest.scenario}” with an overall score of ${latest.scores?.overall || 0}/100.`,
    strength ? `Evidence-backed strength: ${strength.statement}` : '',
    growth ? `Evidence-backed growth area: ${growth.statement}` : '',
    `Manager interpretation: use this as coaching evidence, not as a fixed personality judgment. ${growth?.confidence?.level === 'low' ? 'Confidence is low because the current pattern is based on limited evidence.' : `Current confidence is ${growth?.confidence?.level || 'low'}.`}`,
    activeAssignment ? `An active assignment already exists: “${activeAssignment.scenarioName}” (${activeAssignment.status}).` : `Recommended next step: assign one targeted Practice focused on ${focus.replace(/_/g, ' ')}.`
  ].filter(Boolean).join('\n\n');
  return {
    content, evidence,
    assignmentDraft: activeAssignment ? null : {
      learner: profile.preferredName || profile.learnerEmail,
      assignedTo: profile.learnerEmail, focusCompetency: focus,
      rationale: growth?.statement || `Build additional evidence for ${focus.replace(/_/g, ' ')}.`,
      mode: 'quick'
    }
  };
}

async function generateCoachReply(profile, sessions, assignments, history, learnerMessage) {
  const text = cleanText(learnerMessage, 6000).toLowerCase();
  const latest = sessions[0];
  const strength = activeClaims(profile, 'strength')[0];
  const growth = activeClaims(profile, 'growth_area')[0];
  const next = assignments.find(item => item.status !== 'Completed');
  const evidence = latest
    ? `Evidence: in your latest “${latest.scenario}” Practice, your overall score was ${latest.scores?.overall || 0}/100${latest.summary ? `, and the Coach Summary recorded: ${latest.summary}` : '.'}`
    : 'Evidence: there is not yet a completed Practice session available for a reliable assessment.';
  let coaching;
  if (/result|score|feedback|explain|summary|结果|分数|反馈|解释|总结/.test(text)) {
    coaching = growth
      ? `Interpretation: ${growth.statement} This is a current evidence-based coaching claim, not a fixed personal trait.`
      : strength
        ? `Interpretation: ${strength.statement} This describes the available Practice evidence, not a fixed personal trait.`
        : 'Interpretation: more Practice evidence is needed before identifying a stable pattern.';
  } else if (/prepare|assignment|准备|作业|指派/.test(text)) {
    coaching = next
      ? `Preparation: for “${next.scenarioName},” choose one clear objective, ask one open question, and end with a specific next step.`
      : 'Preparation: choose one conversation objective, ask an open question, and end with a specific next step.';
  } else {
    coaching = growth
      ? `Coaching focus: ${growth.statement}`
      : strength
        ? `Coaching focus: build on this evidence—${strength.statement}`
        : 'Coaching focus: complete a short Practice so your guidance can be grounded in observable evidence.';
  }
  const action = next
    ? `Next action: open your assigned “${next.scenarioName}” Practice and focus on that one behavior.`
    : growth
      ? `Next action: complete one short Practice focused on ${growth.competency.replace(/_/g, ' ')}.`
      : 'Next action: complete one short Practice, then return here for an evidence-linked explanation.';
  return `${evidence}\n\n${coaching}\n\n${action}`;
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
      if (!actor.isManager) {
        await writeAudit(store, teamPrefix, actor, 'assignment_create', 'denied', { reason: 'manager_role_required' });
        return reply(403, { error: 'Manager access is required.' });
      }
      const input = await req.json();
      const record = assignmentRecord(input, actor);
      if (!record.assignedTo || !record.scenarioId || !record.scenarioName) return reply(400, { error: 'Learner email and curriculum scenario are required.' });
      await store.setJSON(`${teamPrefix}/assignments/${record.id}`, record, { onlyIfNew: true });
      await writeAssignmentEvent(store, teamPrefix, {
        assignmentId: record.id, type: 'assigned', assignedTo: record.assignedTo,
        learner: record.learner, scenarioId: record.scenarioId, scenarioName: record.scenarioName,
        createdAt: record.createdAt,
        learnerContent: `Your manager assigned “${record.scenarioName}” (${record.mode} Practice). It is ready in your Assignment Inbox.`,
        managerContent: `Assignment confirmed: “${record.scenarioName}” was sent to ${record.learner || record.assignedTo}. The learner can now launch it from Coach Chat or the Assignment Inbox.`
      });
      await writeAudit(store, teamPrefix, actor, 'assignment_create', 'success', {
        assignmentId: record.id, assignedTo: record.assignedTo, scenarioId: record.scenarioId
      });
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
      if (record.assignmentId) {
        const assignmentKey = `${teamPrefix}/assignments/${record.assignmentId}`;
        const assignment = await store.get(assignmentKey, { type: 'json' });
        if (assignment && normalizeEmail(assignment.assignedTo) === actor.email) {
          const completed = {
            ...assignment, status: 'Completed', completedAt: new Date().toISOString(),
            score: record.scores.overall, transcript: record.transcript,
            resultSessionId: record.id, resultProfileId: profile.profileId
          };
          await store.setJSON(assignmentKey, completed);
          const sessionClaims = (profile.claims || []).filter(claim =>
            claim.status === 'active' && (claim.evidenceRefs || []).some(ref => ref.sessionId === record.id));
          const strength = sessionClaims.find(claim => claim.claimType === 'strength');
          const growth = sessionClaims.find(claim => claim.claimType === 'growth_area');
          const evidenceIds = sessionClaims.flatMap(claim => (claim.evidenceRefs || [])
            .filter(ref => ref.sessionId === record.id).map(ref => ref.evidenceId));
          await writeAssignmentEvent(store, teamPrefix, {
            assignmentId: assignment.id, type: 'completed', assignedTo: assignment.assignedTo,
            learner: assignment.learner || record.learnerName, scenarioId: assignment.scenarioId,
            scenarioName: assignment.scenarioName || record.scenario, score: record.scores.overall,
            sessionId: record.id, evidenceIds,
            learnerContent: `You completed “${assignment.scenarioName || record.scenario}” with an overall score of ${record.scores.overall}/100.${strength ? ` Current evidence: ${strength.statement}` : ''}${growth ? ` Next coaching focus: ${growth.statement}` : ''}`,
            managerContent: `${assignment.learner || record.learnerName} completed “${assignment.scenarioName || record.scenario}” with an overall score of ${record.scores.overall}/100.${strength ? ` Evidence-backed strength: ${strength.statement}` : ''}${growth ? ` Evidence-backed growth area: ${growth.statement}` : ''} The transcript, rubric result, and evidence are now available for follow-up coaching.`
          });
          await writeAudit(store, teamPrefix, actor, 'assignment_complete', 'success', {
            assignmentId: assignment.id, sessionId: record.id, evidenceIds
          });
        }
      }
      return reply(201, { session: record, profile });
    }

    if (req.method === 'GET' && resource === 'sessions') {
      const rows = await listJSON(store, `${teamPrefix}/sessions/`);
      const visible = actor.isManager ? rows : rows.filter(row => row.userId === actor.id);
      visible.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
      return reply(200, { sessions: visible });
    }

    if (req.method === 'GET' && resource === 'manager-chat') {
      if (!actor.isManager) {
        await writeAudit(store, teamPrefix, actor, 'manager_chat_read', 'denied', { reason: 'manager_role_required' });
        return reply(403, { error: 'Manager access is required.' });
      }
      const requested = normalizeEmail(url.searchParams.get('learner'));
      await backfillProfiles(store, teamPrefix, actor, requested);
      const profiles = await listJSON(store, `${teamPrefix}/profiles/`);
      profiles.sort((a, b) => String(a.preferredName || a.learnerEmail).localeCompare(String(b.preferredName || b.learnerEmail)));
      const stored = await listJSON(store, managerChatPrefix(teamPrefix, actor));
      const events = requested
        ? (await listJSON(store, `${teamPrefix}/assignment-events/`))
          .filter(event => normalizeEmail(event.assignedTo) === requested)
          .map(event => assignmentEventMessage(event, 'manager'))
        : [];
      const messages = requested
        ? [...stored.filter(item => normalizeEmail(item.learnerEmail) === requested), ...events]
        : [];
      messages.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      await writeAudit(store, teamPrefix, actor, 'manager_chat_roster', 'success', { requestedLearner: requested, resultCount: profiles.length });
      return reply(200, {
        profiles: profiles.map(profile => ({
          learnerEmail: profile.learnerEmail, preferredName: profile.preferredName,
          updatedAt: profile.updatedAt, claimCount: (profile.claims || []).filter(item => item.status === 'active').length
        })),
        messages,
        privacy: 'Manager Chat uses authorized work-related Practice evidence. Private Learner Coach Chat is never included.'
      });
    }

    if (req.method === 'POST' && resource === 'manager-chat') {
      verifyRequestOrigin(req);
      if (!actor.isManager) {
        await writeAudit(store, teamPrefix, actor, 'manager_chat_query', 'denied', { reason: 'manager_role_required' });
        return reply(403, { error: 'Manager access is required.' });
      }
      const input = await req.json();
      const learnerEmail = normalizeEmail(input.learnerEmail);
      const question = cleanText(input.content, 6000);
      if (!learnerEmail || !question) return reply(400, { error: 'Select a learner and enter a question.' });
      await backfillProfiles(store, teamPrefix, actor, learnerEmail);
      const profiles = await listJSON(store, `${teamPrefix}/profiles/`);
      const profile = profiles.find(item => normalizeEmail(item.learnerEmail) === learnerEmail);
      if (!profile) {
        await writeAudit(store, teamPrefix, actor, 'manager_chat_query', 'not_found', { learnerEmail });
        return reply(404, { error: 'No authorized Practice profile was found for this learner.' });
      }
      const sessions = (await listJSON(store, `${teamPrefix}/sessions/`)).filter(item => normalizeEmail(item.learner) === learnerEmail);
      sessions.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
      const assignments = (await listJSON(store, `${teamPrefix}/assignments/`)).filter(item => normalizeEmail(item.assignedTo) === learnerEmail);
      assignments.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const result = managerIntelligence(profile, sessions, assignments, question);
      const prefix = managerChatPrefix(teamPrefix, actor);
      const managerMessage = managerChatMessage('user', question, learnerEmail);
      const assistantMessage = managerChatMessage('assistant', result.content, learnerEmail, {
        evidenceIds: result.evidence.map(item => item.evidenceId), assignmentDraft: result.assignmentDraft
      });
      await store.setJSON(`${prefix}${managerMessage.createdAt}-${managerMessage.id}`, managerMessage, { onlyIfNew: true });
      await store.setJSON(`${prefix}${assistantMessage.createdAt}-${assistantMessage.id}`, assistantMessage, { onlyIfNew: true });
      await writeAudit(store, teamPrefix, actor, 'manager_chat_query', 'success', {
        learnerEmail, evidenceIds: result.evidence.map(item => item.evidenceId), assignmentDrafted: Boolean(result.assignmentDraft)
      });
      return reply(201, {
        managerMessage, assistantMessage, evidence: result.evidence,
        assignmentDraft: result.assignmentDraft,
        privacy: 'No private Learner Coach Chat content was accessed or included.'
      });
    }

    if (req.method === 'GET' && resource === 'coach-messages') {
      if (actor.isManager) {
        await writeAudit(store, teamPrefix, actor, 'private_coach_read', 'denied', { reason: 'learner_only' });
        return reply(403, { error: 'Private Coach Chat is available only to the learner.' });
      }
      await backfillProfiles(store, teamPrefix, actor, '');
      const profiles = await listJSON(store, `${teamPrefix}/profiles/`);
      const profile = profiles.find(row => row.learnerId === actor.id) || null;
      const sessions = (await listJSON(store, `${teamPrefix}/sessions/`)).filter(row => row.userId === actor.id);
      sessions.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
      const assignments = (await listJSON(store, `${teamPrefix}/assignments/`)).filter(row => normalizeEmail(row.assignedTo) === actor.email);
      assignments.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const stored = await listJSON(store, privateCoachPrefix(teamPrefix, actor));
      const events = (await listJSON(store, `${teamPrefix}/assignment-events/`))
        .filter(event => normalizeEmail(event.assignedTo) === actor.email)
        .map(event => assignmentEventMessage(event, 'learner'));
      const messages = [...(stored.length ? stored : [initialCoachMessage(profile, assignments)]), ...events];
      messages.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      return reply(200, {
        messages, profile, assignments,
        privacy: 'Private Coach Chat is learner-only. Managers receive authorized work evidence, not this conversation.'
      });
    }

    if (req.method === 'POST' && resource === 'coach-messages') {
      verifyRequestOrigin(req);
      if (actor.isManager) {
        await writeAudit(store, teamPrefix, actor, 'private_coach_write', 'denied', { reason: 'learner_only' });
        return reply(403, { error: 'Private Coach Chat is available only to the learner.' });
      }
      const input = await req.json();
      const content = cleanText(input.content, 6000);
      if (!content) return reply(400, { error: 'Please enter a message.' });
      const prefix = privateCoachPrefix(teamPrefix, actor);
      const learnerMessage = coachMessage('user', content);
      await store.setJSON(`${prefix}${learnerMessage.createdAt}-${learnerMessage.id}`, learnerMessage, { onlyIfNew: true });

      await backfillProfiles(store, teamPrefix, actor, '');
      const profiles = await listJSON(store, `${teamPrefix}/profiles/`);
      const profile = profiles.find(row => row.learnerId === actor.id) || null;
      const sessions = (await listJSON(store, `${teamPrefix}/sessions/`)).filter(row => row.userId === actor.id);
      sessions.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
      const assignments = (await listJSON(store, `${teamPrefix}/assignments/`)).filter(row => normalizeEmail(row.assignedTo) === actor.email);
      assignments.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const history = await listJSON(store, prefix);
      history.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      const replyText = await generateCoachReply(profile, sessions, assignments, history, content);
      const assistantMessage = coachMessage('assistant', replyText);
      await store.setJSON(`${prefix}${assistantMessage.createdAt}-${assistantMessage.id}`, assistantMessage, { onlyIfNew: true });
      await writeAudit(store, teamPrefix, actor, 'private_coach_message', 'success', { evidenceSessionId: profile?.latestSessionId || '' });
      return reply(201, { userMessage: learnerMessage, assistantMessage });
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
