// Tests for Team Growth Phase 2: the manager intervention loop
// (Signal -> Manager Action -> Assignment -> Practice Completion -> Manager
// sees the result) and roster joinedAt.
//
// Run with: npm test
// (node --import ./tests/register.mjs --test tests/*.test.mjs)
//
// Pure rules are tested against netlify/functions/lib/team-growth.mjs; the
// endpoints run against the in-memory @netlify/blobs / @netlify/identity
// stubs (see tests/loader.mjs) - no real Netlify, Resend, or AI call is made.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { computeTeamGrowth } from '../netlify/functions/lib/team-growth.mjs';
import pilotData from '../netlify/functions/pilot-data.mjs';
import pilotRoster from '../netlify/functions/pilot-roster.mjs';
import pilotInvite from '../netlify/functions/pilot-invite.mjs';
import { __setUser, __resetIdentityStub } from '../tests/stubs/netlify-identity.mjs';
import { __resetAllStores, getStore } from '../tests/stubs/netlify-blobs.mjs';

const NOW = '2026-09-23T12:00:00.000Z';
const DAY = 86400000;
const daysAgo = n => new Date(Date.parse(NOW) - n * DAY).toISOString();

const A = 'a@example.com';
const B = 'b@example.com';

let seq = 0;
function session(learner, savedAt, scenario, overall, extra = {}) {
  seq += 1;
  return { id: `s-${seq}`, learner, learnerName: learner.split('@')[0], savedAt, scenario, scores: { overall }, ...extra };
}
function intervention(id, learner, createdAt, fields, extra = {}) {
  return {
    id, assignedTo: learner, scenarioId: 'SC-1', scenarioName: 'Coaching Practice', status: 'Assigned', createdAt,
    source: 'team-growth',
    intervention: { learner, createdAt, createdBy: 'manager@example.com', suggestedScenarioId: null, sourceAssignmentIds: [], stuckScenario: null, ...fields },
    ...extra
  };
}
const completedEvent = (assignmentId, createdAt) => ({ assignmentId, type: 'completed', createdAt });
function run(input) {
  return computeTeamGrowth({ members: [{ email: A }, { email: B }], sessions: [], assignments: [], assignmentEvents: [], now: NOW, ...input });
}
const statusOf = (result, learner) => result.focus.find(p => p.learner === learner)?.interventionStatus;

