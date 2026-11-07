# Advanced Voice — PR #70 baseline / implementation plan

Status: architecture specification only; no runtime implementation yet. Source baseline: PR #70 head 3e8c59a, branch feature/advanced-voice-pr70. Issue #71.

## Confirmed current limitations
- Browser SpeechRecognition restarts after onend, and speechSynthesis speaks while the microphone is off.
- A voice turn ends on a fixed 2.5/4/6-second silence timer or Done; it does not use semantic end-of-turn detection.
- Interrupt cancels speech synthesis, but cannot hear a spontaneous barge-in while the microphone is off.
- Existing Client/Coach commands are text regex routing; they work after a recognized utterance, not continuously during playback.

## Phase B — minimum-risk improvements
1. Separate turn state machine: idle / listening / pending-end / thinking / speaking / interrupted. Use session IDs to discard late callbacks from canceled recognizers and stale model replies.
2. Capture partial and final speech separately; never overwrite finalized text with interim revisions. Preserve self-corrections and prevent duplicate transcript on recognizer restart.
3. Adaptive endpointing: retain manual Done and selectable quiet-time fallbacks. Extend silence for syntactically unfinished utterances, filler/hesitation, and mid-sentence corrections; only finalize on stable final recognition + quiet interval. Do not promise perfect semantic VAD with browser APIs.
4. Interrupt: first implement reliable explicit tap-to-interrupt and resume microphone. True spoken barge-in requires simultaneous mic monitoring with echo suppression; test platform support before claiming it.
5. Preserve role-specific transcript, score, redo and coach state across interruptions. Keep Full Run as the default.

## Phase C — realtime feasibility gate
- Compare (A) browser STT/TTS, (B) streaming STT + Claude text + streaming TTS, (C) OpenAI Realtime voice with explicit Client/Coach state control.
- OpenAI voice APIs cannot be assumed to reuse Claude's live internal conversational state. A hybrid adds provider handoffs and latency; measure before selection.
- WebRTC/browser client receives only short-lived scoped credentials from a server endpoint, never the long-lived API key.
- Consent, privacy, data retention, transcript availability and recording indicators must be specified before live rollout.
- Keep fallback to Phase B on unsupported devices, network failure or exhausted budget.

## Cost and reliability gates
- Advanced voice opt-in only; server-enforced per-user session minutes and team spending budget, plus global kill switch.
- Record usage per provider/model, voice seconds, text tokens, retry counts, p50/p95 response latency, and 429/5xx failures. Estimate costs from actual usage, not arbitrary request counts.
- Stop streaming gracefully on budget expiry; keep the existing browser-speech experience usable.
- Test iPhone Safari, Android Chrome, desktop Chrome; long Chinese/English pauses, self-corrections, interruptions, network reconnection, Client/Coach switching and five learners on shared Wi-Fi.

## Acceptance
- No transcript loss or duplicated turns in 20 consecutive simulated interruptions.
- Real-phone validation of pause handling and tap interruption; spoken barge-in accepted only if demonstrated.
- Document cost per 10-minute session and fallback behavior before merge.
- PR #70 and master stay unchanged; create a separate PR only after code and tests are present.
