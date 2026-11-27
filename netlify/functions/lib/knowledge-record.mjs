// Optimistic-concurrency update for one Company Knowledge record.
//
// Several actors write the same record: manager approve, relevance feedback,
// and the relevance assessment (which waits up to ~18s on an AI model between
// reading the record and saving the result). A plain read -> await -> setJSON
// lets a late writer overwrite newer changes, or resurrect a deleted source.
//
// This reads the CURRENT record + ETag, lets `mutate` build the new version
// from that fresh copy, and writes only if the ETag still matches
// (`onlyIfMatch`). On a lost race it reloads and re-applies `mutate`.
//
// mutate(current) -> { record } to save, or { error: { status, message } } to
// reject without saving. Returns one of:
//   { status: 'ok', record } | { status: 'missing' } |
//   { status: 'rejected', error } | { status: 'conflict' }
export async function updateKnowledgeRecord(store, key, mutate, { attempts = 5 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const current = await store.getWithMetadata(key, { type: 'json' });
    if (!current?.data) return { status: 'missing' };
    const outcome = await mutate(current.data);
    if (outcome?.error) return { status: 'rejected', error: outcome.error };
    const write = await store.setJSON(key, outcome.record, { onlyIfMatch: current.etag });
    if (write?.modified !== false) return { status: 'ok', record: outcome.record };
  }
  return { status: 'conflict' };
}

// Maps a non-ok result to an HTTP reply body, or null when it succeeded.
export function knowledgeUpdateFailure(result) {
  if (result.status === 'ok') return null;
  if (result.status === 'missing') return { status: 404, error: 'Knowledge source not found.' };
  if (result.status === 'rejected') return { status: result.error.status, error: result.error.message };
  return { status: 409, error: 'This source was updated at the same time. Please retry.' };
}