describe('intervention states (pure rules)', () => {
  test('intervention assignment not completed -> assigned', () => {
    const result = run({
      sessions: [session(A, daysAgo(20), 'S', 80)],
      assignments: [intervention('i1', A, daysAgo(2), { signalTypes: ['practice_break'] })]
    });
    assert.equal(statusOf(result, A).state, 'assigned');
    assert.equal(statusOf(result, A).assignmentId, 'i1');
  });

  test('completed with no new session -> completed (completion alone is not improvement)', () => {
    const result = run({
      sessions: [session(A, daysAgo(20), 'S', 80)],
      assignments: [intervention('i1', A, daysAgo(3), { signalTypes: ['practice_break'] }, { status: 'Completed' })],
      assignmentEvents: [completedEvent('i1', daysAgo(1))]
    });
    assert.equal(statusOf(result, A).state, 'completed');
    assert.deepEqual(result.recentResults, []);
  });

  test('practice_break: new practice after intervention -> signal gone, improved, in recentResults', () => {
    const result = run({
      sessions: [session(A, daysAgo(20), 'S', 80), session(A, daysAgo(1), 'Coaching Practice', 75, { assignmentId: 'i1' })],
      assignments: [intervention('i1', A, daysAgo(3), { signalTypes: ['practice_break'] })],
      assignmentEvents: [completedEvent('i1', daysAgo(1))]
    });
    assert.equal(result.focus.length, 0, 'member with no current signal leaves focus');
    assert.equal(result.recentResults.length, 1);
    const item = result.recentResults[0];
    assert.equal(item.learner, A);
    assert.equal(item.state, 'improved');
    assert.equal(item.improvementType, 'practice_resumed');
    assert.equal(item.assignmentId, 'i1');
    assert.equal(item.improvementEvidenceAt, daysAgo(1));
    assert.equal(item.assignedAt, daysAgo(3));
    assert.equal(item.completedAt, daysAgo(1));
    assert.equal(item.outcomes[0].evidence[0].date, daysAgo(1));
  });

  test('new_not_started: first practice after intervention -> improved', () => {
    const result = run({
      members: [{ email: A, joinedAt: daysAgo(20) }],
      sessions: [session(A, daysAgo(1), 'Coaching Practice', 70)],
      assignments: [intervention('i1', A, daysAgo(5), { signalTypes: ['new_not_started'] }, { status: 'Completed' })],
      assignmentEvents: [completedEvent('i1', daysAgo(1))]
    });
    assert.deepEqual(result.focus, []);
    assert.equal(result.recentResults[0].improvementType, 'first_practice');
  });

  test('repeated_stuck: a new passing attempt in the same scenario -> improved', () => {
    const stuck = [session(A, daysAgo(9), 'Price', 40), session(A, daysAgo(8), 'Price', 45), session(A, daysAgo(7), 'Price', 50)];
    const result = run({
      sessions: [...stuck, session(A, daysAgo(2), 'Price', 72, { assignmentId: 'i1' })],
      assignments: [intervention('i1', A, daysAgo(5), { signalTypes: ['repeated_stuck'], stuckScenario: 'Price', suggestedScenarioId: 'PRICE' })],
      assignmentEvents: [completedEvent('i1', daysAgo(2))]
    });
    assert.deepEqual(result.focus, [], 'latest attempt passed, so the scenario is no longer stuck');
    const item = result.recentResults[0];
    assert.equal(item.improvementType, 'scenario_passed');
    assert.deepEqual(item.outcomes[0].evidence, [{ date: daysAgo(2), scenario: 'Price', score: 72 }]);
  });

  test('repeated_stuck: only more below-pass attempts after intervention -> still-needs-attention', () => {
    const result = run({
      sessions: [
        session(A, daysAgo(9), 'Price', 40), session(A, daysAgo(8), 'Price', 45), session(A, daysAgo(7), 'Price', 50),
        session(A, daysAgo(2), 'Price', 55, { assignmentId: 'i1' })
      ],
      assignments: [intervention('i1', A, daysAgo(5), { signalTypes: ['repeated_stuck'], stuckScenario: 'Price' })],
      assignmentEvents: [completedEvent('i1', daysAgo(2))]
    });
    assert.equal(statusOf(result, A).state, 'still-needs-attention');
    assert.deepEqual(result.recentResults, []);
  });

  test('repeated_stuck: completed but no new attempt in that scenario -> completed', () => {
    const result = run({
      sessions: [
        session(A, daysAgo(9), 'Price', 40), session(A, daysAgo(8), 'Price', 45), session(A, daysAgo(7), 'Price', 50),
        session(A, daysAgo(2), 'Other', 90)
      ],
      assignments: [intervention('i1', A, daysAgo(5), { signalTypes: ['repeated_stuck'], stuckScenario: 'Price' })],
      assignmentEvents: [completedEvent('i1', daysAgo(2))]
    });
    assert.equal(statusOf(result, A).state, 'completed');
  });

  test('score_decline: fewer than 3 post-intervention sessions -> completed, never improved', () => {
    const before = [90, 90, 90, 70, 70, 70].map((s, i) => session(A, daysAgo(20 - i), `S${i}`, s));
    const result = run({
      sessions: [...before, session(A, daysAgo(2), 'S', 95), session(A, daysAgo(1), 'S', 95)],
      assignments: [intervention('i1', A, daysAgo(5), { signalTypes: ['score_decline'] }, { status: 'Completed' })],
      assignmentEvents: [completedEvent('i1', daysAgo(2))]
    });
    // The Phase 1 rule no longer fires on the raw window, but the re-judgement
    // needs three post-intervention sessions, so the state stays completed.
    assert.deepEqual(result.recentResults, []);
  });

  test('score_decline: re-runs the Phase 1 rule once 3 new sessions exist', () => {
    const before = [90, 90, 90, 70, 70, 70].map((s, i) => session(A, daysAgo(20 - i), `S${i}`, s));
    const improved = run({
      sessions: [...before, ...[80, 85, 90].map((s, i) => session(A, daysAgo(3 - i), 'S', s))],
      assignments: [intervention('i1', A, daysAgo(5), { signalTypes: ['score_decline'] })],
      assignmentEvents: [completedEvent('i1', daysAgo(3))]
    });
    assert.equal(improved.recentResults[0].improvementType, 'score_decline_resolved');
    assert.equal(improved.recentResults[0].improvementEvidenceAt, daysAgo(1));

    const still = run({
      sessions: [...before, ...[40, 40, 40].map((s, i) => session(A, daysAgo(3 - i), 'X', s))],
      assignments: [intervention('i1', A, daysAgo(5), { signalTypes: ['score_decline'] })],
      assignmentEvents: [completedEvent('i1', daysAgo(3))]
    });
    assert.equal(statusOf(still, A).state, 'still-needs-attention');
  });

  test('assignment_open: improvement requires the ORIGINAL open assignment to be completed', () => {
    const original = { id: 'orig', assignedTo: A, scenarioName: 'Old', status: 'Assigned', createdAt: daysAgo(30) };
    const base = {
      sessions: [session(A, daysAgo(1), 'Coaching Practice', 80)],
      assignments: [original, intervention('i1', A, daysAgo(5), { signalTypes: ['assignment_open'], sourceAssignmentIds: ['orig'] })]
    };
    const still = run({ ...base, assignmentEvents: [completedEvent('i1', daysAgo(1))] });
    assert.equal(statusOf(still, A).state, 'still-needs-attention');

    const improved = run({ ...base, assignmentEvents: [completedEvent('i1', daysAgo(1)), completedEvent('orig', daysAgo(0.5))] });
    assert.deepEqual(improved.focus, []);
    assert.equal(improved.recentResults[0].improvementType, 'original_assignment_completed');
    assert.equal(improved.recentResults[0].improvementEvidenceAt, daysAgo(0.5));
  });

  test('assignment_open without a recorded original assignment id stays completed (no guessing)', () => {
    const result = run({
      members: [{ email: A }],
      sessions: [session(A, daysAgo(1), 'S', 80)],
      assignments: [
        { id: 'orig', assignedTo: A, scenarioName: 'Old', status: 'Assigned', createdAt: daysAgo(30) },
        intervention('i1', A, daysAgo(5), { signalTypes: ['assignment_open'], sourceAssignmentIds: [] })
      ],
      assignmentEvents: [completedEvent('i1', daysAgo(1))]
    });
    assert.equal(statusOf(result, A).state, 'completed');
  });

  test('focus shows only current signals; intervention history never keeps a member there', () => {
    const result = run({
      sessions: [session(A, daysAgo(30), 'S', 80), session(A, daysAgo(1), 'S', 80), session(B, daysAgo(20), 'S', 80)],
      assignments: [intervention('i1', A, daysAgo(40), { signalTypes: ['practice_break'] }, { status: 'Completed' })],
      assignmentEvents: [completedEvent('i1', daysAgo(25))]
    });
    assert.deepEqual(result.focus.map(p => p.learner), [B]);
    assert.equal(statusOf(result, B).state, 'none');
  });

  test('recentResults drop out after 14 days', () => {
    const result = run({
      sessions: [session(A, daysAgo(40), 'S', 80), session(A, daysAgo(15), 'S', 80)],
      assignments: [intervention('i1', A, daysAgo(20), { signalTypes: ['practice_break'] })],
      assignmentEvents: [completedEvent('i1', daysAgo(15))]
    });
    assert.deepEqual(result.recentResults, []);
  });

  test('recentResults: at most 3, newest improvement evidence first', () => {
    const members = ['m1', 'm2', 'm3', 'm4'].map(x => ({ email: `${x}@example.com` }));
    const sessions = [];
    const assignments = [];
    const assignmentEvents = [];
    [5, 1, 3, 2].forEach((ago, i) => {
      const learner = members[i].email;
      sessions.push(session(learner, daysAgo(30), 'S', 80), session(learner, daysAgo(ago), 'S', 80));
      assignments.push(intervention(`i${i}`, learner, daysAgo(10), { signalTypes: ['practice_break'] }));
      assignmentEvents.push(completedEvent(`i${i}`, daysAgo(ago)));
    });
    const result = computeTeamGrowth({ members, sessions, assignments, assignmentEvents, now: NOW });
    assert.equal(result.recentResults.length, 3);
    assert.deepEqual(result.recentResults.map(r => r.learner), ['m2@example.com', 'm4@example.com', 'm3@example.com']);
  });

  test('old assignments without source/intervention are handled without error', () => {
    const result = run({
      sessions: [session(A, daysAgo(20), 'S', 80)],
      assignments: [
        { id: 'legacy', assignedTo: A, scenarioName: 'Legacy', status: 'Completed', createdAt: daysAgo(30) },
        { id: 'broken', assignedTo: A, source: 'team-growth', status: 'Assigned', createdAt: daysAgo(2) }
      ]
    });
    assert.equal(statusOf(result, A).state, 'none');
  });

  test("interventions never read another learner's data", () => {
    const result = run({
      sessions: [session(A, daysAgo(20), 'S', 80), session(B, daysAgo(30), 'S', 80), session(B, daysAgo(1), 'S', 80)],
      assignments: [
        intervention('iA', A, daysAgo(5), { signalTypes: ['practice_break'] }),
        // Mismatched learner vs assignedTo is not treated as an intervention.
        intervention('iX', B, daysAgo(5), { signalTypes: ['practice_break'], learner: A })
      ],
      assignmentEvents: [completedEvent('iA', daysAgo(2)), completedEvent('iX', daysAgo(2))]
    });
    // B's new session must not count as A resuming practice.
    assert.equal(statusOf(result, A).state, 'completed');
    assert.deepEqual(result.recentResults, []);
  });

  test('members without joinedAt: no new_not_started signal, not counted as new', () => {
    const result = run({ members: [{ email: A }, { email: B, joinedAt: daysAgo(10) }] });
    assert.deepEqual(result.focus.map(p => [p.learner, p.signals.map(s => s.type)]), [[B, ['new_not_started']]]);
    assert.equal(result.summary.newMembers, 1);
    assert.equal(result.summary.newMembersAvailable, true);
    assert.equal(result.summary.membersWithoutJoinDate, 1);
  });
});

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------
const BASE = 'https://pilot.example.com/.netlify/functions/pilot-data';
const manager = { id: 'mgr-1', email: 'manager@example.com', roles: ['manager'], appMetadata: { team_id: 'team-a' } };
const learnerA = { id: 'l-1', email: A, roles: ['learner'], appMetadata: { team_id: 'team-a' } };
const managerB = { id: 'mgr-2', email: 'other@example.com', roles: ['manager'], appMetadata: { team_id: 'team-b' } };
const store = () => getStore({ name: 'agentraining-pilot' });

