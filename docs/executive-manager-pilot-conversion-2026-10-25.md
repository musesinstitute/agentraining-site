# Executive Manager Demo — Pilot Conversion Draft PR Handoff

Date: 2026-10-25
Branch: `feat/executive-manager-pilot-conversion-20261025`
Base: latest `master` at branch creation
Status: Draft PR; **not merged to master; no production deployment authorized**

## Source of truth and parallel work

- Room 00 handoff: preserve Risk → Four Studios & Hub → Three Phases / Seven Steps → Mission Control V2.2.
- PR #63 (Draft, open): separate automated guided four-chapter playback. This PR does **not** replace or duplicate its tour/controller.
- PR #64 (Draft, open): separate upload-to-practice hook page. This PR does **not** merge or overwrite that page.
- Source requirements: `AgentTraining_Executive_Manager_Demo_Readonly_Implementation_Plan_2026-10-24`.
- `AGENTS.md`: latest master → isolated branch → Draft PR → preview UAT → founder approval before merge.

## Changes

1. Chapter 1: retain original risk framing; surface the observable manager coaching question and clarify limits.
2. Chapter 2: retain the interactive architecture and all four Studios; lead with one Michelle price-objection decision case. Position approved company material as one ingredient in targeted practice.
3. Chapter 3: retain Michelle and all seven interactive steps; expose baseline, evidence, manager-approved next practice, and simulated reassessment.
4. Chapter 4: retain five fictional advisors, override, privacy/evidence disclosures and existing five-step interface; add Chapter 3 back link plus a visible 14-day Pilot invitation and expandable **mock Day-14 Team Readiness Report**. Template contains **no fabricated results**.
5. `pilot-start.html`: reuse existing Netlify form unchanged in its submission structure, explicitly label free Pilot *request*, remove unvalidated exact 2/3-minute promises, describe evidence-based Day-14 review.
6. `manager-demo-review.html`: remove stale PR #61 / pre-merge labels and add current Pilot review link.
7. `tests/executive-manager-pilot-conversion.test.mjs`: regression tests for route continuity, legal/ethical disclaimers, form wiring, demo assets and JS parseability.

## Scope guardrails

No API, database, Netlify Blobs, learner history, assignment or manager-feedback mutations were added. All five demo learners are fictional and there are no promises of sales uplift, retention improvement or a readiness score without sufficient evidence. No automatic readiness-report engine, CRM or tracking backend was created.

## Verification / owner's acceptance checklist

- [ ] GitHub automated tests pass (check branch commit + PR checks).
- [ ] Fresh-session Netlify Deploy Preview opens chapters 1–4 and all forward/back links; verify Mission Control's original supervisor-view link and new Chapter 3 link.
- [ ] Original Mission Control 5-step choices, override reason, privacy and Day-7 reassessment work, with no external assignment.
- [ ] Desktop/mobile and keyboard tests pass (EN and existing Chinese locales as supported by respective pages; original Hub/Phases/Mission Control are primarily English).
- [ ] Pilot CTA opens `/pilot-start.html`; expandable Day-14 template visibly says mock.
- [ ] A **test submission in Deploy Preview only** reaches `/pilot-requested.html` and is actually recorded by Netlify Forms; requires permission/test data and a preview deployment. Do not submit genuine personal data or treat visual presence as proof.
- [ ] Founder explicitly approves before any merge. **Do not merge or deploy production**.

## Not implemented / evidence gaps

- Funnel tracking (Demo → request → launched → Day-14 review) can be maintained manually from real requests; no analytics tracking was added without privacy requirements or a measurement plan.
- The guided playback in PR #63 is a separate Draft; its full fresh-browser/mobile/auth UAT is not established by this PR.
- PR #64's login-gated Knowledge CTA remains independent; no unsupported instant upload conversion is promised here.
- Any real Pilot data/performance claims require actual evidence and manager validation.
