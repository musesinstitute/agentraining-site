// Headless-browser coverage for the Manager AI Brief on Pilot Home: the real
// pilot.html / manager-brief.js / manager-chat.html / pilot-cloud.js run in
// Chromium against a local static server. Every /.netlify/* call and the
// Identity widget are answered from memory - nothing real is contacted.
//
// Run with: npm test
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startStaticServer } from './static-server.mjs';
import * as fx from './fixtures-manager-brief.mjs';

const widget = roles => `window.netlifyIdentity={init(){},currentUser:()=>({email:'user@example.com',jwt:async()=>'fake',app_metadata:{roles:${JSON.stringify(roles)}}}),on(){},open(){},close(){},logout(){},gotrue:{}};`;

// The script netlify/edge-functions/pilot-first-impression.ts appends to
// pilot.html in production, so the test page matches what Netlify serves.
const edgeSource = readFileSync(new URL('../netlify/edge-functions/pilot-first-impression.ts', import.meta.url), 'utf8');
const EDGE_INJECTION = edgeSource.slice(edgeSource.indexOf('String.raw`') + 11, edgeSource.indexOf('`;\n  html=html.replace'));

let baseUrl, stopServer, browser;
before(async () => {
  const started = await startStaticServer();
  baseUrl = started.baseUrl;
  stopServer = () => started.server.close();
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium' });
});
after(async () => { await browser?.close(); stopServer?.(); });

async function open(path, { roles = ['manager'], data = {}, failAssign = 0, withEdge = false } = {}) {
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  const seen = { posts: [], chat: [], errors: [] };
  page.on('pageerror', error => seen.errors.push(error.message));
  await page.clock.setFixedTime(new Date(fx.NOW));
  await page.route('https://identity.netlify.com/**', r => r.fulfill({ contentType: 'text/javascript', body: widget(roles) }));
  await page.route('**/openai-voice.js**', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  if (withEdge) {
    await page.route('**/pilot.html**', async route => {
      const response = await route.fetch();
      route.fulfill({ response, body: (await response.text()).replace('</body>', EDGE_INJECTION + '\n</body>') });
    });
  }
  let failures = failAssign;
  await page.route('**/.netlify/functions/pilot-data**', route => {
    const resource = new URL(route.request().url()).searchParams.get('resource');
    if (route.request().method() === 'POST' && resource === 'assignments') {
      if (failures-- > 0) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Storage is busy.' }) });
      const body = route.request().postDataJSON();
      seen.posts.push(body);
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ assignment: { id: 'new-1', status: 'Assigned', createdAt: fx.NOW, ...body } }) });
    }
    const body = resource === 'me' ? { email: 'user@example.com', roles, teamId: 't' }
      : resource === 'assignments' ? { assignments: data.assignments ?? fx.assignments }
      : resource === 'sessions' ? { sessions: data.sessions ?? fx.sessions }
      : resource === 'profiles' ? { profiles: data.profiles ?? fx.profiles }
      : resource === 'knowledge' ? { sources: data.knowledge ?? fx.knowledge }
      : resource === 'manager-chat' ? { profiles: fx.profiles.map(p => ({ learnerEmail: p.learnerEmail, preferredName: p.preferredName })), messages: [] }
      : {};
    route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/.netlify/functions/manager-ai-chat**', route => {
    seen.chat.push(route.request().postDataJSON());
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ dataVersion: 'manager-evidence-v3', text: 'ok' }) });
  });
  await page.goto(baseUrl + path);
  return { page, seen, close: () => context.close() };
}
const ready = page => page.waitForSelector('.brief-action:not([aria-busy])');

