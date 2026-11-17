// Headless-browser coverage for the Manager AI Brief, Manager AI Copilot and
// the shared sign-in recovery in pilot-cloud.js. The real pages and scripts
// run in Chromium against a local static server. Netlify Identity is replaced
// by a small in-page stand-in whose tokens can be expired, refreshed or
// revoked on demand; every /.netlify/* call is answered from memory. Nothing
// real is contacted and no real credential exists anywhere in these tests.
//
// Run with: npm test
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { startStaticServer } from './static-server.mjs';
import * as fx from './fixtures-manager-brief.mjs';

const MANAGER = 'manager@example.com';

// Stand-in for the Identity widget. jwt() mirrors gotrue-js: it returns the
// current token, refreshes when asked to, and when a refresh is refused it
// clears the session and rejects (which is what logs the real widget out).
const widget = (email, roles, firstExpiry = 0) => `(() => {
  const state = window.__identity = { refreshes: 0, refuseRefresh: false, logins: [], firstExpiry: ${Number(firstExpiry)}, current: null };
  // Like gotrue-js, every user object owns its tokens, and the widget has one "current user"
  // per browser that a sign-in from any tab replaces. With firstExpiry set, tokens are shaped
  // like real JWTs (header.payload.signature) and each refresh is valid one hour longer.
  const make = (address, userRoles, serial) => {
    const self = { email: address, app_metadata: { roles: userRoles }, serial,
      token: () => state.firstExpiry
        ? 'h.' + btoa(JSON.stringify({ exp: state.firstExpiry + (self.serial - 1) * 3600, email: address })).replace(/=+$/, '') + '.s' + self.serial
        : 'token-' + address + '-' + self.serial,
      jwt: async force => {
        if (force) {
          if (state.refuseRefresh) { if (state.current === self) state.current = null; throw new Error('invalid_grant'); }
          state.refreshes += 1; self.serial += 1;
        }
        return self.token();
      } };
    return self;
  };
  state.current = make(${JSON.stringify(email)}, ${JSON.stringify(roles)}, 1);
  // What a sign-in from another tab does to this tab's widget.
  state.signInElsewhere = (address, userRoles) => { state.current = make(address, userRoles, 50); };
  window.netlifyIdentity = { init() {}, currentUser: () => state.current, on() {}, open() {}, close() {}, logout: async () => { state.current = null; },
    gotrue: { login: async (address, password) => {
      state.logins.push(address);
      if (password !== 'correct') throw new Error('Invalid login');
      state.refuseRefresh = false;
      state.current = make(address, address === ${JSON.stringify(MANAGER)} ? ['manager'] : ['learner'], 20);
      return state.current;
    } } };
})();`;

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

