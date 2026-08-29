# D-001B — Source Extraction & Master Question Bank V1

**Phase 1: Controlled Import Pilot**

Status: complete, and reconciled. Sources processed: **S003** and **S005**
only, per the Phase 1 scope limit. **S001, S002, and S004 were NOT
imported** in this task. See **"Architecture Reconciliation"** at the end
of this document for D-001B.1, which stress-tested the knowledge map
against these 67 real questions and corrected several mappings below
before large-scale import proceeds — sections above that D-001B.1 changed
are marked with a pointer rather than rewritten, to keep an accurate
history of what D-001B originally produced.

## Sources processed

| Source ID | File | Pages processed | Questions extracted | Domain(s) |
|---|---|---|---|---|
| S003 | 执照题3.pdf | 10 of 10 | 46 | K01, K02, K06, K07 (Insurance Fundamentals, Contracts, Underwriting/Operations, CA Law & Regulation) |
| S005 | 执照题6(1).pdf | 5 of 5 | 21 | K08 (Social Security & Retirement Benefits) |
| **Total** | | **15 pages** | **67 questions** | |

Both PDFs were provided by the user directly to this session (they are not
committed to the repository — consistent with the D-001A source registry's
"metadata only" policy). Every page of both documents was read and every
visible question, choice, checkmark/star, and handwritten annotation was
transcribed.

## Extraction methodology

Both source files consist of typed English question stems and answer choices
with hand-marked correct answers (checkmark and/or star) and handwritten
Chinese annotations (explanatory notes, mnemonics, vocabulary distinctions).
No text in either source was found to be illegible or uncertain — both PDFs
are clean, legible, single-column layouts, so **no records were flagged
uncertain/illegible in this batch** (this is expected to differ for S001,
S002, and S004, which the source registry notes are Chinese-titled and may
contain different formatting).

**Human annotation extraction policy** (documented here per the source
discipline rules, since this required a judgment call): both source PDFs
underline several phrases within nearly every question stem and choice,
generally to emphasize key vocabulary already present in the printed text.
Rather than transcribing every single underline as a separate
`humanAnnotations` entry (which would have produced several hundred
low-information entries), underlines that merely re-emphasize the printed
question text were folded into a single `highlight`-type annotation per
question when they seemed collectively meaningful, or omitted when the
underlined phrase added no information beyond what the question text itself
already shows. Every annotation that adds genuinely new information not in
the plain question text — a checkmark/star marking the selected answer, a
handwritten Chinese explanation, a mnemonic, a vocabulary gloss, a
term-distinguishing note (e.g. moral vs. morale hazard), or an unusual/
unexplained mark (e.g. the orange hexagon on `Q-S003-010`) — was preserved
as its own `humanAnnotations`, `memoryAids`, or `bilingualNotes` entry. This
is a extraction-fidelity trade-off made for this pilot; a production import
pass could re-visit the source pages to capture every individual underline
if a future use case needs that granularity.

**No question text, choice, or answer was invented, corrected, or
reworded.** Where a question's marked answer looked potentially questionable
under scrutiny (see `Q-S005-002` / `Q-S005-018` below), the source's mark
was still recorded as `sourceAnswer` and the concern was routed to the
duplicate-groups/verification-queue files rather than silently "fixed."

## Files created

- `data/knowledge/project-001/questions/S003.json` — 46 question records.
- `data/knowledge/project-001/questions/S005.json` — 21 question records.
- `data/knowledge/project-001/import/duplicate-groups.json` — 1 duplicate group.
- `data/knowledge/project-001/import/verification-queue.json` — 67 queue entries (one per extracted question).
- `tests/knowledge-questionbank.test.mjs` — 20 new validation assertions.
- `docs/room-4d/D-001B-IMPORT-REPORT.md` — this file.

## Files modified

- `data/knowledge/project-001/domains.json` — appended **one** new topic,
  `"Insurer Organizational Types"`, to domain K01's topic list (additive
  only; none of the 91 existing D-001A topics were renamed, reordered, or
  removed).
