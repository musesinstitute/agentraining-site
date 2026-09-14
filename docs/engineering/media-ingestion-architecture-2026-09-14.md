# Direct video / audio ingestion — architecture findings and safe MVP — 2026-09-14

Status: **architecture decision record + foundation schema only.** No upload
feature was built, no storage provider was chosen or configured, no paid
service was created. **master untouched; nothing merged.**

Reference branch: `feature/long-training-content-fast-track` (this builds on
the Long Training Content Fast Track shipped 2026-09-13 — see
`long-training-content-fast-track-2026-09-13.md`).

---

## 1. Current architecture findings (from the actual repository)

| Fact | Evidence in repo |
|---|---|
| There is exactly one media path today, and it is live-microphone Practice input | `openai-voice.js` → `netlify/functions/openai-transcribe.mjs` |
| Media reaches the server as **base64 inside a JSON body** | `openai-voice.js`: `blobToBase64()` → `JSON.stringify({audioBase64,…})` |
| The transcription function caps audio at 8 MB and requires ≥256 bytes | `openai-transcribe.mjs`: `MAX_AUDIO_BYTES = 8 * 1024 * 1024`, `MIN_AUDIO_BYTES = 256` |
| It sniffs the container itself and only accepts WAV / WebM / MP4 / Ogg / MP3 | `openai-transcribe.mjs`: `detectAudioFormat()` |
| Model in use is `gpt-4o-transcribe`, one synchronous request, `response_format: json` | `openai-transcribe.mjs` form fields |
| It re-verifies identity with an extra HTTP round trip per call | `verifyLegacyIdentity()` → `/.netlify/identity/user` |
| **No background functions exist** anywhere in the repo | `netlify/functions/` has no `*-background.mjs`; `netlify.toml` has no `[functions]` block |
| **No object storage for binaries exists.** Netlify Blobs is used purely as a JSON document store | every call site is `store.setJSON(...)`; there is not one binary `store.set()` in `netlify/functions/*.mjs` |
| No media tooling of any kind is installed (no ffmpeg, no wasm decoder, no AWS/S3 SDK) | `package.json` dependencies are only `@netlify/blobs`, `@netlify/identity` (+ `playwright` dev) |
| Every outbound integration is a bare `fetch()` with an env-var key — the house pattern | `lib/send-email.mjs` header comment; OpenAI and Anthropic calls follow it |
| Product copy is currently honest about video | `knowledge.html`: "Direct video upload and automatic transcription are not included in this Pilot"; the Google Drive importer explicitly refuses `video/*` |
| Downstream is already sized for an hour of speech | `lib/knowledge-source.mjs`: `MAX_SOURCE_CHARS = 500000`; one hour of speech ≈ 55,000–60,000 chars EN |

**Conclusion:** the pipeline *after* a transcript exists is ready for
one-hour training videos today. The gap is entirely in getting the media in
and turning it into a transcript.

---

## 2. Exact bottlenecks

All platform numbers below are verified against current vendor documentation
(sources at the end), not assumed.

| Stage | Hard limit | Consequence |
|---|---|---|
| Netlify **synchronous** function request body | **6 MB** buffered | A video never fits |
| Base64 encoding | **+~33%** inflation (4/3) | Effective binary ceiling ≈ **4.5 MB** |
| Repo's own inline ceiling (computed) | **4,712,448 B ≈ 4.49 MB** | `MAX_INLINE_MEDIA_BYTES` in `lib/media-ingestion.mjs` |
| Netlify **background** function request body | **256 KB** | You may hand a background job an **ID**, never the media |
| Netlify synchronous function timeout | **60 s** | Enough to *submit* a job; not to transcribe an hour |
| Netlify background function timeout | **15 min** | Not enough to be safe for download + transcode + transcribe of long media |
| Netlify Blobs object size | 5 GB — but **no direct browser upload exists** | Every byte must pass through a function ⇒ back to the 6 MB wall |
| OpenAI `/v1/audio/transcriptions` | **25 MB per file**, synchronous POST | An hour of *video* cannot be sent; an hour of *compressed speech audio* can |
| Audio extraction | no ffmpeg in the runtime or the bundle | Video → audio conversion has nowhere to run today |
| Temporary storage | none provisioned | Nothing to stage a large file in |
| Long-running processing | no queue, no worker, no background function | Nothing to run a multi-minute job |