describe('Manager AI Brief on Pilot Home', () => {
  test('opens with the finding, the member’s own words and one prepared Practice', async () => {
    const { page, seen, close } = await open('/pilot.html?pilot=1&briefed=1&lang=en');
    await ready(page);
    assert.match(await page.textContent('.brief-headline'), /3 team members scored lowest on next-step confirmation\.\s*Michelle Chen has dropped the most: 72 → 61 → 55\./);
    assert.match(await page.textContent('.brief-turn.is-marked mark'), /慢慢考虑/);
    assert.match(await page.textContent('.brief-action'), /material you approved: “高净值客户首次面谈指引”/);
    assert.match(await page.textContent('.brief-loop'), /Kevin Zhao finished .* next-step confirmation 52 → 70 \(\+18\)/);
    assert.match(await page.textContent('.brief-loop'), /Amy Wong .* not started, assigned 2 days ago/);
    assert.equal(await page.locator('#ai-brief ~ .next').count(), 0, 'the old "next action" card is replaced by the brief');
    assert.equal(seen.posts.length, 0, 'nothing is assigned by loading the page');
    assert.deepEqual(seen.errors, []);
    await close();
  });

  test('assigns exactly once, only on Confirm, and keeps the finding the manager acted on', async () => {
    const { page, seen, close } = await open('/pilot.html?pilot=1&briefed=1&lang=zh');
    await ready(page);
    const headline = await page.textContent('.brief-headline');
    await page.selectOption('[data-brief-mode]', 'standard');
    await page.click('[data-brief-confirm]');
    await page.waitForSelector('.brief-action.is-done');
    assert.equal(seen.posts.length, 1);
    assert.equal(seen.posts[0].assignedTo, fx.MICHELLE);
    assert.equal(seen.posts[0].mode, 'standard');
    assert.equal(seen.posts[0].sourceKnowledgeId, 'k-hnw');
    assert.match(seen.posts[0].customScenario.objective, /主管辅导重点/);
    assert.equal(await page.textContent('.brief-headline'), headline);
    assert.match(await page.textContent('.brief-loop'), /Michelle Chen\s*「争取与企业主的第一次面谈」，还没开始，今天指派/);
    assert.equal(await page.locator('[data-brief-confirm]').count(), 0, 'no second Confirm for the same member');
    await page.click('.brief-action [data-brief-member]');
    assert.match(await page.textContent('#brief-evidence-title'), /David Liu/);
    await close();
  });

  test('unticking the coaching focus sends the Practice as approved', async () => {
    const { page, seen, close } = await open('/pilot.html?pilot=1&briefed=1&lang=zh');
    await ready(page);
    await page.uncheck('[data-brief-focus]');
    await page.click('[data-brief-confirm]');
    await page.waitForSelector('.brief-action.is-done');
    assert.equal(seen.posts[0].customScenario.objective, fx.knowledge[0].analysis.practiceDraft.objective);
    await close();
  });

  test('a failed assignment says so and can be retried', async () => {
    const { page, seen, close } = await open('/pilot.html?pilot=1&briefed=1&lang=en', { failAssign: 1 });
    await ready(page);
    await page.click('[data-brief-confirm]');
    await page.waitForSelector('.brief-error');
    assert.match(await page.textContent('.brief-error'), /Not sent: Storage is busy\./);
    assert.equal(seen.posts.length, 0);
    await page.click('[data-brief-confirm]');
    await page.waitForSelector('.brief-action.is-done');
    assert.equal(seen.posts.length, 1);
    await close();
  });

  test('a member who already holds an assignment gets no second one offered', async () => {
    const { page, close } = await open('/pilot.html?pilot=1&briefed=1&lang=en');
    await ready(page);
    await page.click(`[data-brief-member="${fx.AMY}"]`);
    assert.match(await page.textContent('.brief-action'), /Amy Wong already has a Practice in hand/);
    assert.equal(await page.locator('[data-brief-confirm]').count(), 0);
    await close();
  });

  test('without approved Company Knowledge it offers the standard Practice for that competency', async () => {
    const { page, seen, close } = await open('/pilot.html?pilot=1&briefed=1&lang=en', { data: { knowledge: [] } });
    await ready(page);
    assert.match(await page.textContent('.brief-action'), /From the standard curriculum, chosen for next-step confirmation\./);
    assert.equal(await page.locator('[data-brief-focus]').count(), 0);
    await page.click('[data-brief-confirm]');
    await page.waitForSelector('.brief-action.is-done');
    assert.equal(seen.posts[0].scenarioId, 'IHFC-02');
    assert.equal(seen.posts[0].customScenario, undefined);
    await close();
  });

  test('with no Practice on record it judges no one and offers a first Practice', async () => {
    const { page, close } = await open('/pilot.html?pilot=1&briefed=1&lang=en', { data: { sessions: [], assignments: [] } });
    await ready(page);
    assert.match(await page.textContent('.brief-headline'), /no Practice on record yet, so I am not going to guess about anyone/);
    assert.equal(await page.locator('.brief-evidence').count(), 0);
    assert.match(await page.textContent('[data-brief-confirm]'), /Confirm and assign to Amy Wong/);
    await close();
  });

  test('a learner sees neither the brief nor the Studios guide', async () => {
    const { page, close } = await open('/pilot.html?pilot=1&lang=en', { roles: ['learner'] });
    await page.waitForSelector('.next');
    assert.equal(await page.locator('#ai-brief').count(), 0);
    assert.equal(await page.locator('#ai-guide').count(), 0);
    await close();
  });

  test('the brief replaces the generic welcome card for managers; learners still get theirs', async () => {
    const manager = await open('/pilot.html?pilot=1&briefed=1&lang=en', { withEdge: true });
    await ready(manager.page);
    await manager.page.waitForTimeout(600);
    assert.equal(await manager.page.locator('#firstImpression').count(), 0);
    assert.equal(await manager.page.locator('#app > *').first().getAttribute('id'), 'ai-brief');
    await manager.close();
    const learner = await open('/pilot.html?pilot=1&lang=en', { roles: ['learner'], withEdge: true });
    await learner.page.waitForSelector('#firstImpression', { state: 'visible' });
    await learner.close();
  });

  test('the Studios guide describes Client and Knowledge Studio without stale disclaimers', async () => {
    const { page, close } = await open('/pilot.html?pilot=1&briefed=1&lang=en');
    await ready(page);
    await page.click('[data-guide-topic="client"]');
    const client = await page.textContent('#ai-guide-result');
    assert.match(client, /linked to scenario Practice/);
    assert.doesNotMatch(client, /not yet live|planned/i);
    assert.match(await page.getAttribute('#ai-guide-chat', 'href'), /guide=client/);
    await page.click('[data-guide-topic="knowledge"]');
    assert.match(await page.textContent('#ai-guide-result'), /turned into Practice and question banks/);
    await close();
  });
});

