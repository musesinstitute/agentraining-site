# PR #75 — Four Studios screenshot capture and placement brief

Status: **Four product screenshots captured and embedded in the Manager Tour.** Each chapter links to its full-size image and identifies the data as illustrative.

The Knowledge, Client and Leadership captures were made on November 26, 2026 in the PR #75 Deploy Preview. Knowledge shows the original fictional premium-comparison notes after AI analysis at Manager Review, with the approval control visible. Client shows one fictional case card. Leadership shows the competency scores and Coach summary from a completed Quick Practice using that fictional case. The Leadership crop excludes account details and the separate assignment panel. Practice uses the previously captured simulator screenshot. The four screenshots illustrate the Studios independently.

## Placement in the pre-Pilot manager demo

After the three-minute executive film, show ONE focused image for each Studio in the existing guided sequence:
Welcome → Knowledge → Practice → Client → Leadership → Hub → five-learner Mission Control.

Each Studio chapter should take ~15–20 seconds of optional narration, with four or five short captions, a recognisable feature highlight, and persistent Previous / Next arrows. Show the real UI crop in the chapter's **existing right-hand .visual area** (rather than an additional full-width section below the fold). Keep the intro compact and mobile responsive; avoid repeating the three-minute film.

Capture exactly four **visually distinct** real screenshots from three product pages: Knowledge, Simulator and Manager. Client and Leadership both use different, tightly cropped areas of `manager.html?pilot=1` without the shared header or navigation. Use an authenticated pilot TEST account and **fictional or test** data only. Never show real customer names, emails, policy details, credentials or other private records. If a view is gated and not accessible for capture, do not fabricate an image; retain the honest existing icon/flow visual.

| Studio | Real source to capture | Focus on 1–2 existing UI features | Caption / talk track | Do NOT imply |
| --- | --- | --- | --- | --- |
| Knowledge | `knowledge.html?pilot=1` | Source library / AI summary with manager review; approved practice draft if visible | “Managers weigh importance; trainees need relevance. AI facilitates that handoff.” | A working individualized importance/relevance ranking engine unless proven |
| Practice | `simulator.html?ref=demo&pilot=1` | AI-simulated client interaction plus evidence/feedback | “Your training goal becomes an interactive client scenario.” | An unverified automatic ingestion → live scenario pipeline |
| Client | `manager.html?pilot=1` — **Client Cases** | One fictional case card with needs, objections and next step; crop out page header and other dashboard sections | “Recorded client context helps focus coaching.” | Automatic capture of real client calls or a verified AI analysis when unavailable |
| Leadership | `manager.html?pilot=1` — **Practice Results / Assign Practice** | Completed practice score and coaching summary, and existing assignment controls if genuinely visible in one crop. Keep **Client Cases** completely out of frame, as well as the shared header | “AI helps you prepare what to discuss. You coach the trainee directly.” | Built-in live two-way chat if the current system offers only asynchronous messages; an artificially combined screenshot |

### Prepare the test account before capture

An empty dashboard is not a useful sales demo. Before capturing, use a dedicated test manager and learner to (1) upload a non-sensitive company learning item, run its available AI analysis and approve it if the product supports that action; (2) assign and complete a practice scenario so Practice Results displays a score and coach summary; (3) create three or four **fictional** client cases with needs, objections and next steps. Ensure no actual customer names, emails, policy details or identities appear anywhere in the capture. Do not use a screenshot showing only `0 cases`, `0 results`, or `Loading team priorities…`.

**Evidence boundary:** the current Knowledge UI has AI summaries and manager review, but an automated individualized importance/relevance ranking engine is **not verified**. Never manufacture a ranked list or a ranking approval button; capture only controls and analysis truly visible in the deployed product. Similarly, no automatic capture of prospect calls or full real-time chat should be implied. If a claim cannot be supported by the UI, keep the existing illustrated icon instead.

`client.html` is a marketing/explanation page (e.g., “Two growth pipelines,” “CRM tracks. We develop.”), **not** the Client Cases product screen. Do not use it as a capture source. Although Client and Leadership screenshots both come from `manager.html`, their crops must look clearly different and must not include the shared top page header or sidebar.

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
