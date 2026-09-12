# Knowledge-to-Training Engine — Pilot Implementation Plan

Approved scope for the current Pilot iteration.

## Goal
Pilot Home → Company Knowledge → Upload/Open Document → Document-grounded AI → Question Bank → Practice Scenarios → Manager Review → Assign → Learner Practice → AI Feedback

## P0 — Question Bank reliability
- Keep 20 / 50 / 100 question options.
- Generate large banks in resilient batches rather than one synchronous 100-question request.
- Persist each completed batch progressively in team-scoped storage.
- Expose visible progress, e.g. 40 / 100 completed.
- Retry failed batches without discarding completed questions.
- Resume from persisted progress when possible.
- Detect obvious duplicates before final save.
- Ground every question in the selected company document.
- Prefer source/page references where extraction metadata supports it.

## P0 — Practice Scenarios
Managers can generate realistic training scenarios grounded in the open company document. Generated scenarios must enter the existing Practice workflow rather than create a parallel system.

## P0 — Existing Pilot governance integration
Preserve Manager Review → Approve → Assign → Learner Practice → AI Feedback. Do not replace working team isolation, manager authorization, or the legacy knowledge.html governance fallback unless necessary.

## Preserve
- Company Training Library
- PDF + AI split-pane workspace
- bilingual EN / 中文 behavior
- PilotCloud authentication/session behavior
- team isolation
- manager-only writes
- existing Company Knowledge approval / assignment semantics

## Not in this iteration
- cosmetic summary redesign
- full multi-week Training Module builder
- Living Knowledge / automatic version-diff system
- broad navigation redesign outside the Pilot Company Knowledge path

## Acceptance path
1. Manager enters Company Knowledge from Pilot.
2. Manager uploads or opens a real insurance company document.
3. AI answers questions strictly from that document.
4. Manager generates 20, 50, or 100 training questions.
5. 100-question generation survives long-running generation through batching/progressive persistence.
6. Manager can reopen/recover generated results.
7. Manager generates Practice Scenarios from the document.
8. Manager reviews/approves and assigns a scenario.
9. Learner receives and completes Practice.
10. AI feedback and manager visibility remain connected to the existing Pilot workflow.
