// End-to-end coverage for direct media ingestion:
//   reserve -> (browser PUTs directly to storage) -> confirm -> provider
//   webhook -> Company Knowledge.
//
// No real Cloudflare R2 or transcription provider is contacted: object
// storage and the provider API are stubbed at the fetch boundary, so these
// tests exercise the real request-shaping, signing, state-machine, ownership
// and hand-off code without any credentials or paid API call.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getStore, __resetAllStores } from './stubs/netlify-blobs.mjs';
import { __setUser } from './stubs/netlify-identity.mjs';
import reserveHandler from '../netlify/functions/media-upload-reserve.mjs';
import confirmHandler from '../netlify/functions/media-upload-confirm.mjs';
import webhookHandler from '../netlify/functions/media-transcription-webhook.mjs';
import statusHandler from '../netlify/functions/media-status.mjs';
import deleteHandler from '../netlify/functions/media-delete.mjs';
import dataHandler from '../netlify/functions/pilot-data.mjs';
import groundedHandler from '../netlify/functions/pilot-coach-source.mjs';
import { WEBHOOK_AUTH_HEADER } from '../netlify/functions/lib/transcription-provider.mjs';
import { lineageComplete } from '../netlify/functions/lib/media-ingestion.mjs';
import { sha256Hex, normalizeSourceText } from '../netlify/functions/lib/knowledge-source.mjs';

const SECRET_KEY = 'r2-secret-access-key-value-do-not-leak';
const WEBHOOK_SECRET = 'webhook-shared-secret-value';
const BUCKET = 'agentraining-media';

function setEnv({ storage = true, transcription = true } = {}) {
  for (const name of ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'ASSEMBLYAI_API_KEY', 'MEDIA_WEBHOOK_SECRET', 'MEDIA_MAX_UPLOAD_BYTES']) delete process.env[name];
  if (storage) {
    process.env.R2_ACCOUNT_ID = 'test-account';
    process.env.R2_ACCESS_KEY_ID = 'TESTACCESSKEYID';
    process.env.R2_SECRET_ACCESS_KEY = SECRET_KEY;
    process.env.R2_BUCKET_NAME = BUCKET;
  }
  if (transcription) {
    process.env.ASSEMBLYAI_API_KEY = 'assemblyai-test-key';
    process.env.MEDIA_WEBHOOK_SECRET = WEBHOOK_SECRET;
  }
}

// Minimal response object: the adapters only use status/ok/headers.get/json/body.
const res = (status, { headers = {}, json = null } = {}) => ({
  status, ok: status >= 200 && status < 300,
  headers: { get: name => headers[String(name).toLowerCase()] ?? null },
  json: async () => json ?? {},
  body: null
});

// Stub storage + provider. `objects` is the fake bucket; `provider` holds the
// transcript the provider would return.
function installFetch({ objects, provider = {}, onSubmit } = {}) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, options = {}) => {
    const u = String(url);
    const method = String(options.method || 'GET').toUpperCase();
    calls.push({ url: u, method, options });
    if (u.includes('r2.cloudflarestorage.com')) {
      const key = decodeURIComponent(new URL(u).pathname.replace(`/${BUCKET}/`, ''));
      const object = objects.get(key);
      if (method === 'HEAD') {
        return object
          ? res(200, { headers: { 'content-length': String(object.byteSize), 'content-type': object.contentType, etag: `"${object.etag}"` } })
          : res(404);
      }
      if (method === 'DELETE') { objects.delete(key); return res(204); }
      return res(200);
    }
    if (u.includes('api.assemblyai.com')) {
      if (method === 'POST') {
        if (onSubmit) onSubmit(JSON.parse(options.body));
        if (provider.submitFails) return res(502, { json: { error: 'provider down' } });
        return res(200, { json: { id: provider.jobId || 'provider-job-1', status: 'queued' } });
      }
      return res(200, { json: provider.transcript || { status: 'completed', text: provider.text ?? 'transcript text' } });
    }
    return res(404);
  };
  return { calls, restore: () => { globalThis.fetch = original; } };
}

