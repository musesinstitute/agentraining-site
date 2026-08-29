# Room 4D — Knowledge & Curriculum Architecture

This document describes the data model backing Room 4D / Project 001. It is
the reusable pattern intended for future Room 4D projects beyond insurance
licensing, not a one-off schema.

```
Domain → Topic → Knowledge Point → Question → Explanation → Assessment → Mastery
```

## Files

All files live under `data/knowledge/project-001/`:

| File | Purpose |
|---|---|
| `domains.json` | The 8 permanent knowledge domains and their topics. |
| `knowledge-points.json` | Individual, permanently-ID'd units of knowledge, grouped by domain/topic. |
| `question-schema.json` | JSON Schema describing a valid Question record (not question data itself). |
| `source-registry.json` | Metadata about the source material batches/documents knowledge and questions are derived from. |

## Layer 1 — Domain

A **Domain** is a top-level subject area with a permanent ID (`K01`–`K08`).
Domain IDs are never reused or renumbered — a retired domain would be marked
inactive, not deleted, once real content depends on it.

```json
{ "id": "K01", "order": 1, "name": "Insurance Fundamentals", "description": "…", "topics": ["Risk", "…"] }
```

`order` controls display/curriculum sequencing only — it is not part of the
identity of the domain and must never be relied on for references.

## Layer 2 — Topic

A **Topic** is a named subdivision of a domain (e.g. `K01`'s topics include
"Risk", "Hazard", "Law of Large Numbers"). Topics are plain strings scoped to
their domain in `domains.json`; they are not separately ID'd because a
knowledge point's own ID already encodes domain + topic (see below), and a
topic's only job is to group knowledge points for humans browsing the map.

## Layer 3 — Knowledge Point

A **Knowledge Point** is the smallest teachable/assessable unit. It has a
permanent ID of the form:

```
<domainId>-<TOPIC-SLUG>-<sequence>
```

e.g. `K01-RISK-001`. The topic slug is derived once from the topic name and
then frozen — renaming the topic's display label later does not change
existing knowledge point IDs. `<sequence>` (`001`, `002`, …) lets a topic
grow multiple knowledge points over time (e.g. `K01-RISK-002` for a more
granular point under "Risk") without ever touching an existing ID.

Fields:

```json
{
  "id": "K01-RISK-001",
  "domainId": "K01",
  "topic": "Risk",
  "title": "Risk",
  "concept": "",
  "learningObjective": "",
  "difficulty": 1,
  "examImportance": null,
  "prerequisites": [],
  "relatedKnowledgePoints": [],
  "sourceRefs": [],
  "verificationStatus": "unverified",
  "verifiedAt": null,
  "verifiedSource": null,
  "tags": []
}
```

- `prerequisites` / `relatedKnowledgePoints` are arrays of other knowledge
  point IDs — this is how the map expresses learning order and cross-links,
  and is what a future "knowledge gap" feature would traverse.
- `sourceRefs` links back to `source-registry.json` entries (and eventually
  specific pages/sections) that informed this point.
- `verificationStatus` mirrors the question-level status below: a knowledge
  point's `concept`/`title` should not be treated as authoritative teaching
  content until it's been verified, even if it's been drafted.

D-001A seeds exactly one stub knowledge point per topic (91 total across the
8 domains) — enough to give every topic in the curriculum a stable, citable
ID before any real content is written. Filling in `concept`,
`learningObjective`, and splitting a topic into multiple knowledge points is
future content work, not part of this task.

## Layer 4 — Question

A **Question** is a single assessment item, validated against
`question-schema.json`. The critical design decision here:

**`sourceAnswer` and `verifiedAnswer` are separate fields, on purpose.**

Imported exam PDFs mark an answer, but that mark is a claim from an
unverified source, not ground truth — it can be wrong, outdated, or
mis-scanned. `sourceAnswer` preserves what the source said; `verifiedAnswer`
is only populated once a human or authoritative reference has actually
confirmed it. Scoring logic should read `verifiedAnswer` once
`verificationStatus` supports it, never `sourceAnswer` directly.