// server.rejected: tokens the "server" refuses with 401, as Netlify does for
// an expired token. server.assignments is what was actually persisted.
async function open(path, { email = MANAGER, roles = ['manager'], data = {}, withEdge = false, chatReply = null, lang, firstExpiry = 0, serverAheadSeconds = 0 } = {}) {
  const context = await browser.newContext({ reducedMotion: 'reduce', timezoneId: 'America/Los_Angeles' });
  const page = await context.newPage();
  const server = { rejected: new Set(), assignments: [...(data.assignments ?? fx.assignments)], posts: [], unauthorized: 0, chat: [], tokens: [], dropNext: 0, forbidNext: 0, errors: [], elapsedSeconds: 0 };
  page.on('pageerror', error => server.errors.push(error.message));
  await page.clock.setFixedTime(new Date(fx.NOW));
  await page.route('https://identity.netlify.com/**', r => r.fulfill({ contentType: 'text/javascript', body: widget(email, roles, firstExpiry) }));
  await page.route('**/openai-voice.js**', r => r.fulfill({ contentType: 'text/javascript', body: '' }));
  if (withEdge) {
    await page.route('**/pilot.html**', async route => {
      const response = await route.fetch();
      route.fulfill({ response, body: (await response.text()).replace('</body>', EDGE_INJECTION + '\n</body>') });
    });
  }
  // The server's own clock, which may be ahead of the device's (fx.NOW).
  const serverNow = () => Date.parse(fx.NOW) / 1000 + serverAheadSeconds + server.elapsedSeconds;
  const stamp = () => (serverAheadSeconds ? { date: new Date(serverNow() * 1000).toUTCString() } : {});
  const claims = token => { try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString()); } catch { return null; } };
  const signedInAs = route => {
    const token = (route.request().headers().authorization || '').replace(/^Bearer /, '');
    server.tokens.push(token);
    const jwt = token.split('.').length === 3 ? claims(token) : null;
    if (jwt) {
      if (jwt.exp <= serverNow()) { server.unauthorized += 1; route.fulfill({ status: 401, headers: stamp(), contentType: 'application/json', body: JSON.stringify({ error: 'Please sign in to continue.' }) }); return null; }
      return jwt.email;
    }
    if (!token || server.rejected.has(token)) { server.unauthorized += 1; route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Please sign in to continue.' }) }); return null; }
    return token.replace(/^token-/, '').replace(/-\d+$/, '');
  };
  await page.route('**/.netlify/functions/pilot-data**', route => {
    const who = signedInAs(route);
    if (!who) return;
    const resource = new URL(route.request().url()).searchParams.get('resource');
    if (route.request().method() === 'POST' && resource === 'assignments') {
      if (server.dropNext-- > 0) return route.abort('connectionreset');
      if (server.forbidNext-- > 0 || who !== MANAGER) return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'Manager access is required.' }) });
      const body = route.request().postDataJSON();
      server.posts.push(body);
      const existing = server.assignments.find(a => a.id === body.requestId);
      if (existing) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ assignment: existing, duplicate: true }) });
      const record = { status: 'Assigned', createdAt: fx.NOW, ...body, id: body.requestId || 'new-1' };
      server.assignments.unshift(record);
      return route.fulfill({ status: 201, headers: stamp(), contentType: 'application/json', body: JSON.stringify({ assignment: record }) });
    }
    const body = resource === 'me' ? { email: who, roles: who === MANAGER ? ['manager'] : ['learner'], teamId: 't' }
      : resource === 'assignments' ? { assignments: server.assignments }
      : resource === 'sessions' ? { sessions: data.sessions ?? fx.sessions }
      : resource === 'profiles' ? { profiles: data.profiles ?? fx.profiles }
      : resource === 'knowledge' ? { sources: data.knowledge ?? fx.knowledge }
      : resource === 'manager-chat' ? { profiles: (data.profiles ?? fx.profiles).map(p => ({ learnerEmail: p.learnerEmail, preferredName: p.preferredName })), messages: [] }
      : {};
    route.fulfill({ headers: stamp(), contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/.netlify/functions/manager-ai-chat**', route => {
    if (!signedInAs(route)) return;
    const body = route.request().postDataJSON();
    server.chat.push(body);
    const reply = typeof chatReply === 'function' ? chatReply(body) : (chatReply || { text: 'ok' });
    route.fulfill({ contentType: 'application/json', body: JSON.stringify({ dataVersion: 'manager-evidence-v3', learnerEmail: body.learnerEmail || null, ...reply }) });
  });
  await page.route('**/.netlify/functions/pilot-roster**', r => r.fulfill({ contentType: 'application/json', body: '{"learners":[]}' }));
  await page.route('**/.netlify/functions/pilot-invite**', r => r.fulfill({ contentType: 'application/json', body: '{"invites":[]}' }));
  await page.goto(baseUrl + path + (lang ? (path.includes('?') ? '&' : '?') + 'lang=' + lang : ''));
  return { page, server, close: () => context.close(), identity: fn => page.evaluate(fn) };
}
const HOME = '/pilot.html?pilot=1&briefed=1';
const ready = page => page.waitForSelector('.brief-recommended:not([aria-busy]), .brief-existing');
const stale = { sessions: fx.staleSessions, profiles: fx.staleProfiles, assignments: fx.staleAssignments, knowledge: fx.assessedKnowledge };
const currentToken = page => page.evaluate(() => window.__identity.current.token());

