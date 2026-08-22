// Backend tests for Invite Learner (netlify/functions/pilot-invite.mjs).
//
// Run with: npm test
// (node --import ./tests/register.mjs --test tests/*.test.mjs)
//
// @netlify/blobs and @netlify/identity are intercepted (see tests/loader.mjs)
// with in-memory stubs - no real Netlify Blobs or Identity call is ever made,
// including no real admin.createUser call.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import handler from '../netlify/functions/pilot-invite.mjs';
import { __setUser, __seedExistingUser, __resetIdentityStub, __setOperatorTokenAvailable } from '../tests/stubs/netlify-identity.mjs';
import { __resetAllStores } from '../tests/stubs/netlify-blobs.mjs';

const BASE = 'https://pilot.example.com/.netlify/functions/pilot-invite';

function req(method, action, { body, query } = {}) {
  const url = new URL(BASE);
  url.searchParams.set('action', action);
  Object.entries(query || {}).forEach(([k, v]) => url.searchParams.set(k, v));
  const init = { method, headers: { origin: 'https://pilot.example.com', 'content-type': 'application/json' } };
  if (body) init.body = JSON.stringify(body);
  return new Request(url, init);
}
// pilot-invite.mjs's handler takes only (req) - no context parameter - since
// admin.createUser() needs no manual operator-token wiring (see file header
// comment / completion report). The stub's operator token is available by
// default, matching a real deployed Function.
function call(method, action, opts = {}) {
  return handler(req(method, action, opts));
}

const manager = { id: 'mgr-1', email: 'manager@example.com', roles: ['manager', 'team-founding-pilot'] };
const managerTeamB = { id: 'mgr-2', email: 'manager-b@example.com', roles: ['manager', 'team-second-pilot'] };
const managerNoTeam = { id: 'mgr-3', email: 'no-team@example.com', roles: ['manager'] };
const managerTwoTeams = { id: 'mgr-4', email: 'two-teams@example.com', roles: ['manager', 'team-founding-pilot', 'team-second-pilot'] };
const learnerRole = { id: 'l-1', email: 'not-a-manager@example.com', roles: ['learner', 'team-founding-pilot'] };

beforeEach(() => {
  __resetAllStores();
  __resetIdentityStub();
});

describe('auth gating', () => {
  test('create: unauthenticated -> 401', async () => {
    __setUser(null);
    const res = await call('POST', 'create', { body: { email: 'x@example.com' } });
    assert.equal(res.status, 401);
  });

  test('create: signed in but not manager role -> 403', async () => {
    __setUser(learnerRole);
    const res = await call('POST', 'create', { body: { email: 'x@example.com' } });
    assert.equal(res.status, 403);
  });

  test('create: manager role but no team-* role -> 403 (fails closed)', async () => {
    __setUser(managerNoTeam);
    const res = await call('POST', 'create', { body: { email: 'x@example.com' } });
    assert.equal(res.status, 403);
  });

  test('create: manager role but ambiguous (two team-* roles) -> 403 (fails closed)', async () => {
    __setUser(managerTwoTeams);
    const res = await call('POST', 'create', { body: { email: 'x@example.com' } });
    assert.equal(res.status, 403);
  });

  test('list: unauthenticated -> 401', async () => {
    __setUser(null);
    const res = await call('GET', 'list');
    assert.equal(res.status, 401);
  });

  test('list: learner role -> 403', async () => {
    __setUser(learnerRole);
    const res = await call('GET', 'list');
    assert.equal(res.status, 403);
  });

  test('create: rejects an invalid email', async () => {
    __setUser(manager);
    const res = await call('POST', 'create', { body: { email: 'not-an-email' } });
    assert.equal(res.status, 400);
  });
});

