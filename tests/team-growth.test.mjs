// Tests for Manager Studio -> Team Growth & Retention.
//
// Run with: npm test
// (node --import ./tests/register.mjs --test tests/*.test.mjs)
//
// Covers the pure signal function (netlify/functions/lib/team-growth.mjs) and
// the read-only GET resource=team-growth endpoint in pilot-data.mjs. The
// endpoint runs against the in-memory @netlify/blobs / @netlify/identity stubs
// (see tests/loader.mjs) - no real Netlify or AI call is ever made.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { computeTeamGrowth, PASS_THRESHOLD, startOfWeek } from '../netlify/functions/lib/team-growth.mjs';
import handler from '../netlify/functions/pilot-data.mjs';
import { __setUser, __resetIdentityStub } from '../tests/stubs/netlify-identity.mjs';
import { __resetAllStores, getStore } from '../tests/stubs/netlify-blobs.mjs';

// Wednesday 2026-09-23 12:00 UTC -> "this week" starts Monday 2026-09-21 00:00 UTC.
const NOW = '2026-09-23T12:00:00.000Z';
const DAY = 86400000;
const daysAgo = n => new Date(Date.parse(NOW) - n * DAY).toISOString();

let seq = 0;
function session(learner, savedAt, scenario, overall, extra = {}) {
  seq += 1;
  return { id: `s-${seq}`, learner, learnerName: learner.split('@')[0], savedAt, scenario, scores: { overall }, ...extra };
}
function run(input) {
  return computeTeamGrowth({ members: [], sessions: [], assignments: [], assignmentEvents: [], now: NOW, ...input });
}
function signalsFor(result, learner) {
  return (result.focus.find(p => p.learner === learner)?.signals || []).map(s => s.type);
}

const A = 'a@example.com';
const B = 'b@example.com';
const C = 'c@example.com';
const D = 'd@example.com';