const manager = (teamId = 'team-a') => __setUser({ id: 'manager-' + teamId, email: `manager@${teamId}.test`, roles: ['manager'], appMetadata: { team_id: teamId } });
const post = (path, body) => new Request(`https://example.test/.netlify/functions/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const get = path => new Request(`https://example.test/.netlify/functions/${path}`, { method: 'GET' });
const del = path => new Request(`https://example.test/.netlify/functions/${path}`, { method: 'DELETE' });
const webhookReq = (body, secret = WEBHOOK_SECRET) =>
  new Request('https://example.test/.netlify/functions/media-transcription-webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(secret === null ? {} : { [WEBHOOK_AUTH_HEADER]: secret }) },
    body: JSON.stringify(body)
  });

const VIDEO = { fileName: 'underwriting-training.mp4', contentType: 'video/mp4', sizeBytes: 180 * 1024 * 1024, consentConfirmed: true, title: 'Underwriting Training' };

// Walks reserve -> upload -> confirm, returning everything the tests need.
async function reserveAndUpload(objects, input = VIDEO, { uploadedSize } = {}) {
  const reserved = await (await reserveHandler(post('media-upload-reserve', input))).json();
  const store = getStore({ name: 'agentraining-pilot' });
  const record = await store.get(`teams/team-a/media/${reserved.media.mediaId}`, { type: 'json' });
  // Simulate the browser's direct PUT landing in the bucket.
  objects.set(record.storageKey, { byteSize: uploadedSize ?? input.sizeBytes, contentType: input.contentType, etag: 'etag-' + record.id });
  return { reserved, record, store };
}

beforeEach(() => { __resetAllStores(); setEnv(); manager(); });

describe('reserve: authorization, validation and the signed ticket', () => {
  test('an authenticated manager receives a direct-to-storage PUT ticket and a metadata-only record', async () => {
    const objects = new Map();
    const fetchStub = installFetch({ objects });
    try {
      const response = await reserveHandler(post('media-upload-reserve', VIDEO));
      assert.equal(response.status, 201);
      const body = await response.json();
      assert.equal(body.upload.method, 'PUT');
      assert.match(body.upload.url, /^https:\/\/test-account\.r2\.cloudflarestorage\.com\//);
      assert.match(body.upload.url, /X-Amz-Signature=[0-9a-f]{64}/);
      assert.equal(body.upload.headers['content-type'], 'video/mp4');
      assert.ok(body.upload.expiresAt);
      // The bytes were never sent anywhere: no storage request was made.
      assert.equal(fetchStub.calls.length, 0);

      const store = getStore({ name: 'agentraining-pilot' });
      const record = await store.get(`teams/team-a/media/${body.media.mediaId}`, { type: 'json' });
      assert.equal(record.state, 'awaiting_upload');
      assert.equal(record.visibility, 'private');
      assert.equal(record.teamId, 'team-a');
      assert.equal(record.kind, 'video');
      assert.match(record.storageKey, /^teams\/team-a\/media\//);
      // The key carries extra entropy beyond the media id.
      assert.ok(record.storageKey.length > `teams/team-a/media/${record.id}/`.length + 20);
      // The browser-facing view exposes neither the key nor any URL.
      assert.equal(body.media.storageKey, undefined);
      assert.ok(!JSON.stringify(body.media).includes('http'));
    } finally { fetchStub.restore(); }
  });

  test('the signed URL never carries the secret access key', async () => {
    const fetchStub = installFetch({ objects: new Map() });
    try {
      const body = await (await reserveHandler(post('media-upload-reserve', VIDEO))).json();
      assert.ok(!body.upload.url.includes(SECRET_KEY));
      assert.ok(!JSON.stringify(body).includes(SECRET_KEY));
      // The access key ID in X-Amz-Credential is public by design; the secret is what must never appear.
      assert.match(body.upload.url, /X-Amz-Credential=TESTACCESSKEYID/);
    } finally { fetchStub.restore(); }
  });

  test('unauthenticated and learner requests are refused before anything is reserved', async () => {
    __setUser(null);
    assert.equal((await reserveHandler(post('media-upload-reserve', VIDEO))).status, 401);
    __setUser({ id: 'learner-1', email: 'learner@team-a.test', roles: ['learner'], appMetadata: { team_id: 'team-a' } });
    assert.equal((await reserveHandler(post('media-upload-reserve', VIDEO))).status, 403);
    const store = getStore({ name: 'agentraining-pilot' });
    assert.equal((await store.list({ prefix: 'teams/' })).blobs.filter(b => b.key.includes('/media/')).length, 0);
  });

  test('an unsupported media type is refused with the supported list', async () => {
    const response = await reserveHandler(post('media-upload-reserve', { ...VIDEO, fileName: 'slides.pdf', contentType: 'application/pdf' }));
    assert.equal(response.status, 415);
    const body = await response.json();
    assert.equal(body.code, 'media_type_not_supported');
    assert.ok(body.supportedFormats.includes('MP4'));
  });

  test('oversized media is refused before any upload authorization is issued', async () => {
    process.env.MEDIA_MAX_UPLOAD_BYTES = String(100 * 1024 * 1024);
    const response = await reserveHandler(post('media-upload-reserve', VIDEO));
    assert.equal(response.status, 413);
    const body = await response.json();
    assert.equal(body.code, 'media_too_large');
    assert.equal(body.upload, undefined, 'no upload ticket may be issued for a rejected file');
    assert.match(body.error, /Nothing was uploaded/);
    assert.match(body.error, /系统没有上传该文件/);
  });

  test('missing authorization consent is refused', async () => {
    const response = await reserveHandler(post('media-upload-reserve', { ...VIDEO, consentConfirmed: false }));
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'consent_required');
  });

  test('with storage unconfigured the endpoint refuses honestly instead of pretending', async () => {
    setEnv({ storage: false });
    const response = await reserveHandler(post('media-upload-reserve', VIDEO));
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.code, 'media_storage_not_configured');
    assert.ok(body.missingEnv.includes('R2_ACCOUNT_ID'));
    assert.equal(body.upload, undefined);
  });
});

