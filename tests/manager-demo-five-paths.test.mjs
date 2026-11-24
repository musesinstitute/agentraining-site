// Headless-browser regression tests for the Manager Demo (manager-demo-review.html):
// every one of the five fictional learners is a complete, independent path.
//
// What these tests protect:
//  - Picking any learner opens that learner's own evidence, decision options,
//    Studio examples and follow-up, never Michelle's by default.
//  - The manager's selection and the AI's suggestion stay separate: when they
//    differ, both can be explored and compared, and each keeps its own decision.
//  - Accept / verify / override use coaching time logically per learner.
//  - Phone widths (320-430px) and desktop have no horizontal overflow.
//  - The Pilot CTA carries the chosen goal and team size into pilot-start.html.
//  - The demo is honest: everything is labelled fictional and nothing is sent.
//
// Runs the real page in Chromium via the local static server. Google Fonts
// requests are aborted (no network needed); no other request is expected.
//
// Run with: npm test
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startStaticServer } from './static-server.mjs';

const PAGE = '/manager-demo-review.html';
const NAMES = { david: 'David', michelle: 'Michelle', john: 'John', grace: 'Grace', anna: 'Anna' };
const AI = 'michelle';

// Independent expectations, written from the owner's brief rather than read
// back from the page, so a data or logic regression fails loudly.
const EXPECT = {
  michelle: { accept: 'Coach now', verify: 'Verify first', override: 'Hold coaching', acceptCoaches: true, overrideCoaches: false,
    kDoc: 'Approved coaching note, price concerns, §2', prospect: 'Ms. Rivera', fig: '0of4' },
  david: { accept: 'Basics + second scenario', verify: 'Review it yourself', override: 'Coach now anyway', acceptCoaches: false, overrideCoaches: true,
    kDoc: 'Approved product guide: term and whole life basics', prospect: 'Mr. Okafor', fig: '2attempts' },
  john: { accept: 'One more practice', verify: 'Review it yourself', override: 'Coach now anyway', acceptCoaches: false, overrideCoaches: true,
    kDoc: 'Approved needs-discovery question guide', prospect: 'Ms. Chen', fig: '1attempt' },
  grace: { accept: 'Harder scenario', verify: 'Review it yourself', override: 'Coach her anyway', acceptCoaches: false, overrideCoaches: true,
    kDoc: 'Approved objection guide: “I already have an agent”', prospect: 'Mr. Patel', fig: '5of5' },
  anna: { accept: 'New scenario next week', verify: 'Review it yourself', override: 'Coach now anyway', acceptCoaches: false, overrideCoaches: true,
    kDoc: 'Approved needs-discovery question guide', prospect: 'Mr. Alvarez', fig: '3attempts' },
};
const PROSPECTS = Object.values(EXPECT).map(e => e.prospect);

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

// Reduced motion makes every reveal immediate, so tests do not wait on animation.
async function openDemo({ width = 1366, height = 900, motion = 'reduce', permissions = [], init = null } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: motion, permissions });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const requests = [];
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  page.on('request', r => { if (!/fonts\.(googleapis|gstatic)\.com/.test(r.url())) requests.push(r.method() + ' ' + r.url()); });
  await page.goto(baseUrl + PAGE);
  return { page, context, requests, errors };
}
const text = async (page, sel) => (await page.textContent(sel)).replace(/\s+/g, ' ').trim();

async function pickAndLock(page, id) {
  await page.click(`label[data-p="${id}"]`);
  await page.click('#lock');
  await page.waitForSelector('#reveal:not([hidden])');
  await page.waitForSelector('#ctxbar:not([hidden])');
}
async function decide(page, action, reasonIndex = 1) {
  await page.click(`#decideRow [data-decide="${action}"]`);
  if (action === 'override') await page.selectOption('#decisionReason', { index: reasonIndex });
  await page.click('#confirmDecision');
  await page.waitForSelector('#decided:not([hidden])');
}
// The full-team evidence list sits in a <details>; open it, then explore from there.
async function exploreFromEvidence(page, id) {
  await page.evaluate(() => { document.querySelector('details.all').open = true; });
  await page.click(`#evidence .ev-go[data-explore="${id}"]`);
}
const approvedMin = async page => parseInt(await page.textContent('#ttCommit'), 10);
const minOptions = page => page.$$eval('#minOpts input', els => els.map(i => [+i.value, !i.disabled]));
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

