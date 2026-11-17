// Manager AI Copilot evidence (issue #77): the model must be given the real
// Practice transcript lines for the selected member, every quotation in its
// answer is checked against those lines, and evidence about one member never
// reaches an answer about another. The OpenAI call is replaced by a stub that
// records what the model was sent and returns a scripted answer; storage and
// Identity are the in-memory stubs. Nothing real is contacted.
//
// Run with: npm test
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import aiChat from '../netlify/functions/ai-chat.mjs';
import { practiceTranscripts, checkQuotes, evidenceReport } from '../netlify/functions/lib/manager-evidence.mjs';
import { getStore, __resetAllStores } from './stubs/netlify-blobs.mjs';
import { __setUser, __resetIdentityStub } from './stubs/netlify-identity.mjs';

const NOW = Date.parse('2026-11-16T18:00:00.000Z');
const TEAM = 'team-a';
const ANA = 'ana@example.com';
const BEN = 'ben@example.com';
const manager = { id: 'm1', email: 'manager@example.com', roles: ['manager'], appMetadata: { roles: ['manager'], team_id: TEAM } };

const anaSession = {
  id: 'sess-ana-1', learner: ANA, learnerName: 'Ana Ruiz', savedAt: '2026-08-14T02:10:00.000Z', scenario: "I'll Think About It",
  practiceMode: 'quick', scores: { overall: 42, empathy: 55, accuracy: 46, closing: 25 },
  tips: ['Ask what the client still needs to think about before ending.'], strengths: [], summary: 'Ended without a next step.',
  transcript: [
    { index: 1, speaker: 'client', text: 'I understand the coverage, but I want to think about it.' },
    { index: 2, speaker: 'agent', text: 'Of course, take all the time you need.' },
    { index: 3, speaker: 'client', text: 'Thanks. I will talk to my wife.' },
    { index: 4, speaker: 'agent', text: 'Sounds good, just reach out whenever you are ready.' }
  ]
};
const benSession = {
  id: 'sess-ben-1', learner: BEN, learnerName: 'Ben Cho', savedAt: '2026-08-19T17:00:00.000Z', scenario: 'Premium Is Too High',
  practiceMode: 'quick', scores: { overall: 51, empathy: 35, accuracy: 60, closing: 58 },
  tips: ['Acknowledge the concern before explaining.'], strengths: [], summary: 'Jumped to price too fast.',
  transcript: [
    { index: 1, speaker: 'client', text: 'This is far more than I expected to pay.' },
    { index: 2, speaker: 'agent', text: 'It is actually very cheap compared with other plans.' }
  ]
};
const benOld = { ...benSession, id: 'sess-ben-0', savedAt: '2026-07-01T17:00:00.000Z', scenario: 'Spouse Objection', transcript: [] };

let sent, answer, realFetch;
async function seed({ sessions = [anaSession, benSession], chat = [] } = {}) {
  const store = getStore({ name: 'agentraining-pilot' });
  await store.setJSON(`teams/${TEAM}/profiles/ana`, { learnerEmail: ANA, preferredName: 'Ana Ruiz', claims: [] });
  await store.setJSON(`teams/${TEAM}/profiles/ben`, { learnerEmail: BEN, preferredName: 'Ben Cho', claims: [] });
  for (const row of sessions) await store.setJSON(`teams/${TEAM}/sessions/${row.id}`, row);
  // A learner's private AI Coach conversation: must never reach Manager AI.
  await store.setJSON(`teams/${TEAM}/private-coach/ana/2026-08-14-x`, { role: 'user', content: 'PRIVATE-COACH-SECRET I am scared of my manager', engine: 'ai-chat-v1', createdAt: '2026-08-14T03:00:00.000Z' });
  // Another team's session with the same learner address: must never be read.
  await store.setJSON('teams/team-b/sessions/other', { ...anaSession, id: 'other-team', transcript: [{ index: 1, speaker: 'agent', text: 'OTHER-TEAM-LINE' }] });
  for (const [i, row] of chat.entries()) await store.setJSON(`teams/${TEAM}/manager-ai/m1/${String(i).padStart(3, '0')}`, { engine: 'ai-chat-v1', createdAt: `2026-11-16T10:00:${String(i).padStart(2, '0')}.000Z`, ...row });
}
async function ask(body) {
  __setUser(manager);
  const res = await aiChat(new Request('https://example.com/.netlify/functions/ai-chat', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'manager', lang: 'en', timeZone: 'America/Los_Angeles', ...body })
  }));
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  __resetAllStores(); __resetIdentityStub();
  process.env.OPENAI_API_KEY = 'test-key';
  sent = null; answer = 'ok';
  realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ output_text: answer }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
});
afterEach(() => { globalThis.fetch = realFetch; delete process.env.OPENAI_API_KEY; });

