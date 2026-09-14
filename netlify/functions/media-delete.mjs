// DELETE /.netlify/functions/media-delete?mediaId=<id>
//
// Safe deletion path for uploaded training media (Part 10: privacy / tenant
// isolation). Removes the private object from storage first, then the media
// and transcription-job records and the provider job index.
//
// Deliberately does NOT delete a Company Knowledge source that was already
// created from the transcript: that is an approved training artifact with its
// own lifecycle and its own existing manager-controlled delete. Deleting the
// recording must not silently destroy approved company training content. The
// lineage on that source keeps pointing at the media id, which now honestly
// reads as "the source recording has been deleted".

import { getStore } from '@netlify/blobs';
import { getUser, verifyRequestOrigin } from '@netlify/identity';
import { storageAdapterFromEnv } from './lib/r2-storage.mjs';
import {
  STORE_NAME, reply, clean, normalizeEmail, safeSegment,
  loadMedia, loadJob, mediaKey, jobKey, jobIndexKey, writeMediaAudit
} from './lib/media-records.mjs';

export default async function handler(req) {
  try {
    if (req.method !== 'DELETE') return reply(405, { error: 'DELETE required.' });
    verifyRequestOrigin(req);
    const user = await getUser(req);
    if (!user) return reply(401, { error: 'Please sign in to continue.' });
    const roles = Array.isArray(user.roles) ? user.roles : [];
    if (!roles.includes('manager') && !roles.includes('admin')) return reply(403, { error: 'Manager access is required.' });
    const actor = { id: clean(user.id, 100), email: normalizeEmail(user.email), roles, teamId: safeSegment(user.appMetadata?.team_id) };

    const mediaId = clean(new URL(req.url).searchParams.get('mediaId'), 100);
    if (!mediaId) return reply(400, { error: 'mediaId is required.' });

    const store = getStore({ name: STORE_NAME, consistency: 'strong' });
    const media = await loadMedia(store, actor.teamId, mediaId);
    if (!media) return reply(404, { error: 'Media record not found.' });

    // Bytes first: a record with no object is recoverable bookkeeping, an
    // object with no record is unaccounted customer data.
    const { adapter } = storageAdapterFromEnv(process.env);
    if (adapter && media.storageKey) await adapter.deleteObject(media.storageKey);

    const job = media.transcriptId ? await loadJob(store, actor.teamId, media.transcriptId) : null;
    if (job) {
      if (job.providerJobId) await store.delete(jobIndexKey(job.providerJobId));
      await store.delete(jobKey(actor.teamId, job.id));
    }
    await store.delete(mediaKey(actor.teamId, mediaId));
    await writeMediaAudit(store, actor.teamId, actor, 'media_delete', 'success', {
      mediaId, fileName: media.fileName, storageDeleted: !!adapter, knowledgeId: media.knowledgeId || ''
    });

    return reply(200, {
      deleted: true,
      mediaId,
      // Stated plainly so a manager is never misled about what remains.
      knowledgeRetained: media.knowledgeId || '',
      storageDeleted: !!adapter
    });
  } catch (error) {
    console.error('media-delete failed', error?.message || error);
    return reply(error?.status || 500, { error: error?.message || 'Media deletion failed.' });
  }
}
