// Manager AI Brief (manager-brief.js): the finding, the transcript passage
// and the prepared Practice are all computed here, so these tests pin down
// what the brief is allowed to claim from a given set of records. The last
// group posts the brief's payload through the real pilot-data handler (with
// the in-memory Blobs/Identity stubs) to prove the assignment it builds is
// one the server accepts and the learner can then see.
//
// Run with: npm test
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import ManagerBrief from '../manager-brief.js';
import * as fx from './fixtures-manager-brief.mjs';
import pilotData from '../netlify/functions/pilot-data.mjs';
import { __setUser, __resetIdentityStub } from './stubs/netlify-identity.mjs';
import { __resetAllStores } from './stubs/netlify-blobs.mjs';

const { buildBrief, pickExcerpt, practiceCandidates, assignmentPayload } = ManagerBrief;
const base = () => ({ now: fx.NOW, sessions: fx.sessions, profiles: fx.profiles, assignments: fx.assignments });

describe('14-day observation', () => {
  test('counts only members who practiced in the last 14 days, and names the competency most of them are weakest on', () => {
    const brief = buildBrief(base());
    assert.equal(brief.state, 'finding');
    assert.deepEqual(brief.pattern, { key: 'closing', count: 3, of: 4 });
    assert.deepEqual(brief.recent, { sessionCount: 7, memberCount: 4 }); // Kevin's 20-day-old session is outside the window
    assert.equal(brief.allTime.sessionCount, 8);
  });

  test('opens on someone a Practice can be recommended for: steepest drop, no assignment still open', () => {
    const brief = buildBrief(base());
    assert.equal(brief.focus.email, fx.MICHELLE);
    assert.deepEqual(brief.focus.series, [72, 61, 55]);
    assert.equal(brief.focus.trend, 'down');
    // Amy shares the pattern but already holds an open assignment, so she comes after everyone who does not.
    assert.deepEqual(brief.members.map(m => m.email), [fx.MICHELLE, fx.DAVID, fx.KEVIN, fx.AMY]);
    assert.deepEqual([brief.members[3].open.id, brief.members[3].open.days, brief.members[3].open.status], ['a-amy', 2, 'Assigned']);
  });

  test('a single Practice is one data point: no drop and no trend, even when the score is low', () => {
    const amy = buildBrief(base()).members.find(m => m.email === fx.AMY);
    assert.equal(amy.sessionCount, 1);
    assert.equal(amy.trend, 'single');
    assert.equal(amy.drop, 0);
    assert.deepEqual(amy.series, [60]);
  });

  test('sessions with no scores are ignored rather than read as zeroes', () => {
    const blank = { id: 'x', learner: 'new@example.com', savedAt: fx.NOW, scores: { overall: 0, empathy: 0, accuracy: 0, closing: 0 } };
    const brief = buildBrief({ ...base(), sessions: [...fx.sessions, blank] });
    assert.equal(brief.members.some(m => m.email === 'new@example.com'), false);
  });
});

