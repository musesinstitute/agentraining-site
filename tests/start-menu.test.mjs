// Runs the real start-menu.js source in a sandbox (same node:vm approach as
// the existing "frontend open recovers…" test in
// question-bank-recovery.test.mjs) against stub mount elements, so the menu
// order / role-awareness / context-preservation logic is verified without a
// browser.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../start-menu.js', import.meta.url), 'utf8');

class Element {
  constructor(attrs = {}) {
    this._attrs = attrs;
    this.outerHTML = '';
  }
  getAttribute(name) { return this._attrs[name] ?? null; }
}

// Runs start-menu.js against a given URL and PilotCloud role response, then
// waits for the role-resolution promise chain to settle before returning the
// rendered top/bottom mounts.
async function run({ href = 'https://app.test/pilot.html?pilot=1', pilotEnabled = true, me, meDelayed = false } = {}) {
  const url = new URL(href);
  const top = new Element({ 'data-position': 'top' });
  const bottom = new Element({ 'data-position': 'bottom' });
  const mounts = [top, bottom];
  const session = new Map();
  let resolveMe;
  const mePromise = meDelayed ? new Promise(resolve => { resolveMe = resolve; }) : Promise.resolve(me || { roles: ['learner'] });
  const context = {
    document: { querySelectorAll: sel => (sel === '.start-menu-mount' ? mounts : []) },
    window: {},
    location: { search: url.search, pathname: url.pathname, hash: url.hash },
    navigator: { language: 'en-US' },
    sessionStorage: { getItem: k => session.get(k) || null, setItem: (k, v) => session.set(k, v), removeItem: k => session.delete(k) },
    URLSearchParams,
    console,
    PilotCloud: pilotEnabled ? { enabled: true, request: (resource) => (resource === 'me' ? mePromise : Promise.reject(new Error('unexpected resource'))) } : { enabled: false }
  };
  context.window = context;
  vm.runInNewContext(source, context, { filename: 'start-menu.js' });
  if (meDelayed) {
    // Nothing should be rendered yet - mounts still bare stub elements.
    assert.equal(top.outerHTML, '', 'top mount must not render before role resolves');
    assert.equal(bottom.outerHTML, '', 'bottom mount must not render before role resolves');
    resolveMe(me || { roles: ['learner'] });
  }
  // Flush the PilotCloud.request('me').then(...) microtask chain.
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  return { top, bottom };
}

function hrefsOf(html) {
  return Array.from(html.matchAll(/href="([^"]*)"/g)).map(m => m[1]);
}

test('learner menu follows the assignment -> knowledge -> practice -> coach -> messages order', async () => {
  const { top } = await run({ me: { roles: ['learner'] } });
  const hrefs = hrefsOf(top.outerHTML);
  assert.deepEqual(hrefs.map(h => h.split('?')[0].split('#')[0]), [
    'pilot.html', 'coach-chat.html', 'knowledge.html', 'simulator.html', 'coach-chat.html', 'team-messages.html'
  ]);
  assert.match(hrefs[1], /#assignments$/, 'My Assignments must deep-link to the Assignment Inbox');
});

test('manager menu uses the real Manager Studio / Team / Results destinations, not invented pages', async () => {
  const { top } = await run({ me: { roles: ['manager'] } });
  const hrefs = hrefsOf(top.outerHTML);
  assert.deepEqual(hrefs.map(h => h.split('?')[0].split('#')[0]), [
    'pilot.html', 'manager.html', 'learner-profile.html', 'manager.html', 'knowledge.html', 'simulator.html', 'team-messages.html'
  ]);
  assert.match(hrefs[1], /#assignments$/);
  assert.match(hrefs[3], /#records$/, 'Results must anchor to the real "records" section in manager.html');
  assert.ok(!top.outerHTML.includes('My AI Coach'), 'manager menu must not carry the learner-only Coach item');
});

test('admin role also resolves to the manager menu (same authoritative role check as pilot.html)', async () => {
  const { top } = await run({ me: { roles: ['admin'] } });
  assert.ok(top.outerHTML.includes('>Team<'), 'admin must see the manager menu, not the learner one');
});

test('top and bottom navigation render the identical order, bottom framed as a continuation', async () => {
  const { top, bottom } = await run({ me: { roles: ['learner'] } });
  assert.deepEqual(hrefsOf(top.outerHTML), hrefsOf(bottom.outerHTML));
  assert.ok(!top.outerHTML.includes('start-menu-bottom'));
  assert.ok(bottom.outerHTML.includes('start-menu-bottom'));
  assert.ok(bottom.outerHTML.includes('sm-continue'), 'bottom nav should read as a "what next" continuation');
});

test('pilot=1 and lang context are preserved on every item, including Practice\'s separate query', async () => {
  const { top } = await run({ href: 'https://app.test/knowledge.html?pilot=1&lang=zh', me: { roles: ['learner'] } });
  const hrefs = hrefsOf(top.outerHTML);
  assert.ok(hrefs.every(h => h.includes('pilot=1')), 'every item must keep pilot=1');
  assert.ok(hrefs.filter(h => !h.startsWith('simulator.html')).every(h => h.includes('lang=zh')));
  assert.ok(hrefs.find(h => h.startsWith('simulator.html')).includes('lang=zh'), 'Practice must also carry lang despite its own ref=demo query');
  assert.ok(top.outerHTML.includes('企业知识库'), 'zh label should render for the active language');
});

test('active item is highlighted from the real current page/hash, never guessed from role alone', async () => {
  const onKnowledge = await run({ href: 'https://app.test/knowledge-chat.html?pilot=1', me: { roles: ['learner'] } });
  assert.match(onKnowledge.top.outerHTML, /class="sm-item active" href="knowledge\.html\?pilot=1"/);
  const onManagerResults = await run({ href: 'https://app.test/manager.html?pilot=1#records', me: { roles: ['manager'] } });
  assert.match(onManagerResults.top.outerHTML, /class="sm-item active" href="manager\.html\?pilot=1#records"/);
});

test('no flash of the wrong menu: mounts stay empty until PilotCloud.request(\'me\') resolves', async () => {
  const { top } = await run({ me: { roles: ['manager'] }, meDelayed: true });
  assert.ok(top.outerHTML.includes('>Team<'), 'once resolved, the correct (manager) menu must render');
});

test('falls back to the learner menu (previous default) when PilotCloud is disabled, without throwing', async () => {
  const { top } = await run({ href: 'https://app.test/pilot.html', pilotEnabled: false });
  assert.ok(top.outerHTML.includes('My AI Coach'));
});
