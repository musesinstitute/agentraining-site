// Headless-browser coverage for Invite Learner: Manager -> Invite -> Copy
// Link -> Learner opens the real accept page -> sets password -> Manager
// roster visibility.
//
// Runs the real manager.html / pilot-invite-accept.html / pilot-cloud.js
// files in real Chromium via a local static server. All /.netlify/* network
// calls (functions and the Identity widget script itself) are intercepted
// with page.route() and answered with scripted, in-memory responses - no
// real Netlify Identity or Netlify Functions call is ever made.
//
// Run with: npm test  (also runs this file; see package.json "test" script)
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { startStaticServer } from './static-server.mjs';

// Reads window.__testManagerUser, which the test seeds via page.addInitScript
// BEFORE this script (and therefore before manager.html's own automatic
// refreshCloud() call) ever runs - so PilotCloud.ready('manager') resolves
// immediately from an already-"signed-in" currentUser(), exactly like a real
// returning session, instead of racing the sign-in gate.
const FAKE_WIDGET_JS = `
window.netlifyIdentity = (function () {
  let currentUser = window.__testManagerUser || null;
  const handlers = {};
  return {
    init() {},
    currentUser: () => currentUser,
    on(event, cb) { handlers[event] = cb; },
    open() {}, close() {}, logout() { currentUser = null; },
    gotrue: { login: async () => { throw new Error('not used in this test'); } }
  };
})();
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

const MANAGER_JWT_PAYLOAD = { app_metadata: { roles: ['manager', 'team-founding-pilot'] } };
function fakeJwt() {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64');
  const payload = Buffer.from(JSON.stringify(MANAGER_JWT_PAYLOAD)).toString('base64');
  return `${header}.${payload}.`;
}

async function mockIdentityWidget(page) {
  await page.route('https://identity.netlify.com/v1/netlify-identity-widget.js', route =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_WIDGET_JS }));
}

async function mockManagerSignedIn(page) {
  await page.addInitScript(({ jwt }) => {
    window.__testManagerUser = {
      email: 'manager@example.com', jwt: async () => jwt, getUserData: async () => {},
      app_metadata: { roles: ['manager', 'team-founding-pilot'] }
    };
  }, { jwt: fakeJwt() });
}

let sharedInviteState = null; // set by the create-invite test, read by the accept-page test

describe('Invite Learner - headless browser flow', () => {
  test('Manager Studio: Invite Learner panel is visible and manager can create an invitation', async () => {
    const page = await browser.newPage();
    await mockIdentityWidget(page);
    await mockManagerSignedIn(page);

    await page.route('**/.netlify/functions/pilot-data**', route => {
      const url = new URL(route.request().url());
      const resource = url.searchParams.get('resource');
      const body = resource === 'assignments' ? { assignments: [] }
        : resource === 'sessions' ? { sessions: [] }
        : resource === 'profiles' ? { profiles: [] }
        : {};
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });

    let createRequestBody = null;
    await page.route('**/.netlify/functions/pilot-invite**', route => {
      const url = new URL(route.request().url());
      const action = url.searchParams.get('action');
      if (action === 'create') {
        createRequestBody = route.request().postDataJSON();
        const invite = {
          id: 'invite-1', token: 'test-token-abc123', email: createRequestBody.email,
          name: createRequestBody.name || '', teamId: 'founding-pilot', status: 'pending',
          createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 7 * 86400000).toISOString(),
          invitedBy: 'manager@example.com'
        };
        sharedInviteState = invite;
        route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ invite, reused: false }) });
      } else if (action === 'list') {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ invites: sharedInviteState ? [sharedInviteState] : [] }) });
      } else {
        route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"unexpected"}' });
      }
    });

    await page.goto(`${baseUrl}/manager.html?pilot=1`);
    // The page's own automatic refreshCloud() call (fired at the bottom of
    // manager.html's script) already ran against the pre-seeded manager user
    // by this point - no manual re-trigger needed.

    const invitePanel = page.locator('#invite-panel');
    await assert.doesNotReject(invitePanel.waitFor({ state: 'visible', timeout: 5000 }), 'Invite Learner panel becomes visible for a manager');

    await page.fill('#inviteName', 'Test Learner');
    await page.fill('#inviteEmail', 'newlearner@example.com');
    await page.click('#createInvite');

    await page.locator('#inviteLinkBox').waitFor({ state: 'visible', timeout: 5000 });
    const linkValue = await page.locator('#inviteLinkText').inputValue();
    assert.equal(createRequestBody.email, 'newlearner@example.com', 'the create request carried the email the manager typed');
    assert.equal(createRequestBody.name, 'Test Learner');
    assert.equal(linkValue, `${baseUrl}/pilot-invite-accept.html?token=test-token-abc123`, 'the Copy Invite Link value is a relative-to-origin link built from the real token');

    await page.close();
  });

  test('Learner: opening the real accept page shows the invited email and lets them set a password', async () => {
    assert.ok(sharedInviteState, 'previous test created an invite to accept');
    const page = await browser.newPage();

    await page.route('**/.netlify/functions/pilot-invite**', route => {
      const url = new URL(route.request().url());
      const action = url.searchParams.get('action');
      if (action === 'lookup') {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'pending', email: sharedInviteState.email, name: sharedInviteState.name }) });
      } else if (action === 'accept') {
        const body = route.request().postDataJSON();
        assert.equal(body.token, sharedInviteState.token, 'accept posts the exact token from the link');
        assert.ok(body.password && body.password.length >= 8, 'accept posts the password the learner typed');
        route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ status: 'created', email: sharedInviteState.email }) });
      } else {
        route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"unexpected"}' });
      }
    });

    await page.goto(`${baseUrl}/pilot-invite-accept.html?token=${sharedInviteState.token}`);
    await page.locator('#acceptForm').waitFor({ state: 'visible', timeout: 5000 });
    const leadText = await page.locator('.card p.lead').innerText();
    assert.match(leadText, /newlearner@example\.com/, 'the accept page shows the correct invited email from lookup');

    await page.fill('#password', 'a-strong-password-1');
    await page.fill('#confirmPassword', 'a-strong-password-1');
    await page.click('#acceptButton');

    const cta = page.locator('a.cta');
    await cta.waitFor({ state: 'visible', timeout: 5000 });
    const href = await cta.getAttribute('href');
    assert.equal(href, 'pilot.html?pilot=1', 'the post-accept CTA is a plain relative link into the existing sign-in flow, not an absolute/production-assumed URL');
    const heading = await page.locator('h1').innerText();
    assert.match(heading, /Account created|账号已建立/);

    await page.close();
  });

  test('Learner re-opening an already-accepted invite link is told to sign in, not asked to set a password again', async () => {
    const page = await browser.newPage();
    await page.route('**/.netlify/functions/pilot-invite**', route => {
      const url = new URL(route.request().url());
      if (url.searchParams.get('action') === 'lookup') {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'accepted', email: sharedInviteState.email }) });
      } else {
        route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
      }
    });
    await page.goto(`${baseUrl}/pilot-invite-accept.html?token=${sharedInviteState.token}`);
    await page.locator('a.cta').waitFor({ state: 'visible', timeout: 5000 });
    const formExists = await page.locator('#acceptForm').count();
    assert.equal(formExists, 0, 'no password form is shown for an already-accepted invite');
    await page.close();
  });

  test('Manager roster visibility: once the backend reports the learner in profiles, they appear in the Manager learner picker', async () => {
    const page = await browser.newPage();
    await mockIdentityWidget(page);
    await mockManagerSignedIn(page);
    await page.route('**/.netlify/functions/pilot-data**', route => {
      const url = new URL(route.request().url());
      const resource = url.searchParams.get('resource');
      const body = resource === 'assignments' ? { assignments: [] }
        : resource === 'sessions' ? { sessions: [] }
        : resource === 'profiles' ? { profiles: [{ learnerEmail: 'newlearner@example.com', preferredName: 'Test Learner', claims: [] }] }
        : {};
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    await page.route('**/.netlify/functions/pilot-invite**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"invites":[]}' }));

    await page.goto(`${baseUrl}/manager.html?pilot=1`);

    await page.waitForFunction(() => document.getElementById('managerLearnerOptions').innerHTML.includes('newlearner@example.com'), { timeout: 5000 });
    const optionsHtml = await page.locator('#managerLearnerOptions').innerHTML();
    assert.match(optionsHtml, /newlearner@example\.com/, 'the newly-provisioned learner is visible to the Manager through the existing roster/profiles rendering, unmodified by this feature');

    await page.close();
  });
});
