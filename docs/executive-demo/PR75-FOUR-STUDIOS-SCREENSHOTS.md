# PR #75 — Four Studios screenshot capture and placement brief

Status: **planned; no screenshots have been captured or added.** Only use current, real product UI. Do not synthesize or fabricate a dashboard, AI ranking, client interaction, or live messaging. This brief is for visual UAT and the next asset pass, not proof of implementation.

## Placement in the pre-Pilot manager demo

After the three-minute executive film, show ONE focused image for each Studio in the existing guided sequence:
Welcome → Knowledge → Practice → Client → Leadership → Hub → five-learner Mission Control.

Each Studio chapter should take ~15–20 seconds of optional narration, with four or five short captions, a recognisable feature highlight, and persistent Previous / Next arrows. Show the real UI crop in the chapter's **existing right-hand .visual area** (rather than an additional full-width section below the fold). Keep the intro compact and mobile responsive; avoid repeating the three-minute film.

Capture exactly four separate real screenshots at desktop resolution, with approved **fictional or test** data, from the PR preview's actual product pages or an authenticated pilot TEST account. Never show real customer names, emails, policy details, credentials or other private records. If a view is gated and not accessible for capture, do not fabricate an image; retain the honest existing icon/flow visual.

| Studio | Real source to capture | Focus on 1–2 existing UI features | Caption / talk track | Do NOT imply |
| --- | --- | --- | --- | --- |
| Knowledge | `knowledge.html?pilot=1` | Source library / AI summary with manager review; approved practice draft if visible | “Managers weigh importance; trainees need relevance. AI facilitates that handoff.” | A working individualized importance/relevance ranking engine unless proven |
| Practice | `simulator.html?ref=demo&pilot=1` | AI-simulated client interaction plus evidence/feedback | “Your training goal becomes an interactive client scenario.” | An unverified automatic ingestion → live scenario pipeline |
| Client | Current Client Studio test flow (check `client.html` and pilot links) | A fictional client's case notes, objections and next steps | “Recorded client context helps focus coaching.” | Automatic capture of real client calls or a verified AI analysis when unavailable |
| Leadership | `manager.html?pilot=1`, plus existing Team Messages if needed | Practice Results and “Message Learner” / assignment controls (choose the most coherent single crop) | “AI helps you prepare what to discuss. You message and coach the trainee directly.” | Built-in live two-way chat if the current system offers only asynchronous messages |

### Crop and UI rules

- One single cropped UI screenshot per chapter, replacing (not stacking below) the icon/diagram's main visual panel.
- If necessary, overlay **at most two** non-interactive highlight labels; never fake feature controls.
- Include a small `Actual product UI — illustrative test data` label on every image.
- Keep screenshots as versioned project assets with descriptive file names, compressed to WebP/PNG, with descriptive alt text. Test at 320, 375, 390, 430, and 1366px.
- Screenshots are **silent visual references**; spoken captions remain in accessible HTML. Navigation and optional narration controls should stay reachable without scrolling past an enormous image.
- Take a second capture for review only if the first crop does not make the specific Studio benefit clear.

### Acceptance before launch

1. Review the four crops with the founder. They must show actual current UI and the intended features, with no sensitive data.
2. Confirm every claim against the exact version deployed to the Private Pilot.
3. On mobile, no sideways scrolling, obstructed captions, or hidden Next arrow.
4. Narration remains optional and captions readable without sound.
5. End of Hub transitions cleanly into the fictional five-learner decision exercise.
6. PR stays Draft; do not merge or modify master, PR #73, or PR #74.

Note: manager-facing demo language is concise and benefits-led; the detailed how-to Tour Guide belongs **inside** the 14-day Private Pilot, not in this pre-Pilot demo.
