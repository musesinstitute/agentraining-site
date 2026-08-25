// Regression tests for netlify/functions/openai-transcribe.mjs.
//
// Covers both the prompt-echo production regression and Voice P0 recording
// stability: the server must identify the actual audio container instead of
// trusting a browser-reported MIME type, and must reject unsupported/corrupt
// payloads before calling OpenAI.
//
// Run with: npm test
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import handler from '../netlify/functions/openai-transcribe.mjs';

const realFetch = global.fetch;
let fetchCalls = [];
let openAiQueue = [];

function queueOpenAiResponse(text) {
  openAiQueue.push({ status: 200, body: { text } });
}

beforeEach(() => {
  fetchCalls = [];
  openAiQueue = [];
  process.env.OPENAI_API_KEY = 'test-key';
  global.fetch = async (url, init) => {
    const urlStr = String(url);
    fetchCalls.push({ url: urlStr, init });
    if (urlStr.includes('/.netlify/identity/user')) {
      return { ok: true, json: async () => ({ id: 'learner-1', email: 'learner@example.com' }) };
    }
    if (urlStr.includes('api.openai.com')) {
      const next = openAiQueue.shift();
      if (!next) throw new Error('No mock OpenAI response queued');
      return { ok: next.status < 400, status: next.status, json: async () => next.body };
    }
    throw new Error('Unexpected fetch to ' + urlStr);
  };
});

afterEach(() => {
  global.fetch = realFetch;
  delete process.env.OPENAI_API_KEY;
});

function req(body) {
  return new Request('https://pilot.example.com/.netlify/functions/openai-transcribe', {
    method: 'POST',
    headers: { origin: 'https://pilot.example.com', 'content-type': 'application/json', authorization: 'Bearer fake-jwt' },
    body: JSON.stringify(body)
  });
}

function audioBase64(bytes) {
  return Buffer.from(bytes).toString('base64');
}

const WEBM_AUDIO_BASE64 = audioBase64([0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42, 0x82, 0x88, 0x77, 0x65, 0x62, 0x6d]);
const MP4_AUDIO_BASE64 = audioBase64([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20]);
const WAV_AUDIO_BASE64 = Buffer.from('RIFF....WAVEfmt ', 'latin1').toString('base64');
const MP3_AUDIO_BASE64 = Buffer.from('ID3\u0004\u0000\u0000test', 'latin1').toString('base64');

function normalBody(overrides = {}) {
  return {
    audioBase64: WEBM_AUDIO_BASE64,
    mimeType: 'audio/webm;codecs=opus',
    language: 'en',
    recordingDurationMs: 1400,
    chunkCount: 6,
    ...overrides
  };
}

function openAiCall() {
  return fetchCalls.find(c => c.url.includes('api.openai.com'));
}

