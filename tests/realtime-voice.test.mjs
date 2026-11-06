// Isolated server-contract checks. No real paid OpenAI sessions are created.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const server = readFileSync(new URL('../netlify/functions/realtime-voice-token.mjs', import.meta.url), 'utf8');
const browser = readFileSync(new URL('../voice-realtime-lab.html', import.meta.url), 'utf8');
const wrapped = server
  .replace(/^import .*;\s*$/gm, '')
  .replace('export default async function handler', 'async function handler')
  + '\nreturn handler;';

function setup({ active = true, user = true, origin = true, key = true, storageOk = true } = {}) {
  let count = 0, records = null, forwarded = null;
  const getStore = () => ({
    async get() {
      if (!storageOk) throw Error('rate limiter unavailable');
      return records;
    },
    async setJSON(_, value) { records = value; }
  });
  const fetch = async (url, opts) => {
    count++;
    forwarded = { url, opts };
    return { ok: true, status: 200, async json() { return { value: 'ek_test', expires_at: 123 }; } };
  };
  const env = {
    OPENAI_REALTIME_ENABLED: active ? '1' : '0',
    OPENAI_API_KEY: key ? 'test-server-secret' : ''
  };
  const handler = new Function('createHash','getUser','verifyRequestOrigin','getStore','fetch','Response',
    'process','AbortController','setTimeout','clearTimeout','console',wrapped)(
    createHash,
    async () => user ? { id: 'pilot-learner' } : null,
    () => { if (!origin) throw Error('untrusted origin'); },
    getStore,fetch,Response,{ env },AbortController,setTimeout,clearTimeout,{ error() {} }
  );
  return { handler, calls: () => count, forwarded: () => forwarded };
}

test('Realtime requires a signed-in user and allowed origin', async () => {
  assert.equal((await setup({user:false}).handler({method:'POST'})).status, 401);
  assert.equal((await setup({origin:false}).handler({method:'POST'})).status, 403);
  assert.equal((await setup().handler({method:'GET'})).status, 405);
});

test('Realtime is OFF unless enabled and configured by the deploy operator', async () => {
  assert.equal((await setup({active:false}).handler({method:'POST'})).status, 503);
  assert.equal((await setup({key:false}).handler({method:'POST'})).status, 503);
});

test('Paid voice sessions are refused when quota storage is unavailable', async () => {
  assert.equal((await setup({storageOk:false}).handler({method:'POST'})).status, 503);
});

test('Only an ephemeral key reaches the browser, with semantic VAD low eagerness', async () => {
  const app=setup();
  const response=await app.handler({method:'POST'});
  assert.equal(response.status, 200);
  const body=await response.json();
  assert.equal(body.value,'ek_test');
  assert.ok(!JSON.stringify(body).includes('test-server-secret'));
  const upstream=app.forwarded();
  assert.match(upstream.url,/\/realtime\/client_secrets$/);
  assert.equal(upstream.opts.headers.authorization,'Bearer test-server-secret');
  const session=JSON.parse(upstream.opts.body).session;
  assert.equal(session.type,'realtime');
  assert.equal(session.model,'gpt-realtime-2.1');
  assert.equal(session.audio.input.turn_detection.type,'semantic_vad');
  assert.equal(session.audio.input.turn_detection.eagerness,'low');
  assert.equal(session.audio.input.turn_detection.interrupt_response,true);
});

test('Learner may start at most five paid sessions per hour', async () => {
  const app=setup();
  for(let i=0;i<5;i++)assert.equal((await app.handler({method:'POST'})).status,200);
  assert.equal((await app.handler({method:'POST'})).status,429);
  assert.equal(app.calls(),5);
});

test('WebRTC lab links from simulator, supports cleanup and coach switching', () => {
  assert.match(browser,/RTCPeerConnection/);
  assert.match(browser,/\/api\/realtime-voice-token/);
  assert.match(browser,/input_audio_buffer\.speech_started/);
  assert.match(browser,/session\.update/);
  assert.match(browser,/stream\.getTracks\(\)/);
  assert.match(browser,/Five-minute test limit reached/);
  assert.doesNotMatch(browser,/sk-[a-zA-Z0-9]/);
  const simulator=readFileSync(new URL('../simulator.html',import.meta.url),'utf8');
  assert.match(simulator,/href="\/voice-realtime-lab\.html"/);
});
