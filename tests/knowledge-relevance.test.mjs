// Backend tests for the Company Knowledge training-relevance assessment:
// Team Training Profile + relevance_feedback in netlify/functions/pilot-data.mjs,
// and the dedicated assessment endpoint netlify/functions/knowledge-relevance.mjs.
//
// Run with: npm test
// (node --import ./tests/register.mjs --test tests/*.test.mjs)
//
// @netlify/blobs and @netlify/identity are stubbed (tests/loader.mjs) and the
// Anthropic API call is replaced by a fake global fetch, so nothing leaves
// the machine. The model call is an OpenAI Responses API fake.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import handler from '../netlify/functions/pilot-data.mjs';
import relevanceHandler from '../netlify/functions/knowledge-relevance.mjs';
import { __setUser, __resetIdentityStub } from '../tests/stubs/netlify-identity.mjs';
import { __resetAllStores, getStore } from '../tests/stubs/netlify-blobs.mjs';

const BASE = 'https://pilot.example.com/.netlify/functions/pilot-data';
const MANAGER = { id: 'm1', email: 'manager@example.com', roles: ['manager'], appMetadata: { team_id: 'acme' } };
const LEARNER = { id: 'l1', email: 'learner@example.com', roles: ['learner'], appMetadata: { team_id: 'acme' } };
const CONTENT = 'When a client says they need to ask their spouse, invite the spouse to the next meeting and confirm a date before leaving. Explain term life as temporary protection for a set period.';