`verificationStatus` (shared vocabulary across knowledge points and
questions):

| Status | Meaning |
|---|---|
| `unverified` | Nothing has been checked yet. |
| `source-confirmed` | Matches what the source material says, but no independent/authoritative check has happened. |
| `authoritatively-verified` | Confirmed against a trusted reference (law text, official study guide, subject-matter expert). |
| `needs-review` | Previously verified but something (a regulatory change, a reported error) has cast doubt on it. |
| `outdated` | Known to be no longer correct (e.g. a superseded contribution limit or licensing rule). |

`regulatorySensitivity: true` flags questions whose correctness depends on
law/tax/regulation that changes over time (contribution limits, licensing
rules, tax code references) — these should be periodically re-checked even
after being marked `authoritatively-verified`, unlike a purely conceptual
question.

Each question also carries `humanAnnotations[]`, `memoryAids[]`, and
`bilingualNotes[]` — see "Human Teaching Data" below.

## Layer 5 — Explanation

Not yet a separate file in D-001A. A question's `answerExplanation` and
`wrongAnswerExplanations` (per-choice, so a wrong answer can be diagnosed
down to *which* misconception it reflects) are the seed of this layer.
Knowledge-point-level explanations belong in `concept`/`learningObjective`.
A dedicated `explanations.json` (for AI-generated or reusable teaching
content) is expected in a later Project 001 task once real question content
exists to explain.

## Layer 6 — Assessment

Out of scope for D-001A (no quiz UI). The architecture is designed so an
assessment layer can be built by grouping questions by knowledge point and
recording per-attempt correctness against `verifiedAnswer` — no schema
changes anticipated, just new consumers of this data.

## Layer 7 — Mastery

Out of scope for D-001A. The intended shape: a per-learner, per-knowledge-
point mastery record, derived from assessment history, that a "targeted
re-teaching" feature would read to decide what to show next. This is why
knowledge point IDs must be permanent and stable now — a mastery record has
no meaning if the knowledge point it's keyed to disappears or gets
renumbered.

## Human Teaching Data

The source PDFs contain more than raw question text: Chinese explanations,
memory aids, highlighted words, stars, underlines, previously-selected
answers, and vocabulary distinctions written by hand. These are treated as
first-class data, not discarded during import:

- `humanAnnotations[]` — raw markings (stars, underlines, highlights,
  selected answers, margin notes) with their type and content preserved.
- `memoryAids[]` — mnemonic devices, optionally tied to a specific
  knowledge point.
- `bilingualNotes[]` — paired-language notes (e.g. a Chinese explanation of
  an English term), kept as primary/translation pairs rather than merged
  into one field.

These are structured this way because they are expected to become AI
coaching/teaching assets later (e.g. surfacing a human's own memory aid back
to them, or using annotation density as a signal of exam importance) — losing
them at import time would be a one-way door.

## Source Registry

`source-registry.json` groups source documents into batches
(`PROJECT001-SOURCE-BATCH-001` for the initial 5 PDFs: `S001`–`S005`). It is
metadata only — `importStatus` (`not-imported` initially) and
`verificationStatus` track the *document*, independent of any question
already extracted from it. The PDFs themselves are not committed as part of
this task.

## Validation

`tests/knowledge-architecture.test.mjs` (run via `npm test`) checks:

- Domain IDs are unique.
- Knowledge point IDs are unique.
- Every knowledge point's `domainId` references a real domain.
- Every `relatedKnowledgePoints` / `prerequisites` reference resolves to a
  real knowledge point ID.
- `verificationStatus` values (knowledge points and, where present, sample
  question fixtures) are from the allowed set.
- `question-schema.json` is a well-formed JSON Schema and its `required`
  list covers the core question fields described above.
- Source registry `sourceId`s are unique and batch membership is consistent.

This is intentionally a small `node:test` file, not a standalone validation
framework — consistent with how the rest of this repository tests its data
(see `tests/pilot-invite.test.mjs` for the existing pattern).