describe('transcript lines given to the model', () => {
  test('carry the session id, local Practice date, scenario, line number and speaker', () => {
    const [s1] = practiceTranscripts([anaSession], { timeZone: 'America/Los_Angeles', now: NOW });
    assert.equal(s1.ref, 'S1');
    assert.equal(s1.sessionId, 'sess-ana-1');
    assert.equal(s1.practiceDate, '2026-08-13', 'the evening session is dated in the manager’s time zone, as the brief shows it');
    assert.equal(s1.daysAgo, 94);
    assert.equal(s1.transcriptStatus, 'verbatim');
    assert.deepEqual(s1.lines[3], { line: 4, speaker: 'learner', text: 'Sounds good, just reach out whenever you are ready.' });
    assert.equal(s1.lines[0].speaker, 'client');
  });

  test('a session saved without a transcript is marked unavailable and offers no lines', () => {
    const [s1] = practiceTranscripts([benOld], { now: NOW });
    assert.equal(s1.transcriptStatus, 'unavailable');
    assert.deepEqual(s1.lines, []);
  });

  test('the session the manager came from is first; the newest three at most are included', () => {
    const many = [1, 2, 3, 4, 5].map(n => ({ ...anaSession, id: `s${n}`, savedAt: `2026-08-0${n}T10:00:00.000Z` }));
    assert.deepEqual(practiceTranscripts(many, { now: NOW }).map(s => s.sessionId), ['s5', 's4', 's3']);
    const focused = practiceTranscripts(many, { focusSessionId: 's1', now: NOW });
    assert.deepEqual(focused.map(s => [s.sessionId, s.isFocus]), [['s1', true], ['s5', false], ['s4', false]]);
  });

  test('a long transcript is bounded: the opening and the end are kept and the gap is reported', () => {
    const long = { ...anaSession, transcript: Array.from({ length: 80 }, (_, i) => ({ index: i + 1, speaker: i % 2 ? 'agent' : 'client', text: `line ${i + 1} ` + 'x'.repeat(900) })) };
    const [s1] = practiceTranscripts([long], { now: NOW });
    const size = s1.lines.reduce((n, row) => n + row.text.length, 0);
    assert.ok(size <= 6000, `kept ${size} characters`);
    assert.ok(s1.lines.every(row => row.text.length <= 600));
    assert.deepEqual(s1.lines.slice(0, 2).map(r => r.line), [1, 2]);
    assert.equal(s1.lines.at(-1).line, 80);
    assert.equal(s1.lineCount, 80);
    assert.equal(s1.omittedLines, 80 - s1.lines.length);
    const three = practiceTranscripts([long, { ...long, id: 'b' }, { ...long, id: 'c' }], { now: NOW });
    assert.ok(three.flatMap(s => s.lines).reduce((n, row) => n + row.text.length, 0) <= 14000);
  });
});

