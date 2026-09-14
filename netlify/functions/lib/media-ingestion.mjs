// Direct video/audio ingestion — foundation schema ONLY.
//
// See docs/engineering/media-ingestion-architecture-2026-09-14.md.
//
// IMPORTANT — what this module is and is not:
//
//   It is the provider-neutral data model for the media -> transcript ->
//   Company Knowledge path: record shapes, processing states, the legal
//   transitions between them, source lineage, and an honest report of what
//   this deployment can actually accept today.
//
//   It is NOT a working upload feature. No endpoint calls it yet, no storage
//   provider is chosen or configured, and createStorageAdapter() deliberately
//   throws until one is. That is on purpose: the platform cannot accept a
//   one-hour training video through an ordinary Netlify Function (see the
//   limits below), and shipping a "video upload" that silently only works for
//   ~4 MB clips would be a fake enterprise feature.
//
// Dependency-free apart from the shared hash helper, so it is safe to import
// from any function, any edge function, and directly from tests.

import { sha256Hex } from './knowledge-source.mjs';

export const MEDIA_SCHEMA_VERSION = 'media-source-v1';

// ---------------------------------------------------------------------------
// Verified platform limits that constrain every design choice here.
// Sources are cited in the architecture doc; these are platform facts, not
// preferences, and the numbers below are what the code reasons against.
// ---------------------------------------------------------------------------

// Netlify synchronous (buffered) function request/response payload ceiling.
export const NETLIFY_SYNC_PAYLOAD_BYTES = 6 * 1024 * 1024;
// Netlify background function request payload ceiling. Small on purpose: a
// background job may be handed an ID, never the media itself.
export const NETLIFY_BACKGROUND_PAYLOAD_BYTES = 256 * 1024;
// Base64 inflates binary by 4/3 before the JSON envelope is even counted,
// which is why the practical inline ceiling is well under 6 MB.
export const BASE64_INFLATION = 4 / 3;
// Room for the surrounding JSON keys/metadata in an inline upload body.
const INLINE_ENVELOPE_BYTES = 8 * 1024;
// The real inline ceiling for media sent as base64 JSON to a normal function.
export const MAX_INLINE_MEDIA_BYTES = Math.floor((NETLIFY_SYNC_PAYLOAD_BYTES - INLINE_ENVELOPE_BYTES) / BASE64_INFLATION);
// OpenAI /v1/audio/transcriptions per-file ceiling (whisper-1,
// gpt-4o-transcribe and gpt-4o-mini-transcribe share it).
export const TRANSCRIPTION_PROVIDER_MAX_FILE_BYTES = 25 * 1024 * 1024;

export const MEDIA_KINDS = ['video', 'audio'];

// ---------------------------------------------------------------------------
// Processing states
// ---------------------------------------------------------------------------
//
// awaiting_upload is not in the original product state list but is required by
// any signed/direct upload design: the record (and therefore the mediaId and
// storage key the browser uploads to) must exist BEFORE the bytes do, so an
// upload can always be traced to an authorized team and actor. The other six
// are the product states as specified.
export const MEDIA_STATES = Object.freeze([
  'awaiting_upload',
  'uploaded',
  'transcribing',
  'transcript_ready',
  'processing',
  'ready',
  'failed'
]);

// Forward transitions plus explicit retry rewinds. A retry may only rewind to
// a state whose artifacts are known-good (the stored media, or the finished
// transcript) and re-derive forward from there - it may never jump forward
// past work that never happened. `ready` is terminal.
const TRANSITIONS = Object.freeze({
  awaiting_upload: ['uploaded', 'failed'],
  uploaded: ['transcribing', 'failed'],
  transcribing: ['transcript_ready', 'failed'],
  transcript_ready: ['processing', 'failed'],
  processing: ['ready', 'failed'],
  ready: [],
  // Retry rewinds: bytes are still in storage (-> uploaded), or the transcript
  // is already saved and only downstream processing failed (-> transcript_ready).
  failed: ['uploaded', 'transcript_ready']
});

export function isMediaState(value) {
  return MEDIA_STATES.includes(value);
}

export function canTransition(from, to) {
  if (!isMediaState(from) || !isMediaState(to)) return false;
  return TRANSITIONS[from].includes(to);
}

