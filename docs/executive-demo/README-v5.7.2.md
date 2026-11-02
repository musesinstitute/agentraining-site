# Executive Demo V5.7.2 — handoff (2026-11-01)

Status: concept preview created in ChatGPT; **the HTML preview has not yet been committed to this repository**. This document preserves the work and next steps; it is not evidence of completed functionality.

## Baseline
- V5.7.1: eight scenes, 3:18, with David (learner), Michael (simulated life-insurance prospect), manager and AI Coach.
- V5.7.2 concept preview: illustrates source-material relevance → question bank → multiple practice scenarios, plus an AI Coach spoken example using browser text-to-speech.
- Browser TTS is not real-time two-way AI conversation. The relevance pipeline is illustrative pending end-to-end UAT.

## Next two product priorities
1. **AI Intelligence**: evaluate document relevance, retain source citations, connect evidence to question-bank items and varied scenarios; require tests and manager review.
2. **Two-way AI voice**: learner ↔ AI prospect and learner ↔ AI Coach, with server-side credentials, explicit microphone permission, graceful fallbacks, transcripts and consent/privacy handling.

## Merge gate
Commit the actual V5.7.2 HTML and source artifacts on a feature branch; verify eight-scene timing, browser playback, accessibility and truthful labeling; test both live product capabilities independently. Only then merge the feature branch to master. Do not describe concept playback as live voice.

The locked V5.4 script must not be overwritten by an unapproved narration draft.