describe('confirm: server-verified, server-controlled state', () => {
  test('confirm verifies the stored object, advances state, and submits transcription', async () => {
    const objects = new Map();
    const submissions = [];
    const fetchStub = installFetch({ objects, onSubmit: body => submissions.push(body) });
    try {
      const { reserved, store } = await reserveAndUpload(objects);
      const response = await confirmHandler(post('media-upload-confirm', { mediaId: reserved.media.mediaId }));
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.media.state, 'transcribing');
      assert.equal(body.transcription.submitted, true);

      const record = await store.get(`teams/team-a/media/${reserved.media.mediaId}`, { type: 'json' });
      assert.equal(record.state, 'transcribing');
      assert.equal(record.mediaEtag, 'etag-' + record.id);
      // The provider was handed a short-lived signed read URL, not credentials.
      assert.equal(submissions.length, 1);
      assert.match(submissions[0].audio_url, /X-Amz-Signature=/);
      assert.ok(!JSON.stringify(submissions[0]).includes(SECRET_KEY));
      assert.equal(submissions[0].webhook_auth_header_name, WEBHOOK_AUTH_HEADER);
      assert.match(submissions[0].webhook_url, /media-transcription-webhook$/);
    } finally { fetchStub.restore(); }
  });

  test('confirm refuses when the object is not actually in storage - and starts no job', async () => {
    const objects = new Map();
    const fetchStub = installFetch({ objects });
    try {
      const reserved = await (await reserveHandler(post('media-upload-reserve', VIDEO))).json();
      // Deliberately do NOT put the object in the bucket.
      const response = await confirmHandler(post('media-upload-confirm', { mediaId: reserved.media.mediaId }));
      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, 'media_object_missing');
      const store = getStore({ name: 'agentraining-pilot' });
      assert.equal((await store.list({ prefix: 'teams/team-a/media-jobs/' })).blobs.length, 0);
    } finally { fetchStub.restore(); }
  });

  test('an object larger than the authorized limit is deleted and the record fails', async () => {
    const objects = new Map();
    const fetchStub = installFetch({ objects });
    try {
      process.env.MEDIA_MAX_UPLOAD_BYTES = String(200 * 1024 * 1024);
      const { reserved, record, store } = await reserveAndUpload(objects, VIDEO, { uploadedSize: 400 * 1024 * 1024 });
      const response = await confirmHandler(post('media-upload-confirm', { mediaId: reserved.media.mediaId }));
      assert.equal(response.status, 413);
      assert.equal(objects.has(record.storageKey), false, 'the unauthorized object must be removed');
      const stored = await store.get(`teams/team-a/media/${reserved.media.mediaId}`, { type: 'json' });
      assert.equal(stored.state, 'failed');
      assert.equal(stored.failureReason, 'stored_object_size_rejected');
    } finally { fetchStub.restore(); }
  });

  test('a client cannot set its own state, and a duplicate confirm starts no second job', async () => {
    const objects = new Map();
    const fetchStub = installFetch({ objects });
    try {
      const { reserved, store } = await reserveAndUpload(objects);
      // A client-supplied state must be ignored entirely.
      await confirmHandler(post('media-upload-confirm', { mediaId: reserved.media.mediaId, state: 'ready', knowledgeId: 'forged' }));
      const first = await store.get(`teams/team-a/media/${reserved.media.mediaId}`, { type: 'json' });
      assert.equal(first.state, 'transcribing');
      assert.equal(first.knowledgeId, '');

      const second = await confirmHandler(post('media-upload-confirm', { mediaId: reserved.media.mediaId }));
      assert.equal((await second.json()).duplicate, true);
      assert.equal((await store.list({ prefix: 'teams/team-a/media-jobs/' })).blobs.length, 1);
    } finally { fetchStub.restore(); }
  });

  test('another team cannot confirm this team\'s media', async () => {
    const objects = new Map();
    const fetchStub = installFetch({ objects });
    try {
      const { reserved } = await reserveAndUpload(objects);
      manager('team-b');
      const response = await confirmHandler(post('media-upload-confirm', { mediaId: reserved.media.mediaId }));
      assert.equal(response.status, 404, 'a foreign mediaId must not resolve at all');
    } finally { fetchStub.restore(); }
  });

  test('a missing provider key is reported plainly - the upload stands, transcription does not start', async () => {
    const objects = new Map();
    const fetchStub = installFetch({ objects });
    try {
      const { reserved, store } = await reserveAndUpload(objects);
      setEnv({ storage: true, transcription: false });
      const body = await (await confirmHandler(post('media-upload-confirm', { mediaId: reserved.media.mediaId }))).json();
      assert.equal(body.media.state, 'uploaded');
      assert.equal(body.transcription.submitted, false);
      assert.equal(body.transcription.reason, 'transcription_not_configured');
      assert.ok(body.transcription.missingEnv.includes('ASSEMBLYAI_API_KEY'));
      const record = await store.get(`teams/team-a/media/${reserved.media.mediaId}`, { type: 'json' });
      assert.equal(record.state, 'uploaded', 'never claim a transcription that is not running');
    } finally { fetchStub.restore(); }
  });

  test('a provider submission failure leaves the verified upload intact', async () => {
    const objects = new Map();
    const fetchStub = installFetch({ objects, provider: { submitFails: true } });
    try {
      const { reserved, store } = await reserveAndUpload(objects);
      const body = await (await confirmHandler(post('media-upload-confirm', { mediaId: reserved.media.mediaId }))).json();
      assert.equal(body.transcription.submitted, false);
      assert.equal(body.transcription.reason, 'transcription_submit_failed');
      assert.equal((await store.get(`teams/team-a/media/${reserved.media.mediaId}`, { type: 'json' })).state, 'uploaded');
    } finally { fetchStub.restore(); }
  });
});