### The 8 MB limit in `openai-transcribe.mjs` is already unreachable

`MAX_AUDIO_BYTES = 8 MB` is dead code above ~4.5 MB. An 8 MB recording
becomes a ~10.7 MB JSON body, which Netlify rejects at the platform edge
**before the handler runs** — so the user gets an opaque 413 instead of the
function's friendly message. The real ceiling today is ~4.5 MB.

*(Not fixed in this change: it is a cosmetic mismatch on a path that works
in practice, because Practice voice turns are seconds long — a few hundred
KB. Worth aligning when the media path is built for real.)*

### Latent detail

`detectAudioFormat()` labels any `ftyp` container as `audio/mp4`. A small MP4
**video** would therefore be forwarded to OpenAI labelled as audio. Size
limits make this unreachable today, but it should not be relied on as
"video support".

---

## 3. Can `openai-transcribe.mjs` handle these? (question 3, answered exactly)

| Input | Works? | Why |
|---|---|---|
| Short audio clip (≤ 1 MB, a Practice turn) | **Yes** — this is its actual job today | ~1.3 MB JSON body, well under every limit |
| 5 MB audio file | **No** | ~6.7 MB body > Netlify's 6 MB ⇒ rejected before the function runs |
| 50 MB video | **No** | ~8× the platform body limit; ~2× OpenAI's 25 MB file cap |
| 200 MB one-hour training video | **No** | ~44× the platform body limit, 8× OpenAI's file cap, and ~267 MB of base64 held in browser memory to build the request |

Practical ceiling for the current design: **≈ 4.4 MB of audio ≈ 18–26 minutes
of speech at 24–32 kbps mono — and only if the browser had already extracted
and compressed that audio itself, which it cannot do today.**

---

## 4. Where large media must upload to instead

**Directly from the browser to private object storage via a short-lived
signed upload URL**, minted by an authenticated Netlify Function. The file
never transits a function; the function only ever handles the *ticket* and
the resulting *key*.

```
Browser ──(1) POST /reserve-upload (authenticated, manager-only)──▶ Netlify Function
        ◀─(2) { mediaId, signed PUT url, expires in ~15 min }──────┘
        ──(3) PUT the file DIRECTLY to object storage ────────────▶ R2 (private bucket)
        ──(4) POST /confirm-upload { mediaId } ───────────────────▶ Netlify Function
                                                                    │ verifies object exists + size
                                                                    │ state: awaiting_upload → uploaded
                                                                    ▼
                                            (5) submit transcription job with a short-lived
                                                signed READ url  ─────────▶ transcription provider
                                                                    │ state: → transcribing
                                            (6) provider webhook ◀──┘ (minutes later)
                                                                    ▼
                                   Netlify Function: fetch transcript, hash it,
                                   create the Company Knowledge source
                                   (existing `action:'create'` path, unchanged)
                                                state: → transcript_ready → processing → ready
                                                                    ▼
                        EXISTING, UNTOUCHED PIPELINE: deterministic chunking →
                        AI Analysis → Question Bank → Practice Scenarios → source-grounded Coach
```

The recommended architecture in the brief is **correct for this repository**,
with one important simplification (see §6): with a webhook-driven
transcription provider, **no long-running background worker is needed at
all**, which removes the 15-minute limit, the queue, and the ffmpeg problem
in one move.

---

## 5. Storage provider comparison and recommendation

| Option | Direct browser upload? | Storage | Egress | New account? | Verdict |
|---|---|---|---|---|---|
| **Netlify Blobs** | **No** — no client-upload flow; writes go through a function | 5 GB/object max; pricing not publicly confirmed | n/a | No (already installed) | **Disqualified as the media landing zone** — the 6 MB function wall applies to every byte. Keep for what it does well today (JSON records, small derived artifacts) |
| **Cloudflare R2** | **Yes** — S3-compatible presigned PUT + multipart | **$0.015/GB-mo**, 10 GB free | **$0** | Yes (free tier) | ✅ **Recommended** |
| **Supabase Storage** | Yes — signed upload URLs + TUS resumable to 50 GB | Free tier only 1 GB; Pro **$25/mo** for 100 GB, $0.021/GB over | included/limited | Yes | Good tech, but $25/mo for storage alone when we already have Identity + Blobs |
| **AWS S3** | Yes — presigned PUT | $0.023/GB-mo | **$0.09/GB** | Yes | Egress is the trap: every background download and every playback is billed. More IAM overhead |
| **Direct-to-transcription-provider** | Not safely | — | — | Yes | Would require a provider API key in the browser, or proxying through a function (6 MB wall). ❌ |

