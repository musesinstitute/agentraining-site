// POST /.netlify/functions/media-upload-confirm
//
// Step 2 of direct media ingestion. Called by the browser AFTER its direct PUT
// to object storage succeeded. This endpoint never trusts that claim: it HEADs
// the object itself, checks the real stored size against the limit, and only
// then advances the state machine and submits the transcription job.
//
// The client cannot name a target state. It sends a mediaId; the server
// decides every transition, and an illegal one throws.

import { getStore } from '@netlify/blobs';
import { getUser, verifyRequestOrigin } from '@netlify/identity';
import { maxMediaUploadBytes, MIN_MEDIA_UPLOAD_BYTES, transcriptionJobRecord } from './lib/media-ingestion.mjs';
import { storageAdapterFromEnv, REQUIRED_ENV_VARS as STORAGE_ENV_VARS } from './lib/r2-storage.mjs';
import { transcriptionAdapterFromEnv, REQUIRED_ENV_VARS as TRANSCRIPTION_ENV_VARS } from './lib/transcription-provider.mjs';
import {
  STORE_NAME, reply, clean, normalizeEmail, safeSegment,
  loadMedia, saveJob, saveJobIndex, transitionMedia, writeMediaAudit, mediaClientView
} from './lib/media-records.mjs';

// The provider needs long enough to fetch a large object once.
const READ_TICKET_SECONDS = 21600; // 6 hours

// States from which a confirm is meaningful. Anything further along is a
// duplicate call and is answered idempotently rather than re-run.
const CONFIRMABLE = new Set(['awaiting_upload', 'failed']);

function webhookUrl(req) {
  const override = String(process.env.MEDIA_WEBHOOK_BASE_URL || '').trim();
  const base = override || new URL(req.url).origin;
  return `${base.replace(/\/+$/, '')}/.netlify/functions/media-transcription-webhook`;
}

