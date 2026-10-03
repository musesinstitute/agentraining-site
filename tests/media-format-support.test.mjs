// Pins the four layers that must agree about which media formats are
// supported. They drifted once already: the UI claimed WebM, the server
// accepted WebM, but a real .webm file could not be selected at all - so this
// file compares them directly rather than trusting each in isolation.
//
//   1. what the UI claims       (SUPPORTED_MEDIA_LABELS)
//   2. what the file chooser allows (knowledge.html accept attribute)
//   3. what browser-side JS accepts (the page's own allowlist)
//   4. what the server accepts  (ALLOWED_MEDIA_TYPES / EXTENSION_TYPES)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getStore, __resetAllStores } from './stubs/netlify-blobs.mjs';
import { __setUser } from './stubs/netlify-identity.mjs';
import reserveHandler from '../netlify/functions/media-upload-reserve.mjs';
import {
  ALLOWED_MEDIA_TYPES, EXTENSION_TYPES, MEDIA_ACCEPT_ATTRIBUTE,
  SUPPORTED_MEDIA_LABELS, resolveMediaType, validateMediaUploadRequest
} from '../netlify/functions/lib/media-ingestion.mjs';

const html = readFileSync(new URL('../knowledge.html', import.meta.url), 'utf8');
const acceptAttribute = (html.match(/id="mediaFile" type="file" accept="([^"]*)"/) || [])[1] || '';
const pageJson = name => JSON.parse((html.match(new RegExp('var ' + name + '=(\\{.*?\\});')) || [])[1] || 'null');
const pageTypeKinds = pageJson('MEDIA_TYPE_KINDS');
const pageExtTypes = pageJson('MEDIA_EXT_TYPES');

describe('layer 2: the HTML file chooser', () => {
  test('the media input exists and lists every allowed extension', () => {
    assert.ok(acceptAttribute, 'knowledge.html must have a media file input with an accept attribute');
    for (const extension of Object.keys(EXTENSION_TYPES)) {
      assert.ok(acceptAttribute.split(',').includes(extension), `accept must list ${extension}`);
    }
  });

  test('.webm and video/webm are both present - the exact acceptance blocker', () => {
    const entries = acceptAttribute.split(',');
    assert.ok(entries.includes('.webm'), 'a chooser without .webm greys out real WebM downloads');
    assert.ok(entries.includes('video/webm'));
  });

  test('it is not narrowed to video/mp4 or to MIME types alone', () => {
    const entries = acceptAttribute.split(',');
    assert.notEqual(acceptAttribute, 'video/mp4');
    assert.ok(entries.some(x => x.startsWith('.')), 'extensions must be offered too');
    assert.ok(entries.some(x => x.includes('/')), 'MIME types must be offered too');
    // A wildcard would let anything through - the allowlist must stay explicit.
    assert.ok(!acceptAttribute.includes('*'));
  });

  test('it matches the server-derived accept attribute exactly', () => {
    assert.equal(acceptAttribute, MEDIA_ACCEPT_ATTRIBUTE);
  });
});

describe('layer 3 vs layer 4: browser and server allowlists agree', () => {
  test('the page allows exactly the MIME types the server allows', () => {
    assert.deepEqual(Object.keys(pageTypeKinds).sort(), Object.keys(ALLOWED_MEDIA_TYPES).sort());
    for (const [type, kind] of Object.entries(pageTypeKinds)) assert.equal(kind, ALLOWED_MEDIA_TYPES[type].kind);
  });

  test('the page maps exactly the extensions the server maps', () => {
    assert.deepEqual(pageExtTypes, EXTENSION_TYPES);
  });
});

describe('layer 1: what the UI claims', () => {
  test('every claimed label is backed by a real allowlist entry', () => {
    const labels = new Set(Object.values(ALLOWED_MEDIA_TYPES).map(x => x.label));
    for (const label of SUPPORTED_MEDIA_LABELS) assert.ok(labels.has(label));
    for (const claimed of ['MP4', 'MOV', 'WebM', 'MP3', 'M4A', 'WAV']) {
      assert.ok(SUPPORTED_MEDIA_LABELS.includes(claimed), `${claimed} is claimed to users and must be supported`);
    }
  });
});