describe('historical records are never presented as recent', () => {
  const stale = () => ({ now: fx.NOW, sessions: fx.staleSessions, profiles: fx.staleProfiles, assignments: fx.staleAssignments });

  test('Practice from three months ago gives a "stale" brief with no 14-day pattern', () => {
    const brief = buildBrief(stale());
    assert.equal(brief.state, 'stale');
    assert.equal(brief.pattern, null, 'no shared 14-day pattern is claimed from old records');
    assert.deepEqual(brief.recent, { sessionCount: 0, memberCount: 0 });
    assert.deepEqual([brief.allTime.sessionCount, brief.allTime.memberCount, brief.allTime.daysSinceLatest], [2, 2, 89]);
  });

  test('each member carries the date and age of their latest Practice and is marked not fresh', () => {
    const brief = buildBrief(stale());
    const ana = brief.members.find(m => m.email === fx.ANA);
    assert.deepEqual([ana.fresh, ana.daysSince, ana.trend, ana.focusKey, ana.focusScore], [false, 95, 'single', 'closing', 25]);
    assert.equal(brief.members.find(m => m.email === fx.BEN).daysSince, 89);
  });

  test('the brief opens on the member without an open assignment; the 42-day-old assignment is reported with its age', () => {
    const brief = buildBrief(stale());
    assert.equal(brief.focus.email, fx.ANA);
    const ben = brief.members.find(m => m.email === fx.BEN);
    assert.deepEqual([ben.open.scenarioName, ben.open.days], ['Handling Skeptical Clients', 42]);
    assert.deepEqual(brief.waiting.map(w => [w.name, w.days]), [['Ben Cho', 42]]);
  });

  test('members with old records and members with none are kept apart', () => {
    const brief = buildBrief(stale());
    assert.deepEqual(brief.members.map(m => [m.name, m.hasEvidence]), [['Ana Ruiz', true], ['Ben Cho', true]]);
    assert.deepEqual(brief.rosterOnly.map(m => [m.name, m.hasEvidence]), [['Cara Diaz', false]]);
  });

  test('one recent session plus older ones: only the recent member is in the 14-day observation', () => {
    const recentBen = { ...fx.staleSessions[1], id: 's-ben-new', savedAt: new Date(Date.parse(fx.NOW) - 3 * 86400000).toISOString() };
    const brief = buildBrief({ ...stale(), sessions: [...fx.staleSessions, recentBen] });
    assert.equal(brief.state, 'finding');
    assert.deepEqual(brief.recent, { sessionCount: 1, memberCount: 1 });
    assert.deepEqual(brief.pattern, { key: 'empathy', count: 1, of: 1 });
    assert.deepEqual(brief.members.map(m => [m.email, m.fresh]), [[fx.BEN, true], [fx.ANA, false]]);
  });

  test('no Practice at all is a different state from old Practice', () => {
    const brief = buildBrief({ now: fx.NOW, sessions: [], profiles: fx.profiles, assignments: [] });
    assert.equal(brief.state, 'no_evidence');
    assert.equal(brief.pattern, null);
    assert.equal(brief.members.length, 0);
    assert.equal(brief.rosterOnly.length, 5);
    assert.equal(buildBrief({ now: fx.NOW }).state, 'no_team');
  });
});

describe('results coming back', () => {
  test('a completed assignment is shown against the weakest area of the session before it', () => {
    const brief = buildBrief(base());
    assert.equal(brief.returns.length, 1);
    assert.deepEqual(
      { name: brief.returns[0].name, key: brief.returns[0].key, before: brief.returns[0].before, after: brief.returns[0].after },
      { name: 'Kevin Zhao', key: 'closing', before: 52, after: 70 });
    assert.ok(brief.returns[0].beforeAt < brief.returns[0].afterAt, 'both scores carry their own Practice date');
    assert.equal(brief.returns[0].resultSessionId, 's-k2');
  });

  test('open assignments are listed as still out, with how long', () => {
    const brief = buildBrief(base());
    assert.deepEqual(brief.waiting.map(w => [w.name, w.status, w.days]), [['Amy Wong', 'Assigned', 2]]);
  });
});

describe('transcript passage', () => {
  const michelle = fx.sessions.find(s => s.id === 's-m3');

  test('for next-step confirmation it marks the last thing the member said, with the lines around it', () => {
    const excerpt = pickExcerpt(michelle, 'closing');
    assert.deepEqual(excerpt.turns.map(t => [t.speaker, t.marked]), [['client', false], ['agent', true], ['client', false]]);
    assert.match(excerpt.turns[1].text, /慢慢考虑/);
    assert.deepEqual([excerpt.line, excerpt.turnCount], [4, 5]);
  });

  test('for knowledge it marks the longest explanation; for empathy the reply to the longest client statement', () => {
    assert.match(pickExcerpt(michelle, 'accuracy').turns.find(t => t.marked).text, /预算，还是保障内容/);
    assert.match(pickExcerpt(michelle, 'empathy').turns.find(t => t.marked).text, /慢慢考虑/);
  });

  test('returns nothing when there is no transcript to quote', () => {
    assert.equal(pickExcerpt({ transcript: [] }, 'closing'), null);
    assert.equal(pickExcerpt({ transcript: [{ speaker: 'client', text: 'hi' }] }, 'closing'), null);
  });
});

