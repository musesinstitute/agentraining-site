# Question Bank V2 — Minimal Duplicate-Evidence Fix

Status: implemented and automatically verified on `knowledge-training-engine`. No live Pacific Life regeneration has been run. PR #22 remains a draft and unmerged.

## Exact behavior change

Before this change, the Quality Gate could return only `status` and a short `reason`. Any `rejected_duplicate` verdict was immediately authoritative. The persisted Pacific bank demonstrates the failure mode: several last-batch reasons claim that a specific source fact was already accepted even though that content cannot be found in the accepted bank.

Quality Gate version 8 adds duplicate-evidence contract version 1:

1. Every prior accepted question sent to the verifier includes its saved `questionId`.
2. A `rejected_duplicate` verdict must return `duplicateOfQuestionId`, the exact `priorQuestionText`, and `duplicateEvidence` explaining the shared fact and cognitive operation.
3. The server checks that the ID exists in the actual persisted bank, the returned prior text matches that saved question after normalization, and the explanation is substantive.
4. A valid match remains rejected as `rejected_duplicate` and persists the prior ID/text/evidence plus `reviewStage` for audit.
5. An unsupported duplicate verdict receives one bounded independent secondary review. That review rechecks source grounding, answer/logic, depth, format, sensitive claims and uniqueness. It may accept only after an explicit full-gate PASS.
6. A secondary duplicate verdict must satisfy the same server-side evidence check. If it does not, the candidate remains rejected as `needs_review`, not as a proven duplicate.
7. If the secondary review call fails, the candidate is saved as `needs_review`; the rest of the batch can still persist. It does not pass and is not mislabeled duplicate.

All non-duplicate verifier rejections follow their existing direct path. Deterministic validation still runs before the AI Quality Gate. Grounding, answer/logic, sensitive-claim, depth and format requirements are unchanged.

## Files changed

- `netlify/functions/knowledge-question-bank-v2.mjs`: evidence-bearing duplicate contract, server validation, bounded secondary full-gate review, fail-closed persistence, Quality Gate version 8 and duplicate-evidence version 1.
- `tests/question-bank-duplicate-evidence.test.mjs`: five endpoint-level regression cases using in-memory storage and deterministic AI-response fixtures.
- This report.

Existing Gold artifacts remain unchanged:

- `tests/fixtures/question-bank/gold-baselines.json`
- Private `Question-Bank-V2-Evidence-2026-09-11.zip`
- Saved Banner bank `49837aeb-f505-4eb0-9b83-f78b88b4d199`, V2 / Depth 5 / Quality Gate 7, 50/50.

The historical Banner bank stays version 7 because it is immutable evidence from September 6. New or resumed generation batches are explicitly recorded as Quality Gate 8 / duplicate-evidence 1; this prevents new behavior from being mislabeled as the historical gate.

## Automated verification

The new endpoint tests prove:

- valid duplicate evidence must reference an exact saved prior question and is persisted;
- a fabricated/missing prior reference cannot produce an authoritative duplicate rejection;
- an unsupported duplicate can pass only after an independent full Quality Gate review accepts it;
- a second unsupported verdict remains `needs_review`;
- a secondary-review outage fails closed as `needs_review` while preserving the batch;
- ordinary grounding rejection is unchanged and does not invoke secondary review.

Full non-browser result with both private evidence snapshots required: **109/109 passed, 0 failed, 0 skipped**. This includes exact deterministic reconstruction of both saved Knowledge Maps, validation of all 74 historical accepted questions, team-isolated `latest` recovery, existing Coach tests, and the new duplicate-evidence cases.

The repository's separate `browser-invite-flow.test.mjs` could not start in this workspace because its declared Playwright package is not installed locally (`ERR_MODULE_NOT_FOUND`). That is an environment dependency failure before test execution, not an application assertion failure. It is unrelated to Question Bank behavior. Deploy Preview browser verification is reported separately.

## Quality and acceptance boundary

This change does not disable duplicate detection, convert missing evidence into acceptance, alter grounding/depth/format rules, change capacity, rebuild a map, or regenerate either saved bank. The added secondary call occurs only for a primary `rejected_duplicate` verdict that fails the evidence contract.

Automated success establishes that the duplicate decision now follows “No Evidence, No Authority.” It does not establish Pacific 50/50. The next product acceptance step is one controlled, newly identified Pacific Life 50-question run on the Deploy Preview. Compare its saved Gate 8 diagnostics with the preserved Gate 7 24/50 run. If it still safe-stops, use the new rejection distribution to identify the next bottleneck before changing another gate.