export function nextStates(from) {
  return isMediaState(from) ? [...TRANSITIONS[from]] : [];
}

// Returns a NEW record; never mutates the input. An illegal transition throws
// rather than silently coercing state - a media pipeline that lies about where
// it is would let unverified output look finished.
export function applyTransition(record, to, patch = {}, now = new Date().toISOString()) {
  const from = record?.state;
  if (!canTransition(from, to)) {
    throw Object.assign(new Error(`Illegal media state transition: ${from} -> ${to}.`), { status: 409, code: 'illegal_media_transition' });
  }
  const next = { ...record, ...patch, state: to, updatedAt: now };
  if (to === 'failed') {
    next.failedFrom = from;
    next.failureReason = String(patch.failureReason || record.failureReason || 'unknown');
  } else {
    delete next.failedFrom;
    delete next.failureReason;
  }
  return next;
}

// ---------------------------------------------------------------------------
// Record shapes
// ---------------------------------------------------------------------------

function clean(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

// The authorized media object. Storage is private by design: this record holds
// an opaque provider key, never a public URL. Any read access is minted
// on demand, short-lived, and authenticated - see the architecture doc.
export function mediaRecord({ id, teamId, kind, fileName, byteSize, contentType, durationSeconds, createdBy, storageProvider = '', storageKey = '', consentConfirmed = false }, now = new Date().toISOString()) {
  return {
    id: clean(id, 100),
    mediaSchemaVersion: MEDIA_SCHEMA_VERSION,
    teamId: clean(teamId, 100),
    kind: MEDIA_KINDS.includes(kind) ? kind : 'video',
    fileName: clean(fileName, 300),
    byteSize: Number.isFinite(byteSize) ? Math.max(0, Math.floor(byteSize)) : 0,
    contentType: clean(contentType, 120),
    durationSeconds: Number.isFinite(durationSeconds) ? Math.max(0, Math.floor(durationSeconds)) : 0,
    // Filled once the bytes actually land and are read back for hashing.
    mediaSha256: '',
    storageProvider: clean(storageProvider, 60),
    storageKey: clean(storageKey, 500),
    visibility: 'private',
    state: 'awaiting_upload',
    consentConfirmed: consentConfirmed === true,
    transcriptId: '',
    knowledgeId: '',
    createdAt: now,
    updatedAt: now,
    createdBy: clean(createdBy, 254)
  };
}

// One transcription attempt against one media record. Kept separate from the
// media record so a retry (a new job) never overwrites the evidence of the
// previous attempt.
export function transcriptionJobRecord({ id, mediaId, teamId, provider = '', model = '', segments = 1, requestedBy }, now = new Date().toISOString()) {
  return {
    id: clean(id, 100),
    mediaSchemaVersion: MEDIA_SCHEMA_VERSION,
    mediaId: clean(mediaId, 100),
    teamId: clean(teamId, 100),
    provider: clean(provider, 60),
    model: clean(model, 120),
    segments: Number.isFinite(segments) ? Math.max(1, Math.floor(segments)) : 1,
    state: 'transcribing',
    transcriptSha256: '',
    transcriptChars: 0,
    startedAt: now,
    finishedAt: '',
    requestedBy: clean(requestedBy, 254)
  };
}

// ---------------------------------------------------------------------------
// Source lineage: media -> transcript -> Company Knowledge
// ---------------------------------------------------------------------------
//
// NO EVIDENCE, NO AUTHORITY. A transcript is a DERIVED source: the authority
// for anything a learner is taught is the approved Company Knowledge record
// the transcript became, and that record must always be traceable back to the
// authorized media it came from. An AI summary is never the authority.
export const LINEAGE_FIELDS = Object.freeze([
  'mediaId',
  'mediaFileName',
  'mediaSha256',
  'transcriptId',
  'transcriptSha256',
  'knowledgeId',
  'processingModel',
  'createdAt'
]);

export function mediaLineage({ media, job, knowledgeId, processingModel }, now = new Date().toISOString()) {
  return {
    mediaId: clean(media?.id, 100),
    mediaFileName: clean(media?.fileName, 300),
    mediaSha256: clean(media?.mediaSha256, 64),
    transcriptId: clean(job?.id, 100),
    transcriptSha256: clean(job?.transcriptSha256, 64),
    knowledgeId: clean(knowledgeId, 100),
    processingModel: clean(processingModel || job?.model, 120),
    createdAt: now
  };
}

// Fail closed: downstream training output may only be presented as
// source-grounded when the whole chain back to the authorized media is intact.
export function lineageComplete(lineage) {
  return LINEAGE_FIELDS.every(field => clean(lineage?.[field], 500).length > 0);
}

export function transcriptIntegrity(transcriptText) {
  const text = String(transcriptText ?? '');
  return { transcriptSha256: sha256Hex(text), transcriptChars: text.length };
}

// ---------------------------------------------------------------------------
// Storage adapter contract (no provider chosen or hardwired yet)
// ---------------------------------------------------------------------------

export class MediaStorageNotConfiguredError extends Error {
  constructor(message = 'Direct media upload storage is not configured for this deployment.') {
    super(message);
    this.name = 'MediaStorageNotConfiguredError';
    this.status = 503;
    this.code = 'media_storage_not_configured';
  }
}

// The four operations any candidate provider (Cloudflare R2, Supabase Storage,
// S3, ...) must supply. Listed as a contract rather than an implementation so
// the provider decision stays reversible: nothing above this line knows or
// cares which one wins.
export const STORAGE_ADAPTER_CONTRACT = Object.freeze([
  'createUploadTicket', // (key, contentType, maxBytes, expiresInSeconds) -> { url, method, headers, expiresAt }
  'headObject',         // (key) -> { byteSize, contentType, sha256? }
  'openObject',         // (key) -> ReadableStream, for server-side processing only
  'deleteObject'        // (key) -> void, for retention/deletion requests
]);

export function isStorageAdapter(candidate) {
  return !!candidate && STORAGE_ADAPTER_CONTRACT.every(method => typeof candidate[method] === 'function');
}

// Deliberately throws until a provider is chosen AND configured. There is no
// default and no fallback: a silent fallback here would be exactly the "fake
// video upload" this foundation exists to avoid.
export function createStorageAdapter(adapter) {
  if (!isStorageAdapter(adapter)) throw new MediaStorageNotConfiguredError();
  return adapter;
}

// ---------------------------------------------------------------------------
// Honest capability reporting
// ---------------------------------------------------------------------------

// One truth source for "what can this deployment actually accept right now",
// so no UI has to guess and no copy can overstate it.
export function describeIngestionCapability({ storageAdapter = null } = {}) {
  const directUploadAvailable = isStorageAdapter(storageAdapter);
  return {
    directUploadAvailable,
    // Without direct-to-storage upload, media can only reach the platform as a
    // base64 JSON body through an ordinary function - capped well below one
    // minute of video.
    maxInlineMediaBytes: MAX_INLINE_MEDIA_BYTES,
    transcriptionProviderMaxFileBytes: TRANSCRIPTION_PROVIDER_MAX_FILE_BYTES,
    supportedToday: ['transcript_text', 'transcript_file', 'video_link_plus_transcript'],
    reason: directUploadAvailable
      ? 'Direct upload storage is configured.'
      : 'No direct-upload storage provider is configured; a one-hour training video cannot be accepted through an ordinary function request.'
  };
}

// Given a media file's size, says how it would have to be handled. Used to
// keep product copy and routing decisions tied to real limits instead of
// optimism.
export function planMediaIngestion({ byteSize, storageAdapter = null } = {}) {
  const size = Number.isFinite(byteSize) ? Math.max(0, Math.floor(byteSize)) : 0;
  const capability = describeIngestionCapability({ storageAdapter });
  if (size <= 0) return { route: 'rejected', reason: 'empty_media', capability };
  if (capability.directUploadAvailable) {
    return {
      route: 'direct_upload',
      // Even with direct upload solved, a single transcription request is
      // still capped by the provider, so longer media must be segmented.
      segmentationRequired: size > TRANSCRIPTION_PROVIDER_MAX_FILE_BYTES,
      capability
    };
  }
  if (size <= MAX_INLINE_MEDIA_BYTES) return { route: 'inline_function_upload', segmentationRequired: false, capability };
  return { route: 'unsupported_today', reason: 'exceeds_inline_function_limit', capability };
}