describe('recommended Practice and how well it fits', () => {
  const curriculum = [{ id: 'IHFC-01', title: { en: 'Premium Is Too High', zh: '保費太高' } }, { id: 'IHFC-02', title: { en: "I'll Think About It", zh: '我會再考慮看看' }, objective: { en: 'o', zh: '目標' } }];
  const draft = { title: 't', situation: 's', objective: 'o' };
  const source = (id, extra) => ({ id, title: id, status: 'approved', approvedAt: '2026-10-01', analysis: { practiceDraft: draft }, ...extra });

  test('offers only approved Company Knowledge; unassessed company material leads, the standard Practice follows', () => {
    const list = practiceCandidates({ knowledge: fx.knowledge, curriculum, key: 'closing', lang: 'zh' });
    assert.deepEqual(list.map(c => [c.id, c.match]), [['knowledge-k-hnw', 'unassessed'], ['IHFC-02', 'standard']]);
    assert.equal(list[1].title, '我會再考慮看看');
    assert.equal(ManagerBrief.rankReason(list).code, 'unassessed_latest');
  });

  test('the UAT case: P2 60/100 material tagged for closing is a partial match, and is first because it is the only one covering it', () => {
    const list = practiceCandidates({ knowledge: fx.assessedKnowledge, curriculum, key: 'closing', lang: 'en' });
    assert.deepEqual(list.map(c => [c.kind === 'knowledge' ? c.sourceId : c.id, c.match]), [['k-uw', 'partial'], ['IHFC-02', 'standard'], ['k-brand', 'off_target']]);
    assert.deepEqual([list[0].priority, list[0].overall, list[0].covers], ['P2', 60, true]);
    assert.deepEqual(ManagerBrief.rankReason(list), { code: 'only_cover', total: 3, covering: 1 });
  });

  test('P1 or 75+ material tagged for the competency is a strong match and outranks a newer partial one', () => {
    const knowledge = [
      source('partial', { approvedAt: '2026-11-15', relevance: { competencies: ['closing'], priority: 'P2', overall: 60 } }),
      source('strong', { relevance: { competencies: ['closing'], priority: 'P1', overall: 82, whyItMatters: 'w' } })
    ];
    const list = practiceCandidates({ knowledge, curriculum: [], key: 'closing', lang: 'en' });
    assert.deepEqual(list.map(c => [c.sourceId, c.match]), [['strong', 'strong'], ['partial', 'partial']]);
    assert.equal(ManagerBrief.rankReason(list).code, 'best_cover');
  });

  test('when every approved source was assessed and none covers the competency, the standard Practice for it comes first', () => {
    const knowledge = [source('a', { relevance: { competencies: ['empathy'], priority: 'P1', overall: 90 } })];
    const list = practiceCandidates({ knowledge, curriculum, key: 'closing', lang: 'en' });
    assert.deepEqual(list.map(c => c.match), ['standard', 'off_target']);
    assert.deepEqual(ManagerBrief.rankReason(list), { code: 'none_covers', total: 2, company: 1 });
  });

  test('with no evidence yet there is nothing to match: the first curriculum Practice, no targeting', () => {
    const list = practiceCandidates({ knowledge: [], curriculum, key: null, lang: 'en' });
    assert.deepEqual(list.map(c => [c.id, c.targeted, c.match]), [['IHFC-01', false, 'starter']]);
  });
});

