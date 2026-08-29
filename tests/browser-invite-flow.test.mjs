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

// Fake widget for pilot-invite-accept.html's post-creation auto-login: a
// working (or deliberately failing) gotrue.login() that records what it was
// called with. The call is recorded into sessionStorage (not just a JS
// variable) because a successful login navigates the page away to
// pilot.html - sessionStorage is the one thing that survives a same-origin
// navigation so the test can still inspect what was actually submitted.
function learnerWidgetScript(loginShouldSucceed) {
  return `
window.netlifyIdentity = (function () {
  // A successful login navigates the page away to pilot.html, which loads
  // this same fake widget script fresh - so "signed in" state has to
  // survive that the same way the real widget does it: persisted to
  // localStorage, not just an in-memory variable that would reset on
  // every navigation.
  function loadUser() {
    try { const raw = localStorage.getItem('__fakeIdentityUser'); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function withJwt(user) {
    return user ? Object.assign({ jwt: async () => 'fake-jwt-for-' + user.email, getUserData: async () => {} }, user) : null;
  }
  let currentUser = loadUser();
  return {
    init() {},
    currentUser: () => withJwt(currentUser),
    on() {}, open() {}, close() {},
    logout() { currentUser = null; try { localStorage.removeItem('__fakeIdentityUser'); } catch (e) {} },
    gotrue: {
      login: async (email, password, remember) => {
        try { sessionStorage.setItem('__autoLoginCall', JSON.stringify({ email, password, remember })); } catch (e) {}
        ${loginShouldSucceed ? '' : "throw new Error('Invalid login credentials');"}
        currentUser = { email, app_metadata: { roles: ['learner', 'team-founding-pilot'] } };
        try { localStorage.setItem('__fakeIdentityUser', JSON.stringify(currentUser)); } catch (e) {}
        return withJwt(currentUser);
      }
    }
  };
})();
`;
}
async function mockLearnerLoginWidget(page, loginShouldSucceed) {
  await page.route('https://identity.netlify.com/v1/netlify-identity-widget.js', route =>
    route.fulfill({ status: 200, contentType: 'text/javascript', body: learnerWidgetScript(loginShouldSucceed) }));
}
async function mockPilotDataForLearner(page, email) {
  await page.route('**/.netlify/functions/pilot-data**', route => {
    const url = new URL(route.request().url());
    const resource = url.searchParams.get('resource');
    const body = resource === 'me' ? { email, roles: ['learner', 'team-founding-pilot'], teamId: 'founding-pilot' }
      : resource === 'assignments' ? { assignments: [] }
      : resource === 'sessions' ? { sessions: [] }
      : resource === 'profiles' ? { profiles: [] }
      : {};
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

async function mockManagerSignedIn(page) {
  await page.addInitScript(({ jwt }) => {
    window.__testManagerUser = {
      email: 'manager@example.com', jwt: async () => jwt, getUserData: async () => {},
      app_metadata: { roles: ['manager', 'team-founding-pilot'] }
    };
  }, { jwt: fakeJwt() });
}

// Parametrized version of mockManagerSignedIn, for the Platform Admin
// visibility tests below - same shape, any role list.
async function mockSignedInAs(page, roles, email = 'manager@example.com') {
  await page.addInitScript(({ roles, email }) => {
    window.__testManagerUser = {
      email, jwt: async () => 'fake-jwt', getUserData: async () => {},
      app_metadata: { roles }
    };
  }, { roles, email });
}

async function mockPilotDataEmpty(page) {
  await page.route('**/.netlify/functions/pilot-data**', route => {
    const url = new URL(route.request().url());
    const resource = url.searchParams.get('resource');
    const body = resource === 'assignments' ? { assignments: [] }
      : resource === 'sessions' ? { sessions: [] }
      : resource === 'profiles' ? { profiles: [] }
      : {};
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.route('**/.netlify/functions/pilot-invite**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"invites":[]}' }));
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

  test('Learner: invite -> set password -> account created -> auto-login -> redirected straight into Pilot Home', async () => {
    assert.ok(sharedInviteState, 'previous test created an invite to accept');
    const page = await browser.newPage();

    await mockLearnerLoginWidget(page, true);
    await mockPilotDataForLearner(page, sharedInviteState.email);
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

    // No CTA click needed this time - a successful auto-login should carry
    // the learner straight into Pilot Home on its own.
    await page.waitForURL(`${baseUrl}/pilot.html?pilot=1`, { timeout: 5000 });

    const autoLoginCall = JSON.parse(await page.evaluate(() => sessionStorage.getItem('__autoLoginCall')));
    assert.equal(autoLoginCall.email, sharedInviteState.email, 'auto-login used the invited account email');
    assert.equal(autoLoginCall.password, 'a-strong-password-1', 'auto-login used the exact password the learner just submitted');
    assert.equal(autoLoginCall.remember, true);

    // Landing on pilot.html already signed in means the sign-in gate never
    // appears and the authenticated header renders directly.
    const gateVisible = await page.locator('#pilot-auth-gate').isVisible().catch(() => false);
    assert.equal(gateVisible, false, 'the manual sign-in gate is never shown - auto-login already established the session');
    await page.locator('#identity').waitFor({ state: 'visible', timeout: 5000 });
    const identityText = await page.locator('#identity').innerText();
    assert.equal(identityText, sharedInviteState.email, 'Pilot Home shows the auto-logged-in learner, confirming the session is real, not just a redirect');

    await page.close();
  });

  test('Learner: if auto-login fails, account creation still succeeds and the Sign In fallback is shown', async () => {
    const page = await browser.newPage();
    const invite = { token: 'fallback-token-xyz', email: 'autologinfails@example.com', name: '' };

    await mockLearnerLoginWidget(page, false);
    await page.route('**/.netlify/functions/pilot-invite**', route => {
      const url = new URL(route.request().url());
      const action = url.searchParams.get('action');
      if (action === 'lookup') {
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'pending', email: invite.email, name: invite.name }) });
      } else if (action === 'accept') {
        route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ status: 'created', email: invite.email }) });
      } else {
        route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"unexpected"}' });
      }
    });

    await page.goto(`${baseUrl}/pilot-invite-accept.html?token=${invite.token}`);
    await page.locator('#acceptForm').waitFor({ state: 'visible', timeout: 5000 });
    await page.fill('#password', 'a-strong-password-1');
    await page.fill('#confirmPassword', 'a-strong-password-1');
    await page.click('#acceptButton');

    // Auto-login was attempted (and failed) - account creation must not be
    // treated as failed because of that: the normal success state and its
    // Sign In fallback link still need to appear, and we must stay on this
    // page rather than being redirected anywhere.
    const cta = page.locator('a.cta');
    await cta.waitFor({ state: 'visible', timeout: 5000 });
    const href = await cta.getAttribute('href');
    assert.equal(href, 'pilot.html?pilot=1', 'the Sign In fallback is a plain relative link into the existing sign-in flow');
    const heading = await page.locator('h1').innerText();
    assert.match(heading, /Account created|账号已建立/);
    assert.equal(page.url(), `${baseUrl}/pilot-invite-accept.html?token=${invite.token}`, 'a failed auto-login does not navigate the learner away');

    const autoLoginCall = JSON.parse(await page.evaluate(() => sessionStorage.getItem('__autoLoginCall')));
    assert.equal(autoLoginCall.email, invite.email, 'auto-login was attempted with the invited account email before falling back');

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

  // Regression coverage for the actual failure Dr. Chen hit: the Platform
  // Admin entry was added to pilot.html's Pilot Home dashboard, but a
  // signed-in Manager who already knows their way around the Pilot lands
  // on (or goes straight to) manager.html - "Manager Studio", where Invite
  // Learner / Assign Practice / Current Assignments actually live - and
  // that page never carried the entry at all, on any PR. These tests run
  // against manager.html itself, not pilot.html, so a future change that
  // "fixes" this on the wrong page fails loudly here.
  test('Manager Studio: Platform Admin / Invite Manager panel is visible for an account with the admin role', async () => {
    const page = await browser.newPage();
    await mockIdentityWidget(page);
    await mockSignedInAs(page, ['manager', 'admin', 'team-founding-pilot']);
    await mockPilotDataEmpty(page);

    await page.goto(`${baseUrl}/manager.html?pilot=1`);

    const adminPanel = page.locator('#platform-admin-panel');
    await assert.doesNotReject(adminPanel.waitFor({ state: 'visible', timeout: 5000 }), 'Platform Admin panel becomes visible on Manager Studio for an admin');
    const href = await page.locator('#platform-admin-panel a').getAttribute('href');
    assert.equal(href, 'platform-admin.html');

    await page.close();
  });

  test('Manager Studio: Platform Admin / Invite Manager panel stays hidden for an ordinary Manager (no admin role)', async () => {
    const page = await browser.newPage();
    await mockIdentityWidget(page);
    await mockSignedInAs(page, ['manager', 'team-founding-pilot']);
    await mockPilotDataEmpty(page);

    await page.goto(`${baseUrl}/manager.html?pilot=1`);

    // Give refreshCloud() a chance to run and settle before asserting the
    // negative - waiting on a real signal (the invite panel it always
    // reveals for any manager) rather than a fixed timeout.
    await page.locator('#invite-panel').waitFor({ state: 'visible', timeout: 5000 });
    const hidden = await page.locator('#platform-admin-panel').isHidden();
    assert.equal(hidden, true, 'an ordinary Manager never sees the Platform Admin panel on Manager Studio');

    await page.close();
  });
});
