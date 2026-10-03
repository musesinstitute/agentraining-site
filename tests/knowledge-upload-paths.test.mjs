// The test class that was missing when a live acceptance test failed while
// every existing test passed.
//
// Every prior UI test drove the page through a JS harness with a capability
// object already stubbed in, then programmatically clicked the tile. None of
// them asked the only question a human actually asks: WHAT IS ON THE PAGE WHEN
// IT LOADS? The answer used to be "a document uploader" - the whole Video/Audio
// identity (its label, its format list, its file chooser) was manufactured at
// runtime by an authenticated fetch, so a slow, failed or unauthenticated probe
// made a shipped feature indistinguishable from one that was never deployed.
//
// So these tests assert on the HTML a browser really receives - the repo file
// AFTER the knowledge-enterprise-upload edge function rewrites it - with no
// JavaScript executed and no credentials configured.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MEDIA_DISPLAY_FORMATS, DEFAULT_MAX_MEDIA_UPLOAD_BYTES, MEDIA_ACCEPT_ATTRIBUTE } from '../netlify/functions/lib/media-ingestion.mjs';

const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const source = read('knowledge.html');
const edgeSource = read('netlify/edge-functions/knowledge-enterprise-upload.ts');
const netlifyToml = read('netlify.toml');

// Applies the edge function's rewrites exactly as the deployed edge does.
function renderAsDeployed(html) {
  const unquote = s => s.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\`/g, '`').replace(/\\\\/g, '\\');
  const pairs = [...edgeSource.matchAll(/html = html\.replace\(\s*(['"`])([\s\S]*?)\1\s*,\s*(['"`])([\s\S]*?)\3\s*\)/g)];
  const unmatched = [];
  for (const [index, m] of pairs.entries()) {
    const from = unquote(m[2]);
    const to = unquote(m[4]);
    if (from.startsWith('</body>')) continue; // the injection (expression RHS), handled below
    if (!html.includes(from)) { unmatched.push(index); continue; }
    html = html.replace(from, to);
  }
  const injected = (edgeSource.match(/const enhancedUpload = `([\s\S]*?)`;/) || [])[1] || '';
  html = html.replace('</body>', injected + '</body>');
  return { html, unmatched };
}

const { html: deployed, unmatched } = renderAsDeployed(source);
const section = (start, end) => deployed.slice(deployed.indexOf(start), deployed.indexOf(end));
const guide = section('<div class="upload-guide">', '<form id="knowledgeForm">');
const pathB = section('<section class="media-panel"', '</section>');
const visibleText = fragment => fragment.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('what a manager sees on load: two clearly separated ingestion paths', () => {
  test('every edge rewrite still matches the page (a silent miss means the deployed page is not what we think)', () => {
    assert.deepEqual(unmatched, [], 'an unmatched edge rewrite means source and edge have drifted');
  });

  test('the Video/Audio path is VISIBLE without any JavaScript running', () => {
    const tag = deployed.match(/<section class="media-panel"[^>]*>/)[0];
    assert.ok(!/\bhidden\b/.test(tag), 'the media panel must not be hidden behind a click');
    assert.ok(pathB.includes('id="mediaFile"'), 'its file chooser must be on the page');
  });

  test('its supported formats are printed in the markup, not fetched at runtime', () => {
    const text = visibleText(pathB);
    for (const format of MEDIA_DISPLAY_FORMATS) {
      assert.ok(text.includes(format), `${format} must be visible without JavaScript`);
    }
    assert.match(text, /WebM/, 'the format that blocked acceptance must be visible');
    assert.match(text, /MP4/);
  });

  test('its size limit is printed too, and matches the server default', () => {
    assert.match(visibleText(pathB), new RegExp(`up to ${DEFAULT_MAX_MEDIA_UPLOAD_BYTES / (1024 * 1024)} MB per file`));
  });

  test('the two paths are distinct, separately headed sections', () => {
    const text = visibleText(guide);
    assert.match(text, /Upload company document or transcript/);
    assert.match(text, /Upload training video or audio/);
    assert.ok(text.indexOf('Upload company document or transcript') < text.indexOf('Upload training video or audio'));
    // Two different choosers, not one shared control.
    assert.equal((deployed.match(/<input[^>]*type="file"/g) || []).length, 2);
  });

  test('the document path keeps its own document formats and limit', () => {
    const pathA = guide.slice(0, guide.indexOf('<section class="media-panel"'));
    const text = visibleText(pathA);
    for (const format of ['PDF', 'Word', 'PowerPoint', 'TXT', 'MD', 'VTT', 'SRT']) assert.ok(text.includes(format), `${format} belongs to the document path`);
    assert.match(text, /10 MB per file/);
    // and must NOT advertise media formats
    assert.ok(!/\bMP4\b/.test(text) && !/\bWebM\b/.test(text), 'the document path must not claim media formats');
  });

  test('a manager can tell which chooser is which from the markup alone', () => {
    assert.match(pathB, /Training video or audio file/);
    assert.ok(/Upload (text transcript|company file)/.test(deployed), 'the document chooser keeps its own label');
  });

  test('the build marker identifies which media UI build is live', () => {
    assert.match(deployed, /data-build="[0-9]{8}-[a-z0-9]+"/);
    assert.match(visibleText(pathB), /Media upload UI build [0-9]{8}-[a-z0-9]+/);
  });
});

describe('the edge function cannot turn the media chooser into a document chooser', () => {
  test('no edge rewrite targets the media input, panel or accept list', () => {
    const froms = [...edgeSource.matchAll(/html = html\.replace\(\s*(['"`])([\s\S]*?)\1\s*,/g)].map(m => m[2]);
    for (const from of froms) {
      for (const guarded of ['mediaFile', 'mediaPanel', 'mediaFormatLine', 'MEDIA_TYPE_KINDS']) {
        assert.ok(!from.includes(guarded), `the edge function must never rewrite ${guarded}`);
      }
    }
  });

  test('the media accept list survives the edge rewrite byte for byte', () => {
    const deployedAccept = (deployed.match(/id="mediaFile" type="file" accept="([^"]*)"/) || [])[1];
    assert.equal(deployedAccept, MEDIA_ACCEPT_ATTRIBUTE);
    assert.ok(deployedAccept.split(',').includes('.webm'));
    assert.ok(deployedAccept.split(',').includes('video/webm'));
  });

  test('the document chooser is the one the edge rewrites, and it keeps document formats only', () => {
    const transcriptAccept = (deployed.match(/id="transcriptFile" type="file" accept="([^"]*)"/) || [])[1];
    assert.match(transcriptAccept, /\.pdf/, 'the edge rewrite of the document chooser still applies');
    assert.ok(!transcriptAccept.includes('.webm'), 'the document chooser must not claim media formats');
    assert.ok(!transcriptAccept.includes('video/'), 'and must not claim video MIME types');
  });
});

describe('routing: /knowledge.html and /knowledge resolve to this implementation', () => {
  test('both paths are bound to the same edge function', () => {
    const bindings = [...netlifyToml.matchAll(/function = "knowledge-enterprise-upload"\s*\n\s*path = "([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(bindings.sort(), ['/knowledge', '/knowledge.html']);
  });

  test('the page is served uncached, so a stale HTML copy cannot mask a deploy', () => {
    assert.match(edgeSource, /headers\.set\('cache-control','no-store'\)/);
  });
});

describe('nothing hides the Video/Audio path at runtime', () => {
  const pageScript = [...source.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).join('\n');

  test('no script sets mediaPanel.hidden = true', () => {
    assert.ok(!/mediaPanel'\)\.hidden\s*=\s*true/.test(pageScript));
    assert.ok(!/panel\.hidden\s*=\s*true/.test(pageScript));
  });

  test('the capability probe no longer decides whether the path exists', () => {
    // It may disable the button; it may not rewrite the path's identity.
    assert.ok(!/mediaUploadPreviewBtn/.test(pageScript), 'the click-to-reveal tile is gone');
    assert.match(pageScript, /button\.disabled\s*=\s*!!blocker/, 'it still gates the Upload button');
    // and the capability is one of the things that can block it
    assert.match(pageScript, /directUploadAvailable\)return 'not_configured'/);
  });

  test('upload is treated as unconfigured until proven otherwise, before any fetch resolves', () => {
    assert.match(pageScript, /applyMediaConfigState\(\);loadKnowledge\(\)/, 'fail-safe state is applied at boot');
  });
});
