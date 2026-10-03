# Formal Coach composer regression — September 10, 2026

Branch: knowledge-training-engine. PR #22 only. Do not merge master.
Baseline: f375dd5b6481b1f69f23d8aeb84ee9bf057eb21f.

## Reproduced findings

The actual authenticated Deploy Preview formal learner page successfully sent the exact underwriting philosophy question by typing and clicking Send at the baseline. It returned the correct source, PASS and pilot-coach-source. Therefore a universal Send/no-response failure was not reproduced and must not be claimed as diagnosed.

A specific no-message state WAS reproduced: choose the available blank coaching-context option, type the question, then click Send. The user-message count remained 39 before/after. `contextRequest()` rejected the empty selection, and `sendMessage()` caught that exception and returned before adding a message or making a request; it only wrote a small side/context notice. Send remained enabled. The repair disables Send when the context is invalid and shows the reason next to the composer. Loading and recording states also have explicit notices.

The prior source-routing fix added a separate context-selection block above the composer, increasing its height and moving the controls down. The Edge voice installer also searched for `button[type="submit"]`, but Send lacked that explicit attribute. `insertBefore(Speak, null)` appended Speak AFTER Send. That selector mismatch already existed at 6ec19bd; it was not caused by removing the AI gateway override. The repair declares Send's type and gives the installer a stable Send-ID fallback. Input can shrink without pushing buttons out of the row; Speak and Send keep stable widths. Context selection is now in Assignment Inbox.

A typed generic question previously stayed in the selected Company Knowledge mode unless a generic starter/context was selected. The repair recognizes a small, anchored set of explicit generic intents at request construction and still carries explicit mode and source IDs to the router. It does not reintroduce mutable routing state or the Edge gateway.

## Files changed

- coach-chat.html
- netlify/edge-functions/ai-relationship-onboarding.ts
- tests/coach-routing.test.mjs
- docs/engineering/coach-composer-regression.md

No grounded backend, source retrieval, generation prompt, verifier or generic endpoint was changed.

## Automated verification

96/96 non-browser tests passed, including 17 Coach tests. Five new tests cover actual form submit-handler dispatch, empty selection, typed generic routing, speech-result insertion/stop without automatic send, and microphone denial followed by successful text submission. Speech results in these tests are synthetic; this is not a real microphone acceptance test.

Command:

```
node --import ./tests/register.mjs --test tests/coach-routing.test.mjs tests/knowledge-architecture.test.mjs tests/openai-transcribe.test.mjs tests/pilot-invite.test.mjs tests/pilot-manager-invite.test.mjs
```

## Actual browser verification

Implementation commit: `a2a93d018c2a2402c8f1695bacd9684ac41fbc17`.
Netlify Deploy Preview status: success.
Test URL: https://deploy-preview-22--magical-platypus-ba1dfe.netlify.app/coach-chat.html?pilot=1

All submissions below used the actual textarea and clicked the real Send button in the authenticated formal learner page. No direct endpoint calls or diagnostic-page shortcuts were used.

| Acceptance | Deployed browser evidence | Result |
| --- | --- | --- |
| A: philosophy question | Typed exact question, clicked Send; visible user bubble and response (01:49:31 Pacific) | PASS |
| B: source grounding | Banner Life, complete-picture explanation and “We underwrite individuals, not impairments.”; correct source and Verifier PASS | PASS |
| C: Why is that important? | Visible sent message and continuous same-source underwriting reply (01:50:04) | PASS |
| C: Give me an example. | Visible sent message and cigar-use underwriting example (01:50:28) | PASS |
| D: composer layout | Actual screenshot shows textarea, Speak, Send in one row; explicit submit type; context selector in Assignment Inbox | PASS |
| D: microphone denial recovery | Real Speak click returns not-allowed; error stays visible; Send re-enabled and subsequent text request succeeds | PASS |
| D: live audio transcription | Cloud browser microphone is not permitted; no live audio transcript produced | BLOCKED / NOT VERIFIED |
| E: typed generic request | Typed What should I practice next? while source context was selected; request succeeds with a Practice-evidence skill recommendation, Generic Coach label and no false source verification (01:51:17) | PASS |

All three source answers displayed `Grounded in: Company Knowledge · underwriting-field-guide · Verifier: PASS · Path: pilot-coach-source` and contained no lending/lender/borrower/loan/commercial-lending/credit-score underwriting drift. Source assignment remained `5586b6bd-7ed7-4958-8404-2bcab8c9143a`. Model wording varies with retained conversation history; histories were not cleared to improve results.

The browser-control service occasionally returned a short selector deadline while a model request was in flight; subsequent visible responses confirmed completion. This was not treated as proof that the application request failed.

`master` was verified unchanged at `d418930375f847d1612796224fe962fe78d7dad7`. PR #22 was not merged. The prior grounding backend and router have no diff from `56f6745`; the new composer still builds explicit request context. Human acceptance remains required, particularly real microphone transcription on a microphone-enabled device.

The baseline real Speak click invoked SpeechRecognition but received `not-allowed` in the cloud browser. Previously onend immediately hid that error. The repair retains the visible error and restores text controls; the speech recognition engine itself is unchanged. Live audio-to-text cannot be reported PASS without an available, permitted microphone.
