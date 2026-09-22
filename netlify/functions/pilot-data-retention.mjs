import { getStore } from '@netlify/blobs';

const STORE_NAME = 'agentraining-pilot';

async function deletePrefix(store, prefix) {
  let deleted = 0;
  while (true) {
    const { blobs } = await store.list({ prefix });
    if (!blobs.length) break;
    for (const entry of blobs) {
      await store.delete(entry.key);
      deleted += 1;
    }
    if (blobs.length === 0) break;
  }
  return deleted;
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

    const teamPrefix = `teams/${request.teamId}/`;
    const deletedObjects = await deletePrefix(store, teamPrefix);
    const completed = {
      ...request,
      status: 'completed',
      completedAt: new Date().toISOString(),
      deletedObjects
    };
    // Keep only a minimal deletion receipt outside the deleted team dataset.
    // It contains no training content, transcripts, scores, or learner profile data.
    await store.setJSON(entry.key, completed);
    results.push({ teamId: request.teamId, deletedObjects });
  }

  return new Response(JSON.stringify({ ok: true, processed: results.length, results }), {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
  });
}