function call(method, resource, body) {
  const init = { method, headers: { origin: 'https://pilot.example.com', 'content-type': 'application/json' } };
  if (body) init.body = JSON.stringify(body);
  return pilotData(new Request(`${BASE}?resource=${resource}`, init));
}

// Team A: learner A practiced 20 days ago (practice_break) with three
// below-pass attempts on "Price" (repeated_stuck) linked to scenario PRICE.
async function seedTeamA() {
  const s = store();
  await s.setJSON('teams/team-a/roster/l-1', { id: 'l-1', email: A, isLearner: true, isManager: false, lastSeenAt: daysAgo(1) });
  await s.setJSON('teams/team-a/roster/l-2', { id: 'l-2', email: B, isLearner: true, isManager: false, lastSeenAt: daysAgo(1) });
  const old = n => new Date(Date.now() - n * DAY).toISOString();
  await s.setJSON('teams/team-a/assignments/p1', { id: 'p1', assignedTo: A, scenarioId: 'PRICE', scenarioName: 'Price', status: 'Completed', createdAt: old(25) });
  await s.setJSON('teams/team-a/sessions/s1', { id: 's1', userId: 'l-1', learner: A, savedAt: old(22), scenario: 'Price', scores: { overall: 40 }, assignmentId: 'p1' });
  await s.setJSON('teams/team-a/sessions/s2', { id: 's2', userId: 'l-1', learner: A, savedAt: old(21), scenario: 'Price', scores: { overall: 45 } });
  await s.setJSON('teams/team-a/sessions/s3', { id: 's3', userId: 'l-1', learner: A, savedAt: old(20), scenario: 'Price', scores: { overall: 50 } });
}

