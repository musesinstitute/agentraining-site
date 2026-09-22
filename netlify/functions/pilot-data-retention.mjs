import { getStore } from '@netlify/blobs';
import { storageAdapterFromEnv } from './lib/r2-storage.mjs';
import { jobIndexKey } from './lib/media-records.mjs';

const STORE_NAME = 'agentraining-pilot';

async function listJSON(store, prefix) {
  const { blobs } = await store.list({ prefix });
  const rows = [];
  for (const entry of blobs) {
    const value = await store.get(entry.key, { type: 'json' });
    if (value) rows.push(value);
  }
  return rows;
}

async function deletePrefix(store, prefix) {
  let deleted = 0;
  while (true) {
    const { blobs } = await store.list({ prefix });
    if (!blobs.length) break;
    for (const entry of blobs) {
      await store.delete(entry.key);
      deleted += 1;
    }
  }
  return deleted;
}

async function purgeTeam(store, request) {
  const teamPrefix = `teams/${request.teamId}`;
  const media = await listJSON(store, `${teamPrefix}/media/`);
  const jobs = await listJSON(store, `${teamPrefix}/media-jobs/`);
  const mediaWithObjects = media.filter(row => row?.storageKey);

  // Do not claim completion while customer-controlled R2 bytes remain.
  // If this deployment has media records but R2 is unavailable, leave the
  // request scheduled so the next daily run can retry after configuration is
  // restored.
  const { adapter: storage, missing } = storageAdapterFromEnv(process.env);
  if (mediaWithObjects.length && !storage) {
    throw Object.assign(new Error(`R2 storage is not configured; cannot complete deletion. Missing: ${missing.join(', ')}`), {
      code: 'storage_not_configured'
    });
  }

  let deletedMediaObjects = 0;
  for (const row of mediaWithObjects) {
    await storage.deleteObject(row.storageKey);
    deletedMediaObjects += 1;
  }

  // Provider job indexes are global identifier-only lookup records, so they
  // sit outside the team prefix and must be removed explicitly.
  let deletedJobIndexes = 0;
  for (const job of jobs) {
    if (!job?.providerJobId) continue;
    await store.delete(jobIndexKey(job.providerJobId));
    deletedJobIndexes += 1;
  }

  const deletedStoreObjects = await deletePrefix(store, `${teamPrefix}/`);
  return { deletedMediaObjects, deletedJobIndexes, deletedStoreObjects };
}

export default async function handler() {
  const store = getStore({ name: STORE_NAME, consistency: 'strong' });
  const { blobs } = await store.list({ prefix: 'deletion-requests/' });
  const now = Date.now();
  const results = [];

  for (const entry of blobs) {
    const request = await store.get(entry.key, { type: 'json' });
    if (!request || request.status !== 'scheduled' || !request.teamId || !request.deleteAfter) continue;
    if (Date.parse(request.deleteAfter) > now) continue;

    try {
      const counts = await purgeTeam(store, request);
      const completed = {
        ...request,
        status: 'completed',
        completedAt: new Date().toISOString(),
        ...counts,
        lastError: ''
      };
      // Keep only a minimal deletion receipt outside the deleted team dataset.
      // It contains no training content, transcript, score, or learner profile.
      await store.setJSON(entry.key, completed);
      results.push({ teamId: request.teamId, status: 'completed', ...counts });
    } catch (error) {
      const retry = {
        ...request,
        status: 'scheduled',
        lastAttemptAt: new Date().toISOString(),
        lastError: String(error?.code || error?.message || 'deletion_failed').slice(0, 300)
      };
      await store.setJSON(entry.key, retry);
      results.push({ teamId: request.teamId, status: 'retry_scheduled', error: retry.lastError });
    }
  }

  return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
