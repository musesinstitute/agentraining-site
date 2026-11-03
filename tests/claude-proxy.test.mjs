// Tests for netlify/functions/claude.js (the Practice Studio AI proxy).
// Covers model routing by `role` (AI client vs. scoring/coach), that the browser
// cannot choose a model, and normalising responses to text-only content.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';

// claude.js is CommonJS and requires @netlify/blobs; give it an in-memory store.
const blobStore = new Map();
const blobsStub = {
  getStore: () => ({
    get: async (key) => blobStore.get(key) ?? null,
    setJSON: async (key, value) => { blobStore.set(key, value); }
  })
};
const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === '@netlify/blobs') return blobsStub;
  return originalLoad.call(this, request, ...rest);
};
const { handler } = createRequire(import.meta.url)('../netlify/functions/claude.js');

const realFetch = global.fetch;
let sent = [];
let reply = null;

function event(body, headers = {}) {
  return {
    httpMethod: 'POST',
    headers: { origin: 'https://agentraining.ai', 'x-nf-client-connection-ip': '203.0.113.' + Math.floor(Math.random() * 250), ...headers },
    body: JSON.stringify(body)
  };
}

beforeEach(() => {
  sent = [];
  blobStore.clear();
  process.env.ANTHROPIC_API_KEY = 'test-key';
  reply = { status: 200, body: { content: [{ type: 'text', text: 'hello' }], stop_reason: 'end_turn' } };
  global.fetch = async (url, init) => {
    sent.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    return { ok: reply.status < 400, status: reply.status, json: async () => reply.body };
  };
});

afterEach(() => { global.fetch = realFetch; });

describe('claude.js model routing', () => {
  test('role "client" uses Claude Haiku 5.5 with thinking off and no fallback', async () => {
    const res = await handler(event({ role: 'client', system: 's', messages: [{ role: 'user', content: 'hi' }] }));
    assert.equal(res.statusCode, 200);
    const req = sent[0];
    assert.equal(req.body.model, 'claude-haiku-5-5');
    assert.deepEqual(req.body.thinking, { type: 'disabled' });
    assert.equal(req.body.fallbacks, undefined);
    assert.equal(req.headers['anthropic-beta'], undefined);
    assert.equal(req.body.system, 's');
    assert.deepEqual(req.body.messages, [{ role: 'user', content: 'hi' }]);
  });

  test('no role (scoring/coach) uses Claude Sonnet 5.5 at low effort with server-side fallback', async () => {
    await handler(event({ system: 's', messages: [{ role: 'user', content: 'hi' }] }));
    const req = sent[0];
    assert.equal(req.body.model, 'claude-sonnet-5-5');
    assert.deepEqual(req.body.output_config, { effort: 'low' });
    assert.equal(req.body.thinking, undefined);
    assert.equal(req.body.fallbacks, 'default');
    assert.equal(req.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  });

  test('the browser cannot pick a model or override settings', async () => {
    await handler(event({ role: 'client', model: 'claude-fable-5-1', max_tokens: 100000, messages: [{ role: 'user', content: 'hi' }] }));
    assert.equal(sent[0].body.model, 'claude-haiku-5-5');
    assert.equal(sent[0].body.max_tokens, 1000);
    await handler(event({ role: 'anything-else', messages: [{ role: 'user', content: 'hi' }] }));
    assert.equal(sent[1].body.model, 'claude-sonnet-5-5');
  });
});

describe('claude.js response handling', () => {
  test('thinking blocks are removed so content[0].text is the answer', async () => {
    reply.body = { content: [{ type: 'thinking', thinking: '', signature: 'x' }, { type: 'text', text: '{"overallScore":80}' }], stop_reason: 'end_turn' };
    const res = await handler(event({ messages: [{ role: 'user', content: 'hi' }] }));
    const data = JSON.parse(res.body);
    assert.equal(res.statusCode, 200);
    assert.equal(data.content.length, 1);
    assert.equal(data.content[0].text, '{"overallScore":80}');
  });

  test('a safety decline is returned as an error, not as an empty answer', async () => {
    reply.body = { content: [], stop_reason: 'refusal' };
    const res = await handler(event({ messages: [{ role: 'user', content: 'hi' }] }));
    assert.equal(res.statusCode, 502);
    assert.equal(JSON.parse(res.body).stop_reason, 'refusal');
  });

  test('an Anthropic API error keeps its status (e.g. 429 overloaded / rate limit)', async () => {
    reply = { status: 429, body: { type: 'error', error: { type: 'rate_limit_error' } } };
    const res = await handler(event({ messages: [{ role: 'user', content: 'hi' }] }));
    assert.equal(res.statusCode, 429);
  });
});