describe('layer 4: server-side type resolution is robust without being loose', () => {
  const supported = [
    ['WebM, correctly typed', 'video/webm', 'Blue_Origin_launch.webm', 'video/webm', 'video'],
    ['WebM, empty type from the OS', '', 'Blue_Origin_launch.webm', 'video/webm', 'video'],
    ['WebM, generic type', 'application/octet-stream', 'Blue_Origin_launch.webm', 'video/webm', 'video'],
    ['WebM, matroska-flavoured type', 'video/x-matroska', 'clip.webm', 'video/webm', 'video'],
    ['WebM with codec parameters', 'video/webm; codecs="vp9,opus"', 'clip.webm', 'video/webm', 'video'],
    ['MP4', 'video/mp4', 'training.mp4', 'video/mp4', 'video'],
    ['MOV', 'video/quicktime', 'training.mov', 'video/quicktime', 'video'],
    ['MOV, empty type', '', 'training.mov', 'video/quicktime', 'video'],
    ['MP3', 'audio/mpeg', 'session.mp3', 'audio/mpeg', 'audio'],
    ['M4A', 'audio/x-m4a', 'session.m4a', 'audio/x-m4a', 'audio'],
    ['M4A, empty type', '', 'session.m4a', 'audio/mp4', 'audio'],
    ['WAV', 'audio/wave', 'session.wav', 'audio/wave', 'audio'],
    ['uppercase extension', '', 'TRAINING.WEBM', 'video/webm', 'video']
  ];
  for (const [label, type, name, expectedType, expectedKind] of supported) {
    test(`${label} resolves to ${expectedType}`, () => {
      const resolved = resolveMediaType(type, name);
      assert.ok(resolved, `${label} must resolve`);
      assert.equal(resolved.contentType, expectedType);
      assert.equal(resolved.kind, expectedKind);
    });
  }

  const refused = [
    ['an executable', 'application/x-msdownload', 'installer.exe'],
    ['a document', 'application/pdf', 'slides.pdf'],
    ['a script disguised with a media-ish name', 'text/javascript', 'payload.webm.js'],
    ['an unlisted video container', 'video/x-msvideo', 'clip.avi'],
    ['no name and no type', '', '']
  ];
  for (const [label, type, name] of refused) {
    test(`${label} is still refused`, () => assert.equal(resolveMediaType(type, name), null));
  }
});

describe('media-upload-reserve accepts each claimed format', () => {
  const files = [
    ['WebM', 'Blue_Origin_launch.webm', 'video/webm'],
    ['WebM with no MIME type', 'Blue_Origin_launch.webm', ''],
    ['MP4', 'training.mp4', 'video/mp4'],
    ['MOV', 'training.mov', 'video/quicktime'],
    ['MP3', 'session.mp3', 'audio/mpeg'],
    ['M4A', 'session.m4a', 'audio/x-m4a'],
    ['WAV', 'session.wav', 'audio/wav']
  ];
  const reserve = body => reserveHandler(new Request('https://example.test/.netlify/functions/media-upload-reserve', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  }));

  function configure() {
    __resetAllStores();
    __setUser({ id: 'm', email: 'manager@team-a.test', roles: ['manager'], appMetadata: { team_id: 'team-a' } });
    process.env.R2_ACCOUNT_ID = 'test-account';
    process.env.R2_ACCESS_KEY_ID = 'TESTKEY';
    process.env.R2_SECRET_ACCESS_KEY = 'secret';
    process.env.R2_BUCKET_NAME = 'bucket';
    delete process.env.MEDIA_MAX_UPLOAD_BYTES;
  }

  for (const [label, fileName, contentType] of files) {
    test(`${label} is reserved, stored under the right kind, and signed for its resolved type`, async () => {
      configure();
      const response = await reserve({ fileName, contentType, sizeBytes: 42 * 1024 * 1024, consentConfirmed: true });
      assert.equal(response.status, 201, `${label} must be accepted by the server`);
      const body = await response.json();
      const expected = resolveMediaType(contentType, fileName);
      assert.equal(body.upload.headers['content-type'], expected.contentType);
      const record = await getStore({ name: 'agentraining-pilot' }).get(`teams/team-a/media/${body.media.mediaId}`, { type: 'json' });
      assert.equal(record.kind, expected.kind);
      assert.ok(record.storageKey.endsWith(expected.extension), `stored object keeps its ${expected.extension} extension`);
    });
  }

  test('an executable is still refused with 415 and no upload ticket', async () => {
    configure();
    const response = await reserve({ fileName: 'installer.exe', contentType: 'application/x-msdownload', sizeBytes: 1024 * 1024, consentConfirmed: true });
    assert.equal(response.status, 415);
    const body = await response.json();
    assert.equal(body.upload, undefined);
    assert.ok(body.supportedFormats.includes('WebM'));
  });

  test('validation reports the same verdict the resolver does, for every allowed type', () => {
    for (const type of Object.keys(ALLOWED_MEDIA_TYPES)) {
      const result = validateMediaUploadRequest({ fileName: 'file' + ALLOWED_MEDIA_TYPES[type].extension, contentType: type, sizeBytes: 1024 * 1024 });
      assert.equal(result.ok, true, `${type} must validate`);
    }
  });
});
