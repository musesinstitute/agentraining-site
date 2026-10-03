# Personal AI Coach source routing P0 — 2026-09-10

Status: routing P0 acceptance passed on the authenticated formal Coach page. **Do not merge master; this does not close other PR #22 release gates.**

Engineering commit: `56f6745fce9a5e02085a98e6870a3c6fe0e5182d`. Netlify PR #22 Deploy Preview check: success. The deployed HTML contains `20260910-explicit-context1` and no legacy learner gateway override. `master` remains `d418930375f847d1612796224fe962fe78d7dad7`.

## Evidence and root cause

Audited PR #22 head `6ec19bd0a7e18f6b5563efe85526aa3deb32f6fc`, branch `knowledge-training-engine`.
The live Deploy Preview HTML fetched before this fix contained both the latest `pilot-cloud.js?v=20260909-grounded3` script and `__learnerAiGatewayInstalled`.

`netlify.toml` attaches `ai-relationship-onboarding.ts` to `/coach-chat.html`. Its injected installer overwrote `window.PilotCloud.request` after the page scripts loaded. Every learner `coach-messages` POST went directly to `/api/ai-chat`, redirected to `netlify/functions/ai-chat.mjs`, with only `{role, lang, message}`. It never called the original router for POST. No assignment ID, source ID, retrieval or verifier was involved. That endpoint uses its general relationship prompt and `ai-chat-v1` conversation history. Prior wrong answers can consequently remain in its conversation context.

This explains why changing assignment bootstrap, assignment priority, prompt keyword routing, and cache-busting the router did not fix the formal page: the later Edge injection bypassed all those changes. The diagnostic page is not subject to this Edge injection and explicitly calls `pilot-coach-source`.

A local test executes the exact old interception block against the formal page's send function and observes `/api/ai-chat`. Its lending response is a synthetic fixture to demonstrate routing and rendering, **not a newly observed live model answer**. Live evidence establishes the served interception code; authenticated acceptance was subsequently completed below.

## Changes

- `netlify/edge-functions/ai-relationship-onboarding.ts`: remove the request override, retaining onboarding and voice UI.
- `coach-chat.html`: visible context selector, default newest active Company Knowledge assignment, explicit assignment/source IDs, sticky selection for follow-ups and refresh, generic results/skills starters, initialization and concurrent-send guards, honest response metadata.
- `pilot-cloud.js`: replace cached assignment/keyword routing with the request's explicit context; reject missing/inconsistent context and mismatched grounded responses; never retry via generic on source failure.
- `netlify/functions/pilot-coach-source.mjs`: compare supplied source ID with the authorized assignment and return persisted source label/path. Approved-source retrieval, generation prompt and verifier are unchanged.
- `netlify/functions/pilot-data.mjs`: require explicit generic mode and reject assignment/source-bearing requests before persisting messages; tag generic responses.
- `netlify/functions/ai-chat.mjs`: reject legacy unscoped learner calls and source-bearing calls, including calls from already-open old Edge-injected pages. Manager routing is unchanged.
- `tests/coach-routing.test.mjs`: 12 focused routing, initialization, rendering, stale selection, no-fallback, verifier and privacy regression tests.

## Verification

Passed 91/91 tests using:

```
node --import ./tests/register.mjs --test tests/coach-routing.test.mjs tests/knowledge-architecture.test.mjs tests/openai-transcribe.test.mjs tests/pilot-invite.test.mjs tests/pilot-manager-invite.test.mjs
```

These run real page/router scripts in a VM with a small DOM and network fixtures, plus real backend handlers with in-memory identity/storage and synthetic model replies. The three formal-page prompts send the explicit selected assignment/source to the grounded endpoint and display returned verification metadata. They do not demonstrate actual Banner answer quality or browser layout.

Existing standalone Playwright invite-browser tests were not run. Syntax and whitespace checks passed. No production branch changes or merge are authorized.

## Formal acceptance results

Tested the authenticated learner in the formal page at:
https://deploy-preview-22--magical-platypus-ba1dfe.netlify.app/coach-chat.html?pilot=1

Selected assignment: `5586b6bd-7ed7-4958-8404-2bcab8c9143a` — Underwriting Field Guide Reference Summary.
Approved source: `2ffd7ff5-ab26-432e-bf49-d7029c361892`.

| Formal prompt | Actual behavior | Result |
| --- | --- | --- |
| How should I explain the holistic underwriting philosophy? | Cigar-use underwriting example; anchored to “we underwrite individuals, not impairments” | PASS for source-routing/domain acceptance |
| Why is that important? | Continued the same life-insurance cigar/rate-classification discussion | PASS |
| Give me an example. | Another guide-based example: recreational versus medicinal marijuana use and underwriting treatment | PASS |

All three actual rendered responses showed **Grounded in: Company Knowledge · underwriting-field-guide · Verifier: PASS · Path: pilot-coach-source**. No lender, lending decision, borrower, loan, commercial lending, or credit-score underwriting drift was present. Server response timestamps were September 10, 2026, 00:52:26, 00:53:00 and 00:53:38 Pacific.

The general-result and next-skill starter buttons also returned actual Practice-evidence coaching with **Path: Generic Coach · Company source not verified** and no company-source/verifier claim. Private Practice details are deliberately omitted from this report.

Reload persistence was checked separately: source and generic trace labels remain attached to their original responses.

## Limits and remaining risks

- First-turn wording incorrectly began by saying the learner asked for an example, carrying over the existing diagnostic conversation. The answer stayed in the correct source/domain, but this conversational relevance issue remains; no history was deleted to improve test results.
- PASS is the existing automated verifier’s result, not an independent line-by-line expert audit of the guide. In particular, the second response included broader premium implications; strict claim-level accuracy remains subject to source review. No new grounding prompt was introduced for this routing fix.
- Generic mode intentionally uses the existing evidence-based `pilot-data` Coach, not the source-free relationship gateway that caused this failure. Onboarding UI remains; free-form relationship conversation may return the existing generic evidence fallback.
- Old open pages now receive a context error from the legacy gateway and must reload; they must not keep producing source-free assignment answers.
- Multiple source assignments require selecting the intended one. Selection persists in the current page, not browser storage; a fresh page defaults to the newest active source assignment unless an explicit assignment URL is supplied.
- Historical messages are retained; they are not relabeled PASS without stored verification.
- The existing model-based verifier and 30,000-character source storage limit were not redesigned.
