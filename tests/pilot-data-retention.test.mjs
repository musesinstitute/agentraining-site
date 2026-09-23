import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { getStore, __resetAllStores } from './stubs/netlify-blobs.mjs';
import { __setUser } from './stubs/netlify-identity.mjs';
import dataHandler from '../netlify/functions/pilot-data.mjs';
import retentionHandler from '../netlify/functions/pilot-data-retention.mjs';
import { jobIndexKey } from '../netlify/functions/lib/media-records.mjs';

const BUCKET = 'agentraining-media';
const R2_ENV = ['R2_ACCOUNT_ID','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_BUCKET_NAME'];

function setStorage(enabled = true) {
  for (const name of R2_ENV) delete process.env[name];
  if (enabled) {
    process.env.R2_ACCOUNT_ID = 'retention-test-account';
    process.env.R2_ACCESS_KEY_ID = 'RETENTIONTESTKEY';
    process.env.R2_SECRET_ACCESS_KEY = 'retention-test-secret';
    process.env.R2_BUCKET_NAME = BUCKET;
  }
}

function manager(teamId = 'retention-team') {
  __setUser({ id: 'manager-' + teamId, email: `manager@${teamId}.test`, roles: ['manager'], appMetadata: { team_id: teamId } });
}

const request = (method, resource, body) => new Request(`https://example.test/.netlify/functions/pilot-data/${resource}`, {
  method,
  headers: { 'content-type': 'application/json', origin: 'https://example.test' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) })
});

function installR2(objects, { failDelete = false } = {}) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    const method = String(options.method || 'GET').toUpperCase();
    calls.push({ url: u, method });
    if (!u.includes('r2.cloudflarestorage.com')) return new Response('', { status: 404 });
    if (method === 'DELETE') {
      if (failDelete) return new Response('storage unavailable', { status: 503 });
      const key = decodeURIComponent(new URL(u).pathname.replace(`/${BUCKET}/`, ''));
      objects.delete(key);
      return new Response(null, { status: 204 });
    }
    return new Response(null, { status: 200 });
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

async function seedTeam({ teamId = 'retention-team', withMedia = true, withJob = true } = {}) {
  const store = getStore({ name: 'agentraining-pilot' });
  await store.setJSON(`teams/${teamId}/sessions/session-1`, { id: 'session-1', teamId, transcript: [{ text: 'test only' }] });
  await store.setJSON(`teams/${teamId}/knowledge/knowledge-1`, { id: 'knowledge-1', teamId, title: 'Test knowledge' });
  let storageKey = '';
  if (withMedia) {
    storageKey = `teams/${teamId}/media/media-1/test-object.mp4`;
    await store.setJSON(`teams/${teamId}/media/media-1`, { id: 'media-1', teamId, storageKey });
  }
  if (withJob) {
    const providerJobId = 'retention-provider-job-1';
    await store.setJSON(`teams/${teamId}/media-jobs/job-1`, { id: 'job-1', teamId, providerJobId });
    await store.setJSON(jobIndexKey(providerJobId), { teamId, jobId: 'job-1' });
  }
  return { store, storageKey };
}

beforeEach(() => {
  __resetAllStores();
  setStorage(true);
  manager();
});

describe('Pilot deletion request lifecycle', () => {
  test('manager schedules deletion about 30 days in the future and can read it back', async () => {
    const started = Date.now();
    const response = await dataHandler(request('POST', 'data-deletion', {}));
    assert.equal(response.status, 202);
    const { deletion } = await response.json();
    assert.equal(deletion.status, 'scheduled');
    assert.equal(deletion.immediate, false);
    const delta = Date.parse(deletion.deleteAfter) - started;
    assert.ok(delta >= 30 * 86400000 - 5000 && delta <= 30 * 86400000 + 5000);

    const read = await dataHandler(request('GET', 'data-deletion'));
    assert.equal(read.status, 200);
    assert.equal((await read.json()).deletion.id, deletion.id);
  });

  test('manager can cancel a scheduled deletion before purge', async () => {
    await dataHandler(request('POST', 'data-deletion', {}));
    const cancelled = await dataHandler(request('DELETE', 'data-deletion'));
    assert.equal(cancelled.status, 200);
    assert.equal((await cancelled.json()).cancelled, true);
    assert.equal((await (await dataHandler(request('GET', 'data-deletion'))).json()).deletion, null);
  });

  test('learner cannot schedule team deletion', async () => {
    __setUser({ id: 'learner-1', email: 'learner@test.invalid', roles: ['learner'], appMetadata: { team_id: 'retention-team' } });
    const response = await dataHandler(request('POST', 'data-deletion', {}));
    assert.equal(response.status, 403);
  });
});

describe('scheduled retention purge', () => {
  test('immediate request removes R2 media, team records and global job index, leaving only a minimal receipt', async () => {
    const { store, storageKey } = await seedTeam();
    const objects = new Map([[storageKey, { bytes: 123 }]]);
    const r2 = installR2(objects);
    try {
      const scheduled = await dataHandler(request('POST', 'data-deletion', { immediate: true }));
      assert.equal(scheduled.status, 202);
      const purge = await retentionHandler();
      assert.equal(purge.status, 200);
      const body = await purge.json();
      assert.equal(body.results[0].status, 'completed');
      assert.equal(objects.has(storageKey), false);
      assert.equal((await store.list({ prefix: 'teams/retention-team/' })).blobs.length, 0);
      assert.equal(await store.get(jobIndexKey('retention-provider-job-1'), { type: 'json' }), null);
      const receipt = await store.get('deletion-requests/retention-team', { type: 'json' });
      assert.equal(receipt.status, 'completed');
      assert.ok(receipt.completedAt);
      assert.equal(receipt.deletedMediaObjects, 1);
      assert.equal(receipt.deletedJobIndexes, 1);
      assert.equal('transcript' in receipt, false);
    } finally { r2.restore(); }
  });

  test('future request is not purged early', async () => {
    const { store } = await seedTeam({ withMedia: false, withJob: false });
    await dataHandler(request('POST', 'data-deletion', {}));
    const purge = await retentionHandler();
    assert.equal((await purge.json()).processed, 0);
    assert.ok((await store.list({ prefix: 'teams/retention-team/' })).blobs.length > 0);
  });

  test('missing R2 configuration keeps due request scheduled for retry and preserves team data', async () => {
    const { store } = await seedTeam();
    setStorage(false);
    await dataHandler(request('POST', 'data-deletion', { immediate: true }));
    const purge = await retentionHandler();
    const body = await purge.json();
    assert.equal(body.results[0].status, 'retry_scheduled');
    assert.match(body.results[0].error, /storage_not_configured/);
    assert.ok((await store.list({ prefix: 'teams/retention-team/' })).blobs.length > 0);
    assert.equal((await store.get('deletion-requests/retention-team', { type: 'json' })).status, 'scheduled');
  });

  test('R2 deletion failure keeps request scheduled and does not erase metadata needed for retry', async () => {
    const { store, storageKey } = await seedTeam();
    const objects = new Map([[storageKey, { bytes: 123 }]]);
    const r2 = installR2(objects, { failDelete: true });
    try {
      await dataHandler(request('POST', 'data-deletion', { immediate: true }));
      const purge = await retentionHandler();
      const body = await purge.json();
      assert.equal(body.results[0].status, 'retry_scheduled');
      assert.equal(objects.has(storageKey), true);
      assert.ok((await store.list({ prefix: 'teams/retention-team/' })).blobs.length > 0);
      assert.equal((await store.get('deletion-requests/retention-team', { type: 'json' })).status, 'scheduled');
    } finally { r2.restore(); }
  });
});
