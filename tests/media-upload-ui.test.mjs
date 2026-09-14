// Runs knowledge.html's real page script in a VM with a small DOM, to pin the
// two things the UI must never get wrong:
//
//   1. If this deployment has no storage/transcription configured, the page
//      must NOT offer media upload at all - no panel, no request, no
//      appearance of a successful upload.
//   2. When it is configured, the file must go straight to the signed storage
//      URL as the file object itself - never base64, never through a function.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../knowledge.html', import.meta.url), 'utf8');
const pageScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');
// Timer-based: the page's status polling awaits setTimeout, so the test
// clock has to reach the timers phase each turn, not just setImmediate.
const tick = () => new Promise(r => setTimeout(r, 0));

const SIGNED_PUT_URL = 'https://test-account.r2.cloudflarestorage.com/bucket/teams/team-a/media/m1/token.mp4?X-Amz-Signature=abc';

function harness({ capability, mediaStates = ['ready'] } = {}) {
  const elements = new Map();
  const calls = [];
  const xhrs = [];
  function element(id) {
    if (elements.has(id)) return elements.get(id);
    const el = {
      id, value: '', textContent: '', innerHTML: '', disabled: false, hidden: true, checked: false,
      files: [], style: {}, dataset: {}, attributes: {},
      classList: { values: new Set(), add(x) { this.values.add(x) }, remove(x) { this.values.delete(x) }, toggle(x, on) { on ? this.values.add(x) : this.values.delete(x) }, contains(x) { return this.values.has(x) } },
      setAttribute(name, value) { this.attributes[name] = value }, getAttribute(name) { return this.attributes[name] ?? null },
      addEventListener(name, fn) { this['on' + name] = fn }, dispatchEvent(e) { this['on' + e.type]?.(e) },
      click() { this.onclick?.({ preventDefault() {} }) },
      querySelector(sel) { return element(id + ' ' + sel) }, querySelectorAll() { return [] },
      closest() { return null }, scrollIntoView() {}, focus() {}, appendChild() {}, reset() {}, showModal() {}, close() {}
    };
    elements.set(id, el);
    return el;
  }
  const document = {
    readyState: 'complete', head: { appendChild() {} }, body: { appendChild() {} },
    documentElement: { lang: 'en' },
    getElementById: element,
    querySelector: sel => element('q:' + sel),
    querySelectorAll: () => [],
    createElement: () => element('new'),
    addEventListener() {}
  };

  const context = vm.createContext({
    document, console, Date, Event, URLSearchParams, CSS: { escape: x => x }, Math, JSON, Promise,
    location: { search: '?pilot=1', hash: '', pathname: '/knowledge.html' },
    sessionStorage: { getItem: () => null, setItem() {} },
    setTimeout: (fn) => setTimeout(fn, 0), clearTimeout, setInterval: () => 0, clearInterval,
    alert() {}, encodeURIComponent, decodeURIComponent, parseInt, Number, String, Array, Object, Set, Map, Error
  });
  context.window = context;

  context.PilotCloud = {
    enabled: true,
    token: async () => 'synthetic-token',
    request: async (resource) => {
      calls.push({ kind: 'pilotcloud', resource });
      if (resource === 'me') return { email: 'manager@team-a.test', roles: ['manager'], teamId: 'team-a' };
      if (resource === 'knowledge') return { canManage: true, sources: [] };
      return {};
    }
  };

  let statusPolls = 0;
  context.fetch = async (url, options = {}) => {
    const u = String(url);
    calls.push({ url: u, method: (options.method || 'GET').toUpperCase(), body: options.body });
    if (u.includes('media-status?mediaId=')) {
      const state = mediaStates[Math.min(statusPolls++, mediaStates.length - 1)];
      return { ok: true, status: 200, json: async () => ({ media: { mediaId: 'm1', state, knowledgeId: state === 'ready' ? 'k1' : '', failureReason: state === 'failed' ? 'transcription_provider_failed' : '' } }) };
    }
    if (u.includes('media-status')) return { ok: true, status: 200, json: async () => ({ capability }) };
    if (u.includes('media-upload-reserve')) {
      return { ok: true, status: 201, json: async () => ({ media: { mediaId: 'm1', state: 'awaiting_upload' }, upload: { url: SIGNED_PUT_URL, method: 'PUT', headers: { 'content-type': 'video/mp4' } }, maxBytes: capability?.maxUploadBytes }) };
    }
    if (u.includes('media-upload-confirm')) {
      return { ok: true, status: 200, json: async () => ({ media: { mediaId: 'm1', state: 'transcribing' }, transcription: { submitted: true } }) };
    }
    if (u.includes('knowledge-question-bank-v2')) return { ok: true, status: 200, json: async () => ({}) };
    return { ok: false, status: 404, json: async () => ({}) };
  };

  context.XMLHttpRequest = class {
    constructor() { this.upload = {}; this.headers = {}; xhrs.push(this) }
    open(method, url) { this.method = method; this.url = url }
    setRequestHeader(name, value) { this.headers[name] = value }
    send(body) {
      this.sentBody = body;
      this.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
      this.status = 200;
      setTimeout(() => this.onload(), 0);
    }
  };

  vm.runInContext(pageScript, context);
  return { context, elements, calls, xhrs, element };
}