describe('Manager AI Brief: recent Practice', () => {
  test('opens with a 14-day finding, the member’s own words, and a recommended Practice with its reasons', async () => {
    const { page, server, close } = await open(HOME, { lang: 'en' });
    await ready(page);
    assert.match(await page.textContent('.brief-headline'), /In the past 14 days, 3 of the 4 team members who practiced scored lowest on next-step confirmation\.\s*Michelle Chen has dropped the most: 72 → 61 → 55\./);
    assert.match(await page.textContent('.brief-basis'), /Past 14 days: 7 Practice sessions by 4 members/);
    assert.match(await page.textContent('.brief-evidence .brief-label'), /^Evidence$/);
    assert.match(await page.textContent('.brief-when'), /Practiced Nov 14, 2026, 2 days ago\. Within the past 14 days\./);
    assert.match(await page.textContent('.brief-turn.is-marked mark'), /慢慢考虑/);
    assert.match(await page.textContent('.brief-margin'), /line 4 of 5/);
    assert.match(await page.textContent('.brief-recommended .brief-label'), /^Recommended Practice$/);
    assert.match(await page.textContent('.brief-recommended'), /material you approved: “高净值客户首次面谈指引”/);
    const why = await page.textContent('.brief-why');
    assert.match(why, /Needs work.*next-step confirmation: 55\/100 on Nov 14, 2026\./);
    assert.match(why, /Match not assessed\. This material has no relevance assessment yet/);
    assert.match(why, /What to look for next.*proposes one specific next step with a day or time/);
    assert.match(await page.textContent('.brief-loop'), /Kevin Zhao finished .* next-step confirmation 52 \(Oct 27, 2026\) → 70 \(Nov 15, 2026\)/);
    assert.match(await page.getAttribute('.brief-evidence .brief-link', 'href'), /^manager\.html\?pilot=1&result=s-m3$/);
    assert.equal(await page.locator('#ai-brief ~ .next').count(), 0, 'the old "next action" card is replaced by the brief');
    assert.equal(server.posts.length, 0, 'nothing is assigned by loading the page');
    assert.deepEqual(server.errors, []);
    await close();
  });

  test('assigns exactly once on Confirm, keeps the finding, and the success state survives a reload', async () => {
    const { page, server, close } = await open(HOME, { lang: 'zh' });
    await ready(page);
    const headline = await page.textContent('.brief-headline');
    await page.selectOption('[data-brief-mode]', 'standard');
    await page.click('[data-brief-confirm]');
    await page.waitForSelector('.brief-existing.is-new');
    assert.equal(server.posts.length, 1);
    assert.equal(server.posts[0].assignedTo, fx.MICHELLE);
    assert.equal(server.posts[0].mode, 'standard');
    assert.equal(server.posts[0].sourceKnowledgeId, 'k-hnw');
    assert.match(server.posts[0].requestId, /^[0-9a-f-]{36}$/);
    assert.match(server.posts[0].customScenario.objective, /主管辅导重点/);
    assert.equal(await page.textContent('.brief-headline'), headline);
    assert.match(await page.textContent('.brief-existing'), /今天已指派给 Michelle Chen.*争取与企业主的第一次面谈.*还没开始/s);
    assert.equal(await page.locator('[data-brief-confirm]').count(), 0, 'no second Confirm for the same member');
    await page.reload();
    await ready(page);
    await page.click(`[data-brief-member="${fx.MICHELLE}"]`);
    assert.match(await page.textContent('.brief-existing.is-new'), /今天已指派给 Michelle Chen/);
    assert.equal(server.posts.length, 1, 'reloading does not assign again');
    await close();
  });

  test('unticking the coaching focus sends the Practice as approved', async () => {
    const { page, server, close } = await open(HOME, { lang: 'zh' });
    await ready(page);
    await page.uncheck('[data-brief-focus]');
    await page.click('[data-brief-confirm]');
    await page.waitForSelector('.brief-existing.is-new');
    assert.equal(server.posts[0].customScenario.objective, fx.knowledge[0].analysis.practiceDraft.objective);
    await close();
  });

  test('a member with an open assignment shows it as an existing assignment; a second one needs a deliberate step', async () => {
    const { page, server, close } = await open(HOME, { lang: 'en' });
    await ready(page);
    assert.match(await page.textContent(`[data-brief-member="${fx.AMY}"]`), /assignment open/);
    await page.click(`[data-brief-member="${fx.AMY}"]`);
    const existing = await page.textContent('.brief-existing');
    assert.match(existing, /Existing assignment.*Amy Wong already has a Practice assigned.*我會再考慮看看.*Not started.*Assigned Nov 14, 2026, 2 days ago/s);
    assert.equal(await page.locator('.brief-recommended').count(), 0, 'no recommendation is shown beside an open assignment by default');
    assert.equal(await page.locator('[data-brief-confirm]').count(), 0);
    assert.match(await page.getAttribute('.brief-existing a.brief-secondary', 'href'), /^team-messages\.html\?pilot=1&learner=amy%40example\.com$/);
    await page.click('[data-brief-another]');
    assert.match(await page.textContent('[data-brief-confirm]'), /Confirm and assign a second Practice to Amy Wong/);
    assert.match(await page.textContent('.brief-recommended'), /Amy Wong will then have two open assignments/);
    assert.equal(server.posts.length, 0);
    await close();
  });

  test('without approved Company Knowledge it offers the standard Practice for that competency', async () => {
    const { page, server, close } = await open(HOME, { lang: 'en', data: { knowledge: [] } });
    await ready(page);
    assert.match(await page.textContent('.brief-recommended'), /From the standard curriculum\./);
    assert.match(await page.textContent('.brief-why'), /Written for next-step confirmation\. This is a standard-curriculum Practice, not built from your company material\./);
    assert.equal(await page.locator('[data-brief-focus]').count(), 0);
    await page.click('[data-brief-confirm]');
    await page.waitForSelector('.brief-existing.is-new');
    assert.equal(server.posts[0].scenarioId, 'IHFC-02');
    assert.equal(server.posts[0].customScenario, undefined);
    await close();
  });

  test('a member with no completed Practice is labelled as such, apart from members with records', async () => {
    const { page, close } = await open(HOME, { lang: 'en' });
    await ready(page);
    assert.match(await page.textContent('[data-brief-member="grace@example.com"]'), /Grace Lin\s*no Practice yet/);
    await page.click('[data-brief-member="grace@example.com"]');
    assert.match(await page.textContent('.brief-evidence'), /No Practice evidence for Grace Lin yet.*there is no record at all/s);
    assert.match(await page.textContent('.brief-why'), /Not known yet\. Grace Lin has no Practice on record/);
    await close();
  });

  test('with no Practice on record at all it judges no one and offers a first Practice', async () => {
    const { page, close } = await open(HOME, { lang: 'en', data: { sessions: [], assignments: [] } });
    await ready(page);
    assert.match(await page.textContent('.brief-headline'), /no Practice on record yet, so I am not going to guess about anyone/);
    assert.equal(await page.locator('.brief-evidence').count(), 0);
    assert.match(await page.textContent('[data-brief-confirm]'), /Confirm and assign to Amy Wong/);
    await close();
  });

  test('a learner sees neither the brief nor the Studios guide', async () => {
    const { page, close } = await open('/pilot.html?pilot=1', { email: 'amy@example.com', roles: ['learner'], lang: 'en' });
    await page.waitForSelector('.next');
    assert.equal(await page.locator('#ai-brief').count(), 0);
    assert.equal(await page.locator('#ai-guide').count(), 0);
    await close();
  });

  test('the brief replaces the generic welcome card for managers; learners still get theirs', async () => {
    const manager = await open(HOME, { withEdge: true, lang: 'en' });
    await ready(manager.page);
    await manager.page.waitForTimeout(600);
    assert.equal(await manager.page.locator('#firstImpression').count(), 0);
    assert.equal(await manager.page.locator('#app > *').first().getAttribute('id'), 'ai-brief');
    await manager.close();
    const learner = await open('/pilot.html?pilot=1', { email: 'amy@example.com', roles: ['learner'], withEdge: true, lang: 'en' });
    await learner.page.waitForSelector('#firstImpression', { state: 'visible' });
    await learner.close();
  });

  test('the Studios guide describes Client and Knowledge Studio without stale disclaimers', async () => {
    const { page, close } = await open(HOME, { lang: 'en' });
    await ready(page);
    await page.click('[data-guide-topic="client"]');
    const client = await page.textContent('#ai-guide-result');
    assert.match(client, /linked to scenario Practice/);
    assert.doesNotMatch(client, /not yet live|planned/i);
    await page.click('[data-guide-topic="knowledge"]');
    assert.match(await page.textContent('#ai-guide-result'), /turned into Practice and question banks/);
    await close();
  });
});