**Recommendation: Cloudflare R2.**

Reasons specific to this project, not generic best practice:

1. **Zero egress** is the decisive one. Our own background job must *read
   the media back* (or hand a signed read URL to a transcription provider
   that reads it). On S3 that is billed every time; on R2 it is free. For a
   workload that is "write once, read a few times for processing", R2's
   pricing shape matches exactly.
2. **10 GB free** covers the first pilot company (~10 hours of video) at
   literally $0.
3. **S3-compatible presigned URLs** work from a plain Netlify Function with
   `fetch()` + SigV4 — consistent with this repo's "no SDK, bare fetch" house
   pattern (`lib/send-email.mjs`).
4. **Reversible.** Because it is S3-compatible, moving to S3/Supabase later
   is a credential change behind the `STORAGE_ADAPTER_CONTRACT` interface
   added today, not a rewrite.

---

## 6. Recommended transcription architecture

**Do not extract audio ourselves. Do not chunk media ourselves. Use a
webhook-driven provider that accepts a URL.**

| Approach | Complexity | Why |
|---|---|---|
| OpenAI `/v1/audio/transcriptions` (current provider) | **High for long media** | Synchronous POST of the file, 25 MB cap ⇒ we must extract audio from video **and** split an hour into segments **and** hold a long request open. We have no ffmpeg and nowhere to run it |
| **URL + webhook provider (AssemblyAI / Deepgram class)** | **Low** | Submit a signed URL, get a job id in < 1 s, receive a webhook when done. Provider handles container demux, long files, and segmentation |

**Recommendation:** submit-by-URL + webhook for the media path; keep
`openai-transcribe.mjs` exactly as it is for live Practice microphone turns
(different problem, already works).

Keep OpenAI as a viable *fallback for short media*: an hour of speech
compressed to mono ≤32 kbps is ~14 MB, which **does** fit OpenAI's 25 MB
single-file cap — but only once something has extracted and compressed that
audio, which is precisely the step a URL-based provider does for free.

Synchronous vs asynchronous: **asynchronous, always.** A 60-second function
cannot wait for an hour of audio to transcribe under any provider.

> ⚠️ **Requires current-documentation verification before implementing:**
> which video containers each candidate provider accepts directly (MP4 / MOV
> / WebM), their webhook retry semantics, and whether a signed URL with a
> ~1 hour expiry satisfies their fetch window. Do not assume — check the
> provider's live docs at implementation time.

---

## 7. Recommended background-processing architecture

**There should be no long-running worker.** Every step fits inside an
ordinary 60-second function:

| Step | Runtime | Duration |
|---|---|---|
| Reserve upload (mint signed PUT) | sync function | < 1 s |
| Confirm upload (HEAD the object, hash, state → uploaded) | sync function | < 2 s |
| Submit transcription job (signed READ url → provider) | sync function | < 2 s |
| Receive transcript webhook, save Company Knowledge source | sync function | < 5 s |
| Chunking + AI Analysis | **existing** `knowledge-analyze.mjs` | already shipped |

A Netlify **background function** (15 min, 256 KB payload) remains a useful
*fallback* for polling a provider that lacks webhooks — the 256 KB payload
limit is not a problem because the job payload is a `mediaId`, never media.
But the webhook design avoids needing it at all.

Status for the UI comes from the media record's `state` field — which is
exactly what the foundation added today defines.

---

## 8. Expected practical video/duration support (once built)

| Metric | Supported |
|---|---|
| Single file size | Up to the presigned-upload ceiling (R2 multipart supports far beyond our needs); practical product cap suggested at **2 GB** |
| Duration | **1–2 hours per file** comfortably, provider-dependent |
| Formats | MP4 / MOV / WebM / M4A / MP3 / WAV — final list gated on provider verification |
| Languages | Chinese and English both supported by all candidate providers |
| Transcript size | ~55,000–60,000 chars/hour EN — **8× inside** the existing 500,000-char Company Knowledge limit |
| Concurrency | 10+ videos can be uploaded and processed in parallel; each is an independent record and job |

For reference, why the audio numbers matter:

| Mono speech bitrate | Size per hour | Fits OpenAI 25 MB? | Fits a 6 MB function body? |
|---|---|---|---|
| 16 kbps | 7.2 MB | Yes | No (≈ 39 min max at 4.5 MB) |
| 24 kbps | 10.8 MB | Yes | No (≈ 26 min max) |
| 32 kbps | 14.4 MB | Yes | No (≈ 20 min max) |
| 64 kbps | 28.8 MB | **No** | No |

---

## 9. Rough cost model (startup-oriented, ranges where vendor pricing varies)

Assumptions: 1 hour of 720p training video ≈ 400 MB stored; transcript ≈
55,000 chars; the existing chunk-aware analysis path (2 extraction batches +
1 merge per hour-long transcript).

**Unit costs**

| Item | Cost |
|---|---|
| Storage (R2) | $0.015/GB-month; first 10 GB free; **$0 egress** |
| Transcription | **$0.15–$0.36 per hour of media** ($0.003/min gpt-4o-mini-transcribe → $0.006/min gpt-4o-transcribe / Deepgram-class) |
| Function / background processing | ~$0 incremental within the existing Netlify plan at pilot volumes |
| AI Analysis after transcription | ~$0.01–$0.15 per hour-long transcript (≈ 35–40K tokens, 3 calls) |
| Question Bank generation (existing pipeline, unchanged) | ~$0.50–$3.00 per 50-question bank — **the dominant AI cost** |

**Scenario totals**

| Scenario | Storage/month | Transcription (one-time) | AI processing (one-time) | Realistic monthly |
|---|---|---|---|---|
| **1 pilot company** (10 videos ≈ 10 h ≈ 4 GB) | **$0** (free tier) | $1.50–$3.60 | $5–$30 | **< $1/mo** after onboarding |
| **5 pilot companies** (50 h ≈ 20 GB) | ~$0.30 | $7.50–$18 | $25–$150 | **$1–$3/mo** |
| **20 small customers** (200 h ≈ 80 GB) | ~$1.20 | $30–$72 | $100–$600 | **$5–$15/mo** |

**The headline for a revenue-first startup:** at 20 customers and 200 hours
of training video, *infrastructure* costs roughly **$10 per month**.
Transcription of the entire corpus is a **one-time ~$50**. The dominant cost
is Question Bank generation, which already exists and is already
per-customer-value-creating. **Infrastructure is not the constraint —
engineering time is.** Do not over-build.

---

## 10. Safe MVP options compared

| | Option A — Transcript-first | Option B — Small media upload | Option C — Real direct upload |
|---|---|---|---|
| What it is | Paste/upload transcript (**shipped**) | Accept only media under the platform limit | Presigned upload + async transcription |
| Real limit | 500,000 chars / 5 MB text | **≈ 4.4 MB ⇒ ~20 min of *pre-compressed audio*, and 0 minutes of video** | 1–2 hour video per file |
| Useful to the target customer? | Yes, but they must produce transcripts themselves | **No** — a customer with 10 one-hour videos cannot use it at all. It would only work after the browser extracted and compressed audio (ffmpeg.wasm, ~25–30 MB download, slow decode, mobile memory limits) and even then needs 3–4 uploads per video | Yes |
| New infrastructure | None | None | 1 storage account + 1 transcription key |
| Risk of dishonest product claim | None | **High** — this is exactly the "enterprise video support that only takes tiny files" trap the brief warns against | None if built properly |

**Recommendation: build Option C next — but not today, and not partially.**

Option B is explicitly *not* recommended: its practical ceiling is ~20
minutes of audio the browser cannot produce yet, and zero minutes of video.
Shipping it would create the false claim we are trying to avoid.

---

## 11. What was implemented today (foundation only)

Only the pieces the brief lists as acceptable foundation work, all
provider-neutral and none of it user-facing as a feature:

- `netlify/functions/lib/media-ingestion.mjs`
  - media record schema (`media-source-v1`), private by default, team-scoped,
    with **no public URL field at all**
  - transcription-job record schema — one record per attempt, so a retry
    never overwrites the previous attempt's evidence
  - the seven processing states (`awaiting_upload` + the six specified) and a
    **state machine that refuses to skip work**: `uploaded → transcript_ready`
    and `uploaded → ready` throw; `ready` is terminal; a retry may only rewind
    to a state whose artifacts are known-good
  - source lineage (`mediaId`, `mediaFileName`, `mediaSha256`, `transcriptId`,
    `transcriptSha256`, `knowledgeId`, `processingModel`, `createdAt`) plus
    `lineageComplete()`, which **fails closed** on a broken chain
  - `STORAGE_ADAPTER_CONTRACT` + `createStorageAdapter()`, which **throws
    `MediaStorageNotConfiguredError` until a provider is chosen** — there is
    deliberately no default and no silent fallback
  - `describeIngestionCapability()` / `planMediaIngestion()` — one honest
    truth source deriving what this deployment can actually accept from the
    real platform limits, so no UI or copy can overstate it
- `tests/media-ingestion.test.mjs` — 20 tests, including a regression guard
  that a realistic 200 MB one-hour video is **never** routed through an
  ordinary function
- `knowledge.html` — a clearly-labelled **"Upload video or audio — coming
  next"** tile that accepts no file and instead routes the manager to the
  path that genuinely works today (authorized video link + transcript)

Nothing calls this module yet. That is intentional and is stated in its
header.

---

## 12. What must NOT be built yet

- ❌ Any upload control that accepts a file without direct-to-storage upload
  behind it (Option B).
- ❌ Server-side ffmpeg / audio extraction in a Netlify Function — no binary
  is bundled, the runtime has none, and a URL-based transcription provider
  removes the need entirely.
- ❌ A hardwired storage provider before the account exists.
- ❌ Any product claim of the form "upload your training videos and we
  transcribe them" until the flow works end to end.
- ❌ Any change to the Question Bank, Quality Gate, Scenario approval, Coach
  verifier, Banner/Pacific banks, or the 2026-09-13 long-transcript limits.

---

## 13. Security and privacy requirements for the build (design contract)

| Requirement | Design |
|---|---|
| Signed upload URLs | Minted per-upload by an authenticated, manager-gated function; short expiry (~15 min); content-type and max-size bound into the signature |
| Private storage | Bucket has **no public access**; no CDN binding; `visibility: 'private'` recorded on every media record |
| No public media URLs | The media record stores an opaque provider key, never a URL. The schema has no URL field — a leak would have to be deliberate |
| Authenticated read | Playback/processing reads use short-lived signed GET urls minted per request, never stored |
| Team isolation | Same convention as every existing record: `teams/{teamId}/media/{mediaId}`, and `teamId` on the record |
| Deletion | `deleteObject` is part of the adapter contract from day one, not an afterthought — deleting a media record must delete the bytes |
| Retention | Per-team retention policy to be set with the first customer contract; derived transcripts may outlive the media, never the reverse |
| Audit trail | Reuse `writeAudit()` in `pilot-data.mjs` for reserve / confirm / transcribe / delete, exactly as knowledge writes already do |

---

## 14. Sources for every vendor number used above

- Netlify function limits (6 MB sync payload, ~4.5 MB after base64, 60 s sync, 15 min / 256 KB background): [Functions overview](https://docs.netlify.com/build/functions/overview/), [Background Functions](https://docs.netlify.com/build/functions/background-functions/)
- Netlify Blobs (5 GB object max; no client-upload flow — writes go through a function): [Netlify Blobs docs](https://docs.netlify.com/build/data-and-storage/netlify-blobs/), [Netlify Blobs vs Vercel Blob](https://www.netlify.com/knowledge-base/netlify-blobs-vs-vercel-blob/)
- OpenAI transcription 25 MB file cap and per-minute pricing: [Audio API FAQ](https://help.openai.com/en/articles/7031512-audio-api-faq), [OpenAI transcription pricing](https://costgoat.com/pricing/openai-transcription)
- Cloudflare R2 pricing ($0.015/GB-mo, zero egress, 10 GB free, presigned URLs): [R2 pricing](https://developers.cloudflare.com/r2/pricing)
- Supabase Storage (1 GB free / 100 GB Pro at $25, $0.021/GB overage, TUS resumable to 50 GB, signed upload URLs): [Resumable Uploads](https://supabase.com/docs/guides/storage/uploads/resumable-uploads), [Supabase pricing](https://supabase.com/pricing)
- Async transcription provider pricing (~$0.15–$0.46/hr): [AssemblyAI pricing](https://www.assemblyai.com/blog/speech-to-text-api-pricing), [Deepgram pricing](https://deepgram.com/pricing)

Provider prices move. Re-verify before committing spend.