describe('transcription returns real speech, never the priming prompt', () => {
  test('returns arbitrary genuine transcript content unchanged', async () => {
    queueOpenAiResponse('So this Whole Life policy includes a cash value component that grows over time.');
    const res = await handler(req(normalBody()));
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.text, 'So this Whole Life policy includes a cash value component that grows over time.');
  });

  test('a completely unrelated genuine sentence is returned exactly as transcribed', async () => {
    queueOpenAiResponse('My dog ate my homework this morning and I was late for the meeting.');
    const res = await handler(req(normalBody()));
    const data = await res.json();
    assert.equal(data.text, 'My dog ate my homework this morning and I was late for the meeting.');
  });

  test('a Chinese genuine transcript naturally using a couple of primed terms is returned unchanged', async () => {
    queueOpenAiResponse('这个保单包含了 Whole Life 和 Term Life 两种选择，您比较倾向哪一种？');
    const res = await handler(req(normalBody({ language: 'zh' })));
    const data = await res.json();
    assert.equal(data.text, '这个保单包含了 Whole Life 和 Term Life 两种选择，您比较倾向哪一种？');
  });

  test('a short isolated vocabulary word actually spoken is returned, not discarded', async () => {
    queueOpenAiResponse('ETF');
    const res = await handler(req(normalBody()));
    const data = await res.json();
    assert.equal(data.text, 'ETF');
  });

  test('the exact English priming prompt itself is caught and discarded as a hallucinated echo, not returned as a transcript', async () => {
    queueOpenAiResponse('IUL, Whole Life, Term Life, annuity, Medicare, premium, coverage, ETF, S&P 500, buy-sell agreement, key person insurance.');
    const res = await handler(req(normalBody()));
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.text, '', 'no fabricated instructional text is ever surfaced as the transcript');
  });

  test('the exact Chinese priming prompt itself is caught and discarded', async () => {
    queueOpenAiResponse('IUL、Whole Life、Term Life、annuity、Medicare、premium、coverage、ETF、S&P 500、buy-sell agreement、key person insurance');
    const res = await handler(req(normalBody({ language: 'zh' })));
    const data = await res.json();
    assert.equal(data.text, '');
  });

  test('the actual reported production symptom is discarded, not returned', async () => {
    queueOpenAiResponse('这是一段销售训练对话，请准确辨识 IUL、Whole Life、Term Life、annuity、Medicare、premium、coverage、ETF、S&P 500、buy-sell agreement、key person insurance 等专业词汇。');
    const res = await handler(req(normalBody({ language: 'zh' })));
    const data = await res.json();
    assert.equal(data.text, '');
  });

  test('the request sent to OpenAI phrases the prompt as a bare term list', async () => {
    queueOpenAiResponse('anything');
    await handler(req(normalBody()));
    const call = openAiCall();
    assert.ok(call, 'a request was sent to OpenAI');
    const promptValue = call.init.body.get('prompt');
    assert.ok(!/this is a/i.test(promptValue));
    assert.ok(!/accurately transcribe/i.test(promptValue));
    assert.match(promptValue, /Whole Life/);
  });

  test('the Chinese prompt sent to OpenAI is also a bare term list', async () => {
    queueOpenAiResponse('anything');
    await handler(req(normalBody({ language: 'zh' })));
    const promptValue = openAiCall().init.body.get('prompt');
    assert.ok(!/这是一段/.test(promptValue));
    assert.ok(!/请准确辨识/.test(promptValue));
  });
});

describe('Voice P0 stability: actual audio container wins over browser MIME', () => {
  test('WebM bytes are sent as recording.webm with audio/webm even if browser MIME claims MP4', async () => {
    queueOpenAiResponse('webm ok');
    const res = await handler(req(normalBody({ mimeType: 'audio/mp4' })));
    assert.equal(res.status, 200);
    const file = openAiCall().init.body.get('file');
    assert.equal(file.name, 'recording.webm');
    assert.equal(file.type, 'audio/webm');
  });

  test('MP4/M4A bytes are sent using an mp4 filename and audio/mp4', async () => {
    queueOpenAiResponse('mp4 ok');
    const res = await handler(req(normalBody({ audioBase64: MP4_AUDIO_BASE64, mimeType: 'audio/webm' })));
    assert.equal(res.status, 200);
    const file = openAiCall().init.body.get('file');
    assert.equal(file.name, 'recording.mp4');
    assert.equal(file.type, 'audio/mp4');
  });

  test('WAV bytes are recognized independently of declared MIME', async () => {
    queueOpenAiResponse('wav ok');
    const res = await handler(req(normalBody({ audioBase64: WAV_AUDIO_BASE64, mimeType: 'application/octet-stream' })));
    assert.equal(res.status, 200);
    const file = openAiCall().init.body.get('file');
    assert.equal(file.name, 'recording.wav');
    assert.equal(file.type, 'audio/wav');
  });

  test('MP3 ID3 bytes are recognized independently of declared MIME', async () => {
    queueOpenAiResponse('mp3 ok');
    const res = await handler(req(normalBody({ audioBase64: MP3_AUDIO_BASE64, mimeType: 'audio/webm' })));
    assert.equal(res.status, 200);
    const file = openAiCall().init.body.get('file');
    assert.equal(file.name, 'recording.mp3');
    assert.equal(file.type, 'audio/mpeg');
  });

  test('unknown/corrupt bytes are rejected before OpenAI is called', async () => {
    const garbage = Buffer.from('not-an-audio-container').toString('base64');
    const res = await handler(req(normalBody({ audioBase64: garbage })));
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /corrupted|unsupported/i);
    assert.equal(openAiCall(), undefined, 'corrupt audio never reaches OpenAI');
  });

  test('recording metadata is diagnostic only and never required for a valid request', async () => {
    queueOpenAiResponse('legacy frontend still works');
    const res = await handler(req({ audioBase64: WEBM_AUDIO_BASE64, mimeType: 'audio/webm', language: 'en' }));
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.text, 'legacy frontend still works');
  });
});