describe('assignment the manager confirms', () => {
  const member = { email: fx.MICHELLE, name: 'Michelle Chen' };
  const [fromKnowledge] = practiceCandidates({ knowledge: fx.knowledge, curriculum: [], key: 'closing', lang: 'zh' });

  beforeEach(() => { __resetAllStores(); __resetIdentityStub(); });

  async function call(user, method, body) {
    __setUser(user);
    const res = await pilotData(new Request('https://example.com/.netlify/functions/pilot-data?resource=assignments', {
      method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined
    }));
    return { status: res.status, body: await res.json() };
  }
  const manager = { id: 'm1', email: 'manager@example.com', roles: ['manager'], appMetadata: { team_id: 'team-a' } };
  const learner = { id: 'l1', email: fx.MICHELLE, roles: ['learner'], appMetadata: { team_id: 'team-a' } };

  test('the coaching focus is added to the objective and criteria only when the manager keeps it ticked', () => {
    const withFocus = assignmentPayload({ candidate: fromKnowledge, member, mode: 'quick', addFocus: true, key: 'closing', lang: 'zh' });
    assert.match(withFocus.customScenario.objective, /主管辅导重点/);
    assert.equal(withFocus.customScenario.successCriteria.length, 3);
    const without = assignmentPayload({ candidate: fromKnowledge, member, mode: 'quick', addFocus: false, key: 'closing', lang: 'zh' });
    assert.equal(without.customScenario.objective, fromKnowledge.objective);
    assert.equal(without.customScenario.successCriteria.length, 2);
  });

  test('a long objective is trimmed so the focus still fits the server limit', () => {
    const long = { ...fromKnowledge, objective: '目'.repeat(1200), successCriteria: ['1', '2', '3', '4', '5', '6'] };
    const payload = assignmentPayload({ candidate: long, member, mode: 'full', addFocus: true, key: 'closing', lang: 'zh' });
    assert.ok(payload.customScenario.objective.length <= 1000);
    assert.match(payload.customScenario.objective, /什么时候。$/);
    assert.equal(payload.customScenario.successCriteria.length, 6);
  });

  test('the server accepts the Company Knowledge assignment and the learner then sees it', async () => {
    const payload = assignmentPayload({ candidate: fromKnowledge, member, mode: 'quick', addFocus: true, key: 'closing', lang: 'zh' });
    const created = await call(manager, 'POST', payload);
    assert.equal(created.status, 201);
    assert.equal(created.body.assignment.status, 'Assigned');
    assert.equal(created.body.assignment.sourceKnowledgeId, 'k-hnw');
    assert.match(created.body.assignment.customScenario.objective, /主管辅导重点/);
    const inbox = await call(learner, 'GET');
    assert.deepEqual(inbox.body.assignments.map(a => a.scenarioName), ['争取与企业主的第一次面谈']);
  });

  test('repeating the same request id returns the first assignment instead of creating a second', async () => {
    const payload = { ...assignmentPayload({ candidate: fromKnowledge, member, mode: 'quick', addFocus: true, key: 'closing', lang: 'zh' }), requestId: '0b0c6a4e-3f0f-4a51-9d55-6f6c2f1f9a10' };
    const first = await call(manager, 'POST', payload);
    const again = await call(manager, 'POST', payload);
    assert.equal(first.status, 201);
    assert.equal(again.status, 200);
    assert.equal(again.body.duplicate, true);
    assert.equal(again.body.assignment.id, first.body.assignment.id);
    assert.equal((await call(learner, 'GET')).body.assignments.length, 1, 'the learner has one assignment, not two');
    const other = await call(manager, 'POST', { ...payload, assignedTo: 'someone-else@example.com' });
    assert.equal(other.status, 409, 'a request id cannot be reused for a different learner');
    const fresh = await call(manager, 'POST', { ...payload, requestId: '7f6b1f0e-93f7-4d0c-b7d2-0f1f0a2a3b4c' });
    assert.equal(fresh.status, 201, 'a new confirmation gets a new id and a new assignment');
  });

  test('the server accepts the standard-curriculum assignment', async () => {
    const candidate = { kind: 'curriculum', id: 'IHFC-02', title: '我會再考慮看看' };
    const created = await call(manager, 'POST', assignmentPayload({ candidate, member, mode: 'quick', addFocus: true, key: 'closing', lang: 'zh' }));
    assert.equal(created.status, 201);
    assert.equal(created.body.assignment.scenarioId, 'IHFC-02');
    assert.equal(created.body.assignment.customScenario, null);
  });

  test('a learner cannot create an assignment with the same payload', async () => {
    const payload = assignmentPayload({ candidate: fromKnowledge, member, mode: 'quick', addFocus: true, key: 'closing', lang: 'zh' });
    assert.equal((await call(learner, 'POST', payload)).status, 403);
  });
});
