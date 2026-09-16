// GET /.netlify/functions/media-status
//   (no query)          -> what this deployment can actually do right now
//   ?mediaId=<id>       -> the processing state of one media record
//
// The capability shape is the single truth source the UI uses to decide
// whether to offer media upload at all, so the page can never advertise a
// feature this deployment is not configured to perform.
//
// Manager-only and team-scoped: the media view is loaded from a team-prefixed
// key, so a mediaId from another company simply does not resolve.

import { getStore } from '@netlify/blobs';
import { getUser } from '@netlify/identity';
import { maxMediaUploadBytes, SUPPORTED_MEDIA_LABELS } from './lib/media-ingestion.mjs';
import { storageAdapterFromEnv, REQUIRED_ENV_VARS as STORAGE_ENV_VARS } from './lib/r2-storage.mjs';
import { transcriptionAdapterFromEnv, REQUIRED_ENV_VARS as TRANSCRIPTION_ENV_VARS } from './lib/transcription-provider.mjs';
import { STORE_NAME, reply, clean, normalizeEmail, safeSegment, loadMedia, mediaClientView } from './lib/media-records.mjs';

export default async function handler(req) {
  try {
    if (req.method !== 'GET') return reply(405, { error: 'GET required.' });
    // This endpoint is read-only. Keep Identity + manager/admin authorization,
    // but do not apply the write-oriented origin gate to Deploy Preview GETs.
    const user = await getUser(req);
    if (!user) return reply(401, { error: 'Please sign in to continue.' });
    const roles = Array.isArray(user.roles) ? user.roles : [];
    if (!roles.includes('manager') && !roles.includes('admin')) return reply(403, { error: 'Manager access is required.' });
    const actor = { id: clean(user.id, 100), email: normalizeEmail(user.email), roles, teamId: safeSegment(user.appMetadata?.team_id) };

    const url = new URL(req.url);
    const mediaId = clean(url.searchParams.get('mediaId'), 100);

    if (!mediaId) {
      const { adapter: storage, missing: storageMissing } = storageAdapterFromEnv(process.env);
      const { adapter: transcription, missing: transcriptionMissing, provider } = transcriptionAdapterFromEnv(process.env);
      // Missing variable NAMES only - never any value.
      return reply(200, {
        capability: {
          directUploadAvailable: !!storage && !!transcription,
          storageConfigured: !!storage,
          transcriptionConfigured: !!transcription,
          transcriptionProvider: provider,
          maxUploadBytes: maxMediaUploadBytes(process.env),
          supportedFormats: SUPPORTED_MEDIA_LABELS,
          missingEnv: [...storageMissing, ...transcriptionMissing],
          requiredEnv: [...STORAGE_ENV_VARS, ...TRANSCRIPTION_ENV_VARS]
        }
      });
    }

    const store = getStore({ name: STORE_NAME, consistency: 'strong' });
    const media = await loadMedia(store, actor.teamId, mediaId);
    if (!media) return reply(404, { error: 'Media record not found.' });
    return reply(200, { media: mediaClientView(media) });
  } catch (error) {
    console.error('media-status failed', error?.message || error);
    return reply(error?.status || 500, { error: error?.message || 'Media status lookup failed.' });
  }
}