describe('checking quotations in an answer', () => {
  const transcripts = practiceTranscripts([anaSession], { now: NOW });

  test('a cited verbatim quotation is verified with its session, line and speaker', () => {
    const check = checkQuotes('Ana closed with “just reach out whenever you are ready” [S1 L4].', transcripts);
    assert.deepEqual(check.verified, [{ text: 'just reach out whenever you are ready', ref: 'S1', sessionId: 'sess-ana-1', line: 4, speaker: 'learner' }]);
    assert.deepEqual(check.unverified, []);
  });

  test('an invented quotation is reported, cited or not', () => {
    const check = checkQuotes('She said “Let us meet Thursday at three to finalize” [S1 L4] and “I never follow up with clients anyway”.', transcripts);
    assert.deepEqual(check.verified, []);
    assert.deepEqual(check.unverified.map(q => q.cited), ['S1 L4', null]);
  });

  test('a paraphrase in quotation marks does not pass as verbatim', () => {
    const check = checkQuotes('Ana said “take as much time as you want” [S1 L2].', transcripts);
    assert.equal(check.verified.length, 0);
    assert.equal(check.unverified.length, 1);
  });

  test('a quotation shortened with an ellipsis is accepted only when both parts are in the same line', () => {
    assert.equal(checkQuotes('“Sounds good … whenever you are ready” [S1 L4]', transcripts).verified.length, 1);
    assert.equal(checkQuotes('“Of course … whenever you are ready” [S1 L2]', transcripts).unverified.length, 1);
  });

  test('scenario titles, coach feedback and short quoted terms are not treated as claimed speech', () => {
    const known = [anaSession.scenario, ...anaSession.tips];
    const check = checkQuotes('In “I\'ll Think About It” the coach noted “Ask what the client still needs to think about before ending.” Her “closing” score is 25.', transcripts, known);
    assert.deepEqual(check, { verified: [], unverified: [] });
  });

  test('Chinese quotations in corner brackets are checked the same way', () => {
    const zh = practiceTranscripts([{ ...anaSession, transcript: [{ index: 1, speaker: 'agent', text: '好的，没问题，那您慢慢考虑，有需要随时找我。' }] }], { now: NOW });
    assert.equal(checkQuotes('她的原话是「那您慢慢考虑，有需要随时找我」[S1 L1]。', zh).verified.length, 1);
    assert.equal(checkQuotes('她说“我们周四下午三点再确认一次”。', zh).unverified.length, 1);
  });

  test('the report distinguishes verbatim evidence, summary only, and no Practice at all', () => {
    assert.equal(evidenceReport({ transcripts, now: NOW }).status, 'verbatim');
    assert.equal(evidenceReport({ transcripts: practiceTranscripts([benOld], { now: NOW }), now: NOW }).status, 'summary_only');
    assert.equal(evidenceReport({ transcripts: [], now: NOW }).status, 'none');
    assert.equal(evidenceReport({ transcripts, now: NOW }).daysSinceLatest, 94);
  });
});