const forged = {
  learner: A,
  signalTypes: ['score_decline', 'new_not_started'],
  sourceEvidenceAt: '2001-01-01T00:00:00.000Z',
  createdAt: '2001-01-01T00:00:00.000Z',
  createdBy: 'someone-else@example.com',
  suggestedScenarioId: 'PRICE'
};
const baseAssignment = { learner: 'A', assignedTo: A, scenarioId: 'PRICE', scenarioName: 'Price', mode: 'quick' };

describe('POST assignments source=team-growth - server-derived intervention metadata', () => {
  beforeEach(() => { __resetAllStores(); __resetIdentityStub(); });

  test('team-growth assignment carries intervention metadata derived on the server', async () => {
    await seedTeamA();
    __setUser(manager);
    const before = Date.now();
    const res = await call('POST', 'assignments', { ...baseAssignment, source: 'team-growth', intervention: forged, createdAt: forged.createdAt, createdBy: forged.createdBy });
    const body = await res.json();
    assert.equal(res.status, 201);
    const saved = await store().get(`teams/team-a/assignments/${body.assignment.id}`);
    assert.equal(saved.source, 'team-growth');
    const iv = saved.intervention;
    assert.equal(iv.learner, A);
    // createdBy / createdAt: from the verified identity and server clock, not the request.
    assert.equal(iv.createdBy, 'manager@example.com');
    assert.equal(saved.createdBy, 'manager@example.com');
    assert.ok(Date.parse(iv.createdAt) >= before && Date.parse(iv.createdAt) <= Date.now());
    assert.notEqual(saved.createdAt, forged.createdAt);
    // signalTypes / sourceEvidenceAt: recomputed, not the forged values.
    assert.deepEqual(iv.signalTypes, ['repeated_stuck', 'practice_break']);
    assert.equal(iv.sourceEvidenceAt, (await store().get('teams/team-a/sessions/s3')).savedAt);
    assert.equal(iv.suggestedScenarioId, 'PRICE');
    assert.equal(iv.stuckScenario, 'Price');
  });

  test('regular assignment has no intervention metadata, even if the client sends some', async () => {
    await seedTeamA();
    __setUser(manager);
    const res = await call('POST', 'assignments', { ...baseAssignment, intervention: forged });
    const body = await res.json();
    assert.equal(res.status, 201);
    const saved = await store().get(`teams/team-a/assignments/${body.assignment.id}`);
    assert.equal(saved.source, undefined);
    assert.equal(saved.intervention, undefined);
  });

  test('learner outside this team is rejected for a team-growth assignment', async () => {
    await seedTeamA();
    await store().setJSON('teams/team-b/roster/x', { id: 'x', email: 'x@example.com', isLearner: true });
    __setUser(manager);
    const res = await call('POST', 'assignments', { ...baseAssignment, assignedTo: 'x@example.com', source: 'team-growth', intervention: { ...forged, learner: 'x@example.com' } });
    assert.equal(res.status, 403);
    const { blobs } = await store().list({ prefix: 'teams/team-a/assignments/' });
    assert.equal(blobs.length, 1, 'nothing new was saved');
  });

  test('a manager of another team cannot create an intervention for this team\'s learner', async () => {
    await seedTeamA();
    __setUser(managerB);
    const res = await call('POST', 'assignments', { ...baseAssignment, source: 'team-growth', intervention: forged });
    assert.equal(res.status, 403);
  });

  test('an unrelated suggestedScenarioId is rejected', async () => {
    await seedTeamA();
    __setUser(manager);
    const res = await call('POST', 'assignments', { ...baseAssignment, source: 'team-growth', intervention: { ...forged, suggestedScenarioId: 'OTHER-TEAM-SCENARIO' } });
    assert.equal(res.status, 400);
  });

  test('a learner with no current signal gets a regular assignment', async () => {
    await seedTeamA();
    __setUser(manager);
    const res = await call('POST', 'assignments', { ...baseAssignment, assignedTo: B, source: 'team-growth', intervention: { ...forged, learner: B } });
    const body = await res.json();
    assert.equal(res.status, 201);
    assert.equal(body.interventionDowngraded, true);
    assert.equal(body.assignment.intervention, undefined);
  });

  test('learners cannot create team-growth assignments or read team-growth', async () => {
    await seedTeamA();
    __setUser(learnerA);
    assert.equal((await call('POST', 'assignments', { ...baseAssignment, source: 'team-growth', intervention: forged })).status, 403);
    const res = await call('GET', 'team-growth');
    assert.equal(res.status, 403);
    assert.equal((await res.json()).recentResults, undefined);
  });

  test('full loop: intervention -> practice completion -> improved result, isolated per team', async () => {
    await seedTeamA();
    __setUser(manager);
    const created = await (await call('POST', 'assignments', { ...baseAssignment, source: 'team-growth', intervention: forged })).json();
    let growth = await (await call('GET', 'team-growth')).json();
    assert.equal(growth.focus[0].interventionStatus.state, 'assigned');

    __setUser(learnerA);
    const saved = await call('POST', 'sessions', { assignmentId: created.assignment.id, scenario: 'Price', scores: { overall: 82 } });
    assert.equal(saved.status, 201);

    __setUser(manager);
    growth = await (await call('GET', 'team-growth')).json();
    assert.deepEqual(growth.focus, [], 'both original signals are resolved');
    assert.equal(growth.recentResults.length, 1);
    assert.equal(growth.recentResults[0].learner, A);
    assert.equal(growth.recentResults[0].assignmentId, created.assignment.id);

    __setUser(managerB);
    const other = await (await call('GET', 'team-growth')).json();
    assert.deepEqual(other.recentResults, []);
    assert.deepEqual(other.focus, []);
    assert.equal(other.summary.teamSize, 0);
  });
});