describe('Manager Demo: five complete learner paths', () => {
  test('guided tour introduces four Studios, the Hub, then the manager challenge one page at a time', async () => {
    const { page, context, errors } = await openDemo();
    try {
      assert.match(await text(page, '.hero .welcome-k'), /Welcome to AgentTraining\\.ai/);
      assert.equal(await page.locator('#tourShell [data-tour-step]').count(), 7);
      const expected = [
        'Knowledge Studio', 'Practice Studio', 'Client Studio', 'Leadership Studio',
      ];
      assert.equal(await page.locator('#tourShell [data-tour-step]:visible').count(), 1);
      assert.match(await text(page, '#tourProgress'), /1 of 7/);
      assert.equal(await page.isDisabled('#tourPrev'), true);
      for (let i = 1; i < 7; i++) {
        await page.click('#tourNext');
        assert.equal(await page.locator('#tourShell [data-tour-step]:visible').count(), 1, 'Only one tour page should be visible');
        assert.match(await text(page, '#tourProgress'), new RegExp((i+1)+' of 7'));
        if (i <= 4) {
          assert.equal(await text(page, '#tourShell [data-tour-step="'+i+'"] .orient-card h3'), expected[i-1]);
          const description = await text(page, '#tourShell [data-tour-step="'+i+'"] .orient-card p');
          assert.ok(description.length > 70, 'Each Studio explains its manager-facing value');
        }
        if (i === 5) {
          assert.match(await text(page, '#tourShell [data-tour-step="5"]'), /AI recommends; the manager decides/);
          assert.equal(await page.locator('#tourShell [data-tour-step="5"] .sys svg').count(), 1);
        }
      }
      assert.equal(await page.isVisible('#tourNext'), false);
      await page.click('#tourPrev');
      assert.match(await text(page, '#tourProgress'), /6 of 7/);
      await page.click('#tourNext');
      await page.click('#startDemo');
      await page.waitForFunction(() => document.activeElement?.closest('#team') !== null);
      assert.equal(await page.locator('#team label[data-p]').count(), 5);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  test('tour can be skipped on phone without sacrificing manager decision access', async () => {
    const { page, context, errors } = await openDemo({ width: 320, height: 740 });
    try {
      await page.click('#tourNext');
      assert.match(await text(page, '#tourProgress'), /2 of 7/);
      assert.equal(await noOverflow(page), true);
      await page.click('#tourSkip');
      await page.waitForFunction(() => document.activeElement?.closest('#team') !== null);
      await pickAndLock(page, 'david');
      assert.equal(await text(page, '#cxPick'), 'David');
      assert.equal(await noOverflow(page), true);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  });

  for (const id of Object.keys(EXPECT)) {
    test(`picking ${NAMES[id]} opens ${NAMES[id]}'s own case`, async () => {
      const { page, context, errors } = await openDemo();
      try {
        await pickAndLock(page, id);
        const e = EXPECT[id];
        const h3 = await text(page, '#verdict h3');
        assert.match(h3, new RegExp(`You chose ${NAMES[id]}`));
        if (id === AI) assert.match(h3, /AI agrees/);

        // the context bar always names all four things
        assert.equal(await text(page, '#cxPick'), NAMES[id]);
        assert.equal(await text(page, '#cxAI'), 'Michelle');
        assert.equal(await text(page, '#cxNow'), NAMES[id]);
        assert.equal(await text(page, '#cxAct'), 'Not decided');

        // the selection/recommendation chooser appears only when they differ
        const paths = await page.$$eval('.path', els => els.map(b => [b.dataset.explore, b.getAttribute('aria-pressed')]));
        if (id === AI) assert.deepEqual(paths, []);
        else assert.deepEqual(paths, [[id, 'true'], [AI, 'false']]);
        assert.equal(await page.isVisible('#cxSwitch'), id !== AI);

        // this learner's evidence, not anyone else's
        assert.equal((await text(page, '#verdict .vs.practice .vs-fig')).replace(/ /g, ''), e.fig);
        const verdict = await text(page, '#verdict');
        assert.match(verdict, /Fictional team\. Simulated practice\./);
        for (const other of Object.keys(NAMES).filter(x => x !== id)) {
          assert.ok(!verdict.includes(EXPECT[other].prospect), `${NAMES[id]}'s case must not mention ${EXPECT[other].prospect}`);
        }

        // the decision panel is about this learner, with this learner's options
        assert.equal(await text(page, '#labName'), NAMES[id]);
        const lab = await text(page, '#labSub') + ' ' + await text(page, '#bound') + ' ' + await text(page, '#decideRow');
        for (const other of Object.values(NAMES).filter(n => n !== NAMES[id])) {
          assert.ok(!lab.includes(other), `decision panel for ${NAMES[id]} mentions ${other}`);
        }
        const titles = await page.$$eval('#decideRow [data-decide] b', els => els.map(b => b.textContent));
        assert.deepEqual(titles, [e.accept, e.verify, e.override]);
        assert.equal(await page.$$eval('#decideRow .sugg', els => els.length), 1, 'exactly one option is marked as the AI suggestion');
        assert.deepEqual(errors, []);
      } finally { await context.close(); }
    });
  }

  test('accept, verify and override: coaching time per learner, one decision at a time', async () => {
    const { page, context } = await openDemo();
    try {
      await pickAndLock(page, 'david');
      for (const id of Object.keys(EXPECT)) {
        if ((await text(page, '#cxNow')) !== NAMES[id]) await exploreFromEvidence(page, id);
        assert.equal(await text(page, '#cxNow'), NAMES[id]);
        const e = EXPECT[id];
        for (const action of ['accept', 'verify', 'override']) {
          await decide(page, action);
          const coaches = action === 'accept' ? e.acceptCoaches : action === 'override' ? e.overrideCoaches : false;
          assert.equal(await approvedMin(page), coaches ? 20 : 0, `${NAMES[id]} ${action}`);
          assert.equal(await text(page, '#cxAct'), e[action] + (coaches ? ' · 20 min' : ''));
          assert.equal(await text(page, '#chainCv'), e[action] + (coaches ? ', 20 min' : ''));
          assert.match(await text(page, '#decided'), /Demo decision\. No assignment was sent to anyone\./);
          await page.click('#changeDecision');
          assert.ok(await page.isHidden('#decided'));
          assert.equal(await approvedMin(page), 0, 'changing a decision releases its minutes');
          assert.equal(await text(page, '#chainCv'), 'Yours');
        }
      }
    } finally { await context.close(); }
  });

  test('coaching for several learners stays inside one team budget, and earlier decisions can be revised', async () => {
    const { page, context } = await openDemo();
    try {
      await pickAndLock(page, 'grace');
      await page.click('.path[data-explore="michelle"]');
      await decide(page, 'accept');
      assert.equal(await approvedMin(page), 20);
      assert.equal(await text(page, '#ttLeft'), '10 min');

      // Grace: only 10 min are free, so 15 and 20 cannot be chosen
      await page.click('#cxSwitch');
      await page.click('#decideRow [data-decide="override"]');
      assert.deepEqual(await minOptions(page), [[10, true], [15, false], [20, false]]);
      assert.match(await text(page, '#ttPend'), /If you approve: 30 of 30 min committed, 0 left\./);
      await page.selectOption('#decisionReason', { index: 1 });
      await page.click('#confirmDecision');
      assert.equal(await approvedMin(page), 30);
      assert.equal(await text(page, '#ttLeft'), '0 min');

      // John: no coaching time left, so coaching cannot be approved; other actions can
      await exploreFromEvidence(page, 'john');
      await page.click('#decideRow [data-decide="override"]');
      assert.deepEqual(await minOptions(page), [[10, false], [15, false], [20, false]]);
      assert.match(await text(page, '#minNote'), /No coaching time is free: 30 of 30 min are already approved/);
      assert.equal(await page.isDisabled('#confirmDecision'), true);
      await decide(page, 'accept');
      assert.equal(await approvedMin(page), 30, 'a no-coaching decision does not use time');

      // the team list shows every approved decision with its minutes
      assert.deepEqual(await page.$$eval('#ttList .it', els => els.map(it => it.querySelector('b').textContent + ' ' + (it.querySelector('.m') || it.querySelector('.t')).textContent)),
        ['Michelle 20 min', 'Grace 10 min', 'John One more practice']);

      // revise Michelle down to 15: her minutes are released, then re-approved
      await page.click('#ttList [data-revise="michelle"]');
      assert.equal(await text(page, '#cxNow'), 'Michelle');
      assert.ok(await page.isHidden('#decided'));
      assert.equal(await approvedMin(page), 10);
      assert.deepEqual(await minOptions(page), [[10, true], [15, true], [20, true]]);
      await page.check('#minOpts input[value="15"]');
      await page.click('#confirmDecision');
      assert.equal(await approvedMin(page), 25);

      await page.click('.steps [data-go="2"]');
      const recap = await text(page, '#actionPlan');
      assert.match(recap, /Michelle: Coach now, 15 min/);
      assert.match(recap, /Grace: Coach her anyway, 10 min/);
      assert.match(recap, /John: One more practice/);
      assert.match(recap, /Coaching time: 25 of 30 min committed, 5 left\./);
    } finally { await context.close(); }
  });

  test('lowering the budget after approval flags the plan as over budget until it is revised', async () => {
    const { page, context } = await openDemo();
    try {
      await pickAndLock(page, 'michelle');
      await decide(page, 'accept');
      assert.equal(await approvedMin(page), 20);
      await page.check('input[name="demoBudget"][value="15"]');
      assert.equal(await text(page, '#ttLeft'), 'Over by 5 min');
      assert.ok(await page.isVisible('#ttWarn'));
      assert.match(await text(page, '#ttWarn'), /20 min of coaching are approved, but only 15 min are available/);
      assert.match(await text(page, '#decidedTxt'), /20 minutes of your team coaching time/);

      // no new coaching can be approved while over budget
      await exploreFromEvidence(page, 'david');
      await page.click('#decideRow [data-decide="override"]');
      assert.equal(await page.isDisabled('#confirmDecision'), true);

      await page.click('.steps [data-go="2"]');
      assert.match(await text(page, '#actionPlan'), /Coaching time: 20 min approved, but only 15 min available\./);

      // revise Michelle to 10 min: back within budget
      await page.click('.steps [data-go="0"]');
      await page.click('#ttList [data-revise="michelle"]');
      assert.deepEqual(await minOptions(page), [[10, true], [15, true], [20, false]]);
      await page.check('#minOpts input[value="10"]');
      await page.click('#confirmDecision');
      assert.equal(await text(page, '#ttLeft'), '5 min');
      assert.ok(await page.isHidden('#ttWarn'));
    } finally { await context.close(); }
  });

  test('simulated follow-up depends on the action, not only on the learner', async () => {
    const { page, context } = await openDemo();
    try {
      await pickAndLock(page, 'anna');
      for (const id of Object.keys(EXPECT)) {
        if ((await text(page, '#cxNow')) !== NAMES[id]) await exploreFromEvidence(page, id);
        const plans = new Set();
        for (const action of ['accept', 'verify', 'override']) {
          await decide(page, action);
          await page.evaluate(() => { document.getElementById('followupDetails').open = true; });
          const plan = await text(page, '#fuPlan'), event = await text(page, '#fuEvent'), head = await text(page, '#fuRespH');
          plans.add(plan);
          assert.match(await text(page, '#fuNext'), /Appears after you choose/);
          const review = id !== 'michelle' && action === 'verify';
          if (review) {
            assert.match(plan, /Nothing is assigned and no coaching time is used/);
            assert.match(event, /No new practice exists yet/);
            assert.doesNotMatch(event, /completes/, 'a review must not show a new-practice result');
            assert.equal(head, 'What you might conclude (hypothetical)');
            assert.ok(await page.isVisible('#fuNoLearner'));
          } else {
            assert.equal(head, 'Hypothetical learner response');
            assert.ok(await page.isHidden('#fuNoLearner'));
          }
          if (EXPECT[id][action === 'accept' ? 'acceptCoaches' : 'overrideCoaches'] && action !== 'verify') assert.match(plan, /20-minute one-to-one/);
          await page.click('#outcomeChoices [data-outcome="1"]');
          assert.doesNotMatch(await text(page, '#fuNext'), /Appears after/);
          await page.click('#changeDecision');
        }
        assert.equal(plans.size, 3, `${NAMES[id]} has three different planned actions`);
      }
      // holding coaching never claims a training assignment
      await exploreFromEvidence(page, 'michelle');
      await decide(page, 'override');
      await page.evaluate(() => { document.getElementById('followupDetails').open = true; });
      assert.match(await text(page, '#fuPlan'), /No coaching and no new practice this week/);
      assert.match(await text(page, '#fuEvent'), /you assigned nothing/);
    } finally { await context.close(); }
  });

  test('step 2 shows the approved route, or labels itself an optional illustration', async () => {
    const { page, context } = await openDemo();
    try {
      await pickAndLock(page, 'michelle');
      await page.click('.steps [data-go="1"]');
      assert.match(await page.getAttribute('#route', 'class'), /illus/);
      assert.match(await text(page, '#route'), /Optional illustration.*No demo decision is confirmed for Michelle\..*Nothing here carries out a management decision/);
      const studios = () => page.$$eval('#route .route-grid li', els => els.map(li => [li.querySelector('b').textContent, li.className]));

      for (const [action, on] of [['override', ['Leadership', 'Hub']], ['verify', ['Leadership', 'Practice', 'Hub']], ['accept', ['Leadership', 'Knowledge', 'Client', 'Practice', 'Hub']]]) {
        await page.click('.steps [data-go="0"]');
        if (await page.isVisible('#changeDecision')) await page.click('#changeDecision');
        await decide(page, action);
        await page.click('.steps [data-go="1"]');
        assert.match(await page.getAttribute('#route', 'class'), /set/);
        assert.match(await text(page, '#route'), new RegExp(`Your approved demo decision, fictional\\s*Michelle: ${EXPECT.michelle[action]}`));
        const got = await studios();
        assert.deepEqual(got.filter(([, c]) => c.includes('on')).map(([n]) => n), on, action);
        for (const [n, c] of got) if (!c.includes('on')) assert.match(await page.textContent(`#route .route-grid li:has(b:text-is("${n}"))`), /Not used by this decision/);
      }
      // a review-only decision for David uses no Knowledge, Client or Practice work
      await page.click('.steps [data-go="0"]');
      await exploreFromEvidence(page, 'david');
      await decide(page, 'verify');
      await page.click('.steps [data-go="1"]');
      assert.deepEqual((await studios()).filter(([, c]) => c.includes('on')).map(([n]) => n), ['Leadership', 'Hub']);
      assert.match(await text(page, '.stagenote'), /General illustration for David's case/);
    } finally { await context.close(); }
  });

  test('evidence inspection shows each learner\'s own labelled, scripted excerpts', async () => {
    const { page, context } = await openDemo();
    try {
      await pickAndLock(page, 'john');
      for (const id of Object.keys(EXPECT)) {
        if ((await text(page, '#cxNow')) !== NAMES[id]) await exploreFromEvidence(page, id);
        await page.click('#decideRow [data-decide="verify"]');
        const autoOpen = await page.$eval('#inspect', d => d.open);
        assert.equal(autoOpen, id !== 'michelle', 'Review it yourself opens the excerpts (Michelle\'s verify is a second scenario instead)');
        await page.evaluate(() => { document.getElementById('inspect').open = true; });
        const body = await text(page, '#inspBody');
        assert.match(body, /Scripted demo excerpts for a fictional agent, not records of real practice\./);
        const labels = await page.$$eval('#inspBody figcaption', els => els.map(e => e.textContent));
        assert.ok(labels.length >= 1 && labels.every(l => /^Attempt \d\. /.test(l)), labels.join(' | '));
        const speakers = await page.$$eval('#inspBody .excerpt i', els => [...new Set(els.map(e => e.textContent))]);
        assert.deepEqual(speakers.sort(), [NAMES[id], 'Simulated client'].sort());
        assert.match(await text(page, '.insp-rest'), /summarised, not shown|only attempt/);
        await page.evaluate(() => { document.getElementById('inspect').open = false; });
      }
    } finally { await context.close(); }
  });

  test('direct links, hash changes and reloads never assume a decision was made', async () => {
    const { page, context } = await openDemo();
    try {
      await page.goto(baseUrl + PAGE + '#the-loop');
      await page.waitForSelector('#p1:not([hidden])');
      assert.match(await text(page, '#route'), /You have not chosen an agent yet, so this shows the AI's top suggestion, Michelle\./);
      assert.equal(await text(page, '#cxPick'), 'Not chosen yet');
      assert.equal(await text(page, '#cxAct'), 'Not decided');

      await page.goto(baseUrl + PAGE + '#your-team');
      await page.reload();
      await page.waitForSelector('#p2:not([hidden])');
      const recap = await text(page, '#actionPlan');
      assert.match(recap, /You have not chosen an agent yet\./);
      assert.match(recap, /No demo decision yet\. The pilot request below does not depend on one\./);
       assert.ok(await page.isVisible('#actionPlan #apHead'), 'empty action plan has its accessible heading');
      assert.ok(await page.isVisible('#pilotLink'));
      assert.ok(await page.isHidden('#ctxbar'));

      // the in-recap button starts the call; a decision then shows up in the recap
      await page.click('#actionPlan [data-go="0"]');
      await pickAndLock(page, 'anna');
      await decide(page, 'accept');
      await page.evaluate(() => { location.hash = '#your-team'; });
      await page.waitForSelector('#p2:not([hidden])');
      assert.match(await text(page, '#actionPlan'), /Anna: New scenario next week/);

      // a reload is a fresh demo: nothing carried over, nothing claimed
      await page.reload();
      await page.waitForSelector('#p2:not([hidden])');
      assert.match(await text(page, '#actionPlan'), /No demo decision yet/);
      assert.match(await text(page, '#actionPlan'), /reset when you reload/);
      await page.evaluate(() => { location.hash = '#the-loop'; });
      await page.waitForSelector('#p1:not([hidden])');
      assert.match(await text(page, '#route'), /Optional illustration/);
    } finally { await context.close(); }
  });

  test('fast path: pick, decide and reach the pilot plan in a few clicks', async () => {
    const { page, context } = await openDemo();
    try {
      assert.doesNotMatch(await text(page, '#intro0'), /identical/);
      await page.click('#startDemo');
      await page.click('label[data-p="michelle"]');
      await page.click('#lock');
      await page.waitForSelector('#reveal:not([hidden])');
      await page.click('#toDecision');
      await page.click('#decideRow [data-decide="accept"]');
      await page.click('#confirmDecision');
      await page.click('#decided .fast [data-go="2"]');
      await page.waitForSelector('#p2:not([hidden])');
      assert.ok(await page.isVisible('#pilotLink'));
      assert.match(await text(page, '#actionPlan'), /Michelle: Coach now, 20 min/);
    } finally { await context.close(); }
  });

  test('override needs a reason; change-decision resets only the learner on screen', async () => {
    const { page, context } = await openDemo();
    try {
      await pickAndLock(page, 'grace');
      await page.click('#decideRow [data-decide="override"]');
      await page.click('#confirmDecision');
      assert.match(await text(page, '#decisionStatus'), /override reason first/);
      assert.ok(await page.isHidden('#decided'));
      await page.selectOption('#decisionReason', { label: 'My field experience contradicts it' });
      await page.click('#confirmDecision');
      assert.match(await text(page, '#decidedTxt'), /coach Grace.*Reason: My field experience contradicts it\./);

      // Michelle gets her own decision, then Grace is reset; Michelle's stays.
      await page.click('.path[data-explore="michelle"]');
      assert.ok(await page.isHidden('#decided'));
      assert.equal(await page.inputValue('#decisionReason'), '');
      await decide(page, 'verify');
      await page.click('#cxSwitch');
      assert.equal(await text(page, '#cxNow'), 'Grace');
      await page.click('#changeDecision');
      assert.equal(await text(page, '#cxAct'), 'Choosing…');
      await page.click('#cxSwitch');
      assert.equal(await text(page, '#cxNow'), 'Michelle');
      assert.equal(await text(page, '#cxAct'), 'Verify first');
    } finally { await context.close(); }
  });

  test('switching keeps your selection and each learner\'s decision through all three steps', async () => {
    const { page, context } = await openDemo();
    try {
      await pickAndLock(page, 'john');
      await decide(page, 'accept');
      await page.click('.path[data-explore="michelle"]');
      assert.equal(await text(page, '#cxPick'), 'John');
      assert.equal(await text(page, '#cxNow'), 'Michelle');
      assert.match(await text(page, '#verdict h3'), /The AI suggests Michelle/);
      assert.equal(await text(page, '#cxSwitch'), 'Back to your pick: John');
      assert.equal(await page.$eval('.person[data-p="michelle"]', l => l.classList.contains('exploring')), true);
      await decide(page, 'accept');
      assert.equal(await approvedMin(page), 20);

      // step 2 follows whoever is explored, and the switch works there too
      await page.click('#decided [data-go="1"]');
      assert.equal(await text(page, '#loopName'), 'Michelle');
      assert.match(await text(page, '#h1'), /Michelle/);
      await page.click('#cxSwitch');
      assert.equal(await text(page, '#loopName'), 'John');
      assert.equal(await text(page, '#cxAct'), 'One more practice');

      // step 3 recaps both decisions and the AI's suggestion
      await page.click('#nextStop >> nth=0');
      await page.click('[data-go="2"] >> nth=0');
      const recap = await text(page, '#actionPlan');
      assert.match(recap, /AI's top priority: Michelle \(same gap in 4 of 4 attempts\)\. You picked John\./);
      assert.doesNotMatch(recap, /top suggestion was/, 'the AI priority is named once, not twice');
      assert.match(recap, /John: One more practice/);
      assert.match(recap, /Michelle: Coach now/);
      assert.match(recap, /nothing was assigned, sent or saved/);
      assert.ok(await page.isHidden('#ctxbar'));
    } finally { await context.close(); }
  });

  test('step 2 Studios and cycle are built from the explored learner', async () => {
    const { page, context } = await openDemo();
    try {
      await pickAndLock(page, 'anna');
      const seen = new Set();
      for (const id of ['anna', 'david', 'michelle', 'john', 'grace']) {
        await page.click('[data-go="0"] >> nth=0');
        if ((await text(page, '#cxNow')) !== NAMES[id]) await exploreFromEvidence(page, id);
        await page.click('.steps [data-go="1"]');
        const title = await text(page, '#h1');
        assert.ok(!seen.has(title), 'each learner has a distinct step-2 title');
        seen.add(title);
        await page.click('#showK [data-run="K"]');
        await page.click('#showC [data-run="C"]');
        await page.waitForSelector('#outK:not([hidden])');
        await page.waitForSelector('#outC:not([hidden])');
        assert.deepEqual(await page.$$eval('#showK .doc.is-important b', els => els.map(b => b.textContent)), [EXPECT[id].kDoc]);
        const file = await text(page, '#showC .filecard');
        assert.ok(file.includes(EXPECT[id].prospect), `${NAMES[id]}'s client note`);
        for (const p of PROSPECTS.filter(p => p !== EXPECT[id].prospect)) assert.ok(!file.includes(p));
        assert.match(await text(page, '#showC .filecard'), new RegExp(`Agent\\s*${NAMES[id]}Prospect`));
        assert.match(await text(page, '#rxLead'), new RegExp(`^${NAMES[id]} compared with ${id === AI ? 'David' : 'Michelle'}`));
        // five stages, ending back at Leadership
        const stops = [];
        for (let i = 0; i < 5; i++) {
          stops.push(await text(page, '#stopTag'));
          if (i < 4) await page.click('#nextStop');
        }
        assert.match(stops[0], /^Stage 1 of 5/);
        assert.match(stops[4], /^Stage 5 of 5/);
        assert.equal(await text(page, '#nextStop'), 'See your action plan');
      }
    } finally { await context.close(); }
  });

  test('keyboard only: choose, lock, switch and decide', async () => {
    const { page, context } = await openDemo();
    try {
      await page.focus('#team input[value="anna"]');
      await page.keyboard.press('Space');
      assert.equal(await page.isEnabled('#lock'), true);
      await page.focus('#lock');
      await page.keyboard.press('Enter');
      await page.waitForSelector('#reveal:not([hidden])');
      assert.equal(await text(page, '#cxPick'), 'Anna');
      await page.focus('.path[data-explore="michelle"]');
      await page.keyboard.press('Enter');
      assert.equal(await text(page, '#cxNow'), 'Michelle');
      assert.equal(await page.evaluate(() => document.activeElement.matches('.path[data-explore="michelle"]')), true, 'focus stays on the chosen path');
      await page.focus('#cxSwitch');
      await page.keyboard.press('Space');
      assert.equal(await text(page, '#cxNow'), 'Anna');
      await page.focus('#decideRow [data-decide="verify"]');
      await page.keyboard.press('Enter');
      await page.focus('#confirmDecision');
      await page.keyboard.press('Enter');
      assert.equal(await text(page, '#cxAct'), 'Review it yourself');
    } finally { await context.close(); }
  });

  test('no horizontal overflow at 320-430px and on desktop, for a non-Michelle path', async () => {
    for (const width of [320, 375, 390, 430, 1366]) {
      const { page, context } = await openDemo({ width, height: 800 });
      try {
        await pickAndLock(page, 'david');
        assert.ok(await noOverflow(page), `step 1 reveal at ${width}`);
        await page.click('.path[data-explore="michelle"]');
        await decide(page, 'override');
        assert.ok(await noOverflow(page), `decision at ${width}`);
        const bar = await page.$eval('#ctxbar', el => el.getBoundingClientRect().height);
        assert.ok(bar < 140, `context bar stays compact at ${width} (${bar}px)`);
        await page.click('#cxSwitch');
        await page.click('.steps [data-go="1"]');
        await page.click('#showK [data-run="K"]');
        await page.click('#showC [data-run="C"]');
        await page.waitForSelector('#outC:not([hidden])');
        assert.ok(await noOverflow(page), `step 2 at ${width}`);
        await page.click('.steps [data-go="2"]');
        assert.ok(await noOverflow(page), `step 3 at ${width}`);
      } finally { await context.close(); }
    }
  });

  test('Pilot CTA carries goal and team size; the demo itself sends nothing', async () => {
    const { page, context, requests, errors } = await openDemo();
    try {
      await pickAndLock(page, 'grace');
      await decide(page, 'accept');
      await page.click('.steps [data-go="2"]');
      await page.check('#chips input[value="0"]');
      await page.check('#chips input[value="2"]');
      await page.selectOption('#size', '11–25');
      const href = await page.getAttribute('#pilotLink', 'href');
      const q = new URL(href, baseUrl).searchParams;
      assert.equal(q.get('goal'), '“Your premium is too high”; “I need to think about it”');
      assert.equal(q.get('team-size'), '11–25');

      // nothing but the page itself was requested; no function, form or POST
      assert.ok(requests.every(r => r.startsWith('GET ') && !r.includes('/.netlify/')), requests.join('\n'));
      assert.deepEqual(errors, []);

      await page.click('#pilotLink');
      await page.waitForURL(/pilot-start\.html/);
      assert.equal(await page.inputValue('textarea[name="goal"]'), '“Your premium is too high”; “I need to think about it”');
      assert.equal(await page.$eval('select[name="team-size"]', s => s.options[s.selectedIndex].text), '11–25');
    } finally { await context.close(); }
  });

  test('with motion on, the reveal still lands on the picked learner', async () => {
    const { page, context } = await openDemo({ motion: 'no-preference' });
    try {
      await page.click('label[data-p="john"]');
      await page.click('#lock');
      await page.waitForSelector('#reveal:not([hidden])', { timeout: 8000 });
      assert.match(await text(page, '#verdict h3'), /You chose John/);
      assert.equal(await page.$$eval('.person.flipped', els => els.length), 5);
      assert.equal(await page.$eval('.person.top', l => l.dataset.p), 'michelle');
    } finally { await context.close(); }
  });

  // ---- third review ----
  async function toStep3(page) { await page.click('.steps [data-go="2"]'); await page.waitForSelector('#p2:not([hidden])'); }
  const goal = async page => new URL(await page.getAttribute('#pilotLink', 'href'), baseUrl).searchParams.get('goal');
  const carried = page => page.$$eval('#pri span:not(.empty)', els => els.map(e => e.textContent));

  test('custom Pilot goal is never dropped silently: explicit replace or leave-out choice', async () => {
    const { page, context } = await openDemo();
    try {
      await toStep3(page);
      // own goal alone, then with one preset: both carried
      await page.fill('#own', 'Medicare conversations, 65+');
      assert.deepEqual(await carried(page), ['Medicare conversations, 65+']);
      await page.check('#chips input[value="0"]');
      assert.deepEqual(await carried(page), ['“Your premium is too high”', 'Medicare conversations, 65+']);
      assert.ok(await page.isHidden('#conflict'));

      // a second preset would make three: the page asks, it does not drop the own goal
      await page.check('#chips input[value="2"]');
      assert.ok(await page.isVisible('#conflict'));
      assert.match(await text(page, '#conflictMsg'), /“Medicare conversations, 65\+”, is not included yet: two conversations are already chosen\. Which should it replace\?/);
      assert.match(await text(page, '#carryMiss'), /Not included yet: “Medicare conversations, 65\+”/);
      const choices = await page.$$eval('#conflictBtns button', els => els.map(b => b.textContent));
      assert.deepEqual(choices, ['Replace “Your premium is too high”', 'Replace “I need to think about it”', 'Leave mine out']);

      // requesting while unresolved is held back, with focus on the choice
      await page.click('#pilotLink');
      assert.match(page.url(), /manager-demo-review\.html/);
      assert.equal(await page.evaluate(() => document.activeElement.closest('#conflictBtns') !== null), true);
      assert.match(await text(page, '#goalLive'), /before requesting/);

      // keyboard: replace the first preset
      await page.focus('#conflictBtns button >> nth=0');
      await page.keyboard.press('Enter');
      assert.ok(await page.isHidden('#conflict'));
      assert.equal(await page.isChecked('#chips input[value="0"]'), false);
      assert.deepEqual(await carried(page), ['“I need to think about it”', 'Medicare conversations, 65+']);
      assert.match(await text(page, '#goalLive'), /Replaced\. Carried into your request: “I need to think about it” and Medicare conversations, 65\+\./);
      await page.selectOption('#size', '26–50');
      assert.equal(await goal(page), '“I need to think about it”; Medicare conversations, 65+');
      assert.equal(await text(page, '#carrySize'), '26–50');

      // both priorities and the team size survive the prefill
      await page.click('#pilotLink');
      await page.waitForURL(/pilot-start\.html/);
      assert.equal(await page.inputValue('textarea[name="goal"]'), '“I need to think about it”; Medicare conversations, 65+');
      assert.equal(await page.$eval('select[name="team-size"]', s => s.options[s.selectedIndex].text), '26–50');
    } finally { await context.close(); }
  });

  test('custom Pilot goal: "leave mine out" is explicit, and a third preset is refused', async () => {
    const { page, context } = await openDemo();
    try {
      await toStep3(page);
      await page.check('#chips input[value="1"]');
      await page.check('#chips input[value="3"]');
      await page.click('#chips input[value="4"]');
      assert.equal(await page.isChecked('#chips input[value="4"]'), false, 'a third preset is not accepted');
      assert.match(await text(page, '#chipHint'), /Two is the limit/);
      await page.fill('#own', 'Final expense questions');
      assert.ok(await page.isVisible('#conflict'));
      await page.click('#conflictBtns [data-leaveout]');
      assert.equal(await page.inputValue('#own'), '');
      assert.ok(await page.isHidden('#conflict'));
      assert.ok(await page.isHidden('#carryMiss'));
      assert.deepEqual(await carried(page), ["Comparing a competitor's quote", 'The first call to a new prospect']);
      assert.equal(await goal(page), "Comparing a competitor's quote; The first call to a new prospect");
      assert.match(await text(page, '#goalLive'), /left out/);
    } finally { await context.close(); }
  });

  test('cutting the budget after several approvals marks the plan Needs revision everywhere, then revising fixes it', async () => {
    const { page, context } = await openDemo();
    try {
      await pickAndLock(page, 'grace');
      await page.click('.path[data-explore="michelle"]');
      await decide(page, 'accept');                       // Michelle 20
      await page.click('#cxSwitch');
      await decide(page, 'override');                     // Grace 10
      await exploreFromEvidence(page, 'john');
      await decide(page, 'verify');                       // John review, no time
      assert.equal(await text(page, '#ttStatus'), 'Within budget');

      await page.check('input[name="demoBudget"][value="15"]');
      assert.equal(await text(page, '#ttStatus'), 'Needs revision');
      assert.match(await text(page, '#ttWarn'), /Needs revision\. 30 min of coaching are approved, but only 15 min are available, so this plan is not workable as it stands\. Your decisions are kept for review/);
      assert.match(await text(page, '#ttLive'), /Needs revision/);
       // The comparison must acknowledge an over-budget manager plan.
       assert.match(await text(page, '#compareBody .cmp-lead'), /your current demo plan is over by 15 min and needs revision/);
       assert.doesNotMatch(await text(page, '#compareBody .cmp-lead'), /Two hypothetical plans within/);
      assert.equal(await page.$$eval('.tt-bar .seg.bad', els => els.length), 2);
      const tags = await page.$$eval('#ttList .it', els => els.map(it => it.querySelector('b').textContent + (it.querySelector('.nr') ? ' NR' : '')));
      assert.deepEqual(tags, ['Michelle NR', 'Grace NR', 'John'], 'decisions are preserved; only coaching is flagged');
      assert.equal(await approvedMin(page), 30);

      // John (no coaching time) is not flagged; Michelle is flagged in her decision, chain, bar and follow-up
      assert.ok(await page.isHidden('#decNeeds'));
      await exploreFromEvidence(page, 'michelle');
      assert.ok(await page.isVisible('#decided'), 'Michelle still decided (not silently reverted)');
      assert.match(await text(page, '#decNeeds'), /Needs revision\. The team plan is over budget/);
      assert.match(await text(page, '#chainCn'), /Needs revision/);
      assert.match(await text(page, '#cxAct'), /Coach now · 20 min · needs revision/);
      await page.evaluate(() => { document.getElementById('followupDetails').open = true; });
      assert.match(await text(page, '#fuPlan'), /^Needs revision before it could happen:/);
      await page.click('.steps [data-go="1"]');
      assert.match(await text(page, '#route'), /Needs revision.*not workable as it stands/);
      await toStep3(page);
      assert.match(await text(page, '#actionPlan'), /Plan status: Needs revision\. Coaching time: 30 min approved, but only 15 min available\./);
      assert.equal(await page.$$eval('#actionPlan .nr', els => els.length), 2);

      // direct control: go back to 30 min, then cut again and revise instead
      await page.click('.steps [data-go="0"]');
      await page.click('#ttWarn [data-budget="30"]');
      assert.equal(await text(page, '#ttStatus'), 'Within budget');
      await page.check('input[name="demoBudget"][value="15"]');
      await page.click('#ttList [data-revise="grace"]');
      assert.equal(await text(page, '#cxNow'), 'Grace');
      assert.equal(await approvedMin(page), 20);
      assert.equal(await text(page, '#ttStatus'), 'Needs revision', 'still 20 of 15');
      await decide(page, 'accept');                       // Grace: harder scenario, no time
      await page.click('#ttList [data-revise="michelle"]');
      assert.deepEqual(await minOptions(page), [[10, true], [15, true], [20, false]]);
      await page.check('#minOpts input[value="10"]');
      await page.click('#confirmDecision');
      assert.equal(await text(page, '#ttStatus'), 'Within budget');
      assert.equal(await page.$$eval('#ttList .nr', els => els.length), 0);
      assert.ok(await page.isHidden('#decNeeds'));
      await toStep3(page);
      const recap = await text(page, '#actionPlan');
      assert.match(recap, /Plan status: within budget\. Coaching time: 10 of 15 min committed, 5 left\./);
      assert.match(recap, /Michelle: Coach now, 10 min/);
      assert.match(recap, /Grace: Harder scenario/);
      assert.match(recap, /John: Review it yourself/);
    } finally { await context.close(); }
  });

  test('team summary groups every decision and names the AI priority, its evidence and who is undecided', async () => {
    const { page, context } = await openDemo();
    try {
      await pickAndLock(page, 'michelle');
      assert.equal(await text(page, '#ttStatus'), 'No decisions yet');
      assert.match(await text(page, '#ttAI'), /AI's top priority: Michelle\. Evidence: same gap in 4 of 4 attempts in simulated practice\./);
      await decide(page, 'override');                     // Michelle: hold coaching -> monitoring, reassess
      await exploreFromEvidence(page, 'david'); await decide(page, 'verify');    // review pending
      await exploreFromEvidence(page, 'john'); await decide(page, 'accept');     // practice planned
      await exploreFromEvidence(page, 'grace'); await decide(page, 'override');  // coaching, reassess
      const groups = await page.$$eval('#ttList li[data-group]', els => els.map(li => li.dataset.group + ': ' + li.querySelector('.its').innerText.replace(/Revise/g, '').replace(/\s+/g, ' ').trim()));
      assert.deepEqual(groups, [
        'coach: Grace Coach her anyway 20 min',
        'practice: John One more practice',
        'review: David Review it yourself',
        'monitor: Michelle Hold coaching',
        'reassess: Michelle and Grace: you overrode the AI suggestion, so compare the new evidence with it. Neither is assumed right.',
        'undecided: Anna',
      ]);
      // an undecided learner is one click from a decision
      await page.click('#ttList [data-decidefor="anna"]');
      assert.equal(await text(page, '#cxNow'), 'Anna');
      assert.equal(await page.evaluate(() => document.activeElement.matches('#decideRow [data-decide]')), true);
      await toStep3(page);
      const recap = await text(page, '#actionPlan');
      assert.deepEqual(await page.$$eval('#actionPlan .ap-item', els => els.map(li => li.dataset.id + ' ' + li.querySelector('.ap-cat').textContent)),
        ['grace Coach', 'david More evidence first', 'john More evidence first', 'michelle Monitor']);
      assert.match(recap, /Not decided yet: Anna/);
    } finally { await context.close(); }
  });

  test('plan comparison is read-only, budget-bound and never claims outcomes', async () => {
    const { page, context } = await openDemo();
    try {
      await pickAndLock(page, 'grace');
      await decide(page, 'override');                     // Grace coached 20
      await page.click('#ttList summary, #compare summary');
      await page.evaluate(() => { document.getElementById('compare').open = true; });
      const cards = await page.$$eval('#compareBody .plancard', els => els.map(e => e.innerText.replace(/\s+/g, ' ')));
      assert.equal(cards.length, 2);
      const [ai, mine] = cards;
      assert.match(ai, /The AI's suggested plan Hypothetical/);
      assert.match(ai, /Immediate coaching Michelle \(20 min\)/);
      assert.match(ai, /Minutes 20 of 30 committed, 10 left/);
      assert.match(ai, /Evidence behind each coaching priority Michelle: Same gap in 4 of 4 attempts \(consistent evidence\)/);
      assert.match(mine, /Immediate coaching Grace \(20 min\)/);
      assert.match(mine, /Michelle, the AI's top priority \(same gap in 4 of 4 attempts\), gets no coaching in this plan\./);
      assert.match(mine, /Spends 20 min on Grace, where practice shows no gap\./);
      assert.match(mine, /No decision yet for David, Michelle, John and Anna\./);
      for (const c of cards) {
        assert.match(c, /Based on simulated practice only\. No outcome is known\./);
        assert.doesNotMatch(c, /will improve|guarantee|proven|validated|optimi[sz]ed/i);
      }
      assert.match(await text(page, '#compareBody .cmp-lead'), /not results\. Nothing here is applied/);
      assert.equal(await page.$$eval('#compareBody button, #compareBody input', els => els.length), 0, 'no controls inside the comparison');

      // follows the budget, and recognises a plan that matches the AI's
      await page.check('input[name="demoBudget"][value="15"]');
      assert.match((await page.innerText('#compareBody .plancard >> nth=0')).replace(/\s+/g, ' '), /Michelle \(10 min\).*10 of 15 committed, 5 left/);
      await page.check('input[name="demoBudget"][value="30"]');
      await page.click('#changeDecision');
      for (const id of ['grace', 'david', 'michelle', 'john', 'anna']) {
        if ((await text(page, '#cxNow')) !== NAMES[id]) await exploreFromEvidence(page, id);
        await decide(page, 'accept');
      }
      assert.match(await text(page, '#compareBody'), /Your plan matches the AI's suggested plan\./);
    } finally { await context.close(); }
  });

  test('step 2 separates decision, hypothetical workflow, general demonstration and illustrative follow-up', async () => {
    const { page, context } = await openDemo();
    try {
      await pickAndLock(page, 'john');
      await decide(page, 'accept');
      await page.evaluate(() => { document.getElementById('followupDetails').open = true; });
      assert.match(await text(page, '#followupDetails .fu-tag'), /Illustrative follow-up Invented events for a fictional team, not results\./);
      await page.click('#decided [data-go="1"]');
      assert.deepEqual(await page.$$eval('.layers .lyr', els => els.map(e => e.textContent)), ['Your decision', 'Hypothetical workflow', 'General demonstration', 'Illustrative follow-up']);
      assert.match(await text(page, '#route .route-k'), /Your decision Your approved demo decision, fictional/);
      assert.match(await text(page, '#route .route-sub'), /Hypothetical workflow What the Studios would do for this decision\. Nothing was sent or assigned\./);
      assert.match(await text(page, '.stagenote'), /^General demonstration General illustration for John's case/);
      assert.equal(await page.$$eval('.rx .lyr.gen', els => els.length), 1);
      assert.equal(await page.$$eval('.loophead .lyr.ill', els => els.length), 1);
      // with no decision, the route is a general demonstration, not a workflow
      await page.click('.steps [data-go="0"]');
      await page.click('#changeDecision');
      await page.click('.steps [data-go="1"]');
      assert.match(await text(page, '#route .route-k'), /General demonstration Optional illustration/);
      assert.equal(await page.$$eval('#route .lyr.dec, #route .lyr.hyp', els => els.length), 0);
    } finally { await context.close(); }
  });

  test('new panels fit at 320-430px and simulation labels stay visible', async () => {
    for (const width of [320, 375, 430]) {
      const { page, context } = await openDemo({ width, height: 760 });
      try {
        await pickAndLock(page, 'michelle');
        assert.ok(await page.isVisible('#verdict .sim-flag'));
        await decide(page, 'accept');
        assert.ok(await page.isVisible('#decided .demo-flag'));
        await page.click('#cxSwitch').catch(() => {});
        await exploreFromEvidence(page, 'grace');
        await decide(page, 'override');
        await page.check('input[name="demoBudget"][value="15"]');
        await page.evaluate(() => { document.getElementById('compare').open = true; });
        assert.ok(await noOverflow(page), `team plan, over budget and comparison at ${width}`);
        await page.click('.steps [data-go="1"]');
        assert.ok(await page.isVisible('.layers'));
        assert.ok(await noOverflow(page), `step 2 layers and route at ${width}`);
        await toStep3(page);
        await page.check('#chips input[value="0"]');
        await page.check('#chips input[value="2"]');
        await page.fill('#own', 'A long custom conversation about family protection reviews');
        assert.ok(await page.isVisible('#conflict'));
        assert.ok(await noOverflow(page), `goal conflict at ${width}`);
        assert.ok(await page.isVisible('.realvs'));
      } finally { await context.close(); }
    }
  });

  // ---- fourth review: Manager Action Plan ----
  async function fourDecisions(page) {
    await pickAndLock(page, 'grace');
    await exploreFromEvidence(page, 'michelle'); await decide(page, 'accept');   // coach 20
    await exploreFromEvidence(page, 'grace'); await decide(page, 'override');    // coach 10, reason 1
    await exploreFromEvidence(page, 'david'); await decide(page, 'accept');      // more evidence first
    await exploreFromEvidence(page, 'john'); await decide(page, 'verify');       // review, more evidence first
  }
  const itext = async (page, sel) => (await page.innerText(sel)).replace(/\s+/g, ' ').trim();
  const items = page => page.$$eval('#actionPlan .ap-item', els => els.map(li => ({
    id: li.dataset.id, cat: li.querySelector('.ap-cat').textContent, head: li.querySelector('h4').textContent,
    review: li.querySelector('.ap-rev').textContent,
    trace: [...li.querySelectorAll('.trace li')].map(c => [c.querySelector('b').textContent, c.querySelector('span').textContent, c.className]) })));

  test('action plan reflects several decisions, their evidence and the team budget', async () => {
    const { page, context } = await openDemo();
    try {
      await fourDecisions(page);
      const committed = await approvedMin(page);
      await toStep3(page);
      assert.equal(await text(page, '#apHead'), 'Coach Michelle and Grace first, and check David and John before spending more time.');
      const kpis = await page.$$eval('#actionPlan .kpi', els => els.map(k => k.innerText.replace(/\s+/g, ' ').trim()));
      assert.deepEqual(kpis, ['Coach 30 min Michelle 20 min, Grace 10 min', 'More evidence first 2 David, John', 'Practice, stretch or monitor 0 No one', 'Capacity 0 min left of 30 min · Within budget']);
      assert.equal(committed, 30, 'the plan and the team panel agree');
      assert.match(await text(page, '.ap-status'), /^Plan status: within budget\. Coaching time: 30 of 30 min committed, 0 left\.$/);
      assert.match(await text(page, '.ap-ai'), /AI's top priority: Michelle \(same gap in 4 of 4 attempts\)\. You picked Grace\./);

      const it = await items(page);
      assert.deepEqual(it.map(i => [i.id, i.cat, i.head, i.review]), [
        ['michelle', 'Coach', 'Michelle: Coach now, 20 min', 'Review: Day 2, after the new practice'],
        ['grace', 'Coach', 'Grace: Coach her anyway, 10 min', 'Review: Day 5, after the session'],
        ['david', 'More evidence first', 'David: Basics + second scenario', 'Review: Day 4, after the second scenario'],
        ['john', 'More evidence first', 'John: Review it yourself', 'Review: Day 1, after you read the excerpt'],
      ]);
      // every item traces evidence -> source -> client -> decision -> next action
      for (const i of it) assert.deepEqual(i.trace.map(t => t[0]), ['Practice evidence', 'Knowledge source', 'Client context', 'Your decision', 'Next action']);
      const [m, g, d, j] = it;
      assert.equal(m.trace.filter(t => t[2] === 'miss').length, 0);
      assert.match(m.trace[0][1], /Same gap in 4 of 4 attempts \(consistent evidence\)\. Scripted excerpts: attempts 1 and 4\./);
      assert.match(m.trace[1][1], /Coaching note §2/);
      assert.match(m.trace[2][1], /Ms\. Rivera/);
      assert.equal(m.trace[3][1], 'Accepted the AI suggestion.');
      assert.match(m.trace[4][1], /^A 20-minute one-to-one with Michelle/);
      assert.deepEqual([g.trace[1][2], g.trace[2][2]], ['miss', 'miss'], 'missing source and client note are marked');
      assert.match(g.trace[1][1], /^Missing: no approved source is linked to this coaching yet\.$/);
      assert.match(g.trace[3][1], /^Overrode the AI suggestion \(Harder scenario\)\. Reason: Evidence is too narrow\.$/);
      assert.equal(d.trace[0][2], 'thin');
      assert.match(j.trace[1][1], /^Not needed yet: you decide after your review\.$/);
      assert.equal(j.trace[3][1], 'Chose to verify first. The AI suggested: One more practice.');
      assert.match(j.trace[4][1], /Nothing is assigned and no coaching time is used/);

      // undecided learners are named, and one click takes the manager back to decide
      assert.match(await text(page, '.ap-undec'), /Not decided yet: Anna No action is planned for them\./);
      await page.click('.ap-undec [data-decidefor="anna"]');
      await page.waitForSelector('#p0:not([hidden])');
      assert.equal(await text(page, '#cxNow'), 'Anna');
      assert.match(await text(page, '.ap-foot'), /nothing was assigned, sent or saved, and no result is claimed/);
    } finally { await context.close(); }
  });

  test('every learner and action gives a traceable plan item with a review period', async () => {
    const { page, context } = await openDemo();
    try {
      await pickAndLock(page, 'david');
      const CAT = { michelle: { accept: 'Coach', verify: 'More evidence first', override: 'Monitor' },
        david: { accept: 'More evidence first', verify: 'More evidence first', override: 'Coach' },
        john: { accept: 'More evidence first', verify: 'More evidence first', override: 'Coach' },
        grace: { accept: 'Practice and stretch', verify: 'More evidence first', override: 'Coach' },
        anna: { accept: 'More evidence first', verify: 'More evidence first', override: 'Coach' } };
      for (const id of Object.keys(EXPECT)) {
        for (const action of ['accept', 'verify', 'override']) {
          await page.click('.steps [data-go="0"]');
          if ((await text(page, '#cxNow')) !== NAMES[id]) await exploreFromEvidence(page, id);
          await decide(page, action);
          await toStep3(page);
          const [i] = await items(page);
          assert.equal((await items(page)).length, 1);
          assert.equal(i.cat, CAT[id][action], `${id} ${action}`);
          assert.match(i.head, new RegExp(`^${NAMES[id]}: ${EXPECT[id][action].replace(/[+]/g, '\\+')}`));
          assert.match(i.review, /^Review: (Day \d+), /);
          const next = i.trace[4][1];
          if (CAT[id][action] === 'Coach') assert.match(next, /\d+-minute one-to-one/, `${id} ${action} next action`);
          if (action === 'verify' && id !== 'michelle') assert.match(next, /Nothing is assigned and no coaching time is used/);
          if (id === 'michelle' && action === 'override') assert.match(next, /No coaching and no new practice/);
          for (const [k, v, cls] of i.trace) {
            assert.ok(v.trim().length > 10, `${id} ${action} ${k} has content`);
            if (cls === 'miss') assert.match(v, /^Missing: /);
            if (cls === 'na') assert.match(v, /^(Not needed yet|Not used): /);
          }
          // the plan never claims a result
          assert.doesNotMatch(await text(page, '#actionPlan'), /improved|achieved|was sent|has been assigned|guarantee/i);
          await page.click('.steps [data-go="0"]');
          await page.click('#changeDecision');
        }
      }
    } finally { await context.close(); }
  });

  test('Copy action plan puts formatted plain text on the clipboard and stores or sends nothing', async () => {
    const { page, context, requests } = await openDemo({ permissions: ['clipboard-read', 'clipboard-write'] });
    try {
      await fourDecisions(page);
      await toStep3(page);
      const before = requests.length;
      await page.click('[data-copyplan]');
      await page.waitForFunction(() => /Copied/.test(document.getElementById('copyStatus').textContent));
      assert.equal(await text(page, '#copyStatus'), 'Copied as plain text. Nothing was stored or sent.');
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      const lines = clip.split('\n');
      assert.equal(lines[0], 'Manager action plan: next week');
      assert.equal(lines[1], 'Fictional demo team. Simulated practice evidence. Demo decisions only: nothing was assigned or sent.');
      for (const want of ['Coach Michelle and Grace first, and check David and John before spending more time.',
        'Plan status: within budget. Coaching time: 30 of 30 min committed, 0 left.',
        'Coach: Michelle (20 min), Grace (10 min)', 'More evidence first: David, John', 'Not decided yet: Anna',
        '1. Michelle: Coach now, 20 min [Coach]', '   Review: Day 2, after the new practice.',
        '2. Grace: Coach her anyway, 10 min [Coach]', '   Knowledge source: Missing: no approved source is linked to this coaching yet.',
        '4. John: Review it yourself [More evidence first]', '   Your decision: Chose to verify first. The AI suggested: One more practice.',
        'Review days are relative to a fictional demo decision, not actual approval or calendar dates.']) assert.ok(lines.includes(want), `copied text includes: ${want}`);
      assert.doesNotMatch(clip, /<[a-z]/i, 'plain text, no markup');
      assert.equal(clip, await page.evaluate(() => planText()), 'the copy is exactly what the page shows');
      assert.equal(requests.length, before, 'copying sends nothing');
      assert.deepEqual(await page.evaluate(() => [localStorage.length, sessionStorage.length]), [0, 0], 'copying stores nothing');
    } finally { await context.close(); }
  });

  test('if the browser blocks copying, the plan is shown selected for manual copy', async () => {
    const init = () => { Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }); document.execCommand = () => false; };
    const { page, context } = await openDemo({ init });
    try {
      await fourDecisions(page);
      await toStep3(page);
      await page.click('[data-copyplan]');
      assert.match(await text(page, '#copyStatus'), /Your browser blocked copying\. The plan is selected below/);
      assert.ok(await page.isVisible('#copyFallback'));
      assert.equal(await page.inputValue('#copyFallback'), await page.evaluate(() => planText()));
    } finally { await context.close(); }
  });

  test('action plan follows decision changes and budget cuts, including Needs revision', async () => {
    const { page, context } = await openDemo({ permissions: ['clipboard-read', 'clipboard-write'] });
    try {
      await fourDecisions(page);
      await page.check('input[name="demoBudget"][value="15"]');
      await toStep3(page);
      assert.match(await itext(page, '#actionPlan .k-cap'), /Capacity Over by 15 of 15 min · Needs revision/);
      assert.match(await text(page, '.ap-status'), /^Plan status: Needs revision\. Coaching time: 30 min approved, but only 15 min available\. Revise in step 1$/);
      assert.equal(await page.$$eval('#actionPlan .ap-item .nr', els => els.length), 2);
      const it = await items(page);
      assert.match(it[0].trace[4][1], /^Needs revision first\. /);
      await page.click('[data-copyplan]');
      await page.waitForFunction(() => /Copied/.test(document.getElementById('copyStatus').textContent));
      const clip = await page.evaluate(() => navigator.clipboard.readText());
      assert.ok(clip.includes('Plan status: Needs revision.') && clip.includes('[Needs revision]'));

      // revise Grace to a harder scenario and Michelle to 10 min: the plan updates
      await page.click('.ap-status [data-todecide]');
      await page.click('#ttList [data-revise="grace"]');
      await decide(page, 'accept');
      await page.click('#ttList [data-revise="michelle"]');
      await page.check('#minOpts input[value="10"]');
      await page.click('#confirmDecision');
      await toStep3(page);
      assert.equal(await text(page, '#apHead'), 'Coach Michelle first, and check David and John before spending more time.');
      assert.match(await itext(page, '#actionPlan .k-cap'), /Capacity 5 min left of 15 min · Within budget/);
      assert.deepEqual((await items(page)).map(i => i.id + ' ' + i.cat), ['michelle Coach', 'david More evidence first', 'john More evidence first', 'grace Practice and stretch']);
      assert.equal(await page.$$eval('#actionPlan .nr', els => els.length), 0);
    } finally { await context.close(); }
  });

  test('the invitation leads into the existing Pilot form, whose prefill still works', async () => {
    const { page, context } = await openDemo();
    try {
      await fourDecisions(page);
      await toStep3(page);
      assert.equal(await text(page, '.invite h3'), 'See what this could look like with your own team.');
      const hashBefore = await page.evaluate(() => location.hash);
      await page.click('#toPilot');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'h2');
      assert.equal(await page.evaluate(() => location.hash), hashBefore, 'no hash change, so a reload stays on step 3');
      await page.check('#chips input[value="1"]');
      await page.fill('#own', 'Final expense questions');
      await page.selectOption('#size', '11–25');
      await page.click('#pilotLink');
      await page.waitForURL(/pilot-start\.html/);
      assert.equal(await page.inputValue('textarea[name="goal"]'), "Comparing a competitor's quote; Final expense questions");
      assert.equal(await page.$eval('select[name="team-size"]', s => s.options[s.selectedIndex].text), '11–25');
    } finally { await context.close(); }
  });

  test('action plan fits phones (320-430px) and desktop, with the copy button reachable', async () => {
    for (const width of [320, 375, 430, 1366]) {
      const { page, context } = await openDemo({ width, height: 800 });
      try {
        await fourDecisions(page);
        await toStep3(page);
        assert.ok(await noOverflow(page), `action plan at ${width}`);
        assert.ok(await page.isVisible('[data-copyplan]'));
        assert.ok(await page.isVisible('#apHead'));
        const kpiBox = await page.$eval('.ap-kpis', el => el.getBoundingClientRect().width);
        assert.ok(kpiBox <= width, `KPIs fit at ${width}`);
      } finally { await context.close(); }
    }
  });
});