describe('webhook: authenticity, idempotency and the Company Knowledge hand-off', () => {
  // Runs the whole flow and returns the media record plus the created knowledge.
  async function runToWebhook(transcriptText, { status = 'completed', objects = new Map() } = {}) {
    const fetchStub = installFetch({ objects, provider: { text: transcriptText, transcript: status === 'completed' ? { status: 'completed', text: transcriptText } : { status: 'error', error: 'provider failed' } } });
    const { reserved, store } = await reserveAndUpload(objects);
    await confirmHandler(post('media-upload-confirm', { mediaId: reserved.media.mediaId }));
    const response = await webhookHandler(webhookReq({ transcript_id: 'provider-job-1', status: status === 'completed' ? 'completed' : 'error' }));
    const media = await store.get(`teams/team-a/media/${reserved.media.mediaId}`, { type: 'json' });
    const jobs = (await store.list({ prefix: 'teams/team-a/media-jobs/' })).blobs;
    const job = jobs.length ? await store.get(jobs[0].key, { type: 'json' }) : null;
    const knowledgeKeys = (await store.list({ prefix: 'teams/team-a/knowledge/' })).blobs;
    const knowledge = knowledgeKeys.length ? await store.get(knowledgeKeys[0].key, { type: 'json' }) : null;
    fetchStub.restore();
    return { response, media, job, knowledge, knowledgeCount: knowledgeKeys.length, store, mediaId: reserved.media.mediaId };
  }

  test('a webhook without the shared secret changes nothing', async () => {
    const objects = new Map();
    const fetchStub = installFetch({ objects });
    try {
      const { reserved, store } = await reserveAndUpload(objects);
      await confirmHandler(post('media-upload-confirm', { mediaId: reserved.media.mediaId }));
      assert.equal((await webhookHandler(webhookReq({ transcript_id: 'provider-job-1', status: 'completed' }, null))).status, 401);
      assert.equal((await webhookHandler(webhookReq({ transcript_id: 'provider-job-1', status: 'completed' }, 'wrong-secret'))).status, 401);
      assert.equal((await store.get(`teams/team-a/media/${reserved.media.mediaId}`, { type: 'json' })).state, 'transcribing');
      assert.equal((await store.list({ prefix: 'teams/team-a/knowledge/' })).blobs.length, 0);
    } finally { fetchStub.restore(); }
  });

  test('an unknown provider job is refused', async () => {
    const fetchStub = installFetch({ objects: new Map() });
    try {
      const response = await webhookHandler(webhookReq({ transcript_id: 'never-heard-of-it', status: 'completed' }));
      assert.equal(response.status, 404);
      assert.equal((await response.json()).code, 'unknown_job');
    } finally { fetchStub.restore(); }
  });

  test('a completed transcription creates exactly one draft Company Knowledge source with the exact transcript', async () => {
    const transcript = 'Underwriters must apply the Q2-FORTRESS exception for this specific case.';
    const { media, job, knowledge, knowledgeCount } = await runToWebhook(transcript);
    assert.equal(media.state, 'ready');
    assert.equal(knowledgeCount, 1);
    // The authoritative content is the transcript itself - not a summary.
    assert.equal(knowledge.content, transcript);
    assert.equal(knowledge.status, 'draft', 'a manager still has to analyze and approve it');
    assert.equal(knowledge.analysis, null);
    assert.equal(knowledge.sourceType, 'video_transcript');
    assert.equal(knowledge.teamId, 'team-a');
    // Integrity metadata matches the stored content exactly.
    assert.equal(knowledge.contentLength, transcript.length);
    assert.equal(knowledge.contentSha256, sha256Hex(transcript));
    assert.equal(knowledge.sourceSchemaVersion, 'knowledge-source-v2');
    // Transcript hash on the job matches the exact provider text.
    assert.equal(job.transcriptSha256, createHash('sha256').update(transcript, 'utf8').digest('hex'));
    assert.equal(job.transcriptChars, transcript.length);
    assert.equal(media.knowledgeId, knowledge.id);
  });

  test('media -> transcript -> knowledge lineage is preserved and complete', async () => {
    const { media, job, knowledge } = await runToWebhook('A complete lineage transcript for the underwriting course.');
    const lineage = knowledge.mediaLineage;
    assert.equal(lineage.mediaId, media.id);
    assert.equal(lineage.mediaFileName, 'underwriting-training.mp4');
    assert.equal(lineage.mediaEtag, media.mediaEtag);
    assert.equal(lineage.transcriptId, job.id);
    assert.equal(lineage.transcriptSha256, job.transcriptSha256);
    assert.equal(lineage.knowledgeId, knowledge.id);
    assert.ok(lineage.processingModel);
    assert.ok(lineage.createdAt);
    assert.equal(lineageComplete(lineage), true);
  });

  test('duplicate webhook delivery is idempotent - no second transcript, no second knowledge source', async () => {
    const objects = new Map();
    const transcript = 'Idempotency transcript.';
    const fetchStub = installFetch({ objects, provider: { text: transcript, transcript: { status: 'completed', text: transcript } } });
    try {
      const { reserved, store } = await reserveAndUpload(objects);
      await confirmHandler(post('media-upload-confirm', { mediaId: reserved.media.mediaId }));
      const first = await webhookHandler(webhookReq({ transcript_id: 'provider-job-1', status: 'completed' }));
      const second = await webhookHandler(webhookReq({ transcript_id: 'provider-job-1', status: 'completed' }));
      assert.equal(first.status, 200);
      assert.equal((await first.json()).knowledgeId !== undefined, true);
      assert.equal((await second.json()).duplicate, true);
      assert.equal((await store.list({ prefix: 'teams/team-a/knowledge/' })).blobs.length, 1);
      assert.equal((await store.get(`teams/team-a/media/${reserved.media.mediaId}`, { type: 'json' })).state, 'ready');
    } finally { fetchStub.restore(); }
  });

  test('a failed transcription creates no Company Knowledge and fabricates no content', async () => {
    const { media, knowledgeCount } = await runToWebhook('', { status: 'error' });
    assert.equal(media.state, 'failed');
    assert.equal(media.failureReason, 'transcription_provider_failed');
    assert.equal(knowledgeCount, 0);
    assert.equal(media.knowledgeId, '');
  });

  test('an empty transcript fails closed rather than creating an empty source', async () => {
    const { media, knowledgeCount } = await runToWebhook('   ');
    assert.equal(media.state, 'failed');
    assert.equal(media.failureReason, 'empty_transcript');
    assert.equal(knowledgeCount, 0);
  });

  test('a long transcript (>30,000 chars) survives complete, with the middle retrievable', async () => {
    const MID = 'MIDDLE-MARKER-UNIQUE-91Q2 the Q2-FORTRESS exception applies here';
    const filler = 'Routine underwriting training narration for this segment. ';
    const transcript = filler.repeat(600) + MID + '. ' + filler.repeat(600);
    assert.ok(transcript.length > 30000);
    const { media, knowledge } = await runToWebhook(transcript);
    assert.equal(media.state, 'ready');
    assert.equal(knowledge.content.length, normalizeSourceText(transcript).length);
    assert.equal(knowledge.contentSha256, sha256Hex(normalizeSourceText(transcript)));
    assert.ok(knowledge.content.includes(MID), 'middle-of-source evidence must survive');
    assert.ok(knowledge.chunkCount > 1);

    // And it is retrievable the way the source-grounded Coach retrieves it.
    const { relevantContent } = await import('../netlify/functions/pilot-coach-source.mjs');
    assert.match(relevantContent(knowledge.content, 'What is the Q2-FORTRESS exception?', '', 14000), /MIDDLE-MARKER-UNIQUE-91Q2/);
  });

  test('a transcript beyond the authoritative 500,000-char limit is rejected, never truncated', async () => {
    const transcript = 'x'.repeat(500001);
    const { media, knowledgeCount, job } = await runToWebhook(transcript);
    assert.equal(media.state, 'failed');
    assert.equal(media.failureReason, 'transcript_exceeds_source_limit');
    assert.equal(knowledgeCount, 0, 'no partial or truncated source may be created');
    // The transcript evidence is still recorded on the job - nothing vanished silently.
    assert.equal(job.transcriptChars, transcript.length);
    assert.equal(job.transcriptSha256, sha256Hex(transcript));
  });

  test('with transcription unconfigured the webhook accepts nothing at all', async () => {
    setEnv({ storage: true, transcription: false });
    assert.equal((await webhookHandler(webhookReq({ transcript_id: 'provider-job-1', status: 'completed' }, 'anything'))).status, 503);
  });
});

