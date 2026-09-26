// Headless-browser coverage for the Manager Studio Team Growth & Retention
// panel: Recent Coaching Results visibility and the Assign Practice
// intervention context flowing through the existing assignment form.
//
// Runs the real manager.html / pilot-cloud.js in real Chromium via a local
// static server. The Identity widget and every /.netlify/functions call are
// answered by page.route() with scripted data - no real Netlify call is made.
//
// Run with: npm test  (also runs this file; see package.json "test" script)
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startStaticServer } from './static-server.mjs';

const FAKE_WIDGET_JS = `
window.netlifyIdentity = {
  init() {}, on() {}, open() {}, close() {}, logout: async () => {},
  currentUser: () => ({ email: 'manager@example.com', app_metadata: { roles: ['manager'] }, jwt: async () => 'fake-jwt' })
};
`;

let baseUrl, stopServer, browser;
before(async () => {
  const started = await startStaticServer();
  baseUrl = started.baseUrl;
  stopServer = () => started.server.close();
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM || '/opt/pw-browsers/chromium' });
});
after(async () => {
  await browser?.close();
  stopServer?.();
});

const focusPerson = {
  learner: 'wang@example.com', name: 'Xiao Wang', suggestedScenarioId: 'IHFC-01', latestEvidenceAt: '2026-09-22T10:00:00.000Z',
  signals: [{ type: 'repeated_stuck', scenario: 'Premium Is Too High', attempts: 3, evidence: [{ date: '2026-09-22T10:00:00.000Z', scenario: 'Premium Is Too High', score: 55 }] }],
  interventionStatus: { state: 'none' }
};
const improvedResult = {
  learner: 'li@example.com', name: 'Li', state: 'improved', assignmentId: 'i1', scenario: 'Need To Think',
  assignedAt: '2026-09-18T10:00:00.000Z', completedAt: '2026-09-21T10:00:00.000Z',
  improvementEvidenceAt: '2026-09-21T10:00:00.000Z', improvementType: 'practice_resumed',
  outcomes: [{ type: 'practice_break', state: 'improved', improvementType: 'practice_resumed', evidenceAt: '2026-09-21T10:00:00.000Z', evidence: [{ date: '2026-09-21T10:00:00.000Z', scenario: 'Need To Think', score: 80 }] }]
};

async function openManager({ recentResults, lang = 'en' }) {
  const page = await browser.newPage();
  const posted = [];
  await page.route('https://identity.netlify.com/v1/netlify-identity-widget.js', route =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_WIDGET_JS }));
  await page.route('**/.netlify/functions/pilot-invite**', route => route.fulfill({ contentType: 'application/json', body: '{"invites":[]}' }));
  await page.route('**/.netlify/functions/pilot-data?**', route => {
    const resource = new URL(route.request().url()).searchParams.get('resource');
    if (resource === 'assignments' && route.request().method() === 'POST') {
      const body = JSON.parse(route.request().postData());
      posted.push(body);
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ assignment: { id: 'new-' + posted.length, ...body, status: 'Assigned' } }) });
    }
    const data = resource === 'team-growth'
      ? { summary: { teamSize: 3, practicedThisWeek: 1, newMembers: null, newMembersAvailable: false }, focus: [focusPerson], recentResults }
      : resource === 'assignments' ? { assignments: [] } : resource === 'sessions' ? { sessions: [] } : { profiles: [] };
    return route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.goto(`${baseUrl}/manager.html?pilot=1&lang=${lang}`);
  await page.waitForSelector('#teamGrowth:not([hidden])');
  await page.waitForFunction(() => document.querySelectorAll('#assignScenario option').length > 2);
  return { page, posted };
}

describe('Manager Studio - Team Growth Phase 2 (browser)', () => {
  test('Recent Coaching Results shows improved results and is hidden when there are none', async () => {
    const withResults = await openManager({ recentResults: [improvedResult] });
    assert.equal(await withResults.page.isVisible('#teamGrowthResults'), true);
    assert.match(await withResults.page.textContent('#teamGrowthResults'), /Recent Coaching Results[\s\S]*Li: Practice resumed after the coaching assignment\./);
    await withResults.page.close();

    const zh = await openManager({ recentResults: [improvedResult], lang: 'zh' });
    assert.match(await zh.page.textContent('#teamGrowthResults'), /最近見效的介入[\s\S]*Li：主管介入後已重新開始練習。/);
    await zh.page.close();

    const empty = await openManager({ recentResults: [] });
    assert.equal(await empty.page.isVisible('#teamGrowthResults'), false);
    assert.equal(await empty.page.$eval('#teamGrowthResults', el => el.hidden), true);
    await empty.page.close();
  });

  test('Assign Practice keeps the context only while the learner still matches', async () => {
    const { page, posted } = await openManager({ recentResults: [] });
    await page.click('[data-growth-assign="0"]');
    assert.equal(await page.inputValue('#learnerEmail'), 'wang@example.com');
    assert.equal(await page.inputValue('#assignScenario'), 'IHFC-01');
    await page.click('#assignPractice');
    await page.waitForFunction(() => document.getElementById('assignStatus').classList.contains('ok'));
    assert.equal(posted[0].source, 'team-growth');
    assert.equal(posted[0].intervention.learner, 'wang@example.com');
    assert.deepEqual(posted[0].intervention.signalTypes, ['repeated_stuck']);

    // Switch the learner after picking the card: submitted as a regular assignment.
    await page.click('[data-growth-assign="0"]');
    await page.fill('#learnerEmail', 'someone-else@example.com');
    await page.selectOption('#assignScenario', 'IHFC-01');
    await page.click('#assignPractice');
    await page.waitForFunction(() => document.getElementById('assignStatus').classList.contains('ok') && document.getElementById('learnerEmail').value === '');
    assert.equal(posted.length, 2);
    assert.equal(posted[1].source, undefined);
    assert.equal(posted[1].intervention, undefined);
    await page.close();
  });
});