describe('Manager AI Brief: historical records (owner UAT of 2026-11-16)', () => {
  test('three-month-old Practice is never presented as a 14-day result (English)', async () => {
    const { page, close } = await open(HOME, { lang: 'en', data: stale });
    await ready(page);
    const headline = await page.textContent('.brief-headline');
    assert.match(headline, /No one on the team has practiced in the past 14 days\./);
    assert.match(headline, /The most recent Practice on record is from Aug 19, 2026, 89 days ago\. What is shown below is a historical record, not current performance\./);
    assert.doesNotMatch(headline, /In the past 14 days,|dropped|slipping|lowest right now/);
    assert.match(await page.textContent('.brief-basis'), /No Practice in the past 14 days\. All-time record: 2 sessions by 2 members/);
    assert.match(await page.textContent('.brief-when.is-old'), /Historical record\. Practiced Aug 13, 2026, 95 days ago: older than 14 days, so it does not describe current performance\./);
    assert.match(await page.textContent('#brief-evidence-title'), /What Ana Ruiz said on Aug 13, 2026/);
    assert.match(await page.textContent('.brief-context'), /The only Practice on record for Ana Ruiz\./);
    assert.match(await page.textContent('.brief-recommended'), /A fresh Practice for Ana Ruiz.*The last record is 95 days old/s);
    assert.match(await page.textContent(`[data-brief-member="${fx.BEN}"]`), /last Practice Aug 19, 2026/);
    assert.doesNotMatch(await page.textContent('#ai-brief'), /→/, 'no before-and-after arrow anywhere when every member has a single Practice');
    await close();
  });

  test('the same in Chinese', async () => {
    const { page, close } = await open(HOME, { lang: 'zh', data: stale });
    await ready(page);
    assert.match(await page.textContent('.brief-headline'), /过去 14 天，团队里没有人做过练习。.*历史记录，不代表目前的表现/s);
    assert.match(await page.textContent('.brief-when.is-old'), /历史记录。.*95 天前.*已超过 14 天，不代表目前的表现/);
    assert.match(await page.textContent('.brief-basis'), /近 14 天没有练习。历史记录共 2 位成员、2 次练习/);
    await close();
  });

  test('the P2 60/100 underwriting material is explained as a partial match, with the reason it is listed first', async () => {
    const { page, close } = await open(HOME, { lang: 'en', data: stale });
    await ready(page);
    const why = await page.textContent('.brief-why');
    assert.match(why, /Needs work.*next-step confirmation: 25\/100 on Aug 13, 2026 \(historical record, 95 days ago\)\./);
    assert.match(why, /Partial match\. This material is assessed as covering next-step confirmation, but its team relevance is only moderate \(team relevance P2, 60\/100\)\./);
    assert.match(why, /Listed first of 3 because it is the only approved material assessed as covering next-step confirmation\./);
    assert.match(await page.textContent('.brief-recommended'), /Training objective: Explain the underwriting steps accurately and agree the next step\./);
    assert.match(await page.textContent('.brief-recommended'), /A relevance rating describes the material\. It does not predict that Ana Ruiz’s score will improve\./);
    await page.selectOption('[data-brief-candidate]', 'knowledge-k-brand');
    assert.match(await page.textContent('.brief-why'), /Weak match\. This material was assessed and is not tagged for next-step confirmation.*Your choice\. The first-listed Practice is/s);
    await close();
  });

  test('an assignment open for 42 days is shown with its age and a reminder action, not a silent new recommendation', async () => {
    const { page, server, close } = await open(HOME, { lang: 'en', data: stale });
    await ready(page);
    await page.click(`[data-brief-member="${fx.BEN}"]`);
    const existing = await page.textContent('.brief-existing.is-overdue');
    assert.match(existing, /Ben Cho already has a Practice assigned.*Handling Skeptical Clients.*Not started.*Assigned Oct 5, 2026 and still open after 42 days\. A reminder is probably more useful than another assignment\./s);
    assert.match(existing, /Write Ben Cho a reminder.*Nothing is sent from here/s);
    assert.equal(await page.locator('.brief-recommended').count(), 0);
    assert.match(await page.textContent('.brief-evidence'), /saved without a transcript, so there are no words to quote.*Moved to price before acknowledging the concern\./s);
    assert.match(await page.textContent('.brief-loop li.is-overdue'), /Ben Cho .*assigned 42 days ago/);
    await page.click('.brief-existing [data-brief-member]');
    assert.match(await page.textContent('#brief-evidence-title'), /Ana Ruiz/);
    assert.equal(server.posts.length, 0);
    await close();
  });
});

