# Question Bank V2 — saved-evidence investigation

Status: evidence recovered; failure localized; production generation logic unchanged. Pacific 50/50 is **not yet fixed or demonstrated**. No questions were regenerated. PR #22 remains unmerged.

## Evidence and provenance

The authenticated PR #22 Deploy Preview was opened with manager access. The new standalone `question-bank-evidence.html` reader called only the existing `latest` Question Bank action and Knowledge Map `status` action, plus the existing team document list. Both records were recovered through visible UI controls. No map build/rebuild, generation, resume, or source edit was performed.

Reader commit: `4b151c7e36ea8c679deebb2f34832913691b82e3`. Netlify Deploy Preview reported success. The page strips author email and team ID from the exported bank/map. Private source and question text are preserved separately in the evidence archive, not committed to this repository. `tests/fixtures/question-bank/gold-baselines.json` contains metadata, counters, structural question records and SHA-256 fingerprints.

The following four files have byte-identical contents between `34fb4dd2726a6383da4bce800a8dbb8302ecb3b8` and `83d3b4599a0ada0100a7f274d04e25ddc9e89611`: `netlify/functions/knowledge-question-bank-v2.mjs`, `netlify/functions/knowledge-map.mjs`, `knowledge-training-engine.js`, `knowledge-chat.html`. This rules out a change to those files during that interval, not every possible environment/provider change.

## A. Gold Baseline reconstruction

| Saved property | Banner | Pacific Life |
|---|---|---|
| Bank ID | `49837aeb-f505-4eb0-9b83-f78b88b4d199` | `d95ef9ef-fad2-44f9-9b62-e1ef1e4441bb` |
| Knowledge ID | `2ffd7ff5-ab26-432e-bf49-d7029c361892` | `d430f5b8-9cea-423b-9fd2-0ac4b452a49a` |
| Created UTC | 2026-09-06 23:01:49.442 | 2026-09-11 00:04:58.888 |
| Updated UTC | 2026-09-06 23:04:45.951 | 2026-09-11 00:07:12.513 |
| Accepted / requested | **50 / 50** | **24 / 50** |
| Candidates / rejected | 129 / 79 | 70 / 46 |
| Covered points | **25 / 32 (78%)** | 21 / 32 (66%) |
| Engine / depth / gate | 2 / 5 / 7 | 2 / 5 / 7 |
| Eligibility / adaptive version | 2 / 1 | 2 / 1 |
| Knowledge Map version | 3 | 3 |
| Saved generator model | `gpt-5.4-mini` | `gpt-5.4-mini` |
| Difficulty / batch size | Mixed / 5 | Mixed / 5 |
| Understanding / Application eligible points | 32 / 23 | 30 / 22 |
| Capacity from unchanged formula | 58 | 57 |
| Stored status | complete | generating (frontend safe-stop) |

Both source records contain 30,000 characters, not a complete 28-page PDF. Their saved maps each have 32 points. Re-running **only the deterministic map function offline** on each saved source exactly reproduced all saved point fields, including IDs, summaries and eligibleDepths. Map createdAt equals updatedAt for each source and predates its bank. This is strong current-source/map consistency evidence; the bank did not preserve a historical source/map snapshot at generation time.

Banner really reached 50 using 25 canonical points at multiple depths, after rejecting 79 candidates. Examples of substantive later work include Q22 comparing medical histories, Q23 comparing age/coverage eligibility, Q36 selecting submissions under state/application-count restrictions, and Q41 applying age/total-coverage eligibility. Its stored success must not be erased or replaced by Pacific's partial result.

This is one recovered successful run, not proof of repeated-run stability. The historical gate also accepted weak material: Banner K004 is a table-of-contents point, and Q46 labels topic lookup as Application. Preserve the successful capacity evidence and true deeper questions, while tracking that quality defect honestly; do not define success as accepting every historical question regardless of quality.

## B. Pacific Life failure anatomy

Persisted cumulative diagnostics reconcile exactly: **70 generated = 24 accepted + 46 rejected**. Primary reasons sum to 46. Secondary reasons are empty.

| Phase | Banner attempted / accepted / rejected | Pacific attempted / accepted / rejected | Pacific rejection reasons |
|---|---|---|---|
| Coverage | 59 / 17 / 42 | 32 / 20 / 12 | duplicate 7; depth 5 |
| Understanding | 38 / 17 / 21 | 38 / 4 / 34 | duplicate 31; shallow_format_after_q20 3 |
| Application | 32 / 16 / 16 | **0 / 0 / 0** | none attempted |
| Unknown | 0 / 0 / 0 | 0 / 0 / 0 | none |

Pacific: `rejected_duplicate` **38 (82.6% of rejects)**; `rejected_depth` 5; `shallow_format_after_q20` 3. Recorded grounding, logic, sensitive-claim, unknown-point, needs-review, exact-duplicate and `same_canonical_point_same_depth` rejection counts are all zero. Zero recorded grounding rejects does not certify source fidelity.

