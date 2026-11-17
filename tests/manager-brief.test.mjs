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

describe('finding', () => {
  test('names the competency most members are weakest on, and counts only them', () => {
    const brief = buildBrief(base());
    assert.equal(brief.state, 'finding');
    assert.deepEqual(brief.pattern, { key: 'closing', count: 3 });
    assert.equal(brief.windowed, true);
    assert.deepEqual(brief.basis, { memberCount: 4, sessionCount: 7 }); // Kevin's 20-day-old session is outside the window
  });

  test('looks first at the steepest drop among members not already holding an assignment', () => {
    const brief = buildBrief(base());
    assert.equal(brief.focus.email, fx.MICHELLE);
    assert.deepEqual(brief.focus.series, [72, 61, 55]);
    assert.equal(brief.focus.trend, 'down');
    // Amy is in the pattern too but already has an open assignment, so she ranks after David.
    assert.deepEqual(brief.members.map(m => m.email), [fx.MICHELLE, fx.DAVID, fx.AMY, fx.KEVIN]);
    assert.equal(brief.members[2].open.id, 'a-amy');
  });

  test('a member with one session is reported as a single data point, never a trend', () => {
    const amy = buildBrief(base()).members.find(m => m.email === fx.AMY);
    assert.equal(amy.sessionCount, 1);
    assert.equal(amy.trend, 'single');
    assert.equal(amy.drop, 0);
  });

  test('falls back to all recorded Practice when the last 14 days are too thin', () => {
    const old = fx.sessions.filter(s => s.id === 's-k1');
    const brief = buildBrief({ ...base(), sessions: old });
    assert.equal(brief.windowed, false);
    assert.equal(brief.focus.email, fx.KEVIN);
  });

  test('with no scored Practice it makes no claim about anyone', () => {
    const brief = buildBrief({ now: fx.NOW, sessions: [], profiles: fx.profiles, assignments: [] });
    assert.equal(brief.state, 'no_evidence');
    assert.equal(brief.pattern, null);
    assert.equal(brief.members.length, 0);
    assert.equal(brief.rosterOnly.length, 5);
    assert.equal(buildBrief({ now: fx.NOW }).state, 'no_team');
  });

  test('sessions with no scores are ignored rather than read as zeroes', () => {
    const blank = { id: 'x', learner: 'new@example.com', savedAt: fx.NOW, scores: { overall: 0, empathy: 0, accuracy: 0, closing: 0 } };
    const brief = buildBrief({ ...base(), sessions: [...fx.sessions, blank] });
    assert.equal(brief.members.some(m => m.email === 'new@example.com'), false);
  });
});

describe('results coming back', () => {
  test('a completed assignment is shown against the weakest area of the session before it', () => {
    const brief = buildBrief(base());
    assert.equal(brief.returns.length, 1);
    assert.deepEqual(
      { name: brief.returns[0].name, key: brief.returns[0].key, before: brief.returns[0].before, after: brief.returns[0].after },
      { name: 'Kevin Zhao', key: 'closing', before: 52, after: 70 });
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

describe('prepared Practice', () => {
  const curriculum = [{ id: 'IHFC-01', title: { en: 'Premium Is Too High', zh: '保費太高' } }, { id: 'IHFC-02', title: { en: "I'll Think About It", zh: '我會再考慮看看' }, objective: { en: 'o', zh: '目標' } }];

  test('offers only approved Company Knowledge, then the standard Practice for that competency', () => {
    const list = practiceCandidates({ knowledge: fx.knowledge, curriculum, key: 'closing', lang: 'zh' });
    assert.deepEqual(list.map(c => c.id), ['knowledge-k-hnw', 'IHFC-02']);
    assert.equal(list[1].title, '我會再考慮看看');
    assert.equal(list[1].targeted, true);
  });

  test('a source assessed as covering the competency outranks a newer one that is not', () => {
    const draft = { title: 't', situation: 's', objective: 'o' };
    const knowledge = [
      { id: 'new', title: 'New', status: 'approved', approvedAt: '2026-11-15', analysis: { practiceDraft: draft } },
      { id: 'fit', title: 'Fit', status: 'approved', approvedAt: '2026-10-01', analysis: { practiceDraft: draft }, relevance: { competencies: ['closing'], priority: 'P1', overall: 82, whyItMatters: 'w' } }
    ];
    const list = practiceCandidates({ knowledge, curriculum: [], key: 'closing', lang: 'en' });
    assert.deepEqual(list.map(c => c.sourceId), ['fit', 'new']);
    assert.deepEqual([list[0].covers, list[0].priority, list[0].overall], [true, 'P1', 82]);
    assert.equal(list[1].covers, false);
  });

  test('with no evidence yet it offers the first curriculum Practice and adds no coaching focus', () => {
    const list = practiceCandidates({ knowledge: [], curriculum, key: null, lang: 'en' });
    assert.deepEqual(list.map(c => [c.id, c.targeted]), [['IHFC-01', false]]);
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
