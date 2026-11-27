# Executive Manager Demo — Canonical Sequence & Handoff (2026-10-23)

## Source of truth
Do **not** assemble a presentation from arbitrary Studio pages. The already-built Executive Manager Demo was merged into `master` and is a coherent four-chapter narrative. Its order must be preserved:

| Chapter | File on `master` | Purpose |
| --- | --- | --- |
| 1/4 | `manager-demo-opening.html` | Present the manager's risks, bottlenecks, and reason to act. Includes the early-warning Hub bridge. |
| 2/4 | `manager-demo-hub.html` | Display the central Team Growth & Retention Hub and the four Studios (Practice, Client, Knowledge, Leadership). |
| 3/4 | `manager-demo-phases.html` | Show Phase 1 (steps 1–4), Phase 2 (step 5), Phase 3 (steps 6–7) with ALL seven step details. |
| 4/4 | `mission-control-v2-1.html` | Demonstrate the five distinct Mission Control states (Prioritize, Diagnose, Evidence, Plan, Reassess), including a purely simulated follow-up. |

## The source of the October 22 sequence error
The original PR #63 tour instead used `supervisor-demo.html → knowledge.html → simulator.html?ref=demo → manager-demo-phases.html → mission-control-v2-1.html → manager-demo-hub.html`. Therefore the source chapter labeled "2 / 4" appeared as final "6 / 6", exposing obsolete internal Next/Previous links and failing to demonstrate changing interactive steps. It was a composition error rather than missing master code.

## Current PR #63 change
- Keep all four canonical files unmodified on `master`.
- Replace only the new tour entry page `guided-supervisor-demo.html` on the PR branch.
- Guided order follows the four original chapters.
- Hub sequentially selects four pre-existing illustrative Studio descriptions.
- Three Manager Phases sequentially selects seven pre-existing step buttons.
- Mission Control stays within its **synthetic five-learner demonstration**, selects fictional Michelle, and progresses through all five steps. The Day 7 outcome and reassessment report are explicitly illustrated, not measured results.
- The tour does not send assignments, submit forms, call APIs, or change localStorage. It only interacts with these named synthetic pages.
- Related Knowledge, Practice, and Supervisor overview pages are linked as **optional extended material**, not treated as arbitrary chapters in the four-chapter manager story.
- Existing internal chapter navigation on Hub and Phases is visually hidden only inside the tour's iframe to avoid showing misleading "Next" at the wrong point. Direct "Open current page" links retain the original pages intact.

## First pacing proposal (not yet signed off)
Chapter 1: 43 seconds. Chapter 2: 41 seconds. Chapter 3: 65 seconds. Chapter 4: 91 seconds. Total: 240 seconds. Prioritize story integrity and visible state changes over forcing this detailed walkthrough into 90 seconds.

## UAT required before master merge
- Start with a fresh browser; verify original order **1→2→3→4**, no duplicate or incorrectly numbered chapters.
- Confirm interactive selection visibly changes all four Hub descriptions.
- Confirm all seven Phase steps and all five Mission Control steps appear, including Step 2/3/4/5, sample simulated outcome, and readjustment report.
- Check Play/Pause, Previous/Next, page load before timeline advances, mobile viewport, no auth or access errors, and stop at the final page.
- Recheck privacy labels and fictional-data disclosures. Current follow-up/consent limitations are not a demonstrated product feature.
- Netlify deploy-success status is NOT proof of runtime/browser UAT.
- **Do not merge PR #63 or deploy to production without explicit owner approval.**

Handoff: Room 00 / AgentTraining.ai Project Master Record should link this file, the GitHub PR #63, and the last user-reviewed preview version.