Understanding acceptance is 10.5% for Pacific versus 44.7% for Banner. Pacific never tested its 22 nominal Application-eligible points in that phase. Its 21 used / 11 never-used points are recorded in the manifest; never-used IDs: K006, K011, K012, K014, K015, K016, K017, K018, K019, K020, K026.

Only the latest batch's rejected question text (truncated to 220 characters), reason label and short reviewer explanation survive; the complete 46 rejected candidates, options, answers, requests, responses and per-batch timeline do not. Therefore no exact candidate-by-candidate explanation of all 46 can honestly be reconstructed.

Five surviving rejected candidates all say duplicate:

| Point | Candidate topic | Stored reviewer assertion | Check against accepted bank |
|---|---|---|---|
| K018 | blood pressure versus drug/alcohol guideline | same K018 pattern already accepted | K018 absent; accepted question/explanation text does not contain this comparison |
| K019 | age 80/81 best-class availability | same K019 point already accepted | K019 absent; this age/class distinction absent |
| K020 | accelerated/modified paths determining requirements | same K020 note already accepted | K020 absent; K013 has related but different pathway fallback content |
| K022 | over-70 evidence validity | same K022 rule already accepted | Q11 does retrieve that six-month rule; duplicate concern is supported |
| K026 | recent heart attack timing | same K026 point already accepted | K026 absent; this timeline absent from accepted question/explanation text |

Missing K-ID alone does not disprove semantic duplication across points. Nevertheless, several specific assertions about prior accepted content are unsupported by the saved bank. The verifier returns only a status and explanation: no referenced prior question ID or evidence span is required or checked. Its duplicate decision is accepted as authoritative and increments retry pressure. **Do not automatically accept these rejected questions**: a mistaken duplicate rationale does not prove depth, correctness, or grounding.

## C. First divergence

**Earliest observable structural divergence: source segmentation and canonical map quality.** Pacific K002–K006 are five navigation/contents fragments; Banner K004 is one. The deterministic mapper ranks sentence/newline fragments using insurance keywords, modal words and numbers. It does not explicitly exclude contents dot-leaders. Scores of 5 promote four of Pacific's five contents fragments to Application eligibility. The generator receives only each point's summary (maximum 700 characters), not full tables or document context. Several dense table summaries end mid-rule.

An additional shared defect inflates eligibility: `evidence(point)` includes `label` and `sourceReference`, and `depthScore()` awards three points for any number. The automatic labels `Training concept N` and `Document concept N` supply a number even without substantive numeric evidence. This affects both maps; it is not a Pacific-only code regression. Pacific product-series points K014/K015 are excluded by the separate short-series penalty; the remaining 30 points pass Understanding eligibility.

**Observed throughput divergence: Understanding.** Pacific already accepted seven Understanding-depth questions during broad coverage (Banner accepted three). The one-point/one-depth rule consumes those slots before the later Understanding-only phase. But Pacific still has 19 unused nominal Understanding point/depth pairs at 24, so exhaustion of canonical pairs is not the demonstrated immediate cause. Duplicate/depth quality failures, not the deterministic same-point rule, dominate.

The frontend starts Application only once the bank reaches the relevant accepted-count boundary. It stops after five no-progress batches, or in a later stage when stage rejects reach 30 and no-progress reaches two (also an overall 50-attempt cap). Pacific's 34 Understanding rejects are consistent with that early safe-stop condition; exact trigger cannot be proven because batch history and stop reason were not persisted. Last success was 00:06:45.675 UTC, 26.838 seconds before final update. Increasing retries alone is not justified.

Banner's recorded phases are 17 Coverage / 17 Understanding / 16 Application, not exactly 20/15/15. Assignments receive phases before a batch is generated; partial acceptance is subsequently renumbered. That permits later-phase questions at earlier displayed positions. Preserve the observed baseline in tests; do not falsify its phase distribution to match the intended layout.

## D. Root-cause classification

| Layer | Evidence-backed conclusion |
|---|---|
| Document / map | Different fragmentation and contents pollution; both sources truncated at 30,000 characters; table context can be truncated again at 700. These weaken the available canonical evidence. |
| Eligibility / estimator | Syntactic criteria admit navigation and metadata digits. Capacity adds three phase pools without accounting for semantic uniqueness, broad-phase depth consumption, or the Understanding bottleneck. Thus 57 is not 57 gate-validated slots. No formula change made. |
| Generator | Produces many candidates judged duplicate and three post-Q20 true/false candidates. Full rejected outputs absent, so the share caused by generation versus verifier error is unknown. |
| Quality Gate | Most immediate recorded blocker is AI duplicate rejection; several surviving rationales assert nonexistent prior content. Gate has no verifiable duplicate reference contract. This is a correctness/reliability issue, not grounds to lower standards. |
| Scheduler / retries | Phase progression prevents Application while Understanding stalls; pressure changes ranking, not source richness or evidence for duplicate judgments. Safe-stop protects quality but ends this run at 24. |
| Deterministic duplicate fallback | Code can select already-used depths after eligible unused pool exhaustion. Real risk, but **not evidenced as this run's root cause**: no same-point/depth rejects and nominal unused slots remain. |
| Coach changes | No change to these four engine/map/UI files over the compared interval. No evidence that Coach routing caused this failure. |

