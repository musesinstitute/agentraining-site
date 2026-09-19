// Foundation coverage for the media -> transcript -> Company Knowledge data
// model (netlify/functions/lib/media-ingestion.mjs).
//
// This model is deliberately not wired to any endpoint yet; these tests pin
// the two things that must not drift before it is: the processing state
// machine cannot skip or fake work, and the platform's real size limits -
// not optimism - decide how a given file could be handled.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  MEDIA_STATES,
  MAX_INLINE_MEDIA_BYTES,
  NETLIFY_SYNC_PAYLOAD_BYTES,
  BASE64_INFLATION,
  TRANSCRIPTION_PROVIDER_MAX_FILE_BYTES,
  LINEAGE_FIELDS,
  canTransition,
  nextStates,
  applyTransition,
  mediaRecord,
  transcriptionJobRecord,
  mediaLineage,
  lineageComplete,
  transcriptIntegrity,
  isStorageAdapter,
  createStorageAdapter,
  MediaStorageNotConfiguredError,
  describeIngestionCapability,
  planMediaIngestion
} from '../netlify/functions/lib/media-ingestion.mjs';

const fakeAdapter = () => ({ createUploadTicket: async () => ({}), headObject: async () => ({}), openObject: async () => ({}), deleteObject: async () => {} });

describe('processing state model', () => {
  test('carries every product state, plus the pre-upload reservation state a signed upload needs', () => {
    for (const state of ['uploaded', 'transcribing', 'transcript_ready', 'processing', 'ready', 'failed']) {
      assert.ok(MEDIA_STATES.includes(state), `${state} must exist`);
    }
    assert.ok(MEDIA_STATES.includes('awaiting_upload'));
  });

  test('walks the happy path in order and refuses to skip a step', () => {
    const path = ['awaiting_upload', 'uploaded', 'transcribing', 'transcript_ready', 'processing', 'ready'];
    for (let i = 0; i < path.length - 1; i++) assert.ok(canTransition(path[i], path[i + 1]));
    // Skipping work is the failure mode that matters: never let a record claim
    // a transcript, or readiness, that was never produced.
    assert.equal(canTransition('uploaded', 'transcript_ready'), false);
    assert.equal(canTransition('uploaded', 'ready'), false);
    assert.equal(canTransition('awaiting_upload', 'transcribing'), false);
    assert.equal(canTransition('transcribing', 'ready'), false);
  });

  test('ready is terminal and unknown states are never transitionable', () => {
    assert.deepEqual(nextStates('ready'), []);
    assert.equal(canTransition('ready', 'processing'), false);
    assert.equal(canTransition('bogus', 'ready'), false);
    assert.equal(canTransition('ready', 'bogus'), false);
  });

  test('every state can fail', () => {
    for (const state of MEDIA_STATES.filter(s => s !== 'ready' && s !== 'failed')) {
      assert.ok(canTransition(state, 'failed'), `${state} -> failed`);
    }
  });

  test('a retry may only rewind to a state whose artifacts are known-good, never forward', () => {
    assert.deepEqual(nextStates('failed').sort(), ['transcript_ready', 'uploaded']);
    assert.equal(canTransition('failed', 'ready'), false);
    assert.equal(canTransition('failed', 'processing'), false);
    assert.equal(canTransition('failed', 'transcribing'), false);
  });

  test('applyTransition returns a new record, records why it failed, and clears that on recovery', () => {
    const record = mediaRecord({ id: 'm1', teamId: 't1', kind: 'video', fileName: 'training.mp4', byteSize: 1000, createdBy: 'manager@example.test' });
    const uploaded = applyTransition(record, 'uploaded', { mediaSha256: 'abc' });
    assert.equal(record.state, 'awaiting_upload', 'input record must not be mutated');
    assert.equal(uploaded.state, 'uploaded');
    assert.equal(uploaded.mediaSha256, 'abc');

    const failed = applyTransition(uploaded, 'failed', { failureReason: 'transcription_provider_timeout' });
    assert.equal(failed.failedFrom, 'uploaded');
    assert.equal(failed.failureReason, 'transcription_provider_timeout');

    const retried = applyTransition(failed, 'uploaded');
    assert.equal(retried.state, 'uploaded');
    assert.equal(retried.failedFrom, undefined);
    assert.equal(retried.failureReason, undefined);
  });

  test('an illegal transition throws instead of silently coercing state', () => {
    const record = mediaRecord({ id: 'm1', teamId: 't1', fileName: 'a.mp4', byteSize: 10, createdBy: 'm@e.test' });
    assert.throws(() => applyTransition(record, 'ready'), err => err.status === 409 && err.code === 'illegal_media_transition');
  });
});