describe('team isolation', () => {
  test('a manager only ever sees invites for their own team', async () => {
    __setUser(manager);
    await call('POST', 'create', { body: { email: 'learner-a@example.com', name: 'Learner A' } });
    __setUser(managerTeamB);
    await call('POST', 'create', { body: { email: 'learner-b@example.com', name: 'Learner B' } });

    __setUser(manager);
    let res = await call('GET', 'list');
    let data = await res.json();
    assert.equal(data.invites.length, 1);
    assert.equal(data.invites[0].email, 'learner-a@example.com');
    assert.equal(data.invites[0].teamId, 'founding-pilot');

    __setUser(managerTeamB);
    res = await call('GET', 'list');
    data = await res.json();
    assert.equal(data.invites.length, 1);
    assert.equal(data.invites[0].email, 'learner-b@example.com');
    assert.equal(data.invites[0].teamId, 'second-pilot');
  });

  test('client-supplied team id is ignored - teamId always comes from the caller\'s own role', async () => {
    __setUser(manager);
    const res = await call('POST', 'create', { body: { email: 'x@example.com', teamId: 'someone-elses-team' } });
    const data = await res.json();
    assert.equal(data.invite.teamId, 'founding-pilot');
  });

  test('accepting an invite grants exactly the inviting team\'s roles, never a client-supplied one', async () => {
    __setUser(manager);
    let res = await call('POST', 'create', { body: { email: 'newlearner@example.com' } });
    let data = await res.json();
    const token = data.invite.token;

    res = await call('POST', 'accept', { body: { token, password: 'correct horse battery' } });
    assert.equal(res.status, 201);

    // Inspect what admin.createUser actually stored via the stub's own list().
    const { admin } = await import('../tests/stubs/netlify-identity.mjs');
    const created = (await admin.listUsers()).find(u => u.email === 'newlearner@example.com');
    assert.ok(created, 'account was created');
    assert.deepEqual(created.app_metadata.roles.sort(), ['learner', 'team-founding-pilot'].sort());
    assert.equal(created.app_metadata.team_id, 'founding-pilot');
  });
});

describe('duplicate invites', () => {
  test('creating a second invite for the same pending email reuses the existing one', async () => {
    __setUser(manager);
    const first = await (await call('POST', 'create', { body: { email: 'dup@example.com' } })).json();
    const second = await (await call('POST', 'create', { body: { email: 'DUP@example.com' } })).json(); // case-insensitive too
    assert.equal(second.reused, true);
    assert.equal(second.invite.token, first.invite.token);
    assert.equal(second.invite.id, first.invite.id);

    const list = await (await call('GET', 'list')).json();
    assert.equal(list.invites.length, 1, 'no duplicate live invite was created');
  });

  test('re-inviting after the prior invite was accepted creates a genuinely new invite', async () => {
    __setUser(manager);
    const first = await (await call('POST', 'create', { body: { email: 'reinvite@example.com' } })).json();
    await call('POST', 'accept', { body: { token: first.invite.token, password: 'correct horse battery' } });

    const second = await (await call('POST', 'create', { body: { email: 'reinvite@example.com' } })).json();
    assert.notEqual(second.invite.token, first.invite.token);
    assert.equal(second.reused, false);
  });
});

describe('existing-account refusal (never overwrite an unrelated Identity account)', () => {
  test('accept refuses when the email is already a registered Identity account, and does not touch it', async () => {
    __seedExistingUser('taken@example.com');
    __setUser(manager);
    const created = await (await call('POST', 'create', { body: { email: 'taken@example.com' } })).json();

    const res = await call('POST', 'accept', { body: { token: created.invite.token, password: 'correct horse battery' } });
    assert.equal(res.status, 409);
    const data = await res.json();
    assert.match(data.error, /already exists/i);

    // The invite must NOT be marked accepted - nothing was actually provisioned.
    __setUser(manager);
    const list = await (await call('GET', 'list')).json();
    assert.equal(list.invites[0].status, 'pending');
  });
});

