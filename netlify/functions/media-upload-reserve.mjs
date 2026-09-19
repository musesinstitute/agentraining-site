// POST /.netlify/functions/media-upload-reserve
//
// Step 1 of direct media ingestion. The browser sends METADATA ONLY - never
// the video bytes - and receives a short-lived presigned PUT it uses to upload
// straight to private object storage. The media never passes through this (or
// any) Netlify Function, which is the whole point: a function request body is
// capped at 6 MB and a one-hour training video is not.
//
// Manager-only, team-scoped, and refuses clearly when storage is unconfigured.

import { getStore } from '@netlify/blobs';
import { getUser, verifyRequestOrigin } from '@netlify/identity';
import { randomBytes } from 'node:crypto';
import {
  mediaRecord,
  mediaObjectKey,
  maxMediaUploadBytes,
  validateMediaUploadRequest,
  SUPPORTED_MEDIA_LABELS
} from './lib/media-ingestion.mjs';
import { storageAdapterFromEnv, STORAGE_PROVIDER, REQUIRED_ENV_VARS } from './lib/r2-storage.mjs';
import { STORE_NAME, reply, clean, normalizeEmail, safeSegment, saveMedia, writeMediaAudit, mediaClientView } from './lib/media-records.mjs';

// How long the browser has to start the upload. Short by design.
const UPLOAD_TICKET_SECONDS = 900;

export default async function handler(req) {
  try {
    if (req.method !== 'POST') return reply(405, { error: 'POST required.' });
    verifyRequestOrigin(req);
    const user = await getUser(req);
    if (!user) return reply(401, { error: 'Please sign in to continue.' });
    const roles = Array.isArray(user.roles) ? user.roles : [];
    if (!roles.includes('manager') && !roles.includes('admin')) return reply(403, { error: 'Manager access is required.' });
    const actor = { id: clean(user.id, 100), email: normalizeEmail(user.email), roles, teamId: safeSegment(user.appMetadata?.team_id) };

    const { adapter, missing } = storageAdapterFromEnv(process.env);
    if (!adapter) {
      // Honest refusal: no ticket, no record, nothing that could later look
      // like a successful upload.
      return reply(503, {
        error: 'Direct media upload is not configured for this workspace yet. / 本工作区尚未配置直接媒体上传。',
        code: 'media_storage_not_configured',
        missingEnv: missing,
        requiredEnv: REQUIRED_ENV_VARS
      });
    }

    const input = await req.json().catch(() => ({}));
    if (input.consentConfirmed !== true) {
      return reply(400, { error: 'Confirm organizational authorization and AI processing consent. / 请确认企业已授权使用此材料及进行 AI 处理。', code: 'consent_required' });
    }

    const maxBytes = maxMediaUploadBytes(process.env);
    const validation = validateMediaUploadRequest(
      { fileName: input.fileName, contentType: input.contentType, sizeBytes: input.sizeBytes },
      { maxBytes }
    );
    if (!validation.ok) {
      const store = getStore({ name: STORE_NAME, consistency: 'strong' });
      await writeMediaAudit(store, actor.teamId, actor, 'media_upload_reserve', 'rejected', { reason: validation.code, byteSize: Number(input.sizeBytes) || 0 });
      return reply(validation.status, { error: validation.error, code: validation.code, maxBytes, supportedFormats: SUPPORTED_MEDIA_LABELS });
    }

    const store = getStore({ name: STORE_NAME, consistency: 'strong' });
    const mediaId = crypto.randomUUID();
    // Extra entropy in the object key: knowing a media id is not enough to
    // address the stored object.
    const token = randomBytes(16).toString('hex');
    const storageKey = mediaObjectKey({ teamId: actor.teamId, mediaId, token, extension: validation.extension });

    const record = {
      ...mediaRecord({
        id: mediaId,
        teamId: actor.teamId,
        kind: validation.kind,
        fileName: validation.fileName,
        byteSize: validation.byteSize,
        contentType: validation.contentType,
        createdBy: actor.email,
        storageProvider: STORAGE_PROVIDER,
        storageKey,
        consentConfirmed: true
      }),
      title: clean(input.title, 240) || validation.fileName,
      languageHint: clean(input.languageHint, 10)
    };
    await saveMedia(store, record);

    const ticket = adapter.createUploadTicket({ key: storageKey, contentType: validation.contentType, expiresInSeconds: UPLOAD_TICKET_SECONDS });
    await writeMediaAudit(store, actor.teamId, actor, 'media_upload_reserve', 'success', { mediaId, kind: validation.kind, byteSize: validation.byteSize, contentType: validation.contentType });

    return reply(201, {
      media: mediaClientView(record),
      // The browser PUTs the file to this URL itself. It is scoped to one key
      // and one method, and expires in 15 minutes.
      upload: { url: ticket.url, method: ticket.method, headers: ticket.headers, expiresAt: ticket.expiresAt },
      maxBytes,
      supportedFormats: SUPPORTED_MEDIA_LABELS
    });
  } catch (error) {
    console.error('media-upload-reserve failed', error?.message || error);
    return reply(error?.status || 500, { error: error?.message || 'Media upload reservation failed.', code: error?.code || 'media_reserve_failed' });
  }
}