The defensible combined diagnosis is weak canonical evidence/eligibility plus unreliable semantic-duplicate adjudication, amplified by phase-dependent scheduling and safe-stop. Aggregate counts cannot prove the counterfactual that repairing any one of these will yield Pacific 50/50. Same saved model name does not prove immutable provider weights, identical responses, or identical hidden environment configuration; those were not versioned in the bank.

## E. Minimal reversible fix proposal — not applied

1. **Make duplicate rejection evidence-bearing.** Assign stable prior-question IDs in the verifier payload. Require a duplicate verdict to identify an existing prior question and the shared fact/cognitive operation. Validate that reference. Unsupported verdicts become unresolved/needs-review and receive a bounded independent recheck, never automatic acceptance. All current grounding, depth, format and uniqueness requirements still apply. Persist full candidate and verdict trace with phase and explicit stop reason in team-protected records.
2. **Version map improvements, preserve old maps and banks.** Exclude contents/navigation and non-substantive fragments; score source evidence without synthetic label/reference digits; preserve coherent table rule boundaries and conditions. Build a separate candidate map for comparison, never silently rebuild Banner's saved map. Keep source hashes and map snapshots on new runs. This is a separate change after the verifier evidence defect is testable.
3. **Then reassess scheduling, not the target.** Reserve/track genuine depth slots and avoid exhausted point-depth retries. Evaluate phase progression against actual gate-usable concepts. Do not lower 50, bypass Understanding, accept shallow questions, or patch the capacity number as the first fix.

Before any new 50-question run, replay available saved candidates against the evidence-bearing gate where full payloads exist. The currently saved last-reject records lack complete payloads, so an exact historical verifier replay is impossible. A future narrowly scoped candidate/verifier test must be labelled new evidence, not reconstruction. Only after that evidence supports the changes should a separately identified Pacific generation run be considered; preserve both original banks permanently.

## F. Regression protection and limits

Added `tests/question-bank-baseline.test.mjs` and `tests/fixtures/question-bank/gold-baselines.json`:

- Immutable fingerprints and actual structural records for Banner 50/50 and Pacific 24/50; cumulative/phase/utilization reconciliation.
- Actual endpoint `latest` round-trip preservation with team-isolation checks and a network trap preventing AI calls during recovery.
- Private fixture replay: reproduce both complete saved maps from stored source; check all 74 accepted questions against the current deterministic gate; verify source/snapshot/question hashes.

Run the full private replay after extracting the evidence archive:

```sh
QB_REQUIRE_EVIDENCE=1 QB_EVIDENCE_DIR=/absolute/path/to/extracted/evidence \
node --import ./tests/register.mjs --test tests/question-bank-baseline.test.mjs
```

Without the private fixture directory, two private replay tests are explicitly skipped. `QB_REQUIRE_EVIDENCE=1` makes missing evidence a failure. A release gate must supply the private archive to require them; this investigation does not configure a private CI artifact store. Historical hashes must not be replaced with a newer run merely to make tests pass.

Investigation verification: **104/104 non-browser tests passed, including 8/8 new tests with private fixtures, no skips**. Existing Coach routing/composer tests remain passing. Both saved maps reproduced exactly and all 74 historical accepted questions passed the unchanged deterministic validator. This does **not** rerun the AI verifier or establish fresh 50/50 generation. A complete future capacity regression must additionally require 50 accepted with source/depth/semantic verification on both documents and preserve quality, not just compare counts. No stochastic system can honestly promise permanent 50/50 from this one replay.

## Changes and remaining work

Files added only: `question-bank-evidence.html`, this report, the baseline manifest and the baseline test. No production generation, map, capacity, Coach or composer logic was edited. No source or stored bank was changed. No learner records were read for this investigation.

Live deployed-browser result: manager document list, Pacific `latest` + map `status`, and Banner `latest` + map `status` all succeeded on PR #22. This was saved-evidence retrieval, not a generation acceptance run.

Remaining: implement and validate the evidence-bearing verifier contract, investigate canonical-map improvements in isolation, supply private fixtures to the release gate, then perform an explicitly justified fresh capacity regression. **Do not close Pacific capacity failure as fixed on these results.** Production `master` and PR merge state remain untouched by this work.
