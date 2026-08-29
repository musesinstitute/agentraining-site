# Room 4D — Project 001: Insurance License Exam

Status: **Foundation only (D-001A).** No learner-facing UI exists yet. This
document describes the target system; the data model it references lives in
`data/knowledge/project-001/`.

## Goal

Turn insurance licensing knowledge into a structured, teachable, assessable,
and adaptive learning system — instead of a flat pile of practice questions.

## Core Principles

1. **Knowledge First.** The knowledge map is the source of truth. Questions,
   explanations, and assessments are all *derived from* knowledge points —
   never the other way around.
2. **Every piece of knowledge should be teachable.** A knowledge point isn't
   done when it has an ID; it's done when it has a clear explanation someone
   could learn from.
3. **Every knowledge point should be convertible into assessment/practice.**
   Questions reference the knowledge point(s) they test, so coverage gaps are
   visible (which knowledge points have zero questions written against them).
4. **Assessment should identify the underlying knowledge gap.** A wrong
   answer should point back to a specific knowledge point, not just a
   right/wrong tally, so re-teaching can be targeted.
5. **Knowledge should accumulate into reusable institutional memory.** Once
   verified, a knowledge point or explanation is a durable asset — it should
   get reused across questions, learners, and (eventually) other projects,
   not re-derived each time.
6. **Source material and verified authoritative knowledge must be
   distinguishable.** An imported PDF's marked answer is a *claim*, not a
   fact. See `verificationStatus` in the data model below — nothing is
   trusted as correct until it has been through a verification step.

## Long-Term Flow

```
Source Material
  → Knowledge Map
  → Question Bank
  → AI Explanation
  → Adaptive Quiz
  → Wrong Answer Diagnosis
  → Knowledge Gap Detection
  → Targeted Re-teaching
  → New Questions
  → Mastery Assessment
  → Practice Scenario
```

Each arrow is a future capability, not something this task builds. D-001A
only establishes the **Knowledge Map** and the data shapes the rest of the
flow will read and write.

## What This Task (D-001A) Delivers

- A permanent set of 8 knowledge domains (`K01`–`K08`) covering the
  California insurance license exam curriculum, each broken into topics.
- A stub knowledge point for every topic, with a stable, permanent ID
  (`data/knowledge/project-001/knowledge-points.json`).
- A question data schema capable of representing future imported/authored
  questions, including the source-vs-verified answer distinction and support
  for human annotations, memory aids, and bilingual notes found in source
  material (`data/knowledge/project-001/question-schema.json`).
- A source registry recording the five source PDFs supplied for this project
  as metadata placeholders — no question content has been imported yet
  (`data/knowledge/project-001/source-registry.json`).
- A lightweight validation test (`tests/knowledge-architecture.test.mjs`)
  that keeps the above three files internally consistent as they grow.

## What This Task Does NOT Deliver

No exam screens, learner quiz pages, dashboards, AI tutor UI, payment,
authentication, or production APIs. No question content has been authored
or imported. No existing Manager → Assign → Learner → Practice → Results
loop, Netlify Identity, or production behavior was touched.

## Relationship to the Existing `data/curriculum/` System

This repository already has a curriculum system for **sales-practice
scenarios** (`data/curriculum/foundation.json`, `data/cases-*.json`) — an
agent role-playing a customer objection, evaluated on soft-skill criteria.
Project 001 is a **separate, additive** knowledge domain: structured exam
knowledge with right/wrong answers, verification status, and regulatory
sensitivity. It lives in its own `data/knowledge/project-001/` tree and does
not read from or modify the sales-practice data. The two systems may
eventually share learners and a coaching layer, but that integration is out
of scope for D-001A.

## See Also

- `docs/room-4d/KNOWLEDGE-ARCHITECTURE.md` — the data model in detail
  (Domain → Topic → Knowledge Point → Question → Explanation → Assessment →
  Mastery).