describe('roster joinedAt', () => {
  const originalFetch = globalThis.fetch;
  beforeEach(() => { __resetAllStores(); __resetIdentityStub(); });
  afterEach(() => { globalThis.fetch = originalFetch; });

  test('a new roster member gets joinedAt on first creation', async () => {
    __setUser(learnerA);
    const before = Date.now();
    await call('GET', 'me');
    const row = await store().get('teams/team-a/roster/l-1');
    assert.ok(Date.parse(row.joinedAt) >= before);
    assert.equal(row.joinedAt, row.lastSeenAt);
  });

  test('later visits update lastSeenAt but never joinedAt', async () => {
    await store().setJSON('teams/team-a/roster/l-1', { id: 'l-1', email: A, isLearner: true, joinedAt: '2026-01-01T00:00:00.000Z', lastSeenAt: '2026-01-01T00:00:00.000Z' });
    __setUser(learnerA);
    await call('GET', 'me');
    await call('POST', 'sessions', { scenario: 'S', scores: { overall: 70 } });
    const row = await store().get('teams/team-a/roster/l-1');
    assert.equal(row.joinedAt, '2026-01-01T00:00:00.000Z');
    assert.notEqual(row.lastSeenAt, '2026-01-01T00:00:00.000Z');
  });

  test('legacy roster member without joinedAt is not backfilled and not counted as new', async () => {
    await store().setJSON('teams/team-a/roster/l-1', { id: 'l-1', email: A, isLearner: true, lastSeenAt: '2026-01-01T00:00:00.000Z' });
    __setUser(learnerA);
    await call('GET', 'me');
    assert.equal((await store().get('teams/team-a/roster/l-1')).joinedAt, null);
    __setUser(manager);
    const growth = await (await call('GET', 'team-growth')).json();
    assert.equal(growth.summary.newMembers, null);
    assert.equal(growth.summary.newMembersAvailable, false);
    assert.deepEqual(growth.focus, []);
  });

  test('pilot-roster POST also keeps an existing joinedAt', async () => {
    await store().setJSON('teams/founding-pilot/roster/l-9', { id: 'l-9', email: 'n@example.com', isLearner: true, joinedAt: '2026-02-02T00:00:00.000Z' });
    globalThis.fetch = async () => new Response(JSON.stringify({ id: 'l-9', email: 'n@example.com', app_metadata: { roles: ['learner', 'team-founding-pilot'] } }));
    const res = await pilotRoster(new Request('https://pilot.example.com/.netlify/functions/pilot-roster', { method: 'POST', headers: { authorization: 'Bearer t' } }));
    assert.equal(res.status, 200);
    const row = await store().get('teams/founding-pilot/roster/l-9');
    assert.equal(row.joinedAt, '2026-02-02T00:00:00.000Z');
    assert.ok(row.lastSeenAt);
  });

  test('invite acceptance records joinedAt, and the first sign-in keeps it', async () => {
    __setUser({ id: 'mgr-1', email: 'manager@example.com', roles: ['manager', 'team-founding-pilot'] });
    const inviteReq = (action, body) => pilotInvite(new Request(`https://pilot.example.com/.netlify/functions/pilot-invite?action=${action}`, {
      method: 'POST', headers: { origin: 'https://pilot.example.com', 'content-type': 'application/json' }, body: JSON.stringify(body)
    }));
    const created = await (await inviteReq('create', { email: 'newbie@example.com', name: 'Newbie' })).json();
    __setUser(null);
    assert.equal((await inviteReq('accept', { token: created.invite.token, password: 'correct horse battery' })).status, 201);
    const invite = await store().get(`invites/by-token/${created.invite.token}`);
    const key = `teams/founding-pilot/roster/${invite.acceptedUserId}`;
    const row = await store().get(key);
    assert.equal(row.joinedAt, invite.acceptedAt);
    assert.equal(row.isLearner, true);

    __setUser({ id: invite.acceptedUserId, email: 'newbie@example.com', roles: ['learner', 'team-founding-pilot'], appMetadata: { team_id: 'founding-pilot' } });
    await call('GET', 'me');
    assert.equal((await store().get(key)).joinedAt, invite.acceptedAt);
  });
});