describe('Assignment sign-in reliability', () => {
  test('a token the server no longer accepts is refreshed and the assignment goes through, with no prompt', async () => {
    const { page, server, close, identity } = await open(HOME, { lang: 'en' });
    await ready(page);
    server.rejected.add(await currentToken(page)); // expired on the server; the browser still considers it valid
    await page.click('[data-brief-confirm]');
    await page.waitForSelector('.brief-existing.is-new');
    assert.equal(server.unauthorized, 1, 'the stale token was refused once');
    assert.equal(server.posts.length, 1, 'then the assignment was accepted once');
    assert.equal(server.assignments.filter(a => a.assignedTo === fx.MICHELLE).length, 1);
    assert.equal(await identity(() => window.__identity.refreshes), 1);
    assert.equal(await page.locator('#pilot-auth-gate').count(), 0, 'the manager was never asked to sign in');
    assert.equal(await page.locator('.brief-error').count(), 0);
    await close();
  });

  test('reloading with a token the server refuses loads the workspace instead of failing', async () => {
    const { page, server, close } = await open(HOME, { lang: 'en' });
    await ready(page);
    server.rejected.add(await currentToken(page));
    await page.reload();
    await ready(page);
    assert.equal(await page.locator('.status').count(), 0, 'no "Could not load the secure workspace"');
    assert.match(await page.textContent('.brief-headline'), /In the past 14 days/);
    await close();
  });

  test('when the session cannot be refreshed, the manager signs in again in place and the confirmed assignment completes once', async () => {
    const { page, server, close, identity } = await open(HOME, { lang: 'en' });
    await ready(page);
    server.rejected.add(await currentToken(page));
    await identity(() => { window.__identity.refuseRefresh = true; });
    await page.click('[data-brief-confirm]');
    await page.waitForSelector('#pilot-auth-gate', { state: 'visible' });
    assert.match(await page.textContent('#pilot-auth-message'), /Your sign-in has expired\. Sign in again as manager@example\.com to continue\. Nothing on this page has been lost\./);
    assert.equal(await page.inputValue('#pilot-auth-email'), MANAGER, 'the manager account is pre-filled; no other account is suggested');
    assert.equal(server.posts.length, 0, 'nothing was assigned while signed out');
    await page.fill('#pilot-auth-password', 'wrong');
    await page.click('#pilot-auth-form button');
    await page.waitForFunction(() => document.getElementById('pilot-auth-status').textContent.includes('Invalid login'));
    await page.fill('#pilot-auth-password', 'correct');
    await page.click('#pilot-auth-form button');
    await page.waitForSelector('.brief-existing.is-new');
    assert.equal(await page.isVisible('#pilot-auth-gate'), false);
    assert.equal(server.posts.length, 1, 'the assignment the manager confirmed was sent once after signing in');
    assert.match(await page.textContent('.brief-existing'), /Assigned to Michelle Chen today/);
    await close();
  });

  test('a dropped connection is reported as a network problem and a retry completes the assignment', async () => {
    const { page, server, close } = await open(HOME, { lang: 'en' });
    await ready(page);
    server.dropNext = 1;
    await page.click('[data-brief-confirm]');
    await page.waitForSelector('.brief-error');
    assert.match(await page.textContent('.brief-error'), /Not confirmed\. The connection dropped before the server answered\. Press Confirm again: if the first attempt did arrive, it will not create a second assignment\./);
    assert.equal(await page.locator('#pilot-auth-gate').count(), 0, 'a network failure does not ask the manager to sign in');
    await page.click('[data-brief-confirm]');
    await page.waitForSelector('.brief-existing.is-new');
    assert.equal(server.posts.length, 1);
    await close();
  });

  test('the retry after a failure repeats the same request id, and a repeated id does not persist a second assignment', async () => {
    const { page, server, close } = await open(HOME, { lang: 'en' });
    await ready(page);
    const seen = [];
    await page.route('**/.netlify/functions/pilot-data?resource=assignments', async route => {
      if (route.request().method() !== 'POST') return route.fallback();
      seen.push(route.request().postDataJSON().requestId);
      if (seen.length === 1) {
        // The server stores the assignment, but the reply never reaches the browser.
        server.assignments.unshift({ status: 'Assigned', createdAt: fx.NOW, ...route.request().postDataJSON(), id: seen[0] });
        return route.abort('connectionreset');
      }
      return route.fallback();
    });
    await page.click('[data-brief-confirm]');
    await page.waitForSelector('.brief-error');
    await page.click('[data-brief-confirm]');
    await page.waitForSelector('.brief-existing.is-new');
    assert.equal(seen.length, 2);
    assert.equal(seen[0], seen[1], 'same request id on the retry');
    assert.equal(server.assignments.filter(a => a.assignedTo === fx.MICHELLE).length, 1, 'one assignment persisted, not two');
    await close();
  });

  test('controlled expiry with a device clock 10 minutes behind the server: recovered at load, then refreshed ahead of time', async () => {
    const now = Date.parse(fx.NOW) / 1000;
    // The token expires 5 minutes from now by the device clock, so the widget calls it valid.
    // By the server clock (10 minutes ahead) it expired 5 minutes ago.
    const { page, server, close, identity } = await open(HOME, { lang: 'en', firstExpiry: now + 300, serverAheadSeconds: 600 });
    await ready(page);
    assert.ok(server.unauthorized >= 1, 'the first token was refused as expired');
    assert.equal(await page.locator('.status').count(), 0, 'the workspace still loaded');
    assert.equal(await page.locator('#pilot-auth-gate').count(), 0);
    const refusedAtLoad = server.unauthorized;
    // 54.5 minutes later the refreshed token has 15 minutes left by the device clock,
    // but only 30 seconds by the server clock. It must be renewed before it is sent.
    const refreshesBefore = await identity(() => window.__identity.refreshes);
    server.elapsedSeconds = 3270;
    await page.clock.setFixedTime(new Date((now + 3270) * 1000));
    await page.click('[data-brief-confirm]');
    await page.waitForSelector('.brief-existing');
    assert.equal(server.posts.length, 1);
    assert.equal(server.unauthorized, refusedAtLoad, 'no request was refused this time');
    assert.equal(await identity(() => window.__identity.refreshes), refreshesBefore + 1, 'renewed once, ahead of server-side expiry');
    await close();
  });

  test('a permission failure is reported as such, not as a sign-in problem', async () => {
    const { page, server, close } = await open(HOME, { lang: 'en' });
    await ready(page);
    server.forbidNext = 1;
    await page.click('[data-brief-confirm]');
    await page.waitForSelector('.brief-error');
    assert.match(await page.textContent('.brief-error'), /Not sent\. This account does not have manager access, so it cannot assign Practice\./);
    assert.equal(await page.locator('#pilot-auth-gate').count(), 0);
    await close();
  });

  test('if another tab signs this browser in as a learner, the manager’s page keeps acting as the manager', async () => {
    const { page, server, close, identity } = await open(HOME, { lang: 'en' });
    await ready(page);
    await identity(() => window.__identity.signInElsewhere('amy@example.com', ['learner']));
    const before = server.tokens.length;
    await page.click('[data-brief-confirm]');
    await page.waitForSelector('.brief-existing.is-new');
    assert.equal(server.posts.length, 1);
    assert.equal(server.tokens.slice(before).some(token => token.includes('amy@example.com')), false, 'the learner’s token was never used for the manager’s action');
    assert.equal(await page.locator('#pilot-auth-gate').count(), 0, 'the manager is not asked to sign in at all');
    await close();
  });

  test('if the manager’s own session has also ended by then, the manager account is asked for by name, never the learner', async () => {
    const { page, server, close, identity } = await open(HOME, { lang: 'en' });
    await ready(page);
    server.rejected.add(await currentToken(page));
    await identity(() => { window.__identity.signInElsewhere('amy@example.com', ['learner']); window.__identity.refuseRefresh = true; });
    const before = server.tokens.length;
    await page.click('[data-brief-confirm]');
    await page.waitForSelector('#pilot-auth-gate', { state: 'visible' });
    assert.match(await page.textContent('#pilot-auth-message'), /signed in to a different account in another tab\. Sign in again as manager@example\.com to continue/);
    assert.equal(await page.inputValue('#pilot-auth-email'), MANAGER);
    assert.equal(server.tokens.slice(before).some(token => token.includes('amy@example.com')), false);
    assert.equal(server.posts.length, 0);
    await page.fill('#pilot-auth-password', 'correct');
    await page.click('#pilot-auth-form button');
    await page.waitForSelector('.brief-existing.is-new');
    assert.equal(server.posts.length, 1);
    await close();
  });

  test('no token, password or authorization value is written to the console', async () => {
    const { page, server, close } = await open(HOME, { lang: 'en' });
    const logged = [];
    page.on('console', message => logged.push(message.text()));
    await ready(page);
    server.rejected.add(await currentToken(page));
    await page.click('[data-brief-confirm]');
    await page.waitForSelector('.brief-existing.is-new');
    assert.ok(logged.some(text => /not accepted as signed in/.test(text)), 'the recovery is noted');
    assert.equal(logged.some(text => /token-|Bearer|password/i.test(text)), false);
    await close();
  });
});

