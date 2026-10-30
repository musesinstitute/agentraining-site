import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'guided-supervisor-demo.html'), 'utf8');
const inline = source.match(/<script>([\s\S]*?)<\/script>/)?.[1] || '';

test('guided manager demo has valid self-contained JavaScript', () => {
  assert.ok(inline, 'controller required');
  assert.equal([...source.matchAll(/<script(?:\s[^>]*)?>/g)].length, 1);
  assert.doesNotThrow(() => new vm.Script(inline));
});

test('original four executive manager chapters appear in their canonical order', () => {
  const orderedRoutes = [...source.matchAll(/\bkey:'[^']+',url:'([^']+)'/g)].map(m => m[1]);
  assert.deepEqual(orderedRoutes, [
    'manager-demo-opening.html',
    'manager-demo-hub.html',
    'manager-demo-phases.html',
    'mission-control-v2-1.html'
  ]);
  for (const route of orderedRoutes) {
    assert.ok(fs.existsSync(path.join(root, route)), 'Missing original manager page: '+route);
  }
  assert.match(inline, /CHAPTER /);
});

test('all seven management steps are explicitly demonstrated', () => {
  for (let n=0; n<7; n++) assert.match(inline, new RegExp("action:'phaseStep',item:"+n));
  assert.match(inline, /Step 7 \/ 7/);
});

test('Mission Control progresses through all five steps and synthetic reassessment', () => {
  const actions=['r-michelle','toStep2','toStep3','toStep4','toStep5','simBetter','openReassessReport'];
  for(const id of actions) assert.match(inline,new RegExp("id:'"+id+"'"));
  assert.match(inline, /key==='mission'/);
  assert.match(inline, /allowed\.includes\(beat\.id\)/);
});

test('player has control buttons, timed playback and direct-page fallback', () => {
  for(const id of ['prev','toggle','next','screen','open','count','time','progress']){
    assert.match(source,new RegExp('id="'+id+'"'));
  }
  assert.match(inline,/setInterval\(tick,1000\)/);
  assert.match(inline,/visibilitychange/);
  assert.match(inline,/if\(!playing\|\|!ready\)return/);
});

test('controller never sends requests, assignments or changes stored user data', () => {
  assert.doesNotMatch(inline,/\b(?:fetch|XMLHttpRequest|sendBeacon)\s*\(/);
  assert.doesNotMatch(inline,/\b(?:localStorage|sessionStorage)\s*\./);
  assert.doesNotMatch(inline,/\bsubmit\s*\(/);
  assert.doesNotMatch(inline,/\.form\.submit\(/);
  assert.doesNotMatch(inline,/\.location\s*=/);
  // Synthetic interactive fixtures only: the Library and Simulator are
  // optional direct links; the guided playback never clicks either page.
  assert.doesNotMatch(inline,/key==='simulator'/);
  assert.doesNotMatch(inline,/key==='knowledge'/);
  assert.match(inline,/key==='hub'/);
  assert.match(inline,/key==='phases'/);
  assert.match(inline,/key==='mission'/);
});