describe('status endpoint', () => {
  test('reports capability honestly when unconfigured and when configured', async () => {
    setEnv({ storage: false, transcription: false });
    let capability = (await (await statusHandler(get('media-status'))).json()).capability;
    assert.equal(capability.directUploadAvailable, false);
    assert.equal(capability.storageConfigured, false);
    assert.ok(capability.missingEnv.includes('R2_ACCOUNT_ID'));
    assert.ok(capability.supportedFormats.includes('MP4'));

    setEnv();
    capability = (await (await statusHandler(get('media-status'))).json()).capability;
    assert.equal(capability.directUploadAvailable, true);
    assert.equal(capability.maxUploadBytes, 500 * 1024 * 1024);
    // Capability never leaks a secret value, only variable names.
    assert.ok(!JSON.stringify(capability).includes(SECRET_KEY));
  });

  test('a learner cannot read media status, and another team\'s media does not resolve', async () => {
    const objects = new Map();
    const fetchStub = installFetch({ objects });
    try {
      const { reserved } = await reserveAndUpload(objects);
      manager('team-b');
      assert.equal((await statusHandler(get(`media-status?mediaId=${reserved.media.mediaId}`))).status, 404);
      __setUser({ id: 'learner-1', email: 'l@team-a.test', roles: ['learner'], appMetadata: { team_id: 'team-a' } });
      assert.equal((await statusHandler(get('media-status'))).status, 403);
    } finally { fetchStub.restore(); }
  });
});