describe('Manager AI Copilot: evidence and member context', () => {
  const evidence = (overrides = {}) => ({
    member: { learnerEmail: fx.MICHELLE, preferredName: 'Michelle Chen' }, status: 'verbatim',
    sessions: [{ ref: 'S1', sessionId: 's-m3', practiceDate: '2026-11-14', savedAt: fx.sessions.find(s => s.id === 's-m3').savedAt, daysAgo: 2, scenario: '我會再考慮看看', overall: 71, transcriptStatus: 'verbatim', lineCount: 5, isFocus: true }],
    latestPracticeAt: fx.sessions.find(s => s.id === 's-m3').savedAt, daysSinceLatest: 2, verifiedQuotes: [], unverifiedQuotes: [], ...overrides
  });

  test('“Ask the AI why first” carries the member and the exact Practice session, and asks once', async () => {
    const home = await open(HOME, { lang: 'en' });
    await ready(home.page);
    const href = await home.page.getAttribute('.brief-recommended a.brief-secondary', 'href');
    assert.equal(href, 'manager-chat.html?pilot=1&lang=en&learner=michelle%40example.com&brief=closing&session=s-m3');
    await home.close();

    const reply = { text: 'Michelle Chen ended with “好的，没问题，那您慢慢考虑，有需要随时找我。” [S1 L4]', evidence: evidence({ verifiedQuotes: [{ text: '好的，没问题，那您慢慢考虑，有需要随时找我。', ref: 'S1', sessionId: 's-m3', line: 4, speaker: 'learner' }] }) };
    const { page, server, close } = await open('/' + href, { chatReply: reply });
    await page.waitForSelector('.message.assistant');
    assert.equal(server.chat.length, 1);
    assert.equal(server.chat[0].learnerEmail, fx.MICHELLE);
    assert.equal(server.chat[0].focusSessionId, 's-m3');
    assert.equal(server.chat[0].timeZone, 'America/Los_Angeles');
    assert.match(server.chat[0].message, /^Michelle Chen scored lowest on next-step confirmation/);
    assert.match(await page.textContent('.message.assistant .cite'), /Nov 14, 2026 · line 4/);
    const note = await page.textContent('.evidence.verified');
    assert.match(note, /1 quotation checked against Michelle Chen’s Practice transcript/);
    assert.match(note, /Michelle Chen, Nov 14, 2026 “我會再考慮看看”, line 4/);
    assert.equal(await page.getAttribute('.evidence.verified a', 'href'), 'manager.html?pilot=1&result=s-m3');
    assert.doesNotMatch(page.url(), /brief=|learner=|session=/);
    await page.reload();
    await page.waitForSelector('.welcome');
    assert.equal(server.chat.length, 1, 'a reload does not ask again');
    await close();
  });

  test('a quotation that is not in the transcript is flagged, in Chinese too', async () => {
    const reply = { text: '她说“我周五上午给您送文件过去”。', evidence: evidence({ unverifiedQuotes: [{ text: '我周五上午给您送文件过去', cited: null }] }) };
    const { page, close } = await open('/manager-chat.html?pilot=1&learner=michelle%40example.com&brief=closing', { chatReply: reply, lang: 'zh' });
    await page.waitForSelector('.evidence.caution');
    assert.match(await page.textContent('.evidence.caution'), /1 处引文不在已保存的对话里.*请不要当作 Michelle Chen 的原话：“我周五上午给您送文件过去”/s);
    assert.equal(await page.locator('.evidence.verified').count(), 0);
    await close();
  });

  test('a session saved without a transcript is labelled summary-based, with its age when it is old', async () => {
    const old = fx.staleSessions[1];
    const reply = { text: 'No verbatim conversation was saved for that Practice.', evidence: { member: { learnerEmail: fx.BEN, preferredName: 'Ben Cho' }, status: 'summary_only', sessions: [{ ref: 'S1', sessionId: 's-ben', savedAt: old.savedAt, daysAgo: 89, scenario: 'Premium Is Too High', overall: 51, transcriptStatus: 'unavailable', lineCount: 0, isFocus: false }], latestPracticeAt: old.savedAt, daysSinceLatest: 89, verifiedQuotes: [], unverifiedQuotes: [] } };
    const { page, close } = await open('/manager-chat.html?pilot=1&learner=ben%40example.com&brief=empathy', { chatReply: reply, data: stale, lang: 'en' });
    await page.waitForSelector('.evidence.caution');
    const note = await page.textContent('.evidence.caution');
    assert.match(note, /Summary-based, not a direct quotation.*Ben Cho’s Practice \(Aug 19, 2026 “Premium Is Too High”\) was saved without a transcript/s);
    assert.match(note, /Historical record: Ben Cho’s latest Practice was Aug 19, 2026 \(89 days ago\)\. It does not describe current performance\./);
    await close();
  });

  test('switching members is marked in the conversation and the other member’s turns are not sent as history', async () => {
    const { page, server, close } = await open('/manager-chat.html?pilot=1', { lang: 'en', chatReply: body => ({ text: 'About ' + (body.learnerEmail || 'no one'), userMessage: { role: 'user', content: body.message, learnerEmail: body.learnerEmail, createdAt: fx.NOW }, assistantMessage: { role: 'assistant', content: 'About ' + (body.learnerEmail || 'no one'), learnerEmail: body.learnerEmail, createdAt: fx.NOW } }) });
    await page.waitForSelector('#learnerSelect option[value="michelle@example.com"]', { state: 'attached' });
    await page.selectOption('#learnerSelect', fx.MICHELLE);
    await page.fill('#chat-input', 'How did her last Practice go?');
    await page.click('#sendButton');
    await page.waitForFunction(() => document.querySelectorAll('.message.assistant').length === 1);
    await page.selectOption('#learnerSelect', fx.DAVID);
    assert.match(await page.textContent('.chat-note'), /Now discussing David Liu\. Practice evidence about anyone else is not carried over\./);
    await page.fill('#chat-input', 'And this one?');
    await page.click('#sendButton');
    await page.waitForFunction(() => document.querySelectorAll('.message.assistant').length === 2);
    assert.equal(server.chat[1].learnerEmail, fx.DAVID);
    assert.deepEqual(server.chat[1].history, [], 'nothing about Michelle is sent with the question about David');
    assert.equal(server.chat[1].focusSessionId, undefined);
    await page.selectOption('#learnerSelect', fx.MICHELLE);
    await page.fill('#chat-input', 'Back to her.');
    await page.click('#sendButton');
    await page.waitForFunction(() => document.querySelectorAll('.message.assistant').length === 3);
    assert.deepEqual(server.chat[2].history.map(h => h.learnerEmail), [fx.MICHELLE, fx.MICHELLE], 'only her own earlier turns come back');
    await close();
  });

  test('Copilot recovers from an expired token the same way, without losing the question', async () => {
    const { page, server, close } = await open('/manager-chat.html?pilot=1', { lang: 'en' });
    await page.waitForSelector('#learnerSelect option[value="michelle@example.com"]', { state: 'attached' });
    server.rejected.add(await currentToken(page));
    await page.fill('#chat-input', 'What should I focus on this week?');
    await page.click('#sendButton');
    await page.waitForSelector('.message.assistant');
    assert.equal(server.chat.length, 1);
    assert.doesNotMatch(await page.textContent('.message.assistant'), /Unable to reach AI/);
    await close();
  });

  test('a member who is not on the roster is ignored', async () => {
    const { page, server, close } = await open('/manager-chat.html?pilot=1&learner=stranger%40example.com&brief=closing', { lang: 'en' });
    await page.waitForSelector('.welcome');
    await page.waitForTimeout(300);
    assert.equal(server.chat.length, 0);
    assert.equal(await page.locator('#briefContext').count(), 0);
    await close();
  });
});

describe('Leadership Studio', () => {
  test('a link to one Practice opens that result with its transcript showing', async () => {
    const { page, close } = await open('/manager.html?pilot=1&result=s-m3', { lang: 'en' });
    await page.waitForSelector('#result-s-m3 .details:not([hidden])');
    assert.match(await page.textContent('#result-s-m3 .transcript'), /好的，没问题，那您慢慢考虑，有需要随时找我。/);
    assert.equal(await page.locator('.details:not([hidden])').count(), 1, 'only the linked result is opened');
    await close();
  });
});
