// Extracts the real #upload / #question-bank / #practice-scenarios deep-link
// handling block straight out of knowledge.html (between its own named
// comment markers, so this test breaks loudly if that code ever moves
// rather than silently testing stale copy-pasted logic) and runs it in a
// node:vm sandbox against stub DOM elements - the same approach already
// used by tests/question-bank-recovery.test.mjs and tests/start-menu.test.mjs
// for this repo's inline frontend scripts.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../knowledge.html', import.meta.url), 'utf8');
const start = html.indexOf('function highlightEl(el){');
const end = html.indexOf('})();', html.indexOf('(function pollDeepLink(){')) + '})();'.length;
if (start < 0 || end < 0) throw new Error('Could not locate the deep-link block in knowledge.html - has it moved?');
const source = html.slice(start, end);

class Element {
  constructor(attrs = {}) {
    this._attrs = attrs;
    this.children = [];
    this.calls = { scrollIntoView: 0, classAdded: [], classRemoved: [] };
    this.classList = {
      add: (c) => this.calls.classAdded.push(c),
      remove: (c) => this.calls.classRemoved.push(c)
    };
  }
  matches(selector) {
    if (selector === '.question-bank-entry') return this._attrs.class === 'question-bank-entry';
    if (selector === '.training-assets a') return this._attrs.trainingAssetsLink === true;
    const m = selector.match(/^\[data-source-card="([^"]*)"\]$/);
    if (m) return this._attrs['data-source-card'] === m[1];
    return false;
  }
  querySelector(selector) {
    if (this.matches(selector)) return this;
    for (const c of this.children) { const r = c.querySelector(selector); if (r) return r; }
    return null;
  }
  scrollIntoView() { this.calls.scrollIntoView++; }
}

function buildDom({ cards = [], hasEntryBanner = true } = {}) {
  const root = new Element();
  const entry = hasEntryBanner ? new Element({ class: 'question-bank-entry' }) : null;
  if (entry) root.children.push(entry);
  const cardEls = cards.map(({ id, withLink }) => {
    const card = new Element({ 'data-source-card': id });
    if (withLink) card.children.push(new Element({ trainingAssetsLink: true }));
    root.children.push(card);
    return card;
  });
  return { root, entry, cardEls };
}

// Runs the real deep-link source against a fresh sandbox. `dom` is the root
// stand-in for `document` (querySelector delegates into it); the rest
// (location, canManage/knowledgeLoaded/guideFlow) mirror the real
// module-level state knowledge.html already declares around this block.
function run({ hash = '', search = '', canManage = false, knowledgeLoaded = true, dom }) {
  const guideFlowCalls = [];
  const context = {
    location: { hash, search },
    URLSearchParams,
    CSS: { escape: s => s },
    setTimeout: (fn) => fn(), // run "later" highlight-removal immediately - not under test here
    setInterval: () => 0,
    clearInterval: () => {},
    document: { querySelector: sel => dom.root.querySelector(sel) },
    canManage,
    knowledgeLoaded,
    guideFlow: (action) => guideFlowCalls.push(action)
  };
  vm.runInNewContext(source, context, { filename: 'knowledge-deep-links.js' });
  return { context, guideFlowCalls };
}

test('#upload scrolls/focuses the Add Source form for a manager once data has loaded', () => {
  const { context, guideFlowCalls } = run({ hash: '#upload', canManage: true, knowledgeLoaded: true, dom: buildDom() });
  assert.deepEqual(guideFlowCalls, ['add']);
  assert.equal(context.deepLinkHandled, true);
});

test('#upload waits (does not show the wrong message) until knowledgeLoaded, then retries correctly', () => {
  const dom = buildDom();
  const { context, guideFlowCalls } = run({ hash: '#upload', canManage: true, knowledgeLoaded: false, dom });
  assert.deepEqual(guideFlowCalls, [], 'must not call guideFlow before role/data is known');
  assert.equal(context.deepLinkHandled, false);
  // Simulate the retry poll firing again once loadKnowledge() has settled.
  context.knowledgeLoaded = true;
  context.handleDeepLinkHash();
  assert.deepEqual(guideFlowCalls, ['add']);
  assert.equal(context.deepLinkHandled, true);
});