const FAKE_FILE = { name: 'training.mp4', size: 180 * 1024 * 1024, type: 'video/mp4' };
const CONFIGURED = { directUploadAvailable: true, storageConfigured: true, transcriptionConfigured: true, maxUploadBytes: 500 * 1024 * 1024, supportedFormats: ['MP4', 'MOV', 'WebM', 'MP3', 'M4A', 'WAV'], missingEnv: [] };
const UNCONFIGURED = { directUploadAvailable: false, storageConfigured: false, transcriptionConfigured: false, maxUploadBytes: 500 * 1024 * 1024, supportedFormats: ['MP4'], missingEnv: ['R2_ACCOUNT_ID'] };

describe('media upload UI honesty gate', () => {
  test('with nothing configured the page offers no upload and sends no upload request', async () => {
    const h = harness({ capability: UNCONFIGURED });
    await tick(); await tick();
    h.element('mediaUploadPreviewBtn').click();
    await tick();
    assert.equal(h.element('mediaPanel').hidden, true, 'the upload panel must stay closed');
    assert.equal(h.calls.some(c => String(c.url || '').includes('media-upload-reserve')), false);
    // It routes the manager to the path that genuinely works instead.
    assert.equal(h.element('sourceType').value, 'video_transcript');
    assert.match(h.element('formStatus').textContent, /not configured/i);
  });

  test('with storage and transcription configured the tile becomes a real upload entry point', async () => {
    const h = harness({ capability: CONFIGURED });
    await tick(); await tick();
    assert.equal(h.element('mediaUploadPreviewBtn').classList.contains('coming-soon'), false);
    assert.match(h.element('mediaUploadPreviewBtn').querySelector('b').getAttribute('data-en'), /Upload training video or audio/);
    assert.match(h.element('mediaUploadPreviewBtn').querySelector('small').getAttribute('data-en'), /500 MB per file/);
    h.element('mediaUploadPreviewBtn').click();
    await tick();
    assert.equal(h.element('mediaPanel').hidden, false);
  });
});

describe('direct upload behaviour', () => {
  async function runUpload(h, file = FAKE_FILE) {
    await tick(); await tick();
    h.element('mediaFile').files = [file];
    h.element('mediaConsent').checked = true;
    h.element('mediaUploadBtn').click();
    for (let i = 0; i < 120; i++) await tick();
  }

  test('the file goes straight to the signed storage URL, as the file itself and never base64', async () => {
    const h = harness({ capability: CONFIGURED, mediaStates: ['transcribing', 'ready'] });
    await runUpload(h);

    assert.equal(h.xhrs.length, 1, 'exactly one direct upload');
    const xhr = h.xhrs[0];
    assert.equal(xhr.method, 'PUT');
    assert.equal(xhr.url, SIGNED_PUT_URL, 'uploads to the signed storage URL, not to a function');
    assert.equal(xhr.sentBody, FAKE_FILE, 'the File object itself is sent - no base64, no JSON envelope');
    assert.equal(xhr.headers['content-type'], 'video/mp4');

    // The media bytes never appear in any function request body.
    for (const call of h.calls) {
      if (call.body) assert.ok(!String(call.body).includes('base64'), 'no function request may carry base64 media');
    }
    // Reserve carried metadata only.
    const reserve = h.calls.find(c => String(c.url).includes('media-upload-reserve'));
    assert.deepEqual(Object.keys(JSON.parse(reserve.body)).sort(), ['consentConfirmed', 'contentType', 'fileName', 'languageHint', 'sizeBytes', 'title']);
  });

  test('it walks the real processing states through to the created draft', async () => {
    const h = harness({ capability: CONFIGURED, mediaStates: ['transcribing', 'ready'] });
    await runUpload(h);
    assert.match(h.element('mediaStatus').textContent, /Ready\./);
    assert.match(h.element('mediaStatus').textContent, /Analyze with AI/);
    assert.match(h.element('mediaSteps').innerHTML, /Ready/);
  });

  test('a failed transcription is reported as failed, and never as a created draft', async () => {
    const h = harness({ capability: CONFIGURED, mediaStates: ['transcribing', 'failed'] });
    await runUpload(h);
    assert.match(h.element('mediaStatus').textContent, /did not finish/);
    assert.match(h.element('mediaStatus').textContent, /No Company Knowledge draft was created/);
    assert.match(h.element('mediaSteps').innerHTML, /media-step failed/);
  });

  test('an oversized file is refused in the browser before any upload is authorized', async () => {
    const h = harness({ capability: CONFIGURED });
    await runUpload(h, { name: 'huge.mp4', size: 900 * 1024 * 1024, type: 'video/mp4' });
    assert.equal(h.xhrs.length, 0);
    assert.equal(h.calls.some(c => String(c.url || '').includes('media-upload-reserve')), false);
    assert.match(h.element('mediaStatus').textContent, /Nothing was uploaded/);
  });

  test('upload is refused without the authorization checkbox', async () => {
    const h = harness({ capability: CONFIGURED });
    await tick(); await tick();
    h.element('mediaFile').files = [FAKE_FILE];
    h.element('mediaUploadBtn').click();
    for (let i = 0; i < 20; i++) await tick();
    assert.equal(h.xhrs.length, 0);
    assert.match(h.element('mediaStatus').textContent, /Confirm organizational authorization/);
  });
});
