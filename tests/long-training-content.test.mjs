// Long Training Content Fast Track — coverage for removing the 30,000-
// character silent truncation on Company Knowledge, deterministic chunking,
// integrity metadata, chunk-aware long-source AI Analysis, and continued
// source-grounded Coach compatibility.
//
// See docs/engineering/long-training-content-fast-track-2026-09-13.md.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { getStore, __resetAllStores } from './stubs/netlify-blobs.mjs';
import { __setUser } from './stubs/netlify-identity.mjs';
import {
  MAX_SOURCE_CHARS,
  SOURCE_SCHEMA_VERSION,
  normalizeSourceText,
  sourceLengthError,
  sha256Hex,
  chunkSource,
  buildIntegrityMetadata,
  groupChunksForAnalysis,
  planSourceAnalysis
} from '../netlify/functions/lib/knowledge-source.mjs';
import dataHandler from '../netlify/functions/pilot-data.mjs';
import analyzeHandler from '../netlify/functions/knowledge-analyze.mjs';
import { relevantContent } from '../netlify/functions/pilot-coach-source.mjs';
import groundedHandler from '../netlify/functions/pilot-coach-source.mjs';

const manager = () => __setUser({ id: 'manager-a', email: 'manager@example.test', roles: ['manager'], appMetadata: { team_id: 'test-team' } });
const req = (input, path = 'pilot-data?resource=knowledge', method = 'POST') =>
  new Request('https://example.test/.netlify/functions/' + path, { method, headers: { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(input) });

// ---------------------------------------------------------------------------
// Synthetic long transcript with unique markers near the beginning, middle,
// and end — specifically to catch a head/tail-only omission bug.
// ---------------------------------------------------------------------------
const BEGIN_TAG = 'BEGIN-MARKER-UNIQUE-77F3';
const MID_TAG = 'MIDDLE-MARKER-UNIQUE-91Q2';
const END_TAG = 'END-MARKER-UNIQUE-42K9';
function filler(n) {
  let out = '';
  while (out.length < n) out += 'This paragraph is routine training filler text about general company policy and procedure.\n\n';
  return out.slice(0, n);
}
function buildLongDocument(totalChars = 120000) {
  const begin = `${BEGIN_TAG}: The opening compliance clause references code Z1-ALPHA.\n\n`;
  const mid = `${MID_TAG}: Underwriters must apply the Q2-FORTRESS exception for this specific case.\n\n`;
  const end = `${END_TAG}: The closing appendix cites regulation K9-OMEGA.`;
  const remaining = totalChars - begin.length - mid.length - end.length;
  // No leading/trailing whitespace in the result: normalizeSourceText()
  // trims the whole document, so tests that assert on exact doc.length
  // must compare against the same already-normalized string.
  return begin + filler(Math.floor(remaining / 2)) + mid + filler(Math.ceil(remaining / 2)) + end;
}

// ---------------------------------------------------------------------------
// 1. Pure chunking/integrity library
// ---------------------------------------------------------------------------
describe('lib/knowledge-source.mjs', () => {
  test('normalizeSourceText standardizes line endings and trims without dropping content', () => {
    assert.equal(normalizeSourceText('  a\r\nb\rc\n  '), 'a\nb\nc');
  });

  test('sourceLengthError is null within the limit and a clear bilingual, non-truncating error over it', () => {
    assert.equal(sourceLengthError(MAX_SOURCE_CHARS, MAX_SOURCE_CHARS), null);
    const err = sourceLengthError(MAX_SOURCE_CHARS + 1, MAX_SOURCE_CHARS);
    assert.equal(err.status, 413);
    assert.match(err.message, /exceeds the current Pilot limit/);
    assert.match(err.message, /NOT truncated or partially saved/);
    assert.match(err.message, /系统没有截断或部分保存该资料/);
  });

  test('sha256Hex matches node:crypto directly', () => {
    const text = 'hello world';
    assert.equal(sha256Hex(text), createHash('sha256').update(text, 'utf8').digest('hex'));
  });

  test('chunkSource is deterministic for the same input', () => {
    const doc = buildLongDocument(50000);
    const a = chunkSource(doc, { knowledgeId: 'k1' });
    const b = chunkSource(doc, { knowledgeId: 'k1' });
    assert.deepEqual(a, b);
    assert.ok(a.length > 1);
  });

  test('chunkSource retains order, exact offsets, and full coverage with no gaps', () => {
    const doc = buildLongDocument(50000);
    const chunks = chunkSource(doc, { knowledgeId: 'k1' });
    for (let i = 0; i < chunks.length; i++) {
      assert.equal(chunks[i].index, i);
      assert.equal(doc.slice(chunks[i].startOffset, chunks[i].endOffset), chunks[i].text);
      if (i > 0) assert.ok(chunks[i].startOffset <= chunks[i - 1].endOffset, 'no gap between consecutive chunks');
    }
    assert.equal(chunks[0].startOffset, 0);
    assert.equal(chunks[chunks.length - 1].endOffset, doc.length);
  });

  test('chunkSource never alters chunk text vs. the source it was sliced from', () => {
    const doc = buildLongDocument(30000);
    const chunks = chunkSource(doc, { knowledgeId: 'k1' });
    const stitched = chunks.map(c => c.text).join('');
    // Every chunk's characters are a verbatim slice of doc (already checked
    // above); this additionally checks nothing outside the chunk set exists.
    assert.ok(stitched.length >= doc.length, 'no content lost across chunk boundaries');
  });

  test('BEGIN / MIDDLE / END markers each survive into at least one chunk', () => {
    const doc = buildLongDocument(120000);
    const chunks = chunkSource(doc, { knowledgeId: 'k1' });
    for (const tag of [BEGIN_TAG, MID_TAG, END_TAG]) {
      const hit = chunks.find(c => c.text.includes(tag));
      assert.ok(hit, `${tag} must survive chunking`);
    }
    // The bug this fixes is specifically head/tail omission of the middle -
    // assert the middle marker is not merely in chunk 0 or the last chunk.
    const midChunk = chunks.find(c => c.text.includes(MID_TAG));
    assert.notEqual(midChunk.index, 0);
    assert.notEqual(midChunk.index, chunks.length - 1);
  });

  test('buildIntegrityMetadata reflects the actual stored text, not a truncated copy', () => {
    const doc = buildLongDocument(120000);
    const meta = buildIntegrityMetadata(doc, 'k1');
    assert.equal(meta.sourceSchemaVersion, SOURCE_SCHEMA_VERSION);
    assert.equal(meta.contentLength, doc.length);
    assert.equal(meta.contentSha256, sha256Hex(doc));
    assert.equal(meta.chunkCount, chunkSource(doc, { knowledgeId: 'k1' }).length);
    assert.ok(meta.chunkCount > 1);
  });

  test('groupChunksForAnalysis covers every fine chunk exactly once with no gaps, bounding call count', () => {
    const doc = buildLongDocument(200000);
    const chunks = chunkSource(doc, { knowledgeId: 'k1' });
    const batches = groupChunksForAnalysis(chunks);
    assert.ok(batches.length < chunks.length, 'batching must reduce call count vs. one call per fine chunk');
    assert.equal(batches[0].startOffset, 0);
    assert.equal(batches[batches.length - 1].endOffset, doc.length);
    for (let i = 1; i < batches.length; i++) assert.ok(batches[i].startOffset <= batches[i - 1].endOffset);
    for (const tag of [BEGIN_TAG, MID_TAG, END_TAG]) {
      assert.ok(batches.some(b => b.text.includes(tag)), `${tag} must reach some analysis batch`);
    }
    // The middle marker must not only reach the first or last batch.
    const midBatch = batches.find(b => b.text.includes(MID_TAG));
    assert.notEqual(midBatch.index, 0);
    assert.notEqual(midBatch.index, batches.length - 1);
  });

  test('planSourceAnalysis takes the short single-call path at/under the limit, long path over it', () => {
    const short = planSourceAnalysis('a'.repeat(100), { shortLimit: 7500 });
    assert.equal(short.mode, 'short');
    assert.equal(short.text.length, 100);
    const long = planSourceAnalysis(buildLongDocument(120000), { shortLimit: 7500 });
    assert.equal(long.mode, 'long');
    assert.ok(long.batches.length > 1);
  });
});

// ---------------------------------------------------------------------------
// 2. Storage: pilot-data.mjs "knowledge" create action
// ---------------------------------------------------------------------------
describe('pilot-data.mjs knowledge storage (no silent truncation)', () => {
  test('a source over 30,000 characters saves completely, with integrity metadata matching the stored content', async () => {
    __resetAllStores(); manager();
    const content = 'Sales training content.'.repeat(2000); // well over 30,000 chars, no trailing whitespace
    assert.ok(content.length > 30000);
    const res = await dataHandler(req({ action: 'create', title: 'Long Source', sourceType: 'document_notes', content, consentConfirmed: true }));
    assert.equal(res.status, 201);
    const { source } = await res.json();
    assert.equal(source.content.length, content.length);
    assert.equal(source.content, content.trim());
    assert.equal(source.contentLength, source.content.length);
    assert.equal(source.contentSha256, sha256Hex(source.content));
    assert.equal(source.sourceSchemaVersion, SOURCE_SCHEMA_VERSION);
    assert.ok(source.chunkCount >= 1);
    // Also confirm what is actually persisted (not just the response echo).
    const store = getStore({ name: 'agentraining-pilot' });
    const stored = await store.get(`teams/test-team/knowledge/${source.id}`, { type: 'json' });
    assert.equal(stored.content.length, content.length);
  });

  test('a source over 500,000 characters is rejected clearly and never saved', async () => {
    __resetAllStores(); manager();
    const oversized = 'x'.repeat(MAX_SOURCE_CHARS + 1);
    const res = await dataHandler(req({ action: 'create', title: 'Too Big', sourceType: 'document_notes', content: oversized, consentConfirmed: true }));
    assert.equal(res.status, 413);
    const body = await res.json();
    assert.match(body.error, /exceeds the current Pilot limit/);
    assert.match(body.error, /NOT truncated or partially saved/);
    assert.match(body.error, /系统没有截断或部分保存该资料/);
    const store = getStore({ name: 'agentraining-pilot' });
    const { blobs } = await store.list({ prefix: 'teams/test-team/knowledge/' });
    assert.equal(blobs.length, 0, 'rejected oversized content must not be saved, not even partially');
  });

  test('a rejected oversized create never overwrites or disturbs an existing valid record', async () => {
    __resetAllStores(); manager();
    const good = await (await dataHandler(req({ action: 'create', title: 'Existing Good Record', sourceType: 'document_notes', content: 'A perfectly fine short training note.', consentConfirmed: true }))).json();
    const before = await getStore({ name: 'agentraining-pilot' }).get(`teams/test-team/knowledge/${good.source.id}`, { type: 'json' });

    const res = await dataHandler(req({ action: 'create', title: 'Bad', sourceType: 'document_notes', content: 'x'.repeat(MAX_SOURCE_CHARS + 1), consentConfirmed: true }));
    assert.equal(res.status, 413);

    const after = await getStore({ name: 'agentraining-pilot' }).get(`teams/test-team/knowledge/${good.source.id}`, { type: 'json' });
    assert.deepEqual(after, before);
    const { blobs } = await getStore({ name: 'agentraining-pilot' }).list({ prefix: 'teams/test-team/knowledge/' });
    assert.equal(blobs.length, 1, 'only the original good record exists');
  });

  test('a source exactly at the limit is accepted (boundary is inclusive)', async () => {
    __resetAllStores(); manager();
    const content = 'y'.repeat(MAX_SOURCE_CHARS);
    const res = await dataHandler(req({ action: 'create', title: 'Exactly At Limit', sourceType: 'document_notes', content, consentConfirmed: true }));
    assert.equal(res.status, 201);
  });

  test('existing Company Knowledge records without knowledge-source-v2 metadata remain readable', async () => {
    __resetAllStores(); manager();
    const store = getStore({ name: 'agentraining-pilot' });
    // Shape of a genuinely pre-existing record: no contentLength/contentSha256/
    // chunkCount/sourceSchemaVersion fields at all.
    const legacy = { id: 'legacy-1', teamId: 'test-team', title: 'Legacy Banner Doc', sourceType: 'document_notes', sourceUrl: '', content: 'Legacy content saved before this feature existed.', consentConfirmed: true, status: 'approved', analysis: { summary: 'ok', practiceDraft: { title: 'ok' } }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', createdBy: 'manager@example.test', approvedAt: '2026-01-01T00:00:00.000Z', approvedBy: 'manager@example.test' };
    await store.setJSON('teams/test-team/knowledge/legacy-1', legacy);
    const res = await dataHandler(req({}, 'pilot-data?resource=knowledge', 'GET'));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.sources.length, 1);
    assert.equal(body.sources[0].id, 'legacy-1');
  });
});

// ---------------------------------------------------------------------------
// 3. Chunk-aware long-source AI Analysis (both backends)
// ---------------------------------------------------------------------------
function markerKeyPointsFromText(text) {
  return [BEGIN_TAG, MID_TAG, END_TAG].filter(tag => text.includes(tag));
}

describe('knowledge-analyze.mjs (OpenAI) long-source AI Analysis', () => {
  test('a short source (<= 7,500 chars) keeps the original single-call behavior', async () => {
    __resetAllStores(); manager(); process.env.OPENAI_API_KEY = 'synthetic';
    const store = getStore({ name: 'agentraining-pilot' });
    const content = 'Short training note. '.repeat(50); // well under 7,500
    await store.setJSON('teams/test-team/knowledge/short-1', { id: 'short-1', teamId: 'test-team', title: 'Short', sourceType: 'document_notes', content, consentConfirmed: true, status: 'draft' });
    let calls = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      calls++;
      const body = JSON.parse(options.body);
      assert.match(body.input, new RegExp(content.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      return new Response(JSON.stringify({ output_text: JSON.stringify({ summary: 'A short summary.', keyPoints: ['a'], audience: 'Agents', quality: 'general', practiceDraft: { title: 'T', situation: 'S', objective: 'O', clientName: 'C', clientOpening: 'Hi', successCriteria: ['x'] } }) }), { status: 200 });
    };
    try {
      const res = await analyzeHandler(req({ id: 'short-1' }, 'knowledge-analyze'));
      assert.equal(res.status, 200);
      assert.equal(calls, 1, 'short sources must not be chunked into multiple calls');
    } finally { globalThis.fetch = original; delete process.env.OPENAI_API_KEY; }
  });

  test('a long source (beginning/middle/end markers) is analyzed via multiple batches whose union covers all three markers, merged into one grounded result', async () => {
    __resetAllStores(); manager(); process.env.OPENAI_API_KEY = 'synthetic';
    const doc = buildLongDocument(120000);
    const store = getStore({ name: 'agentraining-pilot' });
    await store.setJSON('teams/test-team/knowledge/long-1', { id: 'long-1', teamId: 'test-team', title: 'Long', sourceType: 'document_notes', content: doc, consentConfirmed: true, status: 'draft' });
    const seenMarkers = new Set();
    let extractionCalls = 0, mergeCalls = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      if (body.input.includes('SECTION FINDINGS:')) {
        mergeCalls++;
        const findingsJson = JSON.parse(body.input.slice(body.input.indexOf('SECTION FINDINGS:') + 'SECTION FINDINGS:'.length));
        const allPoints = findingsJson.flatMap(f => f.keyPoints);
        return new Response(JSON.stringify({ output_text: JSON.stringify({ summary: 'Synthesis covering all sections.', keyPoints: allPoints.slice(0, 6), audience: 'Agents', quality: 'important', practiceDraft: { title: 'T', situation: 'S', objective: 'O', clientName: 'C', clientOpening: 'Hi', successCriteria: ['x'] } }) }), { status: 200 });
      }
      extractionCalls++;
      const found = markerKeyPointsFromText(body.input);
      found.forEach(m => seenMarkers.add(m));
      return new Response(JSON.stringify({ output_text: JSON.stringify({ summary: 'Section summary.', keyPoints: found }) }), { status: 200 });
    };
    try {
      const res = await analyzeHandler(req({ id: 'long-1' }, 'knowledge-analyze'));
      assert.equal(res.status, 200);
      const { source } = await res.json();
      assert.ok(extractionCalls > 1, 'a long source must be split into multiple extraction calls');
      assert.equal(mergeCalls, 1, 'exactly one merge/synthesis call combines all batch findings');
      assert.deepEqual(seenMarkers, new Set([BEGIN_TAG, MID_TAG, END_TAG]), 'all three markers must reach some extraction call, not only the beginning/end');
      assert.ok([BEGIN_TAG, MID_TAG, END_TAG].every(tag => source.analysis.keyPoints.some(k => k.includes(tag))), 'the merged, manager-facing analysis must incorporate evidence from the middle, not only the beginning/end');
    } finally { globalThis.fetch = original; delete process.env.OPENAI_API_KEY; }
  });
});

describe('pilot-data.mjs analyzeKnowledgeSource (Claude) long-source AI Analysis', () => {
  test('a source at or under the historical 30,000-character single-call size keeps identical single-call behavior', async () => {
    __resetAllStores(); manager(); process.env.ANTHROPIC_API_KEY = 'synthetic';
    const store = getStore({ name: 'agentraining-pilot' });
    const content = 'Short training note. '.repeat(50);
    await store.setJSON('teams/test-team/knowledge/short-2', { id: 'short-2', teamId: 'test-team', title: 'Short', sourceType: 'document_notes', content, consentConfirmed: true, status: 'draft' });
    let calls = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      calls++;
      const body = JSON.parse(options.body);
      assert.ok(body.messages[0].content.includes(content), 'the full short source must be sent verbatim, exactly as before');
      return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ summary: 'ok summary', keyPoints: ['a'], audience: 'Agents', quality: 'general', practiceDraft: { title: 'T', situation: 'S', objective: 'O', clientName: 'C', clientOpening: 'Hi', successCriteria: ['x'] } }) }] }), { status: 200 });
    };
    try {
      const res = await dataHandler(req({ action: 'analyze', id: 'short-2' }));
      assert.equal(res.status, 200);
      assert.equal(calls, 1);
    } finally { globalThis.fetch = original; delete process.env.ANTHROPIC_API_KEY; }
  });

  test('a long source (> 30,000 chars) is analyzed via chunk-aware batches covering beginning, middle, and end', async () => {
    __resetAllStores(); manager(); process.env.ANTHROPIC_API_KEY = 'synthetic';
    const doc = buildLongDocument(120000);
    const store = getStore({ name: 'agentraining-pilot' });
    await store.setJSON('teams/test-team/knowledge/long-2', { id: 'long-2', teamId: 'test-team', title: 'Long', sourceType: 'document_notes', content: doc, consentConfirmed: true, status: 'draft' });
    const seenMarkers = new Set();
    let extractionCalls = 0, mergeCalls = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      const prompt = body.messages[body.messages.length - 1].content;
      if (prompt.includes('SECTION FINDINGS IN ORIGINAL ORDER')) {
        mergeCalls++;
        const findingsJson = JSON.parse(prompt.slice(prompt.indexOf('SECTION FINDINGS IN ORIGINAL ORDER:') + 'SECTION FINDINGS IN ORIGINAL ORDER:'.length));
        const allPoints = findingsJson.flatMap(f => f.keyPoints);
        return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ summary: 'Synthesis.', keyPoints: allPoints.slice(0, 8), audience: 'Agents', quality: 'important', practiceDraft: { title: 'T', situation: 'S', objective: 'O', clientName: 'C', clientOpening: 'Hi', successCriteria: ['x'] } }) }] }), { status: 200 });
      }
      extractionCalls++;
      const found = markerKeyPointsFromText(prompt);
      found.forEach(m => seenMarkers.add(m));
      return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify({ summary: 'section', keyPoints: found }) }] }), { status: 200 });
    };
    try {
      const res = await dataHandler(req({ action: 'analyze', id: 'long-2' }));
      assert.equal(res.status, 200);
      const { source } = await res.json();
      assert.ok(extractionCalls > 1);
      assert.equal(mergeCalls, 1);
      assert.deepEqual(seenMarkers, new Set([BEGIN_TAG, MID_TAG, END_TAG]));
      assert.ok([BEGIN_TAG, MID_TAG, END_TAG].every(tag => source.analysis.keyPoints.some(k => k.includes(tag))));
    } finally { globalThis.fetch = original; delete process.env.ANTHROPIC_API_KEY; }
  });
});