describe('record shapes', () => {
  test('media records are private, team-scoped, and start before any bytes exist', () => {
    const record = mediaRecord({ id: 'm1', teamId: 'team-a', kind: 'video', fileName: 'underwriting.mp4', byteSize: 209715200, contentType: 'video/mp4', durationSeconds: 3600, createdBy: 'manager@example.test' });
    assert.equal(record.state, 'awaiting_upload');
    assert.equal(record.visibility, 'private');
    assert.equal(record.teamId, 'team-a');
    assert.equal(record.mediaSha256, '', 'hash is only known once the bytes land');
    // No public URL field exists at all - customer training video must never
    // be addressable without an authenticated, minted read.
    assert.ok(!('publicUrl' in record) && !('url' in record));
  });

  test('media records sanitize hostile numeric input rather than trusting the client', () => {
    const record = mediaRecord({ id: 'm1', teamId: 't', fileName: 'x.mp4', byteSize: -5, durationSeconds: Number.NaN, createdBy: 'm@e.test' });
    assert.equal(record.byteSize, 0);
    assert.equal(record.durationSeconds, 0);
  });

  test('each transcription attempt is its own record, so a retry never overwrites prior evidence', () => {
    const first = transcriptionJobRecord({ id: 'j1', mediaId: 'm1', teamId: 't1', provider: 'example', model: 'example-model', segments: 4, requestedBy: 'manager@example.test' });
    const second = transcriptionJobRecord({ id: 'j2', mediaId: 'm1', teamId: 't1', provider: 'example', model: 'example-model', requestedBy: 'manager@example.test' });
    assert.notEqual(first.id, second.id);
    assert.equal(first.mediaId, second.mediaId);
    assert.equal(first.segments, 4);
    assert.equal(second.segments, 1);
    assert.equal(first.state, 'transcribing');
  });
});

describe('source lineage (NO EVIDENCE, NO AUTHORITY)', () => {
  test('a complete chain records media -> transcript -> knowledge with every required field', () => {
    const media = { id: 'm1', fileName: 'training.mp4', mediaSha256: 'a'.repeat(64) };
    const job = { id: 'j1', transcriptSha256: 'b'.repeat(64), model: 'example-model' };
    const lineage = mediaLineage({ media, job, knowledgeId: 'k1' });
    for (const field of LINEAGE_FIELDS) assert.ok(lineage[field], `${field} must be populated`);
    assert.ok(lineageComplete(lineage));
  });

  test('a broken chain fails closed', () => {
    const lineage = mediaLineage({ media: { id: 'm1', fileName: 'training.mp4', mediaSha256: 'a'.repeat(64) }, job: { id: 'j1', transcriptSha256: '', model: 'example-model' }, knowledgeId: 'k1' });
    assert.equal(lineageComplete(lineage), false, 'a missing transcript hash must not read as traceable');
    assert.equal(lineageComplete({}), false);
  });

  test('transcript integrity hashes the exact transcript text', () => {
    const text = 'Underwriters must apply the Q2-FORTRESS exception.';
    const integrity = transcriptIntegrity(text);
    assert.equal(integrity.transcriptSha256, createHash('sha256').update(text, 'utf8').digest('hex'));
    assert.equal(integrity.transcriptChars, text.length);
  });
});

describe('storage adapter contract (no provider hardwired yet)', () => {
  test('a partial or absent adapter is refused - there is no silent fallback', () => {
    assert.throws(() => createStorageAdapter(null), MediaStorageNotConfiguredError);
    assert.throws(() => createStorageAdapter({ createUploadTicket: async () => ({}) }), MediaStorageNotConfiguredError);
    assert.equal(isStorageAdapter(null), false);
  });

  test('any provider supplying the full contract is accepted, whichever one wins', () => {
    const adapter = fakeAdapter();
    assert.ok(isStorageAdapter(adapter));
    assert.equal(createStorageAdapter(adapter), adapter);
  });
});

describe('honest capability reporting', () => {
  test('the inline ceiling is derived from the real Netlify payload limit after base64 inflation', () => {
    assert.ok(MAX_INLINE_MEDIA_BYTES * BASE64_INFLATION < NETLIFY_SYNC_PAYLOAD_BYTES);
    assert.ok(MAX_INLINE_MEDIA_BYTES < 5 * 1024 * 1024, 'must stay well under 5 MB');
  });

  test('with no provider configured, the platform says so plainly', () => {
    const capability = describeIngestionCapability({});
    assert.equal(capability.directUploadAvailable, false);
    assert.match(capability.reason, /cannot be accepted through an ordinary function request/);
    assert.deepEqual(capability.supportedToday, ['transcript_text', 'transcript_file', 'video_link_plus_transcript']);
  });

  test('a realistic one-hour training video is never routed through an ordinary function', () => {
    const oneHourVideoBytes = 200 * 1024 * 1024;
    const plan = planMediaIngestion({ byteSize: oneHourVideoBytes });
    assert.equal(plan.route, 'unsupported_today');
    assert.equal(plan.reason, 'exceeds_inline_function_limit');
  });

  test('once direct upload exists, large media routes there and long media still needs segmenting', () => {
    const adapter = fakeAdapter();
    const big = planMediaIngestion({ byteSize: 200 * 1024 * 1024, storageAdapter: adapter });
    assert.equal(big.route, 'direct_upload');
    assert.equal(big.segmentationRequired, true, 'beyond the provider per-file cap, media must be segmented');

    const compressedHourOfAudio = planMediaIngestion({ byteSize: 14 * 1024 * 1024, storageAdapter: adapter });
    assert.equal(compressedHourOfAudio.route, 'direct_upload');
    assert.equal(compressedHourOfAudio.segmentationRequired, false, 'an hour of compressed speech fits one transcription request');
    assert.ok(14 * 1024 * 1024 < TRANSCRIPTION_PROVIDER_MAX_FILE_BYTES);
  });

  test('a small clip can still go inline today, and empty media is rejected', () => {
    assert.equal(planMediaIngestion({ byteSize: 400 * 1024 }).route, 'inline_function_upload');
    assert.equal(planMediaIngestion({ byteSize: 0 }).route, 'rejected');
  });
});
