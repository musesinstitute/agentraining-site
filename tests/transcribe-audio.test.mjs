// Contract tests for the new cloud speech transcription endpoint.
// Uses fake audio and a mocked provider; no API key or actual voice recording needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const code = readFileSync(new URL('../netlify/functions/transcribe-audio.js', import.meta.url), 'utf8');

function makeHandler({ key = 'fake-key', prior = [], storeError = false } = {}) {
  const calls = [];
  const recorded = [];
  const store = {
    async get(k) { if (storeError) throw new Error('no blobs'); if (k === 'service-readiness-v1') return { ok: true }; return prior; },
    async setJSON(k, hits) { recorded.push({ k, hits }); }
  };
  const exports = {};
  const context = {
    exports, Buffer, Blob, FormData, URL, AbortController, setTimeout, clearTimeout, Date,
    process: { env: { OPENAI_API_KEY: key } },
    require(name) {
      assert.equal(name, '@netlify/blobs');
      return { getStore: () => store };
    },
    async fetch(url, options) {
      calls.push({ url, options });
      return { ok: true, status: 200, async json() { return { text: '客户想了解 Roth IRA 和年金', languages: [{ code: 'zh' }, { code: 'en' }] }; } };
    }
  };
  runInNewContext(code, context, { filename: 'transcribe-audio.js' });
  return { handler: exports.handler, calls, recorded };
}

function request(mimeType = 'audio/webm', origin = 'https://deploy-preview-74--magical-platypus-ba1dfe.netlify.app') {
  return {
    httpMethod: 'POST',
    headers: { origin, 'x-forwarded-for': '192.0.2.10' },
    body: JSON.stringify({ mimeType, audioBase64: Buffer.alloc(450, 1).toString('base64') })
  };
}

test('rejects untrusted origin without requesting provider', async () => {
  const { handler, calls } = makeHandler();
  const res = await handler(request('audio/webm', 'https://not-agentraining.example'));
  assert.equal(res.statusCode, 403);
  assert.equal(calls.length, 0);
});

test('returns clear unavailable status when credential is not configured', async () => {
  const { handler, calls } = makeHandler({ key: '' });
  const res = await handler(request());
  assert.equal(res.statusCode, 503);
  assert.equal(calls.length, 0);
});

test('rejects incorrect audio media type', async () => {
  const { handler } = makeHandler();
  const res = await handler(request('text/plain'));
  assert.equal(res.statusCode, 400);
});

test('accepts bilingual recording and sends language and vocabulary hints', async () => {
  const { handler, calls } = makeHandler();
  const res = await handler(request());
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).text, '客户想了解 Roth IRA 和年金');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(calls[0].options.body.get('model'), 'gpt-transcribe');
  assert.deepEqual(calls[0].options.body.getAll('languages[]'), ['zh', 'en']);
  assert.ok(calls[0].options.body.getAll('keywords[]').includes('Roth IRA'));
  assert.equal(calls[0].options.headers.Authorization, 'Bearer fake-key');
  assert.equal(res.headers['Cache-Control'], 'no-store');
});

test('preflight reports whether voice is configured even when GET omits Origin', async () => {
  const on = makeHandler({ key: 'fake-key' });
  const off = makeHandler({ key: '' });
  const req = { httpMethod: 'GET', headers: {} };
  const available = await on.handler(req);
  const absent = await off.handler(req);
  assert.equal(available.statusCode, 200);
  assert.equal(JSON.parse(available.body).configured, true);
  assert.equal(JSON.parse(available.body).rateLimitReady, true);
  assert.equal(JSON.parse(available.body).ready, true);
  assert.equal(JSON.parse(absent.body).configured, false);
  assert.equal(JSON.parse(absent.body).ready, false);
  assert.equal(on.calls.length, 0);
});

test('throttles repeated audio requests', async () => {
  const { handler, calls } = makeHandler({ prior: Array(12).fill(Date.now()) });
  const res = await handler(request());
  assert.equal(res.statusCode, 429);
  assert.equal(calls.length, 0);
});

test('fails closed if rate limit storage is unavailable', async () => {
  const { handler, calls } = makeHandler({ storeError: true });
  const res = await handler(request());
  assert.equal(res.statusCode, 503);
  assert.equal(calls.length, 0);
});

test('preflight blocks recording when Netlify Blobs is unavailable', async () => {
  const { handler, calls } = makeHandler({ storeError: true });
  const res = await handler({ httpMethod: 'GET', headers: {} });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).configured, true);
  assert.equal(JSON.parse(res.body).rateLimitReady, false);
  assert.equal(JSON.parse(res.body).ready, false);
  assert.equal(calls.length, 0);
});

test('storage failure after preflight gives actionable error code and does not call provider', async () => {
  const { handler, calls } = makeHandler({ storeError: true });
  const res = await handler(request());
  assert.equal(res.statusCode, 503);
  assert.equal(JSON.parse(res.body).code, 'RATE_LIMIT_STORAGE_UNAVAILABLE');
  assert.equal(calls.length, 0);
});