function assessReq(id) {
  return new Request('https://pilot.example.com/.netlify/functions/knowledge-relevance', { method: 'POST', headers: { origin: 'https://pilot.example.com', 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
}
const assess = id => relevanceHandler(assessReq(id));
function openaiReply(obj) { return new Response(JSON.stringify({ status: 'completed', output_text: JSON.stringify(obj) }), { status: 200 }); }

function req(method, resource, body) {
  const url = new URL(BASE);
  url.searchParams.set('resource', resource);
  const init = { method, headers: { origin: 'https://pilot.example.com', 'content-type': 'application/json' } };
  if (body) init.body = JSON.stringify(body);
  return new Request(url, init);
}

let realFetch, lastPrompt, modelReply;
function fakeModel(json) {
  modelReply = json;
  globalThis.fetch = async (url, init) => {
    assert.match(String(url), /api\.openai\.com\/v1\/responses/);
    lastPrompt = JSON.parse(init.body).input;
    return openaiReply(modelReply);
  };
}

const GOOD_REPLY = {
  dimensions: {
    goalAlignment: { score: 5, reason: 'Directly addresses spouse objection goal', evidence: 'invite the spouse' },
    skillGapCoverage: { score: 4, reason: 'Next-step confirmation', evidence: 'confirm a date' },
    objectionCoverage: { score: 5, reason: 'Spouse approval', evidence: 'ask their spouse' },
    novelty: { score: 3, reason: 'Partly new', evidence: '' },
    practiceReadiness: { score: 4, reason: 'Clear role-play', evidence: '' }
  },
  matchedGoals: ['Handle spouse objection'],
  competencies: ['closing', 'not-a-competency'],
  objectionTypes: ['needs_third_party_approval', 'made_up'],
  overlapsWith: ['unknown-id'],
  recommendedAudience: 'new_agents',
  recommendedUse: 'Use in week 1',
  whyItMatters: 'It matters.',
  gaps: 'Nothing on price.',
  learnerNote: { en: 'This helps you keep the appointment when a spouse is involved.', zh: '這能幫你在客戶需要配偶同意時保住約見。' },
  licenseScope: 'ok',
  licenseNote: ''
};

async function createSource() {
  const res = await handler(req('POST', 'knowledge', { action: 'create', title: 'Spouse objection script', sourceType: 'sop_script', content: CONTENT, consentConfirmed: true }));
  assert.equal(res.status, 201);
  return (await res.json()).source;
}
async function saveProfile(extra = {}) {
  return handler(req('PUT', 'training-profile', { goals: ['Handle spouse objection', 'Explain term life'], focusCompetencies: ['closing', 'bogus'], priorityObjections: ['needs_third_party_approval'], ...extra }));
}

describe('knowledge training relevance', () => {
  beforeEach(() => { __resetAllStores(); __resetIdentityStub(); __setUser(MANAGER); realFetch = globalThis.fetch; lastPrompt = null; process.env.OPENAI_API_KEY = 'test-key'; });
  afterEach(() => { globalThis.fetch = realFetch; });

  test('training profile requires a goal and is normalized', async () => {
    assert.equal((await handler(req('PUT', 'training-profile', { goals: [] }))).status, 400);
    const res = await saveProfile();
    assert.equal(res.status, 200);
    const { profile } = await res.json();
    assert.deepEqual(profile.focusCompetencies, ['closing']);
    const got = await (await handler(req('GET', 'training-profile'))).json();
    assert.equal(got.profile.goals.length, 2);
    assert.equal(got.practiceSnapshot.sessionCount, 0);
  });

  test('learners cannot read or write the training profile', async () => {
    __setUser(LEARNER);
    assert.equal((await handler(req('GET', 'training-profile'))).status, 403);
    assert.equal((await saveProfile()).status, 403);
  });

  test('learners cannot run an assessment', async () => {
    const source = await createSource();
    __setUser(LEARNER);
    assert.equal((await assess(source.id)).status, 403);
  });

  test('the old pilot-data assess action is gone (single code path)', async () => {
    const source = await createSource();
    assert.equal((await handler(req('POST', 'knowledge', { action: 'assess_relevance', id: source.id }))).status, 400);
  });

  test('assessment is refused until a training profile exists', async () => {
    const source = await createSource();
    const res = await assess(source.id);
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /Team Training Profile/);
  });

  test('works before any Practice data: scores against declared goals, overall computed server-side', async () => {
    await saveProfile();
    const source = await createSource();
    fakeModel(GOOD_REPLY);
    const res = await assess(source.id);
    assert.equal(res.status, 200);
    const r = (await res.json()).source.relevance;
    // 5*.3 + 4*.2 + 5*.15 + 3*.15 + 4*.2 = 4.3 -> 86
    assert.equal(r.overall, 86);
    assert.equal(r.priority, 'P1');
    assert.equal(r.evidenceBasis, 'declared_goals_only');
    assert.deepEqual(r.competencies, ['closing']);
    assert.deepEqual(r.objectionTypes, ['needs_third_party_approval']);
    assert.deepEqual(r.overlapsWith, [], 'unknown source ids are dropped');
    assert.match(lastPrompt, /Handle spouse objection/);
    assert.match(lastPrompt, /none yet - the team has not started Practice/);
  });

  test('uses aggregate Practice data and other library sources once they exist', async () => {
    await saveProfile();
    const other = await createSource();
    const source = await createSource();
    const store = getStore({ name: 'agentraining-pilot' });
    await store.setJSON('teams/acme/sessions/s1', { learner: 'a@x.com', transcript: 'SECRET TRANSCRIPT', scores: { overall: 60, empathy: 80, accuracy: 70, closing: 40 } });
    await store.setJSON('teams/acme/sessions/s2', { learner: 'b@x.com', scores: { overall: 70, empathy: 90, accuracy: 60, closing: 50 } });
    fakeModel({ ...GOOD_REPLY, overlapsWith: [other.id] });
    const r = (await (await assess(source.id)).json()).source.relevance;
    assert.equal(r.evidenceBasis, 'declared_goals_and_practice_data');
    assert.equal(r.practiceSessionCount, 2);
    assert.equal(r.overlapsWith[0].id, other.id);
    assert.match(lastPrompt, /"closing" is currently weakest/);
    assert.match(lastPrompt, new RegExp('id=' + other.id));
    assert.doesNotMatch(lastPrompt, /SECRET TRANSCRIPT|a@x\.com/, 'no transcripts or learner identities reach the model');
  });

  test('securities-licensed content is flagged for review regardless of score', async () => {
    await saveProfile();
    const source = await createSource();
    fakeModel({ ...GOOD_REPLY, licenseScope: 'out_of_scope', licenseNote: 'Recommends ETFs' });
    const r = (await (await assess(source.id)).json()).source.relevance;
    assert.equal(r.priority, 'review');
  });

  test('keeps the prompt compact and output bounded so the call fits the function time limit', async () => {
    await saveProfile();
    const res = await handler(req('POST', 'knowledge', { action: 'create', title: 'Long manual', sourceType: 'document_notes', content: 'term life premium policy. '.repeat(1200), consentConfirmed: true }));
    const source = (await res.json()).source;
    let sentBody;
    globalThis.fetch = async (url, init) => {
      sentBody = JSON.parse(init.body);
      return openaiReply(GOOD_REPLY);
    };
    assert.equal((await assess(source.id)).status, 200);
    assert.ok(sentBody.max_output_tokens <= 1400);
    assert.equal(sentBody.model, 'gpt-5.4-mini');
    assert.ok(sentBody.input.length < 12000, 'a 30k-char source is excerpted, not sent in full');
  });

  test('a slow model call is aborted at the deadline with a retryable 503', async () => {
    await saveProfile();
    const source = await createSource();
    process.env.RELEVANCE_DEADLINE_MS = '30';
    globalThis.fetch = (url, init) => new Promise((_, reject) => {
      init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    try {
      const res = await assess(source.id);
      assert.equal(res.status, 503);
      assert.match((await res.json()).error, /took too long/);
    } finally { delete process.env.RELEVANCE_DEADLINE_MS; }
  });

  test('a truncated model reply is reported as retryable, not saved', async () => {
    await saveProfile();
    const source = await createSource();
    globalThis.fetch = async () => new Response(JSON.stringify({ status: 'incomplete', output_text: '{"dimensions":{' }), { status: 200 });
    const res = await assess(source.id);
    assert.equal(res.status, 502);
    const store = getStore({ name: 'agentraining-pilot' });
    assert.equal((await store.get(`teams/acme/knowledge/${source.id}`)).relevance, undefined);
  });

  test('manager can record agree/disagree feedback; learners never see relevance', async () => {
    await saveProfile();
    const source = await createSource();
    fakeModel(GOOD_REPLY);
    await assess(source.id);
    const fb = await handler(req('POST', 'knowledge', { action: 'relevance_feedback', id: source.id, verdict: 'disagree', note: 'too basic' }));
    assert.equal((await fb.json()).source.relevance.managerVerdict, 'disagree');
    const store = getStore({ name: 'agentraining-pilot' });
    const key = `teams/acme/knowledge/${source.id}`;
    await store.setJSON(key, { ...(await store.get(key)), analysis: { summary: 's', keyPoints: [], practiceDraft: { title: 't' } } });
    assert.equal((await handler(req('POST', 'knowledge', { action: 'approve', id: source.id }))).status, 200);
    __setUser(LEARNER);
    const list = await (await handler(req('GET', 'knowledge'))).json();
    assert.equal(list.sources.length, 1);
    assert.equal(list.sources[0].relevance, undefined, 'relevance stays manager-only');
  });

  async function approvedAndAssessed(reply) {
    await saveProfile();
    const source = await createSource();
    fakeModel(reply);
    await assess(source.id);
    const store = getStore({ name: 'agentraining-pilot' });
    const key = `teams/acme/knowledge/${source.id}`;
    await store.setJSON(key, { ...(await store.get(key)), analysis: { summary: 's', keyPoints: [], practiceDraft: { title: 't' } } });
    await handler(req('POST', 'knowledge', { action: 'approve', id: source.id }));
    return source;
  }
  async function learnerSources() {
    __setUser(LEARNER);
    return (await (await handler(req('GET', 'knowledge'))).json()).sources;
  }

  test('learners see a safe importance rating, never the manager scores', async () => {
    await approvedAndAssessed(GOOD_REPLY);
    const [src] = await learnerSources();
    assert.deepEqual(src.importance, {
      level: 'must_know', stars: 3,
      note: GOOD_REPLY.learnerNote,
      matchedGoals: ['Handle spouse objection'],
      recommendedAudience: 'new_agents',
      assessedAt: src.importance.assessedAt
    });
    const json = JSON.stringify(src);
    for (const secret of ['dimensions', 'overall', 'whyItMatters', 'gaps', 'licenseNote', 'overlapsWith', 'managerVerdict', 'practiceSessionCount']) {
      assert.ok(!json.includes(secret), `${secret} must not reach learners`);
    }
  });

  test('P2 / P3 map to Important / Reference', async () => {
    await approvedAndAssessed({ ...GOOD_REPLY, dimensions: Object.fromEntries(Object.keys(GOOD_REPLY.dimensions).map(k => [k, { score: 1 }])) });
    const [src] = await learnerSources();
    assert.equal(src.importance.level, 'reference');
    assert.equal(src.importance.stars, 1);
  });

  test('no learner importance when the manager disagreed or compliance review is needed', async () => {
    const source = await approvedAndAssessed(GOOD_REPLY);
    await handler(req('POST', 'knowledge', { action: 'relevance_feedback', id: source.id, verdict: 'disagree' }));
    assert.equal((await learnerSources())[0].importance, null);

    __resetAllStores(); __setUser(MANAGER);
    await approvedAndAssessed({ ...GOOD_REPLY, licenseScope: 'out_of_scope' });
    assert.equal((await learnerSources())[0].importance, null);
  });
});