describe('“Ask the AI why first” carries the context into Manager AI Copilot', () => {
  test('selects the member, asks once, and a reload does not ask again', async () => {
    const home = await open('/pilot.html?pilot=1&briefed=1&lang=en');
    await ready(home.page);
    const href = await home.page.getAttribute('.brief-action a.brief-secondary', 'href');
    assert.match(href, /^manager-chat\.html\?pilot=1&lang=en&learner=michelle%40example\.com&brief=closing$/);
    await home.close();

    const { page, seen, close } = await open('/' + href);
    await page.waitForSelector('.message.assistant');
    assert.equal(seen.chat.length, 1);
    assert.equal(seen.chat[0].learnerEmail, fx.MICHELLE);
    assert.match(seen.chat[0].message, /^Michelle Chen scored lowest on next-step confirmation/);
    assert.equal(await page.inputValue('#learnerSelect'), fx.MICHELLE);
    assert.match(await page.textContent('#briefContext'), /Continuing from today’s brief: Michelle Chen/);
    assert.match(await page.getAttribute('#briefContext a', 'href'), /pilot\.html\?pilot=1&briefed=1/);
    assert.doesNotMatch(page.url(), /brief=|learner=/);
    await page.reload();
    await page.waitForSelector('.welcome');
    assert.equal(seen.chat.length, 1);
    await close();
  });

  test('a member who is not on the roster is ignored', async () => {
    const { page, seen, close } = await open('/manager-chat.html?pilot=1&lang=en&learner=stranger%40example.com&brief=closing');
    await page.waitForSelector('.welcome');
    await page.waitForTimeout(300);
    assert.equal(seen.chat.length, 0);
    assert.equal(await page.locator('#briefContext').count(), 0);
    await close();
  });
});
