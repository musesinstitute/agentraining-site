# Long Training Content Fast Track — 2026-09-13

Status: implemented on `feature/long-training-content-fast-track`. **Do not merge master; this does not close other PR #22 release gates.**

This document is written as the implementation record for this change (the
instruction to "first read" this file predates the file itself existing —
no prior spec doc for this feature was found in the repository at the time
this work started; this file now serves that role for future readers).

## Objective

Company Knowledge silently truncated every source to 30,000 characters on
save (`netlify/functions/pilot-data.mjs`'s `knowledgeRecord()`, `content:
cleanText(input.content, 30000)`), and the AI Analysis path
(`netlify/functions/knowledge-analyze.mjs`) additionally head/tail-sampled
anything over 7,500 characters, permanently discarding the middle of any
longer document before AI Analysis ever saw it. This blocks real enterprise
training material: licensing course transcripts, underwriting/product
training, long training notes, and future video-transcript sources.

This change removes the truncation, without touching the existing
Banner/Pacific Question Bank pipeline, Scenario approval logic, or the
source-grounded Coach's verifier — per the constraint that fluency is not
evidence and the approved source remains the sole factual authority
(NO EVIDENCE, NO AUTHORITY).

Direct large-video upload and automatic transcription are explicitly **out
of scope** for this stage; the Pilot claim remains "upload or paste
authorized training transcripts, notes, scripts, and text documents; video
links are recorded together with their transcript."

## New Pilot limits

| | Previous | New |
|---|---|---|
| Stored/normalized source text | 30,000 chars (silently truncated) | 500,000 chars (rejected clearly over) |
| Transcript file (plain text path) | 1 MB | 5 MB |
| Paste/textarea | 30,000 chars | 500,000 chars |
| AI Analysis input (OpenAI path, `knowledge-analyze.mjs`) | 7,500 chars, head/tail sampled, middle discarded | Chunk-aware: full source, multi-batch map-reduce over 7,500 chars |
| AI Analysis input (Claude path, `pilot-data.mjs` `analyzeKnowledgeSource`) | Unbounded but never exercised beyond 30,000 chars (storage cap) | Unchanged ≤30,000 chars single call; chunk-aware map-reduce beyond it |

Client (`knowledge.html`, `knowledge-chat.html`, the
`knowledge-enterprise-upload.ts` edge rewrite) and server
(`netlify/functions/lib/knowledge-source.mjs`) limits are numerically equal;
the server is authoritative and re-validates regardless of what the client
sent.

Oversized content is never truncated. It is rejected with a bilingual
(English + Chinese) error, e.g.:

> This training source exceeds the current Pilot limit of 500,000
> characters (received N characters). The source was NOT truncated or
> partially saved. / 此培训资料超过当前 Pilot 支持的 500,000 字符容量（收到 N
> 字符）。系统没有截断或部分保存该资料。

## Storage and integrity design

`netlify/functions/lib/knowledge-source.mjs` is a new, dependency-free
(no `@netlify/blobs`, no `@netlify/identity`, no `fetch`) module shared by
both analysis backends and the storage path:

- `normalizeSourceText()` — standardizes line endings (`\r\n`/`\r` → `\n`)
  and trims incidental leading/trailing whitespace of the whole document.
  It never collapses internal whitespace, reorders text, or drops a
  character of content — normalization must never change the meaning of an
  authorized source.
- `sourceLengthError()` — `null` within the limit; a bilingual `Error` with
  `status: 413` over it. Used to fail closed *before* a record is built, so
  storage is never touched by an oversized attempt (source before
  derivatives; no partial overwrite).
- `sha256Hex()` / `buildIntegrityMetadata()` — hashes the exact normalized
  text that is stored, never a truncated or pre-normalization copy. A newly
  saved knowledge record now carries:
  ```
  sourceSchemaVersion: "knowledge-source-v2"
  contentLength: <chars>
  contentSha256: <sha256 of the stored content>
  chunkCount: <deterministic chunk count>
  ```
- `chunkSource()` — deterministic, paragraph-aware chunking (see below).

`netlify/functions/pilot-data.mjs`'s `knowledgeRecord()`/`create` action:
validates length first (rejecting clearly, writing an audit entry, touching
no storage) and, only once valid, normalizes and stores the complete
content plus the integrity metadata above. Existing records saved before
this change have none of these new fields; every read path (`GET
?resource=knowledge`, `approvedKnowledgeView`, analyze, Coach retrieval,
Question Bank/Knowledge Map) was already only reading `record.content` and
tolerates their absence — no migration is required or performed.

## Deterministic chunking

`chunkSource(text, { knowledgeId, targetSize = 6000, overlap = 600 })`:

- Stable for the same input — no randomness, no timestamps.
- Retains source order and exact `startOffset`/`endOffset` into the
  normalized text.
- Prefers a paragraph boundary (blank line), then a line/sentence boundary,
  within a small backtrack window, so a chunk only ends mid-sentence when no
  better boundary exists nearby — the text itself is never altered, only
  where a chunk edge falls.
- Overlaps neighboring chunks by ~600 characters so evidence straddling a
  boundary still appears intact in at least one chunk.
- Each chunk carries `chunkId`, `knowledgeId`, `index`, `startOffset`,
  `endOffset`, `text`.

Chunks are **derived retrieval/analysis views only**. The approved
`record.content` remains the sole factual authority; chunking, batching, or
AI synthesis never replaces it. Chunks are not persisted separately — they
are cheap to recompute deterministically from the stored source whenever
needed (analysis, tracing), which also means a future change to the
chunker cannot desynchronize stored chunks from the source.

## Long-source AI Analysis (chunk-aware map-reduce)

Both AI Analysis backends now follow: **long authorized source → deterministic
chunk batches → grounded per-batch findings → merged, manager-facing
analysis**, replacing the old single-shot head/tail sampling. Every batch is
extracted **in parallel**, so the number of sequential model round-trips a
long document adds is one (the merge/synthesis call), not one per chunk.

- `groupChunksForAnalysis()` groups the fine 6,000-char chunks into ~42,000
  char batches (bounded at 14 batches, i.e. up to ~588,000 chars — covers
  the full 500,000-char Pilot limit) so a long source needs a bounded number
  of model calls instead of one per fine chunk, while every batch is still
  built strictly from the same deterministic chunk boundaries used for
  storage/retrieval.
- Each batch is analyzed independently into compact grounded findings
  (`{summary, keyPoints}`, sourced only from that batch's text).
- One final call synthesizes all batch findings (beginning, middle, and
  end alike) into the existing manager-facing shape: `{summary, keyPoints,
  audience, quality, practiceDraft}`. The synthesis step is explicitly
  instructed not to favor only the first/last findings and not to invent
  facts beyond what the findings state.

**Regression control — short sources are byte-for-byte unchanged:**

- `netlify/functions/knowledge-analyze.mjs` (OpenAI, the dedicated
  timeout-safe endpoint `knowledge.html`/`knowledge-chat.html` actually
  call): sources ≤ 7,500 chars (post its existing whitespace-collapse
  normalization) take the exact prior single-call path — same prompt shape,
  same model call. Only sources over that size — previously silently
  head/tail-sampled — take the new chunk-aware path. This is a strict fix,
  not a behavior change, for every case that could previously occur.
- `netlify/functions/pilot-data.mjs`'s `analyzeKnowledgeSource()` (Claude,
  reached when `action: 'analyze'` is called directly rather than through
  the dedicated endpoint): content could never have exceeded 30,000 chars
  before this change (the storage cap), so the single-call path is
  preserved unchanged up to exactly that size. Only content beyond it —
  newly possible now that storage isn't truncated — takes the chunk-aware
  path.

Neither `netlify/functions/knowledge-question-bank.mjs`,
`knowledge-question-bank-v2.mjs`, `knowledge-map.mjs`, nor
`knowledge-practice-scenarios.mjs` were modified — see Non-regression below.

## Source-grounded Coach

`netlify/functions/pilot-coach-source.mjs`'s existing `relevantContent()`
already scores the *entire* source in overlapping 2,200-char windows against
the learner's question (plus assignment context) and assembles the top-
scoring windows in original order, capped at 14,000 chars — it does not
head/tail-sample and was already correct for arbitrarily long content. The
only reason it could never actually exercise that on a long document before
was the 30,000-char storage cap upstream; removing that cap is the fix. No
functional change was made to this file — only `export` was added to
`normalizeContent`/`compactContent`/`terms`/`relevantContent` (previously
module-private) so the long-source test suite can verify middle-of-document
retrieval directly against the real implementation. Assignment ownership
checking, Company Knowledge source binding, approved-source requirement,
domain lock, source-only answering, the verifier (PASS/CONFLICT/UNSUPPORTED/
AMBIGUOUS), learner privacy, and follow-up continuity are all untouched.

## Non-regression: what was deliberately NOT touched

Per the task's explicit constraints, the following were inspected but left
completely unmodified:

- `netlify/functions/knowledge-question-bank-v2.mjs` and
  `netlify/functions/knowledge-map.mjs` — the Banner/Pacific 50-question
  Gold Baseline pipeline. `knowledge-map.mjs`'s `provisionalPoints()` is
  already a deterministic, non-AI, full-document splitter (no head/tail
  sampling) — it already reads `record.content` in full, so it is naturally
  long-source-safe. Reproducibility is guarded by
  `tests/question-bank-baseline.test.mjs`, which still passes unmodified.
- `netlify/functions/knowledge-question-bank.mjs` (the older single-shot
  question-bank generator) and `pilot-data.mjs`'s `generateQuestionBank()`
  — still cap their document input at 20,000/30,000 chars. Same class of
  issue as the fixed AI Analysis paths, deliberately left alone: Question
  Bank quality rules were explicitly out of scope for this task.
- `netlify/functions/knowledge-practice-scenarios.mjs` — its verifier
  cross-check still compacts the source with 3-segment (head/middle/tail)
  sampling at 24,000 chars. Scenario approval logic and the source-grounded
  verifier were explicitly protected from modification by this task.
- `netlify/functions/openai-transcribe.mjs` — live Practice-session voice
  transcription (per-turn audio, unrelated to Company Knowledge long-source
  transcripts). Unchanged.
- `netlify/functions/pilot-source-trace.mjs` — computes `contentLength`/
  `contentSha256` fresh from `record.content` on every call; it needed no
  change to correctly reflect the now-complete stored content.

## Direct video upload

Not implemented, as instructed. The existing product copy in
`knowledge.html` continues to describe transcript/notes/link upload only;
no large binary media is routed through a JSON/Base64 Netlify Function
request anywhere in this change.

## Tests

New: `tests/long-training-content.test.mjs` (21 tests, all passing),
covering:

1. `lib/knowledge-source.mjs` pure functions: normalization, bilingual
   length-limit errors, hashing, deterministic/ordered/gapless chunking,
   beginning/middle/end marker survival through chunking, integrity
   metadata correctness, analysis batching coverage and call-count bound,
   and the short/long path decision.
2. `pilot-data.mjs` storage: a >30,000-char source saves completely with
   correct integrity metadata (both in the response and in what's actually
   persisted); a >500,000-char source is rejected clearly and never saved
   (zero blobs written); a rejected oversized create never disturbs an
   existing valid record (byte-identical before/after); the 500,000-char
   boundary is inclusive; a legacy record with none of the new
   `knowledge-source-v2` fields is still listed/readable.
3. Chunk-aware AI Analysis, both backends (`knowledge-analyze.mjs` OpenAI
   and `pilot-data.mjs`'s Claude path): a short source makes exactly the one
   model call it always did; a long synthetic ~120,000-char document with
   unique BEGIN/MIDDLE/END markers is split into multiple parallel
   extraction batches whose union covers all three markers (the middle
   marker's batch is neither the first nor the last), followed by exactly
   one merge call, and the final manager-facing `keyPoints` demonstrably
   include evidence from all three positions — not only the beginning/end.
4. Source-grounded Coach: `relevantContent()` retrieves a fact that exists
   only in the middle of the same long synthetic document; the full
   `pilot-coach-source.mjs` handler, given that document, sends the
   middle-chunk excerpt to the model and can reach a verifier `PASS`.

Existing suite: `npm test` — 159 passed / 1 pre-existing unrelated failure
(`tests/browser-invite-flow.test.mjs`, a module-resolution error present
identically before this change — confirmed via `git stash`) / 2 skipped,
identical pass/fail/skip counts before and after this change.
`tests/question-bank-baseline.test.mjs` (Banner/Pacific Gold Baseline
reproducibility) passes unmodified.

## What still needs human Deploy Preview acceptance

This work is verified with in-memory identity/Blobs stubs and synthetic
model responses (no live OpenAI/Anthropic calls, no live Netlify Blobs). Not
automated, and requiring human acceptance on a Deploy Preview:

- An actual multi-hundred-thousand-character enterprise transcript, pasted
  and uploaded through the real `knowledge.html`/`knowledge-chat.html` UI in
  a browser (file input, drag-drop, and the Google Drive import path), to
  confirm the real save/analyze round trip and the updated limit copy read
  correctly end-to-end.
- Live AI Analysis quality on a real long document (this change guarantees
  *coverage* — every part of the source reaches some model call — but real
  model output quality/latency on a genuinely long document was not
  observed live).
- Real Netlify Blobs behavior at the new 500,000-character record size
  (the in-memory test stub has no size limit of its own to interact with).
- Confirming the `knowledge-enterprise-upload.ts` edge rewrite still applies
  cleanly against the live-deployed `knowledge.html` (its strategy is exact
  string matching against the page HTML; this was verified by direct string
  containment checks against the committed file, not a live Deploy Preview
  render).
- Full Banner/Pacific Pilot regression (Question Bank 50/50, Scenario
  Review/Approve/Assign, source-grounded Coach) on the actual saved
  Banner/Pacific knowledge records, beyond what
  `tests/question-bank-baseline.test.mjs`'s deterministic replay already
  guards.
