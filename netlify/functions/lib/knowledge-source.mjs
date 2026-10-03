// Long Training Content Fast Track — shared, pure helpers for Company
// Knowledge long-source storage, integrity, and deterministic chunking.
//
// See docs/engineering/long-training-content-fast-track-2026-09-13.md.
//
// Deliberately dependency-free (no @netlify/blobs, no @netlify/identity, no
// fetch) so every function here is safe to import from any Netlify
// Function, any edge function, and from tests without needing to stub
// platform services.
//
// NO EVIDENCE, NO AUTHORITY: normalization below must never change the
// meaning of an authorized source. It only standardizes line endings and
// trims incidental leading/trailing whitespace of the whole document — it
// never collapses internal whitespace, reorders text, or drops characters.
// The normalized text this module produces is the same text that gets
// hashed, stored, and chunked — chunking and hashing must never run against
// anything other than this exact authoritative string.

import { createHash } from 'node:crypto';

export const SOURCE_SCHEMA_VERSION = 'knowledge-source-v2';

// ---------------------------------------------------------------------------
// Pilot limits. The server copy here is authoritative; client-side copies in
// knowledge.html, knowledge-chat.html, and the knowledge-enterprise-upload
// edge function must be kept numerically equal to these.
// ---------------------------------------------------------------------------
export const MAX_SOURCE_CHARS = 500000;
export const MAX_TRANSCRIPT_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

// Deterministic chunking (storage/retrieval-grade traceability).
export const CHUNK_TARGET_SIZE = 6000;
export const CHUNK_OVERLAP = 600;

// Coarser grouping used only to bound how many AI calls a long-source AI
// Analysis pass makes. Every batch is built strictly from the same
// fine-grained deterministic chunks above — analysis coverage always lines
// up with the same chunk boundaries used for storage/retrieval.
export const ANALYSIS_BATCH_CHAR_TARGET = 42000;
export const MAX_ANALYSIS_BATCHES = 14; // 14 * 42,000 chars comfortably covers MAX_SOURCE_CHARS

export function normalizeSourceText(raw) {
  return String(raw ?? '').replace(/\r\n?/g, '\n').trim();
}

function formatCount(n) {
  return n.toLocaleString('en-US');
}

// Returns null when `length` is within `max`, otherwise a plain Error with a
// bilingual (English + Chinese) message and a `status` for the HTTP reply —
// matching the "reject clearly, never truncate" rule from Phase 1.
export function sourceLengthError(length, max = MAX_SOURCE_CHARS) {
  if (length <= max) return null;
  const en = `This training source exceeds the current Pilot limit of ${formatCount(max)} characters (received ${formatCount(length)} characters). The source was NOT truncated or partially saved.`;
  const zh = `此培训资料超过当前 Pilot 支持的 ${formatCount(max)} 字符容量（收到 ${formatCount(length)} 字符）。系统没有截断或部分保存该资料。`;
  return Object.assign(new Error(`${en} / ${zh}`), { status: 413, code: 'source_too_long', maxChars: max, receivedChars: length });
}

export function sha256Hex(text) {
  return createHash('sha256').update(String(text ?? ''), 'utf8').digest('hex');
}

