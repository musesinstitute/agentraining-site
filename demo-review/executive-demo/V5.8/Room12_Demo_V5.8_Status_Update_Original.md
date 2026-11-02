# Room 12 — Executive Demo Status Update (V5.8)

**Date:** 2026-11-02 · **For manual filing** (no Room 12 connector was available in this session).

## Status
- **V5.8 "3-Minute Manager Impact Cut" built** as a self-contained offline HTML preview with narration (MD) and subtitles (SRT). 180 s, six scenes, ~111 wpm.
- **NOT PUSHED.** A review folder `demo-review/executive-demo/` (V5.7 sources, V5.7.1 revision, V5.8 outputs, screenshots, both handoff documents) was prepared on branch `claude/hopeful-faraday-3jpgsy`, but the commit and push were blocked by the session’s permission policy. No pull request exists yet. Files are delivered as the `output/` folder and ZIP; commit later with the commands in the final hand-off message.
- When pushed: open a **Draft** PR to `master`; AI agents must not merge (AGENTS.md §1b).

## What the cut says
"Turn your team’s knowledge into AI practice — and practice into stronger agents." Pillars: AI intelligence (knowledge → question bank + practice scenarios, manager-reviewed), AI practice + personal coach (text chat; feedback, why, better wording, retry), team growth (manager evidence and decision; Team Growth Hub as concept). CTA: Explore How It Works (prototype, no link yet) and 14-day private pilot (by request; subject to confirmation).

## Test status
- PASS: duration 180 s, JS errors none, offline file:// playback, player controls, caption/SRT timing match, layout at 1280×720 / 1920×1080 / 390 px, forbidden terms, visible status tags.
- NOT TESTED: recorded voiceover pacing, real Chrome/Edge/Safari apps, live end-to-end UAT with a real company document, topic relevance/prioritization.

## Decisions needed
1. Destination for "Explore How It Works" (later Interactive Executive Overview project).
2. Studio name: "Leadership Studio" (demo) vs "Manager Studio" (live studios page).
3. Third evidence label: "Next step" (demo) vs "Closing" (pilot manager view).
4. Approve narration for voiceover recording.

## Out of scope (separate later project)
Interactive Executive Overview and four Studio micro-videos.