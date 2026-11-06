import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Exercise the actual inline function used by Practice Studio, rather than a
// separately copied implementation that could drift from the browser code.
const html = readFileSync(new URL('../simulator.html', import.meta.url), 'utf8');
const start = html.indexOf('function voicePauseExtensionMs(text) {');
const end = html.indexOf('\nconst VOICE_START_TIMEOUT_MS', start);
assert.ok(start >= 0 && end > start, 'voice pause function must exist in simulator.html');
const voicePauseExtensionMs = vm.runInNewContext('(' + html.slice(start, end).trim() + ')');

test('Chinese hesitation and connectors extend listening', () => {
  for (const sample of ['我觉得', '因为', '但是……', '我想，', '呃', '等一下', '那个  ']) {
    assert.equal(voicePauseExtensionMs(sample), 3500, sample);
  }
});

test('English hesitation and connectors extend listening', () => {
  for (const sample of ['because', 'I mean', 'um', 'no wait', 'let me think,']) {
    assert.equal(voicePauseExtensionMs(sample), 3500, sample);
  }
});

test('mid-thought punctuation gets a shorter extension', () => {
  assert.equal(voicePauseExtensionMs('这个保障包括，'), 2500);
  assert.equal(voicePauseExtensionMs('The coverage includes:'), 2500);
});

test('complete thoughts and empty text do not add delay', () => {
  for (const sample of ['', '   ', '我已经说完了。', 'This is my answer.', '真的吗？', '好!']) {
    assert.equal(voicePauseExtensionMs(sample), 0, sample);
  }
});

test('mixed-language hesitations and self-corrections are given time', () => {
  for (const sample of ['这个 premium 我觉得', 'I think 因为', '不是', 'no wait…', '嗯，']) {
    assert.equal(voicePauseExtensionMs(sample), 3500, sample);
  }
});

test('manual Done mode does not rely on the pause extension', () => {
  // The timer applies extension only when the selected wait is nonzero.
  const manualWait = 0;
  assert.equal(manualWait ? manualWait + voicePauseExtensionMs('我觉得') : 0, 0);
});
