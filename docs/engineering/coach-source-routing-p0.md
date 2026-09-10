# Personal AI Coach source routing P0 — 2026-09-10

Status: root cause reproduced; fix prepared. **Real authenticated formal-page acceptance remains pending. Do not close P0 or merge master.**

## Evidence and root cause

Audited PR #22 head `6ec19bd0a7e18f6b5563efe85526aa3deb32f6fc`, branch `knowledge-training-engine`.
The live Deploy Preview HTML fetched before this fix contained both the latest `pilot-cloud.js?v=20260909-grounded3` script and `__learnerAiGatewayInstalled`.

`netlify.toml` attaches `ai-relationship-onboarding.ts` to `/coach-chat.html`. Its injected installer overwrote `window.PilotCloud.request` after the page scripts loaded. Every learner `coach-messages` POST went directly to `/api/ai-chat`, redirected to `netlify/functions/ai-chat.mjs`, with only `{role, lang, message}`. It never called the original router for POST. No assignment ID, source ID, retrieval or verifier was involved. That endpoint uses its general relationship prompt and `ai-chat-v1` conversation history. Prior wrong answers can consequently remain in its conversation context.

This explains why changing assignment bootstrap, assignment priority, prompt keyword routing, and cache-busting the router did not fix the formal page: the later Edge injection bypassed all those changes. The diagnostic page is not subject to this Edge injection and explicitly calls `pilot-coach-source`.

A local test executes the exact old interception block against the formal page's send function and observes `/api/ai-chat`. Its lending response is a synthetic fixture to demonstrate routing and rendering, **not a newly observed live model answer**. Live evidence establishes the served interception code; authenticated request/answer acceptance is still required.

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

## Formal acceptance still required

Open PR #22 Deploy Preview's `coach-chat.html?pilot=1`, reload once, and sign in as the assigned learner. Select **Underwriting Field Guide Reference Summary**. Ask in order:

1. How should I explain the holistic underwriting philosophy?
2. Why is that important?
3. Give me an example.

Each response must remain in Banner Life insurance underwriting, without bank-lending drift, and show `Grounded in: Company Knowledge · underwriting-field-guide`, `Verifier: PASS`, and `Path: pilot-coach-source`. Check the initial explanation against “We underwrite individuals, not impairments.” Check generic result/skill starters separately: they must show Generic Coach with no company-source verification claim.

## Limits and remaining risks

- Real authenticated three-turn acceptance is blocked until learner sign-in is available in the test browser. A green deploy is not P0 closure.
- Generic mode intentionally uses the existing evidence-based `pilot-data` Coach, not the source-free relationship gateway that caused this failure. Onboarding UI remains; free-form relationship conversation may return the existing generic evidence fallback.
- Old open pages now receive a context error from the legacy gateway and must reload; they must not keep producing source-free assignment answers.
- Multiple source assignments require selecting the intended one. Selection persists in the current page, not browser storage; a fresh page defaults to the newest active source assignment unless an explicit assignment URL is supplied.
- Historical messages are retained; they are not relabeled PASS without stored verification.
- The existing model-based verifier and 30,000-character source storage limit were not redesigned.
