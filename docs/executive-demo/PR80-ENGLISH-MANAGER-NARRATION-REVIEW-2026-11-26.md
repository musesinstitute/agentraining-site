# PR #80 — English Manager-First Narration Review

**Status:** DRAFT, internal review only; not approved for production, paid filming, manager outreach, or merge.

**Basis:** Reconstructed from the original PR #75 manager-facing feature story and the unchanged PR #80 authentic demo screenshots. The feature value leads; screenshots are illustrations, never the narrative center. This review contains the locally revised English-only film script, based on Claude’s supplied upload package; it is not yet deployed or approved.

**Existing Netlify preview (not this local revision):** https://deploy-preview-80--magical-platypus-ba1dfe.netlify.app/manager-tour-film-frames.html

**GitHub PR:** https://github.com/musesinstitute/agentraining-site/pull/80

**Earlier narration foundation:** `15e3e084ebd6996d0e79667b604d81ddbe44180d` (historical; the current wording and four-stage handoff are on the PR #80 Draft branch).

## Editorial rules

- The audience is an insurance manager seeing AgentTraining.ai for the first time. Prioritize what each Studio does, why it is valuable, and what decision it helps the manager make.
- Keep PR #75 concepts: manager **importance** versus learner **relevance**; foundational learning plus company-approved materials; Practice **Learn → Apply**; Client-specific cases; Leadership **The AI recommends. You decide.** (one spoken occurrence).
- Keep screenshots authentic and unaltered. Cite a detail from an image only when relevant to clarifying the functional story, not as a walkthrough of screenshot pixels.
- No strict duration cap during content review; measure and edit for pacing after content is accepted.
- English-only version now. Chinese version must be a separate localized edition, not a language toggle in the English manager film.

## Narrative structure — explicit chapter cuts

The opening carries forward David’s dilemma but also makes sense when the tour is opened directly. The first two captions establish that practice evidence is not a recording of the original client meeting. The four product frames retain their existing Knowledge → Practice → Client → Leadership order and each stage begins with **First / Second / Third / Fourth**. The last narration caption invites managers to take the manager’s seat and decide how to allocate thirty minutes among five fictional agents. The invitation is a user-clicked handoff, not an automatic page redirect. All product images and coaching scores remain unchanged.

## Narration — English, 32 caption segments

### 1. Knowledge Studio — From approved material to practice

1. David faced two closed doors. His manager could not see what happened inside. How can you coach a conversation you never saw?
2. You cannot replay an unrecorded client meeting. But you can prepare your agents before the next one and review how they practice.
3. First, Knowledge Studio. Are your agents learning what matters most, or simply completing courses?
4. Start with your company's approved product guides, underwriting rules, carrier updates and training procedures.
5. AI summarizes the material and extracts key points. That helps you judge what matters to your team and what is relevant to each learner.
6. AI can draft practice scenarios from the same material, with source-section references you can review. Your company's knowledge becomes the starting point for practice.
7. You review the draft, approve the training and decide what to assign. Company knowledge becomes an actionable training task.
8. But knowing the right answer is not the same as delivering it when a client pushes back.

### 2. Practice Studio — Saying it under pressure

1. Second, Practice Studio. Turn what your agents know into something they can actually do.
2. Instead of memorizing a script, they can rehearse difficult conversations with an AI client before the real meeting.
3. Think of Michael's tight budget. Here is that kind of conversation in practice.
4. An AI client says a hundred and eighty dollars a month is too much for insurance.
5. Instead of arguing about price, the agent asks what feels manageable and what matters most to protect.
6. The client explains the budget, the mortgage and two children to protect. Now the agent can ask better questions.
7. In this simulated session, the AI Coach scores empathy and rapport eighty, product accuracy seventy-two, and closing technique seventy.
8. These scores are not a verdict on the agent. They help you identify what to coach. But every client brings a different challenge.

### 3. Client Studio — Preparing for this client

1. Third, Client Studio. Is your agent prepared for this particular client, rather than just a familiar objection?
2. Think of Richard. After fifteen years in business, he had new partners and new concerns. He needed understanding, not another sales pitch.
3. A client record tells you who to follow up with. But is your agent ready for that conversation?
4. Client Studio organizes the client's needs, current objections, case status and next follow-up in a portfolio.
5. Start Practice uses the client's recorded concern to select a relevant exercise or build a case-based rehearsal.
6. That gives the agent a chance to explore questions, explain options and respond to objections before the next meeting.
7. For a manager, the goal is not just to track an opportunity, but to develop the skills needed to move it forward responsibly.
8. Knowledge, rehearsal and client context give your coaching a clearer purpose. How will you turn that into your next decision?

### 4. Leadership Studio — Who you coach first

1. Fourth, Leadership Studio. Who needs support before a quiet struggle becomes a reason to leave?
2. Practice results, assignments and coaching follow-up give you evidence beyond a completed training checklist.
3. Review the work, assign a targeted practice and follow up with the learner through Message Learner.
4. AI feedback helps you identify practice gaps. You decide whether to coach now, gather more evidence or assign another exercise.
5. Review the next practice to see whether the same difficulty persists, and adjust the coaching plan.
6. This is the Team Growth and Retention Hub: company knowledge, applied skills, client preparation and targeted coaching, feeding the next round of development.
7. The AI recommends. You decide.
8. Now take the manager's seat. Five agents. Five clean training reports. Thirty minutes of coaching. David is one of them. Who gets your time first?

## Evidence and marketing-claim guardrails

| Studio | What the authentic UI illustrates | Do not claim without separate verification |
| --- | --- | --- |
| Knowledge | Approved fictional training guide, AI summary, practice draft and assignment entry point | Automatic importance/relevance ranking, automatic approval, universal source citations; the source-linked workflow is distinct from the simple draft shown |
| Practice | One contributor-sourced **1520×691 product-rendered WebP**, copied byte-for-byte into this Draft PR, shows a single fictional AI conversation, Overall 82, Empathy & Rapport 80, Product Accuracy 72 and Closing Technique 70. It is not an untouched raw browser capture. | Do not claim a real customer call, a verified sale, an unedited browser screenshot or measured real-world outcomes |
| Client | Fictional Elena Rivera case: need, premium objection, follow-up and Start Practice | AI Client Discovery / Understanding Map in PR #80, live-call analysis, full case-context injection on all matching paths, verified writeback or cross-device case synchronization |
| Leadership | Assign Practice, Current Assignments, Message Learner in a manager workspace | Automated team priority ranking, verified real-time/cross-device message delivery, reduced turnover, or outcomes beyond visible evidence |

**Important:** These are independent fictional examples, not one continuous case journey. Keep these qualifications in internal review and ensure the presentation does not imply functionality not actually tested.

## Independent AI review — before Genspark

Review this as a skeptical insurance agency owner, Sales Manager, or Training Manager who has never seen AgentTraining.ai. Please report **PASS / PASS WITH CHANGES / FAIL** with evidence and suggested replacements only where needed. Specifically examine:

1. First-view clarity: Does the narration explain the problem, distinctive capability and manager benefit for each Studio without prior context?
2. Narrative integrity: Is the PR #75 feature story preserved, with PR #80 screenshots naturally supporting it instead of dominating it?
3. Product honesty: Are any statements unverified, ambiguous or prone to mistaken assumptions about automation, insurance outcomes, messaging, or case synchronization?
4. Distinctive selling points: Does it explain why four linked Studios and manager decision-making are more valuable than isolated AI role-play?
5. Flow and pacing: Are transitions logical and is anything repetitive or missing? Do not cut critical content merely to hit a preselected runtime.
6. Screenshot/audio coordination: Does each screenshot substantiate a relevant spoken statement, and are captions readable without covering essential controls?

**Review sequence:** founder/assistant revision → independent AI reviews and revision → Genspark final production review → founder final acceptance → optional paid video production and controlled manager distribution. Any merge to master requires separate explicit approval of the exact PR revision. PR #68 and master remain untouched by this narration task.

## Engineering validation state

- GitHub branch file readback: English-only navigation; three original PR75 WebP sources (Knowledge, Client, Leadership); one explicitly labeled PR80 product-rendered WebP (Practice); four chapters; 8 captions/chapter and 32 caption segments — checked.
- Browser-generated speech remains only a preview tool and does not constitute a professionally timed or encoded final film.
- Actual playback, responsive text fit, speech/caption synchronization and fresh Netlify browser UAT — **not yet signed off**.
- Netlify build success, if subsequently confirmed, cannot substitute for runtime UAT or founder approval.

## Nov 27 historical review response — three Practice coaching dimensions (SUPERSEDED BY SOURCE SWAP BELOW)

Source: [PR #80 issue comment #7213487779](https://github.com/musesinstitute/agentraining-site/pull/80#issuecomment-7213487779) and the contributor-provided 1520×691 source re-render in the founder's review package.

Historical finding, now superseded by the installed 1520×691 WebP: the original 1028×448 browser screenshot ends at the Empathy & Rapport bar. CSS cannot reveal Product Accuracy or Closing Technique because these pixels are absent. The original screenshot is **not replaced** in the PR at this stage: the proposed new image was produced by re-rendering one authentic fictional simulator run with the product's UI at 2×, rather than capturing a browser window without alterations, and it has a different AI client follow-up from the original screenshot.

**Current correction on this draft:** the original screenshot remains clearly labeled; **a separate coaching evidence panel** in the Practice Studio page and 16:9 film framing review displays the three values from the separately sourced run (80 / 72 / 70). Captions 2.6 and 2.7 distinguish the original conversation screen and the separate product-rendered score run. No cross-session splice or fictionalized "raw screenshot" is presented. The original user's source re-render is preserved in the local review materials for side-by-side acceptance and possible future faithful raw recapture.

**Before final acceptance:** if the founder wants all three coaching scores literally inside the screenshot, obtain an unaltered taller browser capture of **one and the same session**, or explicitly approve the contributor's source-labeled product-rendered replay as film material. Do not quietly substitute it for a raw capture. Test the 16:9 frame and mobile layout with that replacement before revising narration to imply the scores are visible in the screenshot itself.


## Nov 27 — Founder-accepted source re-render installed on Draft PR #80

**Source decision:** Founder permits a product UI re-render, rather than requiring raw browser screenshot pixels. This is a media-source-format decision only, **not** final film or merge approval.

**Exact installed file:** `assets/studio-screenshots/PR80-Practice-Source-ReRender-1520x691.webp`, original 1520×691 WebP supplied in `PR-Practice-Screenshot-Upload.zip` at `upload/assets/studio-screenshots/PR75-Practice-Studio.webp`. Git blob SHA: `e85c124127c0495624619aac2a6b6d60b3e34417`; 68,322 bytes. Its label and filename in the contribution archive are historical; this is **not** the earlier cropped PR75 1028×448 WebP.

**Provenance:** The contributor states the source WebP was reconstructed from one real fictional Nov 26 simulator test using the product's own UI renderer at 2×. It is **not an untouched browser screenshot**. The displayed dialogue and score panel are part of this same run: price concern $180/month, trainee asks the client's manageable budget and coverage priorities, client follow-up mentions ~$120–$130 comfort and family/mortgage, overall 82 (A), Empathy & Rapport 80, Product Accuracy 72, Closing Technique 70. This single-run image is an example of the platform's simulated practice, not a real insurance client conversation or predictor of actual outcomes.

**Implemented:** Both `manager-tour-practice.html` and `manager-tour-film-frames.html` now point to this same full-size WebP, and the previous mismatched separate-run score panels were removed. The English Practice 2.6 and 2.7 lines now describe the same underlying test and the three coaching dimensions. The former temporary editorial SVG proxy was removed after the real contributed WebP was installed. Knowledge, Client and Leadership screenshots remain unchanged.

**Static verification completed:** Original asset bytes were retrieved from the user's uploaded ZIP and transferred as a raw Git blob, checked by exact byte size and SHA; branch HTML readback and Netlify build verification are tracked separately.

**Acceptance not yet performed:** Fresh Netlify browser UAT for exact final PR head, desktop 1366×768, mobile 390×844 and 320×700, video 16:9 framing, image contrast/readability, no horizontal page overflow, captions/voice synchronization, full-size link, and end-of-film handoff. Do not call the film production-ready from CI success alone.

**Approval chain:** Independent AI review → changes → Genspark final review → founder personal final review. Final payment/video generation, outreach and PR merge require their own explicit decisions. The PR stays Draft and no merge to master is authorized.


## Nov 27 — Claude’s prior narration revision (historical; reported live AI feature verification)

**Claude reported:** Claude ran Knowledge Studio (production, byte-identical to this branch) and Client Studio (PR #74 preview) in the real product with fictional data. Knowledge Studio shows an AI summary, key points and AI-generated practice scenarios that cite their source section, then a manager review queue. **No UI shows an AI importance/relevance judgment**; `netlify/functions/knowledge-map.mjs` ranks concepts by keyword rule (`model: null`). Client Studio's AI discovery, understanding map and hypotheses exist only on PR #74 (not merged), so the Client chapter describes the live case file and Start Practice only.

**What changed on this branch:** all 32 captions in `manager-tour-film-frames.html` (still 4 chapters × 8, so the Practice score zoom stays on caption 2.7 and Take the Manager's Seat on caption 4.8); Knowledge frame heading and side list no longer claim importance/relevance; Leadership heading uses the film's tagline "The AI recommends. You decide."; spoken disclaimers moved to on-screen footers (Knowledge, Client, Leadership).

**Narrative spine:** opens on the PR #68 film's own question ("how can you coach a conversation you never saw?"), carries Michael into Practice and Richard into Client, frames Leadership around retention without outcome claims, names the Team Growth and Retention Hub once, and hands off with the interactive demo's actual task (five agents, five clean reports, thirty minutes).

**When PR #74 merges:** the Client chapter can add the AI discovery and suggested-approach capability, with a recaptured Client Studio frame. Until then it must not be described as live.


## Nov 27 — Follow-up editorial revision (local candidate; not deployed)

**Review finding:** Claude’s supplied package improved continuity and removed unsupported AI claims. Its 32-cue structure and corrected CTA are retained. This revision restores the manager-value distinction between importance and relevance as a human judgment informed by available AI analysis; differentiates case-based rehearsal from recordkeeping; connects retention to timely coaching rather than a promised reduction; and makes the next development cycle and five-agent challenge explicit. The opening works without requiring the previous film to have been watched.

**Evidence boundary:** Claude reports live checks, but the package does not contain the new raw captures or live test logs. The richer Knowledge source-linked scenario workflow should be shown with actual results before final filming; audience/quality fields are not evidence of personalized AI ranking. PR #74 is a separate draft; its Client Discovery/Understanding Map must be independently accepted and integrated before being presented as PR #80 product capability. Do not silently merge it, or substitute mock evidence. The current Client frame shows case-based rehearsal entry only. Existing Practice image and same-session 80/72/70 values are retained, without sales predictions.

**Outstanding founder-approved capture requirements:** obtain actual AI analysis and generated scenario evidence for Knowledge, actual Discovery / Understanding Map and case-specific practice evidence for Client, and determine release scope. Narration restraint is not cancellation of those requirements.

**Validation and approval:** This candidate changes only the film page’s editorial copy and this document. No player logic, screenshot assets, tests, PR #74, PR #68 or master are modified. The separately supplied manager-demo-five-paths test is not a direct film-page regression and must not be used as proof of live AI features. Claude reported three full 123/123 passes and two failures of the Invite Learner test across five runs; treat the failure as unresolved until logs and isolated reproduction establish its cause. Do not waive red CI. Fresh Deploy Preview UAT for the exact revision, independent review, Genspark review, and explicit founder approval remain required.

## Local validation — Nov 27, 2026

- PASS: JavaScript syntax (`node --check`). Film narration and review document match all 32 captions (4 × 8). Original player code and all image references remain unchanged.
- PASS (local HTML/Chromium, without product screenshot assets): seek through all 32 cues at each of 1366×768, 1920×1080, 390×844 and 320×700 (128 checks). Caption text matches; no page JavaScript errors; Practice score zoom triggers at cue 2.7; Take the Manager's Seat appears at cue 4.8, with the correct apostrophe and existing destination.
- LIMITATION: Both Claude's supplied baseline and this revision exhibit the same footer/side-panel layout overlap flags on the two narrow viewports, at Knowledge cues 1–8 and the last Leadership cue (32). No caption text overflow or CTA overlap was observed in these local checks. Do not treat this as mobile visual acceptance; recheck on the actual deployed assets and address separately if reproduced.
- NOT RUN: Full repository suite (including Invite Learner), deployed Netlify UAT, real image-load/visual verification, real AI operations, and browser speech/audio playback. The supplied ZIP contains only the film page and review document; actual image files and full project are not included. The separately supplied `manager-demo-five-paths.test.mjs` was not modified or substituted for a film test. Claude's reported 123/123 passes are not our own results.
- Existing Deploy Preview is not this revision. Compare the current PR #80 head and file diffs before committing these two files. Do not overwrite unrelated work, merge PRs, or alter master.

## Future target copy — conditional, not in current film

**Knowledge (only after actual AI importance/relevance functionality is shown):** “AI helps you identify which knowledge matters most to your team and which material is relevant to each learner, with reasons you can review.” Keep manager approval and scenario generation in the subsequent cues.

**Client (only after PR #74 capability is accepted and integrated into the intended product release):** “AI helps you distinguish what you know about the client from what still needs to be clarified, and suggests what to ask next.” Then show the actual Understanding Map and prove that the relevant case context carries into Start Practice.

These are proposed target lines, not current feature claims. Do not cancel the founder-approved capture work because the interim narration uses narrower claims.


## Nov 27 — V3.1 reconciliation (local editorial candidate; not deployed)

**Compared the actual V2 and V3 HTML and review documents.** Claude's V3 uses V2's 32 captions with changes to Knowledge 1.6 and Client 3.5, but also changes the on-screen Knowledge label, Client and Leadership headings, and disclosures. V3.1 retains V2's screen labels and product positioning (including the Practice scores-not-predictive label, browser-local Client notes, separate PR74 status, and future target copy).

- Knowledge 1.6 acknowledges source-section references without claiming every draft names a section or that every claim has been independently verified. Claude reported seeing named source sections in real product runs (Application Review Priorities and Case B); raw captures are absent from the supplied archives. The PR80 backend at b66ea6b supports a sourceReference field, canonical knowledge point IDs and a separate verification gate, but its existence does not prove the precise workflow is visible or universally enforced by the frontend. Keep the additional capture requirement open.
- Client 3.5 states both actual code paths. Read-only inspection of master simulator.html confirms keyword matching against existing curriculum scenario prompts (with client name and case link) or a Free Practice fallback using buildCaseFreePracticePrompt(c), which includes case need and objection. Do not claim that every matched scenario incorporates the full client record. AI Discovery/Understanding Map remains a separate unmerged PR74 capability until accepted and integrated.
- Claude's V3 report confirms narrow-screen disclosure overlap (320/390px, cue 4.8; reported 82% vs baseline 100%). The dynamic-padding attempt was reverted after introducing Knowledge overlap. This reconciliation does not change layout or player code; mobile UAT remains blocked.
- Invite Learner flake: Claude reports 3/3 isolated passes, 3/5 full-suite runs with all 123 passing, and a later full pass. Empty invite input after visibility is the observed symptom; root cause is unconfirmed. A parallel-run race is a hypothesis only; no test weakening or rerun-to-green approval.
- The V2 validation above is historical, not a claim of V3.1 full browser UAT. Current V3.1 validation: static exact caption synchronization across HTML, this document and captions file; JavaScript parse; unchanged player logic, CSS, image paths, CTA destination and 4x8 cue structure. No full repository suite, actual product AI execution, source capture, Netlify browser UAT, audio/visual acceptance or deployment performed for V3.1.
- No source files on GitHub changed. PR80 remains draft at b66ea6b0050515fac537924439024c75b6eecc8f as checked during reconciliation. This package is for review only, not merge approval or authorization for paid production. Compare exact branch head before any commit; fix layout separately and retain the founder's AI feature acceptance requirements.

## Nov 27 — V3.2: V3.1 accepted, one on-screen heading restored

**Accepted from V3.1, both caption changes:**
- Knowledge 1.6 — "with source-section references you can review" is better than V3's wording, and V3.1's disclosure correctly adds that the current Knowledge image shows only a practice draft and assignment entry point, so the reference is stated, not shown.
- Client 3.5 — "select a relevant exercise or build a case-based rehearsal" is the most accurate line any draft has had. It matches both branches of `startPracticeFromCase()` on master: an objection-keyword match against the curriculum, or a fallback to Free Practice re-prompted through `buildCaseFreePracticePrompt(c)`.

**One change back:** the Leadership frame heading returns to "The AI recommends. You decide." V3.1 had replaced it with "Team Growth &amp; Retention Hub". The Hub is all four Studios and already has its own tour chapter (`manager-tour-hub.html`), so using it as the heading of the slide labelled "04 / Leadership Studio" reads as if Leadership Studio were the Hub. Caption 4.6 already names the Hub, and caption 4.7 speaks the tagline, which then has nothing on screen behind it. The name is still kept, as the founder asked, in caption 4.6 and in the Hub's own chapter. All of V3.1's other on-screen edits are kept.

**Browser verification of V3.1 and of this file** (V3.1 shipped with static checks only): full suite 123/123; all 32 captions render on desktop 1366×850 and iPhone 13; Practice score zoom on caption 2.7; Take the Manager's Seat on caption 4.8 with the correct apostrophe; no page or console errors; no horizontal overflow.

**Unchanged and still open:** the narrow-viewport overlap on caption 4.8 at 320×700 and 390×844 (pre-existing, 100% on the unmodified branch head, 82% here); the `browser-invite-flow` intermittent failure, root cause unconfirmed; AI Client Discovery and the Understanding Map still PR #74-only; Netlify UAT on the real deployed assets not performed.

**Worth doing before filming:** the Knowledge frame could show the source-section references instead of only disclosing them. A Nov 27 capture of the generated scenarios exists, showing "… Underwriting Guide — Application Review Priorities" and "— Case B" on the drafts. Swapping it in would make caption 1.6 visible evidence rather than a claim, but it adds an asset and reflows that frame, so it needs its own review pass.


## Release candidate addendum — November 27

The 32 approved V3.2 narration cues are unchanged. Superseding earlier visual descriptions: Knowledge uses three original November 27 production screenshots with fictional data, email badge redacted, at 1346×581. Cues 1.1–1.4 use the workflow, 1.5 uses AI summary/manager review, 1.6 displays the two scenario source references, and 1.7–1.8 return to manager review. These captures are not a verified end-to-end assignment or proof of all generated claims. Compact browser review uses a stacked, scrollable layout rather than a fixed 16:9 film frame; desktop retains the 16:9 stage and captions in a separate grid row. Client/Practice/Leadership images and playback timing remain unchanged. No PR #74 features added. Pending live deploy UAT, full regression and founder approval.
