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
async function openDemo({ width = 1366, height = 900, motion = 'reduce' } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: motion });
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
const minutes = page => page.$$eval('#allocation b', els => els.map(e => parseInt(e.textContent, 10)));
const noOverflow = page => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

describe('Manager Demo: five complete learner paths', () => {
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

  test('accept, verify and override use coaching time logically for every learner', async () => {
    const { page, context } = await openDemo();
    try {
      await pickAndLock(page, 'david');
      for (const id of Object.keys(EXPECT)) {
        if ((await text(page, '#cxNow')) !== NAMES[id]) {
          await exploreFromEvidence(page, id);
        }
        assert.equal(await text(page, '#cxNow'), NAMES[id]);
        const e = EXPECT[id];
        for (const action of ['accept', 'verify', 'override']) {
          await decide(page, action);
          const [total, mine, rest] = await minutes(page);
          const coaches = action === 'accept' ? e.acceptCoaches : action === 'override' ? e.overrideCoaches : false;
          assert.equal(total, 30);
          assert.equal(mine, coaches ? 20 : 0, `${NAMES[id]} ${action}`);
          assert.equal(rest, total - mine);
          assert.equal(await text(page, '#cxAct'), e[action]);
          assert.equal(await text(page, '#chainCv'), e[action]);
          assert.match(await text(page, '#decided'), /Demo decision\. No assignment was sent to anyone\./);
          await page.click('#changeDecision');
          assert.ok(await page.isHidden('#decided'));
          assert.equal(await text(page, '#chainCv'), 'Yours');
        }
      }
      // only Michelle's AI suggestion spends coaching time; budget changes scale it
      await exploreFromEvidence(page, 'michelle');
      await decide(page, 'accept');
      await page.click('#judgmentDetails summary');
      await page.check('input[name="demoBudget"][value="15"]');
      assert.deepEqual(await minutes(page), [15, 10, 5]);
      assert.match(await text(page, '#decidedTxt'), /10 of your 15/);
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
      assert.equal((await minutes(page))[1], 20);

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
      const recap = await text(page, '#recap');
      assert.match(recap, /You picked John\. The AI's top suggestion was Michelle\./);
      assert.match(recap, /John: One more practice/);
      assert.match(recap, /Michelle: Coach now/);
      assert.match(recap, /Nothing was sent or saved/);
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
        assert.equal(await text(page, '#nextStop'), 'Now your team');
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
});
