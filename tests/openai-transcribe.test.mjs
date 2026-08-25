// Regression tests for netlify/functions/openai-transcribe.mjs.
//
// Production regression: every learner recording was returning the fixed
// priming-prompt text ("这是一段销售训练对话，请准确辨识...") instead of
// what the learner actually said. Root cause: an instructional-style
// prompt sent to gpt-4o-transcribe, which can "continue" prompt-shaped
// narration instead of transcribing unclear/quiet audio. These tests prove
// arbitrary genuine transcript content is returned unchanged, and that a
// model response which is itself substantially the prompt talking back is
// discarded rather than surfaced as the transcript.
//
// Run with: npm test
//
// global fetch() is monkey-patched directly in this file (not via the ESM
// loader hook, since this function calls OpenAI's REST API and Netlify's
// legacy Identity REST endpoint inline, not through a separate lib module)
// - no real call to OpenAI or to Netlify Identity is ever made.
// @netlify/identity's verifyRequestOrigin() is still intercepted globally
// by tests/loader.mjs exactly as it is for every other test file.
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

const FAKE_AUDIO_BASE64 = Buffer.from('fake-audio-bytes').toString('base64');

describe('transcription returns real speech, never the priming prompt', () => {
  test('returns arbitrary genuine transcript content unchanged', async () => {
    queueOpenAiResponse('So this Whole Life policy includes a cash value component that grows over time.');
    const res = await handler(req({ audioBase64: FAKE_AUDIO_BASE64, mimeType: 'audio/webm', language: 'en' }));
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.text, 'So this Whole Life policy includes a cash value component that grows over time.');
  });

  test('a completely unrelated genuine sentence is returned exactly as transcribed', async () => {
    queueOpenAiResponse('My dog ate my homework this morning and I was late for the meeting.');
    const res = await handler(req({ audioBase64: FAKE_AUDIO_BASE64, mimeType: 'audio/webm', language: 'en' }));
    const data = await res.json();
    assert.equal(data.text, 'My dog ate my homework this morning and I was late for the meeting.');
  });

  test('a Chinese genuine transcript naturally using a couple of primed terms is returned unchanged', async () => {
    queueOpenAiResponse('这个保单包含了 Whole Life 和 Term Life 两种选择，您比较倾向哪一种？');
    const res = await handler(req({ audioBase64: FAKE_AUDIO_BASE64, mimeType: 'audio/webm', language: 'zh' }));
    const data = await res.json();
    assert.equal(data.text, '这个保单包含了 Whole Life 和 Term Life 两种选择，您比较倾向哪一种？');
  });

  test('a short isolated vocabulary word actually spoken is returned, not discarded', async () => {
    queueOpenAiResponse('ETF');
    const res = await handler(req({ audioBase64: FAKE_AUDIO_BASE64, mimeType: 'audio/webm', language: 'en' }));
    const data = await res.json();
    assert.equal(data.text, 'ETF');
  });

  test('the exact English priming prompt itself is caught and discarded as a hallucinated echo, not returned as a transcript', async () => {
    queueOpenAiResponse('IUL, Whole Life, Term Life, annuity, Medicare, premium, coverage, ETF, S&P 500, buy-sell agreement, key person insurance.');
    const res = await handler(req({ audioBase64: FAKE_AUDIO_BASE64, mimeType: 'audio/webm', language: 'en' }));
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.text, '', 'no fabricated instructional text is ever surfaced as the transcript');
  });

  test('the exact Chinese priming prompt itself is caught and discarded', async () => {
    queueOpenAiResponse('IUL、Whole Life、Term Life、annuity、Medicare、premium、coverage、ETF、S&P 500、buy-sell agreement、key person insurance');
    const res = await handler(req({ audioBase64: FAKE_AUDIO_BASE64, mimeType: 'audio/webm', language: 'zh' }));
    const data = await res.json();
    assert.equal(data.text, '');
  });

  test('the actual reported production symptom - a paraphrase of the old instructional prompt - is discarded, not returned', async () => {
    queueOpenAiResponse('这是一段销售训练对话，请准确辨识 IUL、Whole Life、Term Life、annuity、Medicare、premium、coverage、ETF、S&P 500、buy-sell agreement、key person insurance 等专业词汇。');
    const res = await handler(req({ audioBase64: FAKE_AUDIO_BASE64, mimeType: 'audio/webm', language: 'zh' }));
    const data = await res.json();
    assert.equal(data.text, '');
  });

  test('the request sent to OpenAI phrases the prompt as a bare term list, never as an instruction the model could mistake for narration', async () => {
    queueOpenAiResponse('anything');
    await handler(req({ audioBase64: FAKE_AUDIO_BASE64, mimeType: 'audio/webm', language: 'en' }));
    const openAiCall = fetchCalls.find(c => c.url.includes('api.openai.com'));
    assert.ok(openAiCall, 'a request was sent to OpenAI');
    const promptValue = openAiCall.init.body.get('prompt');
    assert.ok(!/this is a/i.test(promptValue), 'prompt is not narrated as describing the conversation');
    assert.ok(!/accurately transcribe/i.test(promptValue), 'prompt does not instruct the model');
    assert.match(promptValue, /Whole Life/);
  });

  test('the Chinese prompt sent to OpenAI is also a bare term list, not an instruction', async () => {
    queueOpenAiResponse('anything');
    await handler(req({ audioBase64: FAKE_AUDIO_BASE64, mimeType: 'audio/webm', language: 'zh' }));
    const openAiCall = fetchCalls.find(c => c.url.includes('api.openai.com'));
    const promptValue = openAiCall.init.body.get('prompt');
    assert.ok(!/这是一段/.test(promptValue), 'prompt does not narrate the conversation');
    assert.ok(!/请准确辨识/.test(promptValue), 'prompt does not instruct the model');
  });
});