// ---------------------------------------------------------------------------
// 4. Source-grounded Coach: middle-of-long-document retrieval
// ---------------------------------------------------------------------------
describe('pilot-coach-source.mjs stays compatible with long sources', () => {
  test('relevantContent() retrieves a fact that exists only in the middle of a long document', () => {
    const doc = buildLongDocument(120000);
    const excerpt = relevantContent(doc, 'What is the Q2-FORTRESS exception underwriters must apply?', '', 14000);
    assert.match(excerpt, new RegExp(MID_TAG));
    assert.match(excerpt, /Q2-FORTRESS/);
  });

  test('the full grounded Coach handler sends a middle-chunk excerpt to the model and can PASS on it', async () => {
    __resetAllStores();
    const doc = buildLongDocument(120000);
    const store = getStore({ name: 'agentraining-pilot' });
    const assignment = { id: 'assignment-long', assignedTo: 'learner@example.test', sourceType: 'company_knowledge', sourceKnowledgeId: 'long-source', scenarioName: 'Underwriting Deep Dive', status: 'Assigned', createdAt: '2026-09-10' };
    await store.setJSON('teams/test-team/assignments/assignment-long', assignment);
    await store.setJSON('teams/test-team/knowledge/long-source', { id: 'long-source', teamId: 'test-team', title: 'Underwriting Manual', status: 'approved', content: doc });
    __setUser({ id: 'learner-a', email: 'learner@example.test', roles: ['learner'], appMetadata: { team_id: 'test-team' } });
    process.env.ANTHROPIC_API_KEY = 'synthetic';
    const calls = [];
    const original = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push(body);
      const isVerifier = body.system.includes('strict evidence verifier');
      const text = isVerifier ? JSON.stringify({ status: 'PASS', reason: 'Directly supported by the source excerpt.' }) : 'Underwriters must apply the Q2-FORTRESS exception for this case.';
      return new Response(JSON.stringify({ content: [{ type: 'text', text }] }), { status: 200 });
    };
    try {
      const res = await groundedHandler(req({ assignmentId: 'assignment-long', sourceKnowledgeId: 'long-source', message: 'What exception should I apply here?' }, 'pilot-coach-source'));
      assert.equal(res.status, 201);
      const body = await res.json();
      assert.equal(body.verification.status, 'PASS');
      assert.match(body.assistantMessage.content, /Q2-FORTRESS/);
      // The system prompt sent to the model must actually carry the middle
      // marker's excerpt - proof the long-source content was not truncated
      // away before it ever reached retrieval.
      assert.ok(calls[0].system.includes(MID_TAG), 'the middle-of-document excerpt must reach the model');
    } finally { globalThis.fetch = original; delete process.env.ANTHROPIC_API_KEY; }
  });
});