- `data/knowledge/project-001/knowledge-points.json` — added **2** new
  knowledge points (see "New knowledge points" below). All 91 existing
  D-001A knowledge points are untouched.
- `data/knowledge/project-001/question-schema.json` — additively extended
  the `bilingualNote` definition with two new optional properties, `term`
  and `note` (see "Schema gaps discovered" below). No existing required
  fields or property definitions were changed or removed.

No file outside `data/knowledge/project-001/`, `docs/room-4d/`, and
`tests/` was touched.

## Extraction counts

- **S003 questions extracted:** 46 (all 46 questions visible across the
  document's 10 pages were extracted; none were skipped).
- **S005 questions extracted:** 21 (all 21 questions visible across the
  document's 5 pages were extracted; none were skipped).
- **Total question count:** 67.
- **Uncertain/illegible records:** 0 (both sources were fully legible; see
  "Extraction methodology" above).

## Knowledge mapping

- **67 of 67 questions (100%) were mapped** to one or more existing or
  newly-added D-001A knowledge point IDs. No question was left unmapped.
- Of these, **65 questions (97%)** mapped cleanly to one of the **91
  existing** D-001A knowledge points (several with more than one
  `knowledgePointIds` entry where a question genuinely spans two related
  concepts, e.g. materiality + representation).
- **2 questions** required a **new** knowledge point (see below);
  **5 additional questions** were mapped to an existing knowledge point
  under an explicitly-noted "approximate/soft mapping" (documented per
  question in `sourceNotes`, and summarized under "Schema gaps discovered").
- All 21 S005 questions mapped directly onto the pre-existing K08 domain's
  10 topics with no gaps — S005's content matched the D-001A knowledge map
  almost exactly.

## Duplicate detection

**1 duplicate group** was found (no exact duplicates; one conceptual
duplicate):

- **`DG-001`** (`conceptualDuplicate`, confidence: high) — `Q-S005-002` and
  `Q-S005-018` share the identical stem *"From the choices below select the
  one which is false about Social Security (OASDHI)"* with overlapping but
  not identical answer choices, and a **different** choice marked as the
  false statement in each version (`Q-S005-002` marks "benefits closely
  match contributions" as false; `Q-S005-018` marks "the program is fully
  funded" as false). Both are commonly-tested true facts about OASDHI
  (benefits are *not* closely tied to individual contributions, and the
  system is *not* fully pre-funded), so the two versions are not strictly
  contradictory — but the repetition across two source variants, on the
  same underlying "false statement about Social Security" concept, is
  exactly the kind of duplicate the task asked to preserve as a signal of
  exam importance, and it warranted a closer look (see verification queue,
  P0).

No exact duplicates were found within or across S003/S005 in this batch.

## Verification queue

Every one of the 67 extracted questions was added to the queue, since **no
question in this phase has an independently verified answer** — a
handwritten/checked answer in the source is evidence, not verification, per
the task's source-discipline rules.

| Priority | Count | Basis |
|---|---|---|
| **P0** | 2 | `Q-S005-002` and `Q-S005-018` — the conflicting/duplicate OASDHI pair (see DG-001 above). |
| **P1** | 43 | `regulatorySensitivity: true` — law, tax, licensing, or Social Security rules that can change over time. |
| **P2** | 22 | Ordinary answer verification — non-regulatory content, source-marked answer plausible but unconfirmed. |
| **P3** | 0 | No editorial-cleanup-only cases in this batch (no illegible/uncertain text). |
| **Total** | 67 | |

**No authoritative web verification was performed**, per the task's explicit
instruction — this queue is a work list for a later verification phase.

## Regulatory-sensitive count

**45 of 67 questions (67%)** were flagged `regulatorySensitivity: true`:

- **24 of 46** S003 questions — those citing specific California Insurance
  Code sections/day-counts (e.g. Section 1729.2's 30-day reporting rule),
  Commissioner authority, licensing classifications, the Guaranty
  Association's covered-policy list, and statutory-interpretation rules
  (e.g. "may" = permissive).
- **All 21 of 21** S005 questions — every Social Security rule tested
  (quarters of coverage thresholds, insured-status definitions, retirement
  age, blackout period, disability qualification periods, payroll tax
  split, funding status) is federally legislated and has changed via
  amendment historically, so all were treated as time-sensitive.

## New knowledge points created

*(Superseded in part by D-001B.1 — see "Architecture Reconciliation" below:
`K07-CALIFORNIA-INSURANCE-CODE-002` described here was relocated to
`K07-RATE-REGULATION-001`, and 2 further knowledge points were added.)*

**2 new knowledge points** were added, both because the tested concept had
no reasonable existing home in the 91-point D-001A map (per "do not force a
clearly mismatched question into an existing knowledge point"):

1. **`K01-INSURER-ORGANIZATIONAL-TYPES-001`** — "Insurer Organizational
   Types (Stock, Mutual, Reciprocal, Fraternal)", added under a **new**
   topic (`"Insurer Organizational Types"`) appended to domain K01. Needed
   for `Q-S003-024` ("Which type of insurer is owned by its
   policyholders?"). None of K01's original 8 topics or K06's 11 topics
   cover insurer ownership/organizational structure as a concept.
2. **`K07-CALIFORNIA-INSURANCE-CODE-002`** — "Rate Regulation Systems
   (File-and-Use, Use-and-File, Prior Approval, State-Mandated)", added as
   a second knowledge point under the *existing* K07 topic "California
   Insurance Code" (no new topic needed here). Needed for `Q-S003-004`
   (insurer rate-filing jurisdiction types). No existing K07 topic covers
   rate-filing systems.

Both additions are purely additive: no existing domain, topic, or knowledge
point ID from D-001A was renamed, renumbered, or removed.

## Schema gaps discovered

*(Superseded in part by D-001B.1 — see "Architecture Reconciliation" below:
gaps #2 (Warranty) and #4 (Federal offenses) were resolved with new
permanent knowledge points; gaps #3's two sub-cases were reviewed and each
resolved differently — see the reconciliation section for the reasoning
kept per-case.)*

1. **`bilingualNote` needed richer fields.** D-001A's `question-schema.json`
   modeled a bilingual note as `{primary, primaryLanguage, translation,
   translationLanguage}`. Several source annotations are better expressed
   as a specific glossed *term* plus a free-text *distinguishing note* (e.g.
   contrasting "moral hazard" vs. "morale hazard", or "pure risk" vs.
   "speculative risk") rather than a flat sentence translation. Resolved by
   additively extending the definition with two new **optional** properties,
   `term` and `note`, alongside the existing required `primary`/
   `translation` — no existing consumer or required field was changed.
2. **No "Warranty" concept distinct from Representation/Concealment.**
   `Q-S003-012` tests breach of a material warranty and the remedy of
   rescission — a concept related to, but technically distinct from,
   misrepresentation/concealment. Rather than force a new knowledge point
   for a single question in a two-source pilot, it was mapped to the
   closest existing points (`K02-MATERIALITY-001`, `K02-CONCEALMENT-001`)
   with an explicit `sourceNotes` flag. **Recommendation:** consider adding
   a dedicated "Warranty" knowledge point in a future architecture review
   if more warranty-specific questions surface during S001/S002/S004
   import.
3. **No "insurer expense categories" or "distribution channel" concepts.**
   `Q-S003-010` (insurer expenses) and `Q-S003-017` (direct-response
   distribution) were mapped to the closest existing points
   (`K06-PREMIUM-DETERMINATION-001`, `K07-AGENT-001` respectively) with
   explicit approximate-mapping notes rather than forcing an exact fit or
   inventing narrow one-off knowledge points for single questions.
   **Recommendation:** revisit if later sources surface more questions on
   these sub-topics.
4. **No "Federal offense / 18 U.S.C. §1033-style" concept distinct from CA
   licensing.** `Q-S003-007` tests a federal (not California-specific)
   insurance-crime boundary; mapped to `K07-LICENSING-001` as the closest
   fit, flagged as approximate.
5. **`sourceQuestionNumber` cannot be populated for these two sources** —
   neither S003 nor S005 prints a question number anywhere on the page.
   Every record's `sourceQuestionNumber` is `null` with a `sourceNotes`
   explanation, per the "do not invent missing question text" rule; the
   sequence encoded in each `questionId` (`Q-S003-001`, etc.) is this
   import's own bookkeeping order, not a source-printed number.

None of these gaps blocked extraction; all are documented per-question via
`sourceNotes` and summarized here for the next architecture review.

## Extraction limitations

- Limited to the two Phase 1 sources (S003, S005) by design — S001, S002,
  and S004 remain unprocessed.
- Underline-only emphasis annotations were consolidated rather than
  transcribed individually (see "Extraction methodology" above); a future
  pass could capture full underline-level fidelity if a use case needs it.
- `answerExplanation` and `wrongAnswerExplanations` were left empty for all
  67 questions — the source material marks a correct answer but does not
  print a rationale, and inventing one would violate the "do not invent"
  rule. Populating these is future authored/verified content work, not
  extraction.
- No OCR was required (both PDFs contain selectable/renderable typed text
  and hand-annotations legible directly from the rendered page images), so
  no OCR-specific caveats apply to this batch.
- No cross-reference against S001/S002/S004 was possible yet (not
  imported), so duplicate detection in this phase is necessarily limited to
  within-S003 and within-S005 (plus the S003×S005 comparison, which found
  no overlap, as expected given they cover disjoint domains).

## Confirmation: no production functionality touched

All changes are confined to `data/knowledge/project-001/`, `docs/room-4d/`,
and `tests/`. No file under `netlify/`, no top-level `.html` file (manager,
pilot, simulator, client, etc.), no Identity code, and no existing
sales-practice curriculum data (`data/curriculum/`, `data/cases-*.json`,
`data/case-tag-taxonomy.json`) was read from or written to. No new
production runtime dependency was added (`package.json` is unchanged). No
UI was built. No external AI API was called. Nothing was deployed or
merged.

---

## Architecture Reconciliation

**Task: D-001B.1.** Before any large-scale import of S001/S002/S004, this
task used the 67 real questions already extracted from S003/S005 to
stress-test and reconcile the D-001A knowledge map: every soft/approximate
mapping and every reported schema gap was individually re-examined, the two
knowledge points added during D-001B extraction were checked for correct
placement, and the map was corrected where the review found a genuine
issue. No source wording, choices, or annotations were touched; no
`sourceAnswer` was changed; no `verifiedAnswer` was set; no authoritative
verification was performed.

### Review of the 2 points added during D-001B extraction

| Knowledge point | Verdict | Reasoning |
|---|---|---|
| `K01-INSURER-ORGANIZATIONAL-TYPES-001` | **Confirmed as-is** | Insurer ownership structure (stock / mutual / reciprocal / fraternal) is a genuinely distinct, universally-tested insurance-fundamentals concept. Domain (K01) and topic are correctly located; no change made. |
| `K07-CALIFORNIA-INSURANCE-CODE-002` | **Relocated** → `K07-RATE-REGULATION-001` | The concept itself (rate-filing systems: file-and-use / use-and-file / prior approval / state-mandated) is genuinely distinct and correctly warranted a new point — but it had been nested under the generic "California Insurance Code" catch-all topic, which is D-001A's definitional/miscellaneous bucket (it already also holds 3 unrelated single facts — admitted-carrier definition, primary objectives of regulation, and the "may"-is-permissive interpretation rule). Rate regulation is a specific, self-contained regulatory mechanism, structurally more like K07's other dedicated-topic mechanisms (Guaranty Association, Policy Illustration Rules, Claims Rules) than like the generic code-definitions bucket. Relocated to its own new topic, "Rate Regulation," with a fresh ID. This ID had existed for one commit on this unmerged feature branch only (never referenced by production or by any other branch), so the rename was a safe, contained correction — `Q-S003-004` is the only question that referenced it, and its mapping was updated in place. |

### Investigation of the 5 soft/approximate mappings and reported gaps

| # | Question(s) | Concept | Verdict | Resulting knowledge point(s) |
|---|---|---|---|---|
| 1 | `Q-S003-012` | **Warranty** | **New permanent point created** | `K02-WARRANTY-001` (new topic "Warranty" under K02) |
| 2 | `Q-S003-010` | **Insurer expense concepts** | **No new point — reviewed and accepted** | Kept: `K06-PREMIUM-DETERMINATION-001` |
| 3 | `Q-S003-017` | **Insurance distribution channels** | **No new point — deferred, not accepted** | Kept: `K07-AGENT-001`, marked as an open watch item |
| 4 | `Q-S003-007` | **Federal insurance offenses** | **New permanent point created** | `K07-FEDERAL-INSURANCE-OFFENSES-001` (new topic under K07), `K07-LICENSING-001` kept as a secondary reference |
| 5 | `Q-S003-030` | NAIC financial statement filing cadence | **No new point — reviewed and accepted** | Kept: `K07-RECORD-REQUIREMENTS-001` |

Reasoning for each, applying the rule *"do not create a knowledge point
merely because one question uses a different phrase — only when it
represents a genuinely distinct examinable concept"*:

1. **Warranty — new point warranted.** Breach of a material *warranty* is
   not the same doctrine as misrepresentation or concealment: a warranty is
   a promise incorporated directly into the policy, and its breach lets the
   insurer rescind *regardless of materiality* — the opposite of how
   representation/concealment work, where materiality is exactly what
   decides the outcome. Representation-vs-warranty is one of the standard,
   recurring distinctions taught and tested on insurance license exams, so
   this comfortably clears the "genuinely distinct" bar even on one
   question's evidence. Added `K02-WARRANTY-001` (topic "Warranty", new,
   under K02) with `prerequisites: ["K02-ELEMENTS-OF-A-CONTRACT-001"]` and
   `relatedKnowledgePoints` linking it to `K02-REPRESENTATION-001`,
   `K02-MATERIALITY-001`, and `K02-CONCEALMENT-001` — the concepts it is
   classically contrasted against. `Q-S003-012` was remapped from
   `[K02-MATERIALITY-001, K02-CONCEALMENT-001]` to `[K02-WARRANTY-001]`
   exclusively.
2. **Insurer expense concepts — not distinct enough on current evidence.**
   The question tests one narrow fact (a policy premium is the insurer's
   *revenue*, not one of its *expenses*) rather than a rich, multi-facet
   concept family. This is exactly the "different phrase" case the rule
   warns against manufacturing a permanent ID for. Kept mapped to
   `K06-PREMIUM-DETERMINATION-001`; `sourceNotes` updated to record this as
   a reviewed-and-accepted decision, not an open gap, with an explicit
   note to revisit only if more insurer-expense/accounting questions
   surface from S001/S002/S004.
3. **Distribution channels — plausible, but insufficient evidence yet.**
   Agent vs. broker vs. direct-response distribution is a real regulatory/
   marketing topic on some exams, and could justify its own knowledge point
   — but exactly one question in this batch touches it. Creating a
   permanent ID on one question's evidence, before knowing whether it
   recurs, risks exactly the "different phrase" over-creation the rule
   guards against. Left mapped to `K07-AGENT-001`, but *unlike* case #2,
   this is recorded as an explicitly **deferred** decision (not a settled
   one) pending more evidence from the remaining sources.
4. **Federal insurance offenses — new point warranted.** This question
   tests federal (not California) law — insurance-crime prohibitions in the
   style of 18 U.S.C. §1033 (felony-conviction bar, embezzlement, false
   statements to regulators) — a distinct, nationally-recurring exam topic
   separate from state licensing procedure. Added
   `K07-FEDERAL-INSURANCE-OFFENSES-001` (topic "Federal Insurance
   Offenses", new, under K07) with `prerequisites:
   ["K07-LICENSING-001"]` and `relatedKnowledgePoints` to
   `K07-LICENSING-001` and `K07-BACKGROUND-INFORMATION-001`. `Q-S003-007`
   was remapped to `[K07-FEDERAL-INSURANCE-OFFENSES-001,
   K07-LICENSING-001]` (kept as a secondary reference, since the felony-
   conviction-plus-Commissioner-consent choice sits at the intersection of
   both concepts).

   **Domain-naming tension (unresolved, flagged below):** K07 is named
   *"California Insurance Law & Regulation,"* but this new topic is
   federal, not California-specific. It was placed in K07 anyway because
   that is where the real exam tests it (alongside state licensing
   content), and D-001A has no separate federal-law domain. This naming
   mismatch is recorded as an open architecture question rather than
   resolved unilaterally here.
5. **NAIC filing cadence — not distinct enough on current evidence.** A
   single fact (annual filing frequency) that fits comfortably inside the
   already-existing, intentionally broader "Record Requirements" topic.
   Kept mapped to `K07-RECORD-REQUIREMENTS-001`; `sourceNotes` updated to
   record this as reviewed-and-accepted.

### Other overly-broad mappings and multi-point mappings reviewed

The generic **"California Insurance Code"** topic (`K07-CALIFORNIA-
INSURANCE-CODE-001`) still carries 3 unrelated single facts (admitted-
carrier definition, primary objectives of insurance regulation, and the
"may"-is-permissive interpretation rule) after this reconciliation. Each
was individually assessed against the same "genuinely distinct concept"
bar and, on the evidence of one question each, none currently clears it.
This is recorded as an **open watch item**, not a resolved gap: if
S001/S002/S004 surface recurring questions on any one of these three
facts, each should be re-evaluated for its own knowledge point at that
point, following the same reasoning applied to Warranty and Federal
Insurance Offenses above.

**Multi-`knowledgePointIds` mappings** already present in the D-001B
extraction (16 questions spanning two or three knowledge points, e.g.
`Q-S003-008` → Materiality + Representation, `Q-S005-009` → Blackout
Period + Survivor Benefits + Fully Insured) were reviewed and found
appropriately scoped — each reflects a question genuinely testing more
than one concept, not a mapping uncertainty being papered over with extra
tags. No multi-point mapping was collapsed to a single point, and no
single-point mapping needed to be split into multiple, beyond the two
corrections described above (`Q-S003-007`, `Q-S003-012`).

### Knowledge-graph enrichment (prerequisites / relatedKnowledgePoints)

Beyond the edges added for the 2 new knowledge points above, **28
`relatedKnowledgePoints` edges were added across 22 existing knowledge
points**, added bidirectionally and purely additively (no existing edge
removed) wherever two knowledge points were **actually observed
co-occurring** on the same question across the 67-question set — this uses
real exam evidence rather than guessing at a taxonomy. Examples: `K01-RISK-
001` ↔ `K01-RISK-MANAGEMENT-001`; `K02-REPRESENTATION-001` ↔
`K02-MATERIALITY-001` and ↔ `K02-CONCEALMENT-001`; `K07-INSURANCE-
COMMISSIONER-001` ↔ `K07-LICENSING-001` and ↔ `K07-GUARANTY-ASSOCIATION-
001`; `K06-UNDERWRITING-001` ↔ `K06-RISK-CLASSIFICATION-001`; and 6 pairs
within the K08 Social Security domain (e.g. `K08-BLACKOUT-PERIOD-001` ↔
`K08-SURVIVOR-BENEFITS-001` ↔ `K08-FULLY-INSURED-001`). No new
`prerequisites` edges were added beyond the two new knowledge points' own
(`K02-WARRANTY-001` → `K02-ELEMENTS-OF-A-CONTRACT-001`;
`K07-FEDERAL-INSURANCE-OFFENSES-001` → `K07-LICENSING-001`) — asserting a
strict learning-order dependency on existing D-001A points without stronger
evidence felt like overreach for this reconciliation pass.

### Reconciliation counts

- **Original knowledge points (D-001A):** 91
- **Points added during extraction (D-001B):** 2
  (`K01-INSURER-ORGANIZATIONAL-TYPES-001`, `K07-CALIFORNIA-INSURANCE-CODE-002`)
- **Additional points added during reconciliation (D-001B.1):** 2
  (`K02-WARRANTY-001`, `K07-FEDERAL-INSURANCE-OFFENSES-001`)
- **Points relocated (not counted as new — same concept, corrected home) during reconciliation:** 1
  (`K07-CALIFORNIA-INSURANCE-CODE-002` → `K07-RATE-REGULATION-001`)
- **Final knowledge-point count:** **95** (91 + 2 + 2; the 1 relocation is a rename, not a net addition)
- **New topics added:** 3 (`Warranty` under K02; `Federal Insurance Offenses` and `Rate Regulation` under K07) — all additive, no existing topic renamed or removed
- **Soft/approximate mappings before reconciliation:** 5
  (`Q-S003-007`, `Q-S003-010`, `Q-S003-012`, `Q-S003-017`, `Q-S003-030`)
- **Soft/approximate mappings after reconciliation:** 1 open (`Q-S003-017`,
  explicitly deferred pending more evidence) + 2 reviewed-and-accepted as
  correctly-scoped narrow mappings, not open gaps (`Q-S003-010`,
  `Q-S003-030`) — i.e., **0 mappings remain flagged as unresolved gaps**
  requiring a decision; 1 remains an intentionally open watch item.
- **Questions remapped:** 2 (`Q-S003-004` to the relocated
  `K07-RATE-REGULATION-001`; `Q-S003-007` and `Q-S003-012` to the 2 new
  points — `Q-S003-007` gained a point while keeping its existing
  secondary reference, `Q-S003-012` was narrowed from 2 points to 1)
- **Multi-point mappings introduced by this reconciliation:** 0 new
  (the existing 16 multi-point questions from D-001B were reviewed and
  left unchanged; `Q-S003-007` already had a second reference before and
  after, `Q-S003-012` went from 2 points to 1)
- **relatedKnowledgePoints edges added:** 28 (across 22 existing knowledge
  points, all evidence-based from co-occurrence, all additive)
- **Unresolved architecture gaps carried forward:**
  1. The domain-naming tension between K07 ("California Insurance Law &
     Regulation") and the newly-added, federally-scoped "Federal Insurance
     Offenses" topic — flagged for a future architecture decision (broaden
     K07's description, or split out a dedicated federal-law domain if
     federal content grows with S001/S002/S004).
  2. `Q-S003-017` (insurance distribution channels) remains an open,
     explicitly-deferred watch item rather than either a permanent
     knowledge point or a fully "accepted" mapping.
  3. The generic "California Insurance Code" topic still holds 3 unrelated
     single-fact mappings; each is individually watched for recurrence in
     future imports rather than pre-emptively split.

### Validation after reconciliation

- `data/knowledge/project-001/knowledge-points.json`: all 95 knowledge
  point IDs unique; every `domainId` resolves; every `relatedKnowledgePoints`
  and `prerequisites` reference resolves to a real knowledge point ID with
  no self-references (verified directly, and via `tests/knowledge-
  architecture.test.mjs`).
- `data/knowledge/project-001/questions/S003.json` /
  `.../S005.json`: all 67 questions' `knowledgePointIds` resolve to a real
  (post-reconciliation) knowledge point; no `sourceAnswer`, choice, question
  text, or annotation was altered; no `verifiedAnswer` was set (all remain
  `null`); no `verificationStatus` was changed (all remain `unverified`).
- `npm test`: **99 pass / 1 fail** — the 1 failure
  (`tests/browser-invite-flow.test.mjs`) is the same pre-existing, unrelated
  failure confirmed on a clean `master` checkout in the D-001A/D-001B
  rounds; not touched, per instructions not to fix unrelated repo failures.
  All 39 Room 4D knowledge-architecture and question-bank assertions
  (`tests/knowledge-architecture.test.mjs` +
  `tests/knowledge-questionbank.test.mjs`) pass.