describe('no regression to the existing transcript-first pipeline', () => {
  test('pasting a transcript directly still works, untouched by the media path', async () => {
    const content = 'A pasted transcript that never involved any media upload.';
    const response = await dataHandler(new Request('https://example.test/.netlify/functions/pilot-data?resource=knowledge', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'create', title: 'Pasted', sourceType: 'document_notes', content, consentConfirmed: true })
    }));
    assert.equal(response.status, 201);
    const { source } = await response.json();
    assert.equal(source.content, content);
    assert.equal(source.mediaLineage, undefined, 'a transcript-only source carries no media lineage');
  });

  test('a media-derived source is indistinguishable to existing readers, including the Coach', async () => {
    const transcript = 'Banner Life underwriting. We underwrite individuals, not impairments.';
    const { knowledge, store } = await runToWebhookForCoach(transcript);
    // Approve it exactly the way a manager would, through the unchanged endpoint.
    const approved = await dataHandler(new Request('https://example.test/.netlify/functions/pilot-data?resource=knowledge', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'approve', id: knowledge.id })
    }));
    // Approve requires an analysis first - confirm that gate still applies.
    assert.equal(approved.status, 400);

    // Force-approve in storage (the analysis step is unrelated to this test)
    // and check the source-grounded Coach can use a media-derived record.
    await store.setJSON(`teams/team-a/knowledge/${knowledge.id}`, { ...knowledge, status: 'approved' });
    await store.setJSON('teams/team-a/assignments/assignment-m', {
      id: 'assignment-m', assignedTo: 'learner@team-a.test', sourceType: 'company_knowledge',
      sourceKnowledgeId: knowledge.id, scenarioName: 'Underwriting', status: 'Assigned', createdAt: '2026-09-14'
    });
    __setUser({ id: 'learner-1', email: 'learner@team-a.test', roles: ['learner'], appMetadata: { team_id: 'team-a' } });
    process.env.ANTHROPIC_API_KEY = 'synthetic';
    const original = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (_url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      const isVerifier = body.system.includes('strict evidence verifier');
      return new Response(JSON.stringify({ content: [{ type: 'text', text: isVerifier ? JSON.stringify({ status: 'PASS', reason: 'Supported.' }) : 'We underwrite individuals, not impairments.' }] }), { status: 200 });
    };
    try {
      const response = await groundedHandler(new Request('https://example.test/.netlify/functions/pilot-coach-source', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assignmentId: 'assignment-m', sourceKnowledgeId: knowledge.id, message: 'How do you underwrite impairments?' })
      }));
      assert.equal(response.status, 201);
      const body = await response.json();
      assert.equal(body.verification.status, 'PASS');
      assert.match(calls[0].system, /We underwrite individuals, not impairments/);
    } finally { globalThis.fetch = original; delete process.env.ANTHROPIC_API_KEY; }
  });

  // Local helper: same flow as above, kept here so the Coach test reads linearly.
  async function runToWebhookForCoach(transcript) {
    const objects = new Map();
    const fetchStub = installFetch({ objects, provider: { text: transcript, transcript: { status: 'completed', text: transcript } } });
    const { reserved, store } = await reserveAndUpload(objects);
    await confirmHandler(post('media-upload-confirm', { mediaId: reserved.media.mediaId }));
    await webhookHandler(webhookReq({ transcript_id: 'provider-job-1', status: 'completed' }));
    fetchStub.restore();
    const keys = (await store.list({ prefix: 'teams/team-a/knowledge/' })).blobs;
    return { knowledge: await store.get(keys[0].key, { type: 'json' }), store };
  }
});