describe('computeTeamGrowth - pure signal rules', () => {
  test('pass threshold is 60 on the 0-100 overall scale', () => {
    assert.equal(PASS_THRESHOLD, 60);
  });

  test('week starts Monday 00:00 UTC', () => {
    assert.equal(new Date(startOfWeek(Date.parse(NOW))).toISOString(), '2026-09-21T00:00:00.000Z');
  });

  test('1. practice_break: practiced before, nothing in the last 14 days', () => {
    const result = run({
      members: [{ email: A }],
      sessions: [session(A, daysAgo(30), 'Premium Is Too High', 70), session(A, daysAgo(20), 'Need To Think', 82)]
    });
    const signal = result.focus[0].signals.find(s => s.type === 'practice_break');
    assert.ok(signal);
    assert.deepEqual(signal.evidence, [{ date: daysAgo(20), scenario: 'Need To Think', score: 82 }]);
  });

  test('1b. practice_break is not raised when practice happened within 14 days', () => {
    const result = run({ members: [{ email: A }], sessions: [session(A, daysAgo(30), 'X', 70), session(A, daysAgo(13), 'X', 70)] });
    assert.deepEqual(signalsFor(result, A), []);
  });

  test('1c. a long-time member who never practiced is not flagged as practice_break', () => {
    const result = run({ members: [{ email: A }], sessions: [] });
    assert.deepEqual(result.focus, []);
  });

  test('2. score_decline: latest 3 avg is 10+ below the 3 immediately before', () => {
    const scores = [40, 40, 90, 90, 90, 70, 70, 70]; // oldest -> newest
    const sessions = scores.map((score, i) => session(A, daysAgo(10 - i), `Scenario ${i}`, score));
    // Insert out of order to prove sorting by savedAt happens first.
    const result = run({ members: [{ email: A }], sessions: [...sessions].reverse() });
    const signal = result.focus[0].signals.find(s => s.type === 'score_decline');
    assert.ok(signal);
    assert.equal(signal.previousAverage, 90);
    assert.equal(signal.recentAverage, 70);
    assert.deepEqual(signal.evidence.map(e => e.score), [90, 90, 90, 70, 70, 70]);
    assert.deepEqual(signal.evidence.map(e => e.scenario), ['Scenario 2', 'Scenario 3', 'Scenario 4', 'Scenario 5', 'Scenario 6', 'Scenario 7']);
    assert.equal(signal.evidence[0].date, daysAgo(8));
  });

  test('2b. score_decline compares only the adjacent previous 3, not older sessions', () => {
    // Older sessions are high, but the previous 3 vs latest 3 differ by < 10.
    const scores = [95, 95, 95, 75, 75, 75, 70, 70, 70];
    const sessions = scores.map((score, i) => session(A, daysAgo(12 - i), 'S', score));
    const result = run({ members: [{ email: A }], sessions });
    assert.ok(!signalsFor(result, A).includes('score_decline'));
  });

  test('2c. fewer than 6 sessions never triggers score_decline', () => {
    const scores = [95, 95, 95, 60, 60];
    const sessions = scores.map((score, i) => session(A, daysAgo(6 - i), `S${i}`, score));
    const result = run({ members: [{ email: A }], sessions });
    assert.ok(!signalsFor(result, A).includes('score_decline'));
  });

  test('3. repeated_stuck: 3+ below-pass attempts on the same scenario', () => {
    const result = run({
      members: [{ email: A }],
      sessions: [
        session(A, daysAgo(5), 'Price Objection', 45, { assignmentId: 'asg-1' }),
        session(A, daysAgo(4), 'Price Objection', 80),
        session(A, daysAgo(3), 'Price Objection', 52),
        session(A, daysAgo(2), 'Price Objection', 59)
      ],
      assignments: [{ id: 'asg-1', assignedTo: A, scenarioId: 'IHFC-01', scenarioName: 'Price Objection', status: 'Completed', createdAt: daysAgo(6) }],
      assignmentEvents: [{ assignmentId: 'asg-1', type: 'completed', createdAt: daysAgo(5) }]
    });
    const person = result.focus[0];
    const signal = person.signals.find(s => s.type === 'repeated_stuck');
    assert.ok(signal);
    assert.equal(signal.attempts, 3);
    assert.deepEqual(signal.evidence.map(e => e.score), [45, 52, 59]);
    assert.ok(signal.evidence.every(e => e.scenario === 'Price Objection' && e.date));
    assert.equal(person.suggestedScenarioId, 'IHFC-01');
  });

  test('3b. below-pass attempts on different scenarios are not merged', () => {
    const result = run({
      members: [{ email: A }],
      sessions: [
        session(A, daysAgo(5), 'Scenario One', 40), session(A, daysAgo(4), 'Scenario One', 40),
        session(A, daysAgo(3), 'Scenario Two', 40), session(A, daysAgo(2), 'Scenario Two', 40)
      ]
    });
    assert.ok(!signalsFor(result, A).includes('repeated_stuck'));
  });

  test('3c. multiple stuck scenarios: suggestion prefers most attempts, then most recent', () => {
    const sessions = [
      session(A, daysAgo(9), 'Alpha', 30), session(A, daysAgo(8), 'Alpha', 30), session(A, daysAgo(7), 'Alpha', 30),
      session(A, daysAgo(6), 'Beta', 30), session(A, daysAgo(5), 'Beta', 30), session(A, daysAgo(4), 'Beta', 30),
      session(A, daysAgo(3), 'Gamma', 30), session(A, daysAgo(2), 'Gamma', 30)
    ];
    const assignments = [
      { id: 'x1', assignedTo: A, scenarioId: 'ALPHA', scenarioName: 'Alpha', status: 'Completed', createdAt: daysAgo(10) },
      { id: 'x2', assignedTo: A, scenarioId: 'BETA', scenarioName: 'Beta', status: 'Completed', createdAt: daysAgo(10) }
    ];
    const tie = run({ members: [{ email: A }], sessions, assignments });
    const stuck = tie.focus[0].signals.find(s => s.type === 'repeated_stuck');
    assert.equal(stuck.scenario, 'Beta'); // same count (3), Beta failed more recently
    assert.equal(tie.focus[0].suggestedScenarioId, 'BETA');
    assert.deepEqual(stuck.scenarios.map(x => x.scenario), ['Beta', 'Alpha']);
    assert.equal(stuck.evidence.length, 6);

    const more = run({ members: [{ email: A }], sessions: [...sessions, session(A, daysAgo(11), 'Alpha', 20)], assignments });
    assert.equal(more.focus[0].signals.find(s => s.type === 'repeated_stuck').scenario, 'Alpha');
    assert.equal(more.focus[0].suggestedScenarioId, 'ALPHA');
  });

  test('4. assignment_open: open over 7 days, or past its due date, with no completed record', () => {
    const result = run({
      members: [{ email: A }],
      assignments: [
        { id: 'old', assignedTo: A, scenarioId: 'S1', scenarioName: 'Old One', status: 'Assigned', createdAt: daysAgo(9), dueDate: '' },
        { id: 'due', assignedTo: A, scenarioId: 'S2', scenarioName: 'Due One', status: 'In Progress', createdAt: daysAgo(3), dueDate: '2026-09-22' },
        { id: 'fresh', assignedTo: A, scenarioId: 'S3', scenarioName: 'Fresh One', status: 'Assigned', createdAt: daysAgo(2), dueDate: '2026-09-30' }
      ],
      assignmentEvents: [{ assignmentId: 'old', type: 'assigned', createdAt: daysAgo(9) }]
    });
    const signal = result.focus[0].signals.find(s => s.type === 'assignment_open');
    assert.deepEqual(signal.evidence.map(e => [e.scenario, e.reason, e.completed]), [
      ['Old One', 'open_over_7_days', false],
      ['Due One', 'past_due_date', false]
    ]);
    assert.equal(signal.evidence[1].dueDate, '2026-09-22');
    assert.equal(signal.evidence[0].date, daysAgo(9));
  });

  test('4b. an assignment with a completed record is never reported as open', () => {
    const result = run({
      members: [{ email: A }],
      assignments: [
        { id: 'done-event', assignedTo: A, scenarioName: 'Done by event', status: 'Assigned', createdAt: daysAgo(20), dueDate: '2026-09-01' },
        { id: 'done-status', assignedTo: A, scenarioName: 'Done by status', status: 'Completed', createdAt: daysAgo(20) }
      ],
      assignmentEvents: [{ assignmentId: 'done-event', type: 'completed', createdAt: daysAgo(15) }]
    });
    assert.deepEqual(result.focus, []);
  });

  test('5. new_not_started: reliable join date, 7+ days ago, no practice', () => {
    const result = run({ members: [{ email: A, joinedAt: daysAgo(8) }, { email: B, joinedAt: daysAgo(3) }] });
    assert.deepEqual(signalsFor(result, A), ['new_not_started']);
    assert.deepEqual(result.focus[0].signals[0].evidence, [{ date: daysAgo(8), joinedAt: daysAgo(8), sessionCount: 0 }]);
    assert.deepEqual(signalsFor(result, B), []);
    assert.equal(result.summary.newMembers, 2);
    assert.equal(result.summary.newMembersAvailable, true);
  });

  test('5b. without a reliable join date: no new_not_started signal and new-member count unavailable', () => {
    const result = run({ members: [{ email: A }, { email: B, joinedAt: 'not-a-date' }] });
    assert.deepEqual(result.focus, []);
    assert.equal(result.summary.newMembers, null);
    assert.equal(result.summary.newMembersAvailable, false);
  });

  test('6. insufficient data produces no signals and an honest empty focus', () => {
    const result = run({
      members: [{ email: A }, { email: B }],
      sessions: [session(A, daysAgo(1), 'S', 45), session(A, daysAgo(0.5), 'S', 50)]
    });
    assert.deepEqual(result.focus, []);
    assert.equal(result.summary.teamSize, 2);
    assert.equal(result.summary.practicedThisWeek, 1);
  });

  test('summary counts only members who practiced since Monday 00:00 UTC', () => {
    const result = run({
      members: [{ email: A }, { email: B }, { email: C }],
      sessions: [
        session(A, '2026-09-21T00:00:00.000Z', 'S', 80),
        session(B, '2026-09-20T23:59:59.000Z', 'S', 80),
        session('outsider@example.com', daysAgo(1), 'S', 80)
      ]
    });
    assert.equal(result.summary.teamSize, 3);
    assert.equal(result.summary.practicedThisWeek, 1);
  });

  test('focus: at most 3, ordered by signal count, then latest evidence, then stable', () => {
    const openAssignment = learner => ({ id: `open-${learner}`, assignedTo: learner, scenarioName: 'Open', status: 'Assigned', createdAt: daysAgo(30) });
    const sessions = [
      // A: practice_break + assignment_open (2 signals)
      session(A, daysAgo(20), 'S', 80),
      // B, C, D: practice_break only; latest evidence differs
      session(B, daysAgo(40), 'S', 80),
      session(C, daysAgo(15), 'S', 80),
      session(D, daysAgo(15), 'S', 80)
    ];
    const result = run({
      members: [{ email: D }, { email: C }, { email: B }, { email: A }],
      sessions,
      assignments: [openAssignment(A)]
    });
    assert.equal(result.focus.length, 3);
    assert.deepEqual(result.focus.map(p => p.learner), [A, C, D]);
    assert.ok(result.focus.every(p => !('risk' in p) && !('riskScore' in p) && !('probability' in p)));
  });
});

