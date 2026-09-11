import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Knowledge Chat has one deterministic Edge implementation and parser-ordered versioned runtime',()=>{
  const edgeFiles=readdirSync(new URL('../netlify/edge-functions/',import.meta.url)).filter(name=>name.startsWith('knowledge-chat-training-engine.'));
  assert.deepEqual(edgeFiles,['knowledge-chat-training-engine.mjs']);
  const edge=read('netlify/edge-functions/knowledge-chat-training-engine.mjs'),loader=read('knowledge-training-engine-loader.js'),netlify=read('netlify.toml');
  assert.match(edge,/knowledge-training-engine-loader\.js\?v=20260911-recovery2/);
  assert.match(edge,/knowledge-training-engine\.js\?v=20260911-recovery2/);
  assert.ok(edge.indexOf('knowledge-training-engine-loader.js')<edge.indexOf('knowledge-training-engine.js'),'bridge must load before engine');
  assert.match(edge,/cache-control','no-store'/);
  assert.match(netlify,/function = "knowledge-chat-training-engine"\s+path = "\/knowledge-chat\.html"/);
  assert.match(netlify,/function = "knowledge-chat-training-engine"\s+path = "\/knowledge-chat"/);
  assert.doesNotMatch(loader,/createElement\(['"]script/,'loader must not dynamically race the engine');
  assert.doesNotMatch(loader,/knowledge-training-engine\.js/,'the Edge response owns the one deterministic engine load');
});

test('/knowledge exposes a clear Company Training Library Question Bank entry',()=>{
  const page=read('knowledge.html');
  assert.match(page,/Question Bank · Company Training Library/);
  assert.match(page,/href="knowledge-chat\.html\?pilot=1"/);
  assert.match(page,/Open Question Bank →/);
});

test('base Question Bank renderer uses a valid persisted-bank date fallback',()=>{
  const page=read('knowledge-chat.html');
  assert.match(page,/bank\.generatedAt \|\| bank\.updatedAt \|\| bank\.createdAt/);
  assert.doesNotMatch(page,/\$\{new Date\(bank\.generatedAt\)\.toLocaleDateString\(\)\}/);
});
