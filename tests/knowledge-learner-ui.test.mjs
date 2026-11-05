// Browser regression test: manager-only controls on knowledge.html must be
// invisible to learners.
//
// Bug it guards against: the library toolbar ("Assess all unassessed", the
// "Relevance to team" sort) was hidden with the `hidden` attribute, but CSS
// rules like `.toolbar{display:flex}` / `.btn{display:inline-block}` overrode
// it, so learners saw buttons they cannot use (clicking one asked a learner
// to "set the Team Training Profile").
//
// Real knowledge.html in real Chromium over a local static server; the pilot
// cloud client (pilot-cloud.js) is replaced by a scripted learner/manager
// stub, so no Netlify Function or Identity call is made.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startStaticServer } from './static-server.mjs';

let baseUrl, server, browser;
before(async () => {
  ({ server, baseUrl } = await startStaticServer());
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium' });
});
after(async () => { await browser?.close(); server?.close(); });

const source = (id, title, importance, extra = {}) => ({
  id, title, sourceType: 'sop_script', status: 'approved', updatedAt: '2026-11-01',
  analysis: { summary: 'Summary of ' + title, keyPoints: [], practiceDraft: { title: 'Role-play', objective: 'Practice' } },
  importance, ...extra
});
const RATED = { level: 'must_know', stars: 3, note: { en: 'Matters for your first meetings.', zh: '對你的首次面談很重要。' }, matchedGoals: ['Handle spouse objection'], recommendedAudience: 'all' };

function stub({ canManage, sources, profile }) {
  return `window.PilotCloud={enabled:true,token:async()=>'t',request:async function(r){
    if(r==='me')return{};
    if(r==='knowledge')return{canManage:${canManage},sources:${JSON.stringify(sources)}};
    if(r==='training-profile')return{profile:${JSON.stringify(profile || null)},practiceSnapshot:{sessionCount:0}};
    return{}}};`;
}

async function open(config) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  await page.route('https://identity.netlify.com/**', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: '' }));
  await page.route('**/pilot-cloud.js*', route => route.fulfill({ status: 200, contentType: 'text/javascript', body: stub(config) }));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(baseUrl + '/knowledge.html');
  await page.waitForSelector('.source-card');
  return { page, errors };
}

describe('knowledge.html role separation', () => {
  test('learner sees importance and never any manager-only control', async () => {
    const { page, errors } = await open({ canManage: false, sources: [source('a', 'Unrated memo', null), source('b', 'Spouse script', RATED)] });
    try {
      for (const sel of ['#libraryToolbar', '#assessAllBtn', '#sortSources', '#profilePanel', '#relevanceOverview', '#managerPanel', '[data-action="assess"]', '[data-action="rel-agree"]']) {
        assert.equal(await page.locator(sel).first().isVisible(), false, `${sel} must be hidden for learners`);
      }
      const titles = await page.$$eval('.source-card h3', els => els.map(e => e.textContent));
      assert.deepEqual(titles, ['Spouse script', 'Unrated memo'], 'most important first, unrated last');
      const text = await page.locator('#sourceLibrary').innerText();
      assert.match(text, /Must-know/);
      assert.match(text, /not rated yet/i);
      assert.doesNotMatch(text, /Team relevance|\/100|Assess/i);
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test('manager still gets the toolbar, assess-all button and profile panel', async () => {
    const profile = { goals: ['Handle spouse objection'], industry: 'insurance', tenureMix: 'mixed', products: '', complianceNotes: '', focusCompetencies: [], priorityObjections: [], updatedAt: '2026-11-01T00:00:00Z' };
    const { page, errors } = await open({ canManage: true, profile, sources: [source('a', 'Memo', null, { content: 'x'.repeat(100) }), source('b', 'Script', null, { content: 'y'.repeat(100) })] });
    try {
      for (const sel of ['#libraryToolbar', '#assessAllBtn', '#sortSources', '#profilePanel']) {
        assert.equal(await page.locator(sel).isVisible(), true, `${sel} must be visible for managers`);
      }
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  });

  test('manager without a training profile does not get a dead-end assess-all button', async () => {
    const { page } = await open({ canManage: true, profile: null, sources: [source('a', 'Memo', null, { content: 'x'.repeat(100) })] });
    try {
      assert.equal(await page.locator('#assessAllBtn').isVisible(), false);
      assert.equal(await page.locator('#profilePanel').isVisible(), true, 'profile form is where they start');
    } finally { await page.close(); }
  });
});