describe('Manager AI request', () => {
  test('the model receives the selected member’s own transcript, and nothing private or from another team', async () => {
    await seed();
    answer = 'Ana Ruiz, Practice of 2026-08-13, “I\'ll Think About It”: she ended with “Sounds good, just reach out whenever you are ready.” [S1 L4] Suggested wording: Could we speak again on Thursday?';
    const { status, body } = await ask({ message: 'Why did you recommend this coaching goal?', learnerEmail: ANA, focusSessionId: 'sess-ana-1' });
    assert.equal(status, 200);
    assert.match(sent.instructions, /Sounds good, just reach out whenever you are ready\./);
    assert.match(sent.instructions, /"sessionId":"sess-ana-1"/);
    assert.match(sent.instructions, /"practiceDate":"2026-08-13"/);
    assert.match(sent.instructions, /historical_older_than_14_days/);
    assert.doesNotMatch(sent.instructions, /PRIVATE-COACH-SECRET/);
    assert.doesNotMatch(sent.instructions, /OTHER-TEAM-LINE/);
    assert.doesNotMatch(sent.instructions, /very cheap compared/, 'Ben’s transcript is not sent when Ana is selected');
    assert.equal(body.evidence.status, 'verbatim');
    assert.equal(body.evidence.member.preferredName, 'Ana Ruiz');
    assert.deepEqual(body.evidence.verifiedQuotes.map(q => [q.sessionId, q.line, q.speaker]), [['sess-ana-1', 4, 'learner']]);
    assert.deepEqual(body.evidence.unverifiedQuotes, []);
    assert.equal(body.evidence.sessions[0].scenario, "I'll Think About It");
    assert.equal(body.assistantMessage.evidence.status, 'verbatim', 'the stored message keeps its evidence record');
  });

  test('a fabricated quotation in the answer is flagged rather than passed through as evidence', async () => {
    await seed();
    answer = 'Ana told the client “I will call you Friday morning with the paperwork” [S1 L4].';
    const { body } = await ask({ message: 'Quote her exact words.', learnerEmail: ANA });
    assert.equal(body.evidence.verifiedQuotes.length, 0);
    assert.equal(body.evidence.unverifiedQuotes.length, 1);
  });

  test('a session with no stored transcript is reported as summary-based', async () => {
    await seed({ sessions: [benOld] });
    answer = 'No verbatim conversation was saved for that Practice, so this is based on the summary and scores only.';
    const { body } = await ask({ message: 'Why this coaching goal?', learnerEmail: BEN });
    assert.equal(body.evidence.status, 'summary_only');
    assert.match(sent.instructions, /"transcriptStatus":"unavailable"/);
    assert.match(sent.instructions, /Give no quotation in that case/);
  });

  test('switching members drops the earlier member’s turns from what the model sees', async () => {
    await seed({ chat: [
      { role: 'user', content: 'Tell me about Ana', learnerEmail: ANA },
      { role: 'assistant', content: 'ANA-ONLY-CLAIM closing 25', learnerEmail: ANA },
      { role: 'user', content: 'General question about my week' },
      { role: 'assistant', content: 'GENERAL-REPLY' }
    ] });
    const { body } = await ask({ message: 'And what about this person?', learnerEmail: BEN });
    const history = JSON.stringify(sent.input);
    assert.doesNotMatch(history, /ANA-ONLY-CLAIM|Tell me about Ana/);
    assert.match(history, /GENERAL-REPLY/);
    assert.match(sent.instructions, /"switchedFromAnotherMember":true/);
    assert.match(sent.instructions, /very cheap compared/);
    assert.doesNotMatch(sent.instructions, /reach out whenever you are ready/);
    assert.equal(body.learnerEmail, BEN);
    assert.equal(body.evidence.member.learnerEmail, BEN);
  });

  test('with no member selected the model gets no individual’s evidence and no member-specific history', async () => {
    await seed({ chat: [{ role: 'assistant', content: 'ANA-ONLY-CLAIM', learnerEmail: ANA }] });
    const { body } = await ask({ message: 'How should I plan my week?' });
    assert.doesNotMatch(JSON.stringify(sent), /ANA-ONLY-CLAIM|reach out whenever|very cheap compared/);
    assert.equal(body.evidence.member, null);
  });

  test('a member named in the message is used; two similar roster addresses are never guessed between', async () => {
    await seed();
    assert.equal((await ask({ message: 'How is Ben Cho doing?', learnerEmail: ANA })).body.learnerEmail, BEN);
    const store = getStore({ name: 'agentraining-pilot' });
    await store.setJSON(`teams/${TEAM}/roster/1`, { email: 'muses+learner@gmail.com', isLearner: true });
    await store.setJSON(`teams/${TEAM}/roster/2`, { email: 'muses+learner2@gmail.com', isLearner: true });
    assert.equal((await ask({ message: 'tell me about the gmail learner on my team', learnerEmail: ANA })).body.learnerEmail, ANA, 'falls back to the explicit selection');
  });

  test('a learner cannot use the manager path', async () => {
    await seed();
    __setUser({ id: 'l1', email: ANA, roles: ['learner'], appMetadata: { roles: ['learner'], team_id: TEAM } });
    const res = await aiChat(new Request('https://example.com/x', { method: 'POST', body: JSON.stringify({ role: 'manager', message: 'show me Ben', learnerEmail: BEN }) }));
    assert.equal(res.status, 403);
    assert.equal(sent, null);
  });
});