test('#upload for a non-manager still just delegates to guideFlow(\'add\') - no duplicated messaging', () => {
  // guideFlow itself (not re-tested here) already shows the "Manager
  // access is required" message for a non-manager; the deep-link handler
  // must not invent a second copy of that logic.
  const { guideFlowCalls } = run({ hash: '#upload', canManage: false, knowledgeLoaded: true, dom: buildDom() });
  assert.deepEqual(guideFlowCalls, ['add']);
});

test('#question-bank with a matching knowledgeId scrolls to that document\'s Question Bank link, preserving the id', () => {
  const dom = buildDom({ cards: [{ id: 'doc-1', withLink: true }, { id: 'doc-2', withLink: true }] });
  const { context } = run({ hash: '#question-bank', search: '?pilot=1&knowledgeId=doc-2', dom });
  assert.equal(context.deepLinkHandled, true);
  const targeted = dom.cardEls[1].children[0];
  assert.equal(targeted.calls.scrollIntoView, 1);
  assert.deepEqual(targeted.calls.classAdded, ['deep-link-highlight']);
  assert.equal(dom.cardEls[0].calls.scrollIntoView, 0, 'the other document must not be touched');
});

test('#practice-scenarios with a matching knowledgeId targets the same real entry point (no invented section)', () => {
  const dom = buildDom({ cards: [{ id: 'doc-1', withLink: true }] });
  const { context } = run({ hash: '#practice-scenarios', search: '?knowledgeId=doc-1', dom });
  assert.equal(context.deepLinkHandled, true);
  assert.equal(dom.cardEls[0].children[0].calls.scrollIntoView, 1);
});

test('a learner\'s card (no manager-only Question Bank link rendered) still scrolls to the document itself', () => {
  const dom = buildDom({ cards: [{ id: 'doc-1', withLink: false }] });
  const { context } = run({ hash: '#question-bank', search: '?knowledgeId=doc-1', dom });
  assert.equal(context.deepLinkHandled, true);
  assert.equal(dom.cardEls[0].calls.scrollIntoView, 1, 'falls back to highlighting the whole card, never invents a link that isn\'t there');
});

test('#question-bank with no knowledgeId falls back to the generic entry point immediately', () => {
  const dom = buildDom({ cards: [{ id: 'doc-1', withLink: true }] });
  const { context } = run({ hash: '#question-bank', search: '', dom });
  assert.equal(context.deepLinkHandled, true);
  assert.equal(dom.entry.calls.scrollIntoView, 1);
  assert.equal(dom.cardEls[0].calls.scrollIntoView, 0);
});

test('#question-bank with an unknown/inaccessible knowledgeId waits for load, then falls back to the entry point', () => {
  const dom = buildDom({ cards: [] });
  const { context } = run({ hash: '#question-bank', search: '?knowledgeId=not-a-real-doc', knowledgeLoaded: false, dom });
  assert.equal(context.deepLinkHandled, false, 'must not give up before sources finish loading');
  context.knowledgeLoaded = true;
  context.handleDeepLinkHash();
  assert.equal(context.deepLinkHandled, true);
  assert.equal(dom.entry.calls.scrollIntoView, 1);
});

test('no hash present: does nothing, throws nothing', () => {
  const dom = buildDom();
  const { context } = run({ hash: '', dom });
  assert.equal(context.deepLinkHandled, false);
  assert.equal(dom.entry.calls.scrollIntoView, 0);
});

test('an unrelated hash (e.g. from an old link) is ignored rather than mishandled', () => {
  const dom = buildDom();
  const { context } = run({ hash: '#something-else', dom });
  assert.equal(context.deepLinkHandled, false);
  assert.equal(dom.entry.calls.scrollIntoView, 0);
});
