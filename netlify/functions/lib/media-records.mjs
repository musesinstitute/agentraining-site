// Shared persistence, ownership and Company Knowledge hand-off for the media
// ingestion endpoints (media-upload-reserve / media-upload-confirm /
// media-transcription-webhook / media-status).
//
// Key layout matches the existing Pilot convention exactly, so media records
// are isolated per authenticated team the same way knowledge, assignments and
// audit records already are.

import {
  applyTransition,
  mediaLineage,
  transcriptIntegrity
} from './media-ingestion.mjs';
import {
  MAX_SOURCE_CHARS,
  normalizeSourceText,
  sourceLengthError,
  buildIntegrityMetadata
} from './knowledge-source.mjs';

export const STORE_NAME = 'agentraining-pilot';

export const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
export const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: jsonHeaders });
export const clean = (value, max = 500) => String(value ?? '').trim().slice(0, max);
export const normalizeEmail = value => clean(value, 254).toLowerCase();
export const safeSegment = (value, fallback = 'founding-pilot') =>
  clean(value, 100).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || fallback;

export const teamPrefix = teamId => `teams/${teamId}`;
export const mediaKey = (teamId, mediaId) => `${teamPrefix(teamId)}/media/${mediaId}`;
export const jobKey = (teamId, jobId) => `${teamPrefix(teamId)}/media-jobs/${jobId}`;
// Global lookup so an incoming provider webhook - which carries no team
// context and no user session - can find the right team-scoped records. It
// stores identifiers ONLY: no transcript, no media, no customer content.
export const jobIndexKey = providerJobId => `media-job-index/${providerJobId}`;

// Mirrors writeAudit() in pilot-data.mjs (same key layout and event shape) so
// media events land in the same audit trail managers already have.
export async function writeMediaAudit(store, teamId, actor, action, outcome, details = {}) {
  const occurredAt = new Date().toISOString();
  const event = {
    id: crypto.randomUUID(), action, outcome,
    actorId: clean(actor?.id, 100), actorEmail: normalizeEmail(actor?.email), actorRoles: Array.isArray(actor?.roles) ? actor.roles : [],
    occurredAt, details
  };
  await store.setJSON(`${teamPrefix(teamId)}/audit/${occurredAt}-${event.id}`, event, { onlyIfNew: true });
}

export async function loadMedia(store, teamId, mediaId) {
  if (!teamId || !mediaId) return null;
  return store.get(mediaKey(teamId, mediaId), { type: 'json' });
}

export async function saveMedia(store, media) {
  await store.setJSON(mediaKey(media.teamId, media.id), media);
  return media;
}

export async function loadJob(store, teamId, jobId) {
  if (!teamId || !jobId) return null;
  return store.get(jobKey(teamId, jobId), { type: 'json' });
}

export async function saveJob(store, job) {
  await store.setJSON(jobKey(job.teamId, job.id), job);
  return job;
}

export async function saveJobIndex(store, providerJobId, { teamId, mediaId, jobId }) {
  await store.setJSON(jobIndexKey(providerJobId), { teamId, mediaId, jobId, providerJobId });
}

export async function loadJobIndex(store, providerJobId) {
  if (!providerJobId) return null;
  return store.get(jobIndexKey(providerJobId), { type: 'json' });
}

// Server-controlled state change. A client may never name a target state:
// every caller here passes a state the server decided on, and an illegal
// transition throws (409) rather than being coerced.
export async function transitionMedia(store, media, to, patch = {}) {
  const next = applyTransition(media, to, patch);
  await saveMedia(store, next);
  return next;
}

// The view safe to return to a browser. Notably absent: storageKey and any
// signed URL - a manager's browser never needs either, so neither is exposed.
export function mediaClientView(media) {
  if (!media) return null;
  return {
    mediaId: media.id,
    kind: media.kind,
    fileName: media.fileName,
    byteSize: media.byteSize,
    contentType: media.contentType,
    state: media.state,
    failureReason: media.failureReason || '',
    knowledgeId: media.knowledgeId || '',
    transcriptChars: media.transcriptChars || 0,
    createdAt: media.createdAt,
    updatedAt: media.updatedAt
  };
}

// ---------------------------------------------------------------------------
// Company Knowledge hand-off
// ---------------------------------------------------------------------------
//
// Produces a record IDENTICAL in shape to the one pilot-data.mjs's
// knowledgeRecord() writes (same fields, same knowledge-source-v2 integrity
// metadata), plus an additive mediaLineage block. Existing readers - the
// library list, AI Analysis, Knowledge Map, Question Bank V2, Practice
// Scenarios and the source-grounded Coach - therefore treat a transcribed
// video exactly like a pasted transcript, with no change on their side.
//
// NO EVIDENCE, NO AUTHORITY: `content` is the actual normalized transcript and
// nothing else. It is never an AI summary, never truncated, and the record is
// created as a DRAFT - a manager still has to Analyze and Approve it before
// any learner sees anything derived from it.
export function knowledgeRecordFromTranscript({ media, job, transcriptText, title, createdBy }, now = new Date().toISOString()) {
  const content = normalizeSourceText(transcriptText);
  const lengthError = sourceLengthError(content.length, MAX_SOURCE_CHARS);
  if (lengthError) throw lengthError;

  const id = crypto.randomUUID();
  const record = {
    id,
    teamId: media.teamId,
    title: clean(title || media.fileName || 'Training media transcript', 240),
    // Transcribed media is exactly the existing "training video + transcript"
    // source type; no new type is introduced for downstream code to learn.
    sourceType: media.kind === 'audio' ? 'meeting_transcript' : 'video_transcript',
    sourceUrl: '',
    content,
    ...buildIntegrityMetadata(content, id),
    consentConfirmed: media.consentConfirmed === true,
    status: 'draft',
    analysis: null,
    createdAt: now,
    updatedAt: now,
    createdBy: normalizeEmail(createdBy || media.createdBy),
    approvedAt: '',
    approvedBy: '',
    // Additive: full media -> transcript -> knowledge traceability.
    mediaLineage: mediaLineage({ media, job, knowledgeId: id, processingModel: job?.model }, now)
  };
  return record;
}

export async function saveKnowledgeRecord(store, record) {
  await store.setJSON(`${teamPrefix(record.teamId)}/knowledge/${record.id}`, record, { onlyIfNew: true });
  return record;
}

export { transcriptIntegrity };