// ---------------------------------------------------------------------------
// GET resource=team-growth
// ---------------------------------------------------------------------------
const BASE = 'https://pilot.example.com/.netlify/functions/pilot-data';
const manager = { id: 'mgr-1', email: 'manager@example.com', roles: ['manager'], appMetadata: { team_id: 'team-a' } };
const learner = { id: 'l-1', email: A, roles: ['learner'], appMetadata: { team_id: 'team-a' } };
const otherManager = { id: 'mgr-2', email: 'other@example.com', roles: ['manager'], appMetadata: { team_id: 'team-b' } };

function get(resource) {
  return handler(new Request(`${BASE}?resource=${resource}`, { method: 'GET' }));
}

async function seedTeamA() {
  const store = getStore({ name: 'agentraining-pilot' });
  await store.setJSON('teams/team-a/roster/l-1', { id: 'l-1', email: A, isLearner: true, isManager: false, lastSeenAt: new Date().toISOString() });
  await store.setJSON('teams/team-a/roster/l-2', { id: 'l-2', email: B, isLearner: true, isManager: false, lastSeenAt: new Date().toISOString() });
  const old = new Date(Date.now() - 20 * DAY).toISOString();
  await store.setJSON('teams/team-a/sessions/s-a', { id: 's-a', userId: 'l-1', learner: A, learnerName: 'Alex', savedAt: old, scenario: 'Price Objection', scores: { overall: 72 } });
}

