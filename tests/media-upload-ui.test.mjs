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

function harness({ capability, mediaStates = ['ready'], slowCapability = false, deferCapability = null } = {}) {
  const elements = new Map();
  const calls = [];
  const xhrs = [];
  function element(id) {
    if (elements.has(id)) return elements.get(id);
    const el = {
      id, value: '', textContent: '', innerHTML: '', disabled: false, hidden: false, checked: false,
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
    if (u.includes('media-status')) {
      if (slowCapability) return new Promise(() => {}); // never resolves
      // deferCapability lets a test control WHEN the probe answers, so the
      // before/after-file-selection race is actually exercised.
      if (deferCapability) return deferCapability.promise.then(() => ({ ok: true, status: 200, json: async () => ({ capability }) }));
      return { ok: true, status: 200, json: async () => ({ capability }) };
    }
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
// Shaped like the real Wikimedia Commons download that blocked acceptance.
const WEBM_FILE = { name: 'Blue_Origin_launch.webm', size: 42 * 1024 * 1024, type: 'video/webm' };
const CONFIGURED = { directUploadAvailable: true, storageConfigured: true, transcriptionConfigured: true, maxUploadBytes: 500 * 1024 * 1024, supportedFormats: ['MP4', 'MOV', 'WebM', 'MP3', 'M4A', 'WAV'], missingEnv: [] };
// media-status reports the full supported-format list whether or not the
// deployment is configured (see tests/media-upload-flow.test.mjs), so the
// fixture must too.
const UNCONFIGURED = { directUploadAvailable: false, storageConfigured: false, transcriptionConfigured: false, maxUploadBytes: 500 * 1024 * 1024, supportedFormats: ['MP4', 'MOV', 'WebM', 'MP3', 'M4A', 'WAV'], missingEnv: ['R2_ACCOUNT_ID'] };

describe('credentials-off behaviour (the live acceptance failure)', () => {
  test('the Video/Audio panel stays visible and never redirects to the document chooser', async () => {
    const h = harness({ capability: UNCONFIGURED });
    await tick(); await tick();
    // Regression: this used to hide the panel and scroll the manager to the
    // TRANSCRIPT chooser, which accepts documents only - so a real .webm could
    // not be selected at all and the feature looked undeployed.
    assert.notEqual(h.element('mediaPanel').hidden, true, 'the media path must stay on the page without credentials');
    assert.equal(h.element('sourceType').value, '', 'it must not switch the document form on the manager\'s behalf');
    assert.equal(h.element('mediaUploadBtn').disabled, true, 'but uploading stays off');
    assert.match(h.element('mediaConfigNote').textContent, /not yet configured for this environment/i);
    assert.match(h.element('mediaConfigNote').textContent, /R2_ACCOUNT_ID/, 'and says what is missing');
    assert.equal(h.calls.some(c => String(c.url || '').includes('media-upload-reserve')), false);
  });

  test('a .webm can still be selected and validated with no credentials configured', async () => {
    const h = harness({ capability: UNCONFIGURED });
    await tick(); await tick();
    const input = h.element('mediaFile');
    input.files = [WEBM_FILE];
    input.onchange.call(input);
    assert.match(h.element('mediaLimitNote').textContent, /Selected: Blue_Origin_launch\.webm/);
    assert.match(h.element('mediaStatus').textContent, /accepted/i);
  });

  test('pressing Upload anyway says so plainly and sends nothing', async () => {
    const h = harness({ capability: UNCONFIGURED });
    await tick(); await tick();
    h.element('mediaFile').files = [WEBM_FILE];
    h.element('mediaFile').onchange.call(h.element('mediaFile'));
    h.element('mediaConsent').checked = true;
    h.element('mediaUploadBtn').click();
    for (let i = 0; i < 10; i++) await tick();
    assert.equal(h.xhrs.length, 0);
    assert.match(h.element('mediaStatus').textContent, /was not uploaded/i);
  });

  test('upload is disabled before the capability probe has even answered', async () => {
    const h = harness({ capability: CONFIGURED, slowCapability: true });
    assert.equal(h.element('mediaUploadBtn').disabled, true, 'fail safe: off until proven configured');
  });

  test('with everything configured the environment banner clears, and the button waits on the manager', async () => {
    const h = harness({ capability: CONFIGURED });
    await tick(); await tick();
    // No environment-level problem left to report...
    assert.equal(h.element('mediaConfigNote').hidden, true);
    // ...but a real upload still needs a file and authorization, and the page
    // says which is outstanding rather than offering a dead button.
    assert.equal(h.element('mediaUploadBtn').disabled, true);
    assert.match(h.element('mediaBlockedReason').textContent, /Choose a video or audio file/);
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

describe('file selection accepts every claimed format (the real acceptance blocker)', () => {
  const cases = [
    ['WebM video', { name: 'Blue_Origin_launch.webm', size: 42 * 1024 * 1024, type: 'video/webm' }],
    ['WebM with an empty MIME type from the OS', { name: 'Blue_Origin_launch.webm', size: 42 * 1024 * 1024, type: '' }],
    ['WebM the OS mislabelled', { name: 'Blue_Origin_launch.webm', size: 42 * 1024 * 1024, type: 'application/octet-stream' }],
    ['MP4', { name: 'training.mp4', size: 10 * 1024 * 1024, type: 'video/mp4' }],
    ['MOV', { name: 'training.mov', size: 10 * 1024 * 1024, type: 'video/quicktime' }],
    ['MOV with an empty MIME type', { name: 'training.mov', size: 10 * 1024 * 1024, type: '' }],
    ['MP3', { name: 'session.mp3', size: 5 * 1024 * 1024, type: 'audio/mpeg' }],
    ['M4A', { name: 'session.m4a', size: 5 * 1024 * 1024, type: 'audio/x-m4a' }],
    ['WAV', { name: 'session.wav', size: 5 * 1024 * 1024, type: 'audio/wave' }]
  ];
  for (const [label, file] of cases) {
    test(`${label} is accepted and confirmed back to the manager by name`, async () => {
      const h = harness({ capability: CONFIGURED });
      await tick(); await tick();
      const input = h.element('mediaFile');
      input.files = [file];
      input.onchange.call(input);
      assert.equal(input.value, '', 'a supported file is never cleared');
      assert.match(h.element('mediaLimitNote').textContent, new RegExp('Selected: ' + file.name.replace('.', '\\.')));
      assert.match(h.element('mediaStatus').textContent, /accepted/i);
    });
  }

  test('an unsupported file is refused immediately and cleared', async () => {
    const h = harness({ capability: CONFIGURED });
    await tick(); await tick();
    const input = h.element('mediaFile');
    input.files = [{ name: 'installer.exe', size: 1024 * 1024, type: 'application/x-msdownload' }];
    input.value = 'installer.exe';
    input.onchange.call(input);
    assert.equal(input.value, '', 'an unsupported selection is cleared');
    assert.match(h.element('mediaStatus').textContent, /not a supported media file/i);
    assert.match(h.element('mediaStatus').textContent, /WebM/, 'the supported list is shown');
  });

  test('a mislabelled but supported file uploads under its resolved type, not the OS guess', async () => {
    const h = harness({ capability: CONFIGURED, mediaStates: ['ready'] });
    await tick(); await tick();
    h.element('mediaFile').files = [{ name: 'Blue_Origin_launch.webm', size: 42 * 1024 * 1024, type: 'application/octet-stream' }];
    h.element('mediaConsent').checked = true;
    h.element('mediaUploadBtn').click();
    for (let i = 0; i < 120; i++) await tick();
    const reserve = h.calls.find(c => String(c.url).includes('media-upload-reserve'));
    assert.equal(JSON.parse(reserve.body).contentType, 'video/webm', 'the resolved type is sent, so the signed PUT matches');
    assert.equal(h.xhrs.length, 1);
  });
});

describe('Upload and transcribe button state (never enabled without a real pipeline)', () => {
  const WEBM = { name: 'Blue_Origin_launch.webm', size: 42 * 1024 * 1024, type: 'video/webm' };
  const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
  async function ready(h) { await tick(); await tick(); await tick(); }
  function choose(h, file) { const input = h.element('mediaFile'); input.files = [file]; input.onchange.call(input); }
  function authorize(h, on = true) { const box = h.element('mediaConsent'); box.checked = on; box.onchange.call(box); }
  const reason = h => h.element('mediaBlockedReason').textContent;

  test('1. valid WebM + authorization + capability available -> ENABLED', async () => {
    const h = harness({ capability: CONFIGURED });
    await ready(h);
    choose(h, WEBM);
    authorize(h);
    assert.equal(h.element('mediaUploadBtn').disabled, false);
    assert.equal(reason(h), '', 'nothing is blocking, so nothing is explained');
  });

  test('2. valid WebM + NO authorization -> disabled, and says so', async () => {
    const h = harness({ capability: CONFIGURED });
    await ready(h);
    choose(h, WEBM);
    assert.equal(h.element('mediaUploadBtn').disabled, true);
    assert.match(reason(h), /Confirm organizational authorization/);
  });

  test('3. authorization + NO valid media -> disabled, and says so', async () => {
    const h = harness({ capability: CONFIGURED });
    await ready(h);
    authorize(h);
    assert.equal(h.element('mediaUploadBtn').disabled, true);
    assert.match(reason(h), /Choose a video or audio file/);
  });

  test('4. valid WebM + authorization + capability UNAVAILABLE -> disabled with an explicit reason', async () => {
    const h = harness({ capability: UNCONFIGURED });
    await ready(h);
    choose(h, WEBM);
    authorize(h);
    assert.equal(h.element('mediaUploadBtn').disabled, true);
    // The exact "mysteriously disabled button" the acceptance run hit.
    assert.match(reason(h), /not yet configured for this environment/);
    assert.match(reason(h), /R2_ACCOUNT_ID/, 'names the missing configuration');
    assert.match(reason(h), /supported format/, 'and confirms the file itself was fine');
    assert.match(h.element('mediaStatus').textContent, /This file is accepted\.$/, 'must not promise an upload that is switched off');
  });

  test('5. capability arriving BEFORE file selection leaves the right state', async () => {
    const h = harness({ capability: CONFIGURED });
    await ready(h);
    assert.match(reason(h), /Choose a video or audio file/);
    choose(h, WEBM);
    authorize(h);
    assert.equal(h.element('mediaUploadBtn').disabled, false);
  });

  test('6. capability arriving AFTER file selection leaves the right state', async () => {
    const gate = deferred();
    const h = harness({ capability: CONFIGURED, deferCapability: gate });
    await ready(h);
    // Manager gets ahead of the probe: file chosen and authorized first.
    choose(h, WEBM);
    authorize(h);
    assert.equal(h.element('mediaUploadBtn').disabled, true, 'still unknown, so still off');
    assert.match(reason(h), /could not be checked|not yet configured/);
    gate.resolve();
    for (let i = 0; i < 10; i++) await tick();
    assert.equal(h.element('mediaUploadBtn').disabled, false, 'enables once the probe confirms a real pipeline');
    assert.equal(reason(h), '');
  });

  test('7. ticking and unticking authorization recalculates the button', async () => {
    const h = harness({ capability: CONFIGURED });
    await ready(h);
    choose(h, WEBM);
    authorize(h, true);
    assert.equal(h.element('mediaUploadBtn').disabled, false);
    authorize(h, false);
    assert.equal(h.element('mediaUploadBtn').disabled, true);
    assert.match(reason(h), /Confirm organizational authorization/);
  });

  test('8. changing the file recalculates the button', async () => {
    const h = harness({ capability: CONFIGURED });
    await ready(h);
    authorize(h);
    choose(h, WEBM);
    assert.equal(h.element('mediaUploadBtn').disabled, false);
    // Swapping in an unsupported file must switch it back off.
    choose(h, { name: 'installer.exe', size: 1024, type: 'application/x-msdownload' });
    assert.equal(h.element('mediaUploadBtn').disabled, true);
    assert.match(reason(h), /Choose a video or audio file/);
  });

  test('9. missing credentials can never produce an enabled button, whatever the manager does', async () => {
    const h = harness({ capability: UNCONFIGURED });
    await ready(h);
    for (let attempt = 0; attempt < 3; attempt++) {
      choose(h, WEBM);
      authorize(h, true);
      authorize(h, false);
      authorize(h, true);
      assert.equal(h.element('mediaUploadBtn').disabled, true, 'no sequence of UI actions may fake a pipeline');
    }
    assert.equal(h.xhrs.length, 0);
  });

  test('10. a failed capability check is reported differently from missing credentials', async () => {
    const h = harness({ capability: CONFIGURED, slowCapability: true });
    await ready(h);
    choose(h, WEBM);
    authorize(h);
    assert.equal(h.element('mediaUploadBtn').disabled, true);
    assert.match(reason(h), /could not be checked/, 'a failed probe must not be reported as missing credentials');
  });
});
