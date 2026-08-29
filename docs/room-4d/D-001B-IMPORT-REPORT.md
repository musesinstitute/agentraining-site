# D-001B — Source Extraction & Master Question Bank V1

**Phase 1: Controlled Import Pilot**

Status: complete. Sources processed: **S003** and **S005** only, per the Phase 1
scope limit. **S001, S002, and S004 were NOT imported** in this task.

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