describe('GET resource=team-growth - authorization', () => {
  beforeEach(() => {
    __resetAllStores();
    __resetIdentityStub();
  });

  test('manager reads their own team growth data', async () => {
    await seedTeamA();
    __setUser(manager);
    const res = await get('team-growth');
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.summary.teamSize, 2);
    assert.equal(body.summary.newMembers, null); // roster has no join date
    assert.equal(body.summary.newMembersAvailable, false);
    assert.equal(body.focus.length, 1);
    assert.equal(body.focus[0].learner, A);
    assert.equal(body.focus[0].name, 'Alex');
    assert.deepEqual(body.focus[0].signals.map(s => s.type), ['practice_break']);
  });

  test('learner is denied with 403 and nothing is returned', async () => {
    await seedTeamA();
    __setUser(learner);
    const res = await get('team-growth');
    const body = await res.json();
    assert.equal(res.status, 403);
    assert.equal(body.summary, undefined);
    assert.equal(body.focus, undefined);
  });

  test('unauthenticated request is rejected with 401', async () => {
    __setUser(null);
    const res = await get('team-growth');
    assert.equal(res.status, 401);
  });

  test('a manager of another team does not see this team', async () => {
    await seedTeamA();
    __setUser(otherManager);
    const res = await get('team-growth');
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.summary.teamSize, 0);
    assert.deepEqual(body.focus, []);
  });
});