// Deterministic, paragraph-aware chunker.
//
// - Stable: the same text + the same options always produce the same
//   chunks — no randomness, no timestamps, no external input.
// - Retains source order and exact start/end character offsets into the
//   normalized text; offsets (not re-derived text) are the source of truth
//   for where a chunk sits in the original document.
// - Prefers to end a chunk on a paragraph boundary (blank line) or, failing
//   that, a line or sentence boundary, within a small backtrack window —
//   so a chunk only ends mid-sentence when no better boundary exists
//   nearby. This never changes the text itself, only where a chunk edge
//   falls.
// - Chunks overlap by `overlap` characters so evidence straddling a chunk
//   boundary still appears intact in at least one chunk.
export function chunkSource(text, { knowledgeId = '', targetSize = CHUNK_TARGET_SIZE, overlap = CHUNK_OVERLAP } = {}) {
  const normalized = normalizeSourceText(text);
  const length = normalized.length;
  if (!length) return [];
  const safeOverlap = Math.min(overlap, Math.floor(targetSize / 2));
  const backtrack = Math.min(400, Math.floor(targetSize * 0.15));
  const chunks = [];
  let start = 0;
  while (start < length) {
    let end = Math.min(length, start + targetSize);
    if (end < length) {
      const windowStart = Math.max(start + 1, end - backtrack);
      const slice = normalized.slice(windowStart, end);
      const paragraphBreak = slice.lastIndexOf('\n\n');
      const lineBreak = slice.lastIndexOf('\n');
      if (paragraphBreak !== -1) end = windowStart + paragraphBreak + 2;
      else if (lineBreak !== -1) end = windowStart + lineBreak + 1;
      else {
        const sentenceBreak = Math.max(slice.lastIndexOf('. '), slice.lastIndexOf('。'), slice.lastIndexOf('！'), slice.lastIndexOf('？'), slice.lastIndexOf('! '), slice.lastIndexOf('? '));
        if (sentenceBreak !== -1) end = windowStart + sentenceBreak + 1;
      }
    }
    if (end <= start) end = Math.min(length, start + targetSize); // safety net; never stalls
    const index = chunks.length;
    chunks.push({
      chunkId: `${knowledgeId || 'source'}-c${String(index + 1).padStart(4, '0')}`,
      knowledgeId,
      index,
      startOffset: start,
      endOffset: end,
      text: normalized.slice(start, end)
    });
    if (end >= length) break;
    const nextStart = Math.max(0, end - safeOverlap);
    start = nextStart > start ? nextStart : end; // guarantee forward progress
  }
  return chunks;
}

export function buildIntegrityMetadata(normalizedText, knowledgeId) {
  return {
    sourceSchemaVersion: SOURCE_SCHEMA_VERSION,
    contentLength: normalizedText.length,
    contentSha256: sha256Hex(normalizedText),
    chunkCount: chunkSource(normalizedText, { knowledgeId }).length
  };
}

// Groups the deterministic fine-grained chunks into larger, still-ordered
// batches for AI Analysis, bounding the number of model calls a long source
// needs instead of one call per fine chunk. Every fine chunk is represented
// exactly once in the reconstructed batch text (overlap between consecutive
// fine chunks is not duplicated across a batch boundary), so batches
// together cover the complete source with no gaps and no omitted middle.
export function groupChunksForAnalysis(chunks, { batchCharTarget = ANALYSIS_BATCH_CHAR_TARGET, maxBatches = MAX_ANALYSIS_BATCHES } = {}) {
  if (!chunks.length) return [];
  const batches = [];
  let current = null;
  for (const chunk of chunks) {
    const piece = current ? chunk.text.slice(Math.max(0, current.endOffset - chunk.startOffset)) : chunk.text;
    if (current && current.text.length + piece.length > batchCharTarget) {
      batches.push(current);
      current = null;
    }
    if (!current) current = { chunkIds: [], startOffset: chunk.startOffset, endOffset: chunk.startOffset, text: '' };
    const append = current.chunkIds.length ? chunk.text.slice(Math.max(0, current.endOffset - chunk.startOffset)) : chunk.text;
    current.chunkIds.push(chunk.chunkId);
    current.text += append;
    current.endOffset = chunk.endOffset;
  }
  if (current) batches.push(current);
  // Only reachable for sources far beyond MAX_SOURCE_CHARS: merge tail
  // batches together rather than ever dropping text.
  while (batches.length > maxBatches) {
    const last = batches.pop();
    const prev = batches[batches.length - 1];
    prev.text += last.text;
    prev.endOffset = last.endOffset;
    prev.chunkIds.push(...last.chunkIds);
  }
  return batches.map((b, i) => ({ index: i, startOffset: b.startOffset, endOffset: b.endOffset, chunkIds: b.chunkIds, text: b.text }));
}

// Decides whether a source is short enough to keep sending in a single AI
// call unchanged (existing, already-shipped behavior) or needs the
// chunk-aware long-source path. Keeping this as one shared decision point
// means every caller applies the exact same threshold semantics.
export function planSourceAnalysis(normalizedText, { shortLimit }) {
  if (normalizedText.length <= shortLimit) return { mode: 'short', text: normalizedText };
  const chunks = chunkSource(normalizedText, {});
  const batches = groupChunksForAnalysis(chunks);
  return { mode: 'long', batches, chunkCount: chunks.length };
}
