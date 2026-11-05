// Browser regression tests for Practice Studio (simulator.html), run in real Chromium against the
// real page with every /.netlify/functions/claude call scripted. They cover:
//  - the final evaluation never failing silently: 429, 502 and malformed JSON show a visible failure
//    with a Retry button, and a retry finishes the exercise from the saved transcript without
//    repeating the role-play;
//  - JSON wrapped in prose still parses;
//  - withdrawing a line ("redo") rolls the scoreboard and the interjection budget back.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { startStaticServer } from './static-server.mjs';

let chromium = null;
try { ({ chromium } = await import('playwright')); }
catch { try { ({ chromium } = createRequire(import.meta.url)('playwright')); } catch { /* skipped below */ } }

const GOOD_FINAL = { overallScore: 71, empathy: 70, accuracy: 72, closing: 69, strengths: ['Listened first'], tips: ['Ask one more question'], summary: 'Solid.', keyMoments: [] };
const turnScore = (n, extra = {}) => ({ overallScore: n, empathy: n, accuracy: n, closing: n, strengths: ['ok'], tips: ['tip'], interject: false, coachSays: '', betterLine: '', ...extra });

describe('Practice Studio (browser)', { skip: !chromium && 'playwright is not installed' }, () => {
  let browser, server, baseUrl;
  before(async () => {
    ({ server, baseUrl } = await startStaticServer());
    browser = await chromium.launch();
  });
  after(async () => { await browser?.close(); server?.close(); });

  // script.final: array of replies for successive FINAL evaluation calls: {status} | {text}
  // script.turn: function(turnNumber) -> object for the per-turn score
  async function openStudio(script) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const stats = { client: 0, turn: 0, final: 0 };
    await page.route('**/.netlify/functions/claude', async (route) => {
      const body = JSON.parse(route.request().postData());
      const reply = (status, text) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(status === 200 ? { content: [{ type: 'text', text }] } : { error: 'x' }) });
      if (body.role === 'client') { stats.client++; return reply(200, 'Hmm, let me think.'); }
      if (body.messages[0].content.includes('FINAL evaluation')) {
        const next = (script.final || [])[stats.final++] ?? { text: JSON.stringify(GOOD_FINAL) };
        return next.status ? reply(next.status) : reply(200, next.text);
      }
      stats.turn++;
      return reply(200, JSON.stringify((script.turn || turnScore)(stats.turn)));
    });
    await page.goto(baseUrl + '/simulator.html?ref=demo&practiceMode=quick');
    await page.waitForFunction(() => typeof selectScenario === 'function' && typeof scenarios !== 'undefined');
    await page.evaluate(() => {
      document.querySelectorAll('[id$="overlay"],#summary-modal,#access-gate,#gate-welcome').forEach((e) => (e.style.display = 'none'));
      selectScenario(scenarios.find((s) => s.id === 1));
    });
    return { page, stats };
  }
  const say = async (page, text) => { await page.fill('#chat-input', text); await page.click('#send-btn'); await page.waitForFunction(() => !isLoading); };
  // quick mode = 3 turns; the third one starts the final evaluation, so wait until it has either
  // produced the summary or shown the failure card (the input unlocks before the evaluation finishes).
  const playToFinal = async (page) => {
    await say(page, 'one'); await say(page, 'two'); await say(page, 'three');
    await page.waitForFunction(() => document.getElementById('final-eval-failure') || getComputedStyle(document.getElementById('summary-modal')).display !== 'none', null, { timeout: 8000 });
  };
  const summaryOpen = (page) => page.waitForFunction(() => getComputedStyle(document.getElementById('summary-modal')).display !== 'none', null, { timeout: 5000 });

  test('final evaluation 429: visible failure + Retry, no role-play repeated, retry completes the session', async () => {
    const { page, stats } = await openStudio({ final: [{ status: 429 }] });
    await playToFinal(page);
    assert.ok(await page.locator('#final-eval-failure').isVisible(), 'failure is shown to the learner');
    assert.match(await page.textContent('#final-eval-failure'), /Too many requests/);
    assert.equal(stats.final, 1, 'a 429 is not retried automatically');
    assert.equal(await page.isVisible('#summary-modal'), false);
    const clientCallsBefore = stats.client;
    await page.click('#final-eval-failure button');
    await summaryOpen(page);
    assert.equal(stats.client, clientCallsBefore, 'the role-play was not repeated');
    assert.equal(await page.locator('#final-eval-failure').count(), 0);
    assert.equal(await page.locator('#final-eval-retry-row').count(), 0);
    assert.match(await page.textContent('#feedback-body'), /71/);
    await page.close();
  });

  test('final evaluation 502 is retried once automatically; two failures show Retry; Retry then succeeds', async () => {
    const { page, stats } = await openStudio({ final: [{ status: 502 }, { status: 502 }] });
    await playToFinal(page);
    assert.equal(stats.final, 2, 'one automatic retry');
    assert.ok(await page.locator('#final-eval-failure').isVisible());
    assert.match(await page.textContent('#final-eval-failure'), /could not be completed/);
    await page.click('#final-eval-failure button');
    await summaryOpen(page);
    assert.equal(stats.final, 3);
    await page.close();
  });

  test('a transient 502 followed by success needs no click at all', async () => {
    const { page } = await openStudio({ final: [{ status: 502 }] });
    await playToFinal(page);
    await summaryOpen(page);
    assert.equal(await page.locator('#final-eval-failure').count(), 0);
    await page.close();
  });

  test('malformed JSON twice shows Retry; JSON wrapped in prose parses without any retry', async () => {
    const bad = await openStudio({ final: [{ text: 'Sorry, here is my analysis: great job!' }, { text: '{"overallScore": 80,' }] });
    await playToFinal(bad.page);
    assert.ok(await bad.page.locator('#final-eval-failure').isVisible());
    await bad.page.close();

    const wrapped = await openStudio({ final: [{ text: 'Here is the evaluation:\n```json\n' + JSON.stringify(GOOD_FINAL) + '\n```\nHope it helps!' }] });
    await playToFinal(wrapped.page);
    await summaryOpen(wrapped.page);
    assert.equal(wrapped.stats.final, 1);
    await wrapped.page.close();
  });

  test('a failed per-turn score shows a small notice and the practice continues', async () => {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.route('**/.netlify/functions/claude', (route) => {
      const body = JSON.parse(route.request().postData());
      if (body.role === 'client') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ content: [{ type: 'text', text: 'ok' }] }) });
      return route.fulfill({ status: 502, contentType: 'application/json', body: '{}' });
    });
    await page.goto(baseUrl + '/simulator.html?ref=demo&practiceMode=quick');
    await page.waitForFunction(() => typeof scenarios !== 'undefined');
    await page.evaluate(() => { document.querySelectorAll('[id$="overlay"],#summary-modal,#access-gate').forEach((e) => (e.style.display = 'none')); selectScenario(scenarios.find((s) => s.id === 1)); });
    await say(page, 'hello');
    assert.ok(await page.locator('#turn-feedback-warning').isVisible());
    assert.equal(await page.isDisabled('#chat-input'), false, 'can keep practising');
    await page.close();
  });

  test('withdrawing a line restores the previous score and gives the interjection back', async () => {
    const { page } = await openStudio({
      turn: (n) => (n === 1 ? turnScore(70) : turnScore(40, { interject: true, coachSays: 'Ask first.', betterLine: 'What worries you?' })),
    });
    await say(page, 'first line');
    assert.match(await page.textContent('#feedback-body'), /70/);
    await say(page, 'pushy second line');
    assert.match(await page.textContent('#feedback-body'), /40/);
    assert.equal(await page.evaluate(() => coachInterjectCount), 1);

    await page.click('#coach-chat-log [data-act="redo"]');
    const body = await page.textContent('#feedback-body');
    assert.match(body, /70/, 'previous turn\'s score is back');
    assert.doesNotMatch(body, /(^|\D)40(\D|$)/, 'the withdrawn turn\'s score is gone');
    assert.ok(await page.locator('#feedback-rollback-note').isVisible(), 'the scoreboard says it was rolled back');
    assert.equal(await page.evaluate(() => coachInterjectCount), 0, 'interjection budget refunded');
    assert.equal(await page.evaluate(() => turnCount), 1);
    assert.equal(await page.evaluate(() => conversationHistory.filter((m) => m.role === 'user').length), 1);
    await page.close();
  });

  test('withdrawing the very first line returns to the empty scoreboard', async () => {
    const { page } = await openStudio({ turn: () => turnScore(40, { interject: true, coachSays: 'Ask first.', betterLine: '' }) });
    await say(page, 'only line');
    assert.match(await page.textContent('#feedback-body'), /40/);
    await page.click('#coach-chat-log [data-act="redo"]');
    assert.equal(await page.locator('#feedback-body .score-card').count(), 0);
    assert.equal(await page.locator('#feedback-body .empty-feedback').count(), 1);
    await page.close();
  });
});