describe('expired tokens', () => {
  test('accept with an expired invite -> 410, no account created', async () => {
    __setUser(manager);
    const created = await (await call('POST', 'create', { body: { email: 'expired@example.com' } })).json();

    // Simulate time passing by writing a backdated expiry directly into the stub store.
    const { getStore } = await import('../tests/stubs/netlify-blobs.mjs');
    const store = getStore({ name: 'agentraining-pilot' });
    const key = `invites/by-token/${created.invite.token}`;
    const invite = await store.get(key);
    invite.expiresAt = new Date(Date.now() - 1000).toISOString();
    await store.setJSON(key, invite); // accept only ever reads the by-token key, so updating just this is sufficient

    const res = await call('POST', 'accept', { body: { token: created.invite.token, password: 'correct horse battery' } });
    assert.equal(res.status, 410);

    const { admin } = await import('../tests/stubs/netlify-identity.mjs');
    assert.equal((await admin.listUsers()).length, 0, 'no account was created for an expired invite');
  });

  test('lookup on an expired invite also reports expired, not a generic error', async () => {
    __setUser(manager);
    const created = await (await call('POST', 'create', { body: { email: 'expired2@example.com' } })).json();
    const { getStore } = await import('../tests/stubs/netlify-blobs.mjs');
    const store = getStore({ name: 'agentraining-pilot' });
    const key = `invites/by-token/${created.invite.token}`;
    const invite = await store.get(key);
    invite.expiresAt = new Date(Date.now() - 1000).toISOString();
    await store.setJSON(key, invite);

    const res = await call('GET', 'lookup', { query: { token: created.invite.token } });
    assert.equal(res.status, 410);
  });
});

describe('invalid tokens', () => {
  test('lookup with an unknown token -> 404, no information leaked', async () => {
    const res = await call('GET', 'lookup', { query: { token: 'this-token-does-not-exist' } });
    assert.equal(res.status, 404);
  });

  test('accept with an unknown token -> 404', async () => {
    const res = await call('POST', 'accept', { body: { token: 'this-token-does-not-exist', password: 'correct horse battery' } });
    assert.equal(res.status, 404);
  });

  test('accept with no token at all -> 400, not a crash', async () => {
    const res = await call('POST', 'accept', { body: { password: 'correct horse battery' } });
    assert.equal(res.status, 400);
  });

  test('accept with too short a password -> 400', async () => {
    __setUser(manager);
    const created = await (await call('POST', 'create', { body: { email: 'shortpw@example.com' } })).json();
    const res = await call('POST', 'accept', { body: { token: created.invite.token, password: '123' } });
    assert.equal(res.status, 400);
  });
});

describe('re-opening an accepted invite (idempotent)', () => {
  test('accepting the same token twice does not create a second account or error out', async () => {
    __setUser(manager);
    const created = await (await call('POST', 'create', { body: { email: 'reopen@example.com' } })).json();

    const first = await call('POST', 'accept', { body: { token: created.invite.token, password: 'correct horse battery' } });
    assert.equal(first.status, 201);

    const second = await call('POST', 'accept', { body: { token: created.invite.token, password: 'a-totally-different-password' } });
    assert.equal(second.status, 200);
    const data = await second.json();
    assert.equal(data.status, 'already_accepted');
    assert.equal(data.email, 'reopen@example.com');

    const { admin } = await import('../tests/stubs/netlify-identity.mjs');
    const matches = (await admin.listUsers()).filter(u => u.email === 'reopen@example.com');
    assert.equal(matches.length, 1, 'exactly one account exists, re-accept did not create a duplicate');
  });

  test('re-opening the lookup page after acceptance reports accepted, not pending', async () => {
    __setUser(manager);
    const created = await (await call('POST', 'create', { body: { email: 'reopen2@example.com' } })).json();
    await call('POST', 'accept', { body: { token: created.invite.token, password: 'correct horse battery' } });

    const res = await call('GET', 'lookup', { query: { token: created.invite.token } });
    const data = await res.json();
    assert.equal(data.status, 'accepted');
  });
});

describe('operator token / real-environment dependency', () => {
  test('accept fails clearly (not silently) if the Netlify runtime does not provide an Identity operator token', async () => {
    __setUser(manager);
    const created = await (await call('POST', 'create', { body: { email: 'notoken@example.com' } })).json();
    __setOperatorTokenAvailable(false); // simulates the one thing that cannot be proven outside a real deployment
    const res = await call('POST', 'accept', { body: { token: created.invite.token, password: 'correct horse battery' } });
    assert.equal(res.status, 503);
    const data = await res.json();
    assert.ok(!/operator token/i.test(data.error), 'internal detail is not leaked to the browser response');
  });
});
