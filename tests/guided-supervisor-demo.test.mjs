import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'guided-supervisor-demo.html'), 'utf8');

test('guided supervisor demo contains valid JavaScript', () => {
  const inline = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
  assert.equal(inline.length, 1, 'single self-contained controller expected');
  assert.doesNotThrow(() => new vm.Script(inline[0][1], { filename: 'guided-supervisor-demo.html' }));
});

test('all guided scenes resolve to existing in-repo pages', () => {
  const routes = [...source.matchAll(/\burl:'([^']+\.html(?:\?[^']*)?)'/g)].map(m => m[1]);
  assert.equal(routes.length, 6, 'expected six agreed presentation scenes');
  for (const route of routes) {
    const [pathname] = route.split('?');
    assert.match(pathname, /^[a-z0-9-]+\.html$/);
    assert.ok(fs.existsSync(path.join(root, pathname)), `Missing guided route: ${route}`);
  }
});

test('tour has playback and manual navigation controls', () => {
  for (const id of ['prev', 'toggle', 'next', 'screen', 'open', 'count', 'time'])
    assert.match(source, new RegExp(`id=["']${id}["']`));
  assert.match(source, /setInterval\(tick,1000\)/);
  assert.match(source, /visibilitychange/);
});

test('guided controller never submits or changes user data', () => {
  const inline = source.match(/<script>([\s\S]*?)<\/script>/)?.[1] || '';
  assert.ok(inline, 'inline controller is required');
  assert.doesNotMatch(inline, /\b(?:fetch|XMLHttpRequest|sendBeacon)\s*\(/);
  assert.doesNotMatch(inline, /\b(?:localStorage|sessionStorage)\s*\./);
  assert.doesNotMatch(inline, /\bsubmit\s*\(/);
  assert.doesNotMatch(inline, /\.click\s*\(/);
});