export default async function handler(req) {
  try {
    if (req.method !== 'POST') return reply(405, { error: 'POST required.' });
    verifyRequestOrigin(req);
    const user = await getUser(req);
    if (!user) return reply(401, { error: 'Please sign in to continue.' });
    const roles = Array.isArray(user.roles) ? user.roles : [];
    if (!roles.includes('manager') && !roles.includes('admin')) return reply(403, { error: 'Manager access is required.' });
    const actor = { id: clean(user.id, 100), email: normalizeEmail(user.email), roles, teamId: safeSegment(user.appMetadata?.team_id) };

    const input = await req.json().catch(() => ({}));
    const mediaId = clean(input.mediaId, 100);
    if (!mediaId) return reply(400, { error: 'mediaId is required.' });

    const store = getStore({ name: STORE_NAME, consistency: 'strong' });
    // Team-scoped key lookup: another team's mediaId simply does not exist
    // here, so cross-tenant access is structurally impossible rather than
    // filtered after the fact.
    const media = await loadMedia(store, actor.teamId, mediaId);
    if (!media) return reply(404, { error: 'Media record not found.' });

    // Idempotent: a repeated confirm (double click, retried request) returns
    // the current state instead of starting a second transcription job.
    if (!CONFIRMABLE.has(media.state)) {
      return reply(200, { media: mediaClientView(media), duplicate: true });
    }

    const { adapter: storage, missing: storageMissing } = storageAdapterFromEnv(process.env);
    if (!storage) return reply(503, { error: 'Direct media upload is not configured for this workspace yet.', code: 'media_storage_not_configured', missingEnv: storageMissing, requiredEnv: STORAGE_ENV_VARS });

    // Verify the bytes actually exist before believing the client.
    const head = await storage.headObject(media.storageKey);
    if (!head.exists) {
      await writeMediaAudit(store, actor.teamId, actor, 'media_upload_confirm', 'rejected', { mediaId, reason: 'object_not_found' });
      return reply(409, { error: 'No uploaded media was found for this reservation. Please upload the file again. / 未找到已上传的媒体文件，请重新上传。', code: 'media_object_missing' });
    }

    const maxBytes = maxMediaUploadBytes(process.env);
    if (head.byteSize > maxBytes || head.byteSize < MIN_MEDIA_UPLOAD_BYTES) {
      // The stored object is not what was authorized: remove it rather than
      // leave unaccounted customer data in the bucket, and fail the record.
      await storage.deleteObject(media.storageKey).catch(() => {});
      const failed = await transitionMedia(store, media, 'failed', { failureReason: 'stored_object_size_rejected', byteSize: head.byteSize });
      await writeMediaAudit(store, actor.teamId, actor, 'media_upload_confirm', 'rejected', { mediaId, reason: 'stored_object_size_rejected', byteSize: head.byteSize });
      return reply(413, { error: 'The uploaded media does not match the authorized size limit. It was removed and NOT processed. / 已上传的媒体文件不符合授权的大小限制，系统已将其删除且没有处理。', code: 'media_too_large', media: mediaClientView(failed) });
    }

    // Bytes verified. This is the first legal forward transition.
    let current = await transitionMedia(store, media, 'uploaded', {
      byteSize: head.byteSize,
      // Provider content fingerprint, recorded as exactly what it is.
      mediaEtag: clean(head.etag, 128),
      storedContentType: clean(head.contentType, 120)
    });
    await writeMediaAudit(store, actor.teamId, actor, 'media_upload_confirm', 'success', { mediaId, byteSize: head.byteSize });

    // Submit transcription. A missing provider key is NOT a failure of the
    // upload: the media is safely stored, so the record rests at `uploaded`
    // and says plainly that transcription has not started.
    const { adapter: transcription, missing: transcriptionMissing, provider } = transcriptionAdapterFromEnv(process.env);
    if (!transcription) {
      return reply(200, {
        media: mediaClientView(current),
        transcription: { submitted: false, reason: 'transcription_not_configured', missingEnv: transcriptionMissing, requiredEnv: TRANSCRIPTION_ENV_VARS }
      });
    }

    const jobId = crypto.randomUUID();
    try {
      const readTicket = storage.createReadTicket({ key: media.storageKey, expiresInSeconds: READ_TICKET_SECONDS });
      const submitted = await transcription.submitTranscription({
        mediaId,
        mediaReadUrl: readTicket.url,
        languageHint: clean(media.languageHint, 10),
        webhookUrl: webhookUrl(req)
      });

      const job = {
        ...transcriptionJobRecord({ id: jobId, mediaId, teamId: actor.teamId, provider: submitted.provider || provider, model: submitted.model || '', requestedBy: actor.email }),
        providerJobId: clean(submitted.providerJobId, 200)
      };
      await saveJob(store, job);
      // Lets the provider's webhook - which carries no team context - find
      // these team-scoped records. Identifiers only.
      await saveJobIndex(store, job.providerJobId, { teamId: actor.teamId, mediaId, jobId });

      current = await transitionMedia(store, current, 'transcribing', { transcriptId: jobId });
      await writeMediaAudit(store, actor.teamId, actor, 'media_transcription_submit', 'success', { mediaId, jobId, provider: job.provider });

      return reply(200, { media: mediaClientView(current), transcription: { submitted: true, jobId, provider: job.provider } });
    } catch (error) {
      // Submission failed: the stored media is still valid, so stay at
      // `uploaded` and report it. Never claim a transcription that is not
      // running.
      await writeMediaAudit(store, actor.teamId, actor, 'media_transcription_submit', 'failed', { mediaId, reason: clean(error?.code || error?.message, 200) });
      return reply(200, {
        media: mediaClientView(current),
        transcription: { submitted: false, reason: 'transcription_submit_failed', error: clean(error?.message, 300) }
      });
    }
  } catch (error) {
    console.error('media-upload-confirm failed', error?.message || error);
    return reply(error?.status || 500, { error: error?.message || 'Media upload confirmation failed.', code: error?.code || 'media_confirm_failed' });
  }
}