describe('deletion (privacy)', () => {
  test('deleting media removes the stored object, the records and the job index', async () => {
    const objects = new Map();
    const fetchStub = installFetch({ objects });
    try {
      const { reserved, record, store } = await reserveAndUpload(objects);
      await confirmHandler(post('media-upload-confirm', { mediaId: reserved.media.mediaId }));
      assert.equal(objects.has(record.storageKey), true);

      const response = await deleteHandler(del(`media-delete?mediaId=${reserved.media.mediaId}`));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).storageDeleted, true);

      assert.equal(objects.has(record.storageKey), false, 'the private object must be gone');
      assert.equal(await store.get(`teams/team-a/media/${reserved.media.mediaId}`, { type: 'json' }), null);
      assert.equal((await store.list({ prefix: 'teams/team-a/media-jobs/' })).blobs.length, 0);
      assert.equal((await store.list({ prefix: 'media-job-index/' })).blobs.length, 0);
    } finally { fetchStub.restore(); }
  });

  test('another team cannot delete this team\'s media, and a learner cannot delete at all', async () => {
    const objects = new Map();
    const fetchStub = installFetch({ objects });
    try {
      const { reserved, record } = await reserveAndUpload(objects);
      manager('team-b');
      assert.equal((await deleteHandler(del(`media-delete?mediaId=${reserved.media.mediaId}`))).status, 404);
      __setUser({ id: 'l', email: 'l@team-a.test', roles: ['learner'], appMetadata: { team_id: 'team-a' } });
      assert.equal((await deleteHandler(del(`media-delete?mediaId=${reserved.media.mediaId}`))).status, 403);
      assert.equal(objects.has(record.storageKey), true, 'nothing may be deleted by an unauthorized caller');
    } finally { fetchStub.restore(); }
  });

  test('deleting the recording never silently destroys an approved Company Knowledge source', async () => {
    const objects = new Map();
    const transcript = 'A transcript that already became company knowledge.';
    const fetchStub = installFetch({ objects, provider: { text: transcript, transcript: { status: 'completed', text: transcript } } });
    try {
      const { reserved, store } = await reserveAndUpload(objects);
      await confirmHandler(post('media-upload-confirm', { mediaId: reserved.media.mediaId }));
      await webhookHandler(webhookReq({ transcript_id: 'provider-job-1', status: 'completed' }));
      const knowledgeKeys = (await store.list({ prefix: 'teams/team-a/knowledge/' })).blobs;
      assert.equal(knowledgeKeys.length, 1);

      const body = await (await deleteHandler(del(`media-delete?mediaId=${reserved.media.mediaId}`))).json();
      assert.ok(body.knowledgeRetained, 'the response states plainly that the knowledge source remains');
      const knowledge = await store.get(knowledgeKeys[0].key, { type: 'json' });
      assert.equal(knowledge.content, transcript, 'the approved training content survives');
    } finally { fetchStub.restore(); }
  });
});
