# PR #80 — English Manager-First Narration Review

**Status:** DRAFT, internal review only; not approved for production, paid filming, manager outreach, or merge.

**Basis:** Reconstructed from the original PR #75 manager-facing feature story and the unchanged PR #80 authentic demo screenshots. The feature value leads; screenshots are illustrations, never the narrative center. This review text was extracted from the actual English-only film page on the PR #80 branch.

**Playable Netlify preview:** https://deploy-preview-80--magical-platypus-ba1dfe.netlify.app/manager-tour-film-frames.html

**GitHub PR:** https://github.com/musesinstitute/agentraining-site/pull/80

**Narration change commit:** 15e3e084ebd6996d0e79667b604d81ddbe44180d

## Editorial rules

- The audience is an insurance manager seeing AgentTraining.ai for the first time. Prioritize what each Studio does, why it is valuable, and what decision it helps the manager make.
- Keep PR #75 concepts: manager **importance** versus learner **relevance**; foundational learning plus company-approved materials; Practice **Learn → Apply**; Client-specific cases; Leadership **AI facilitates. You lead.**
- Keep screenshots authentic and unaltered. Cite a detail from an image only when relevant to clarifying the functional story, not as a walkthrough of screenshot pixels.
- No strict duration cap during content review; measure and edit for pacing after content is accepted.
- English-only version now. Chinese version must be a separate localized edition, not a language toggle in the English manager film.

## Narration — English, 32 caption segments

### 1. Knowledge Studio — Teaching What Matters

1. Every agency receives more information than a team can absorb: carrier updates, product guides, new training files, and insurance fundamentals. The manager must decide what matters most.
2. Knowledge Studio addresses two different learning needs: foundational insurance knowledge, and your own company's approved training library.
3. For a manager, the question is importance: what should the team learn first? For a trainee, the question is relevance: what knowledge is most useful for the next client conversation?
4. AI can help organize materials and prepare summaries. The manager reviews the source evidence, chooses priorities and decides which content is suitable for the team.
5. In this real test interface, a sample company training guide appears alongside an AI-generated summary for the manager to inspect.
6. The same workflow shows a practice draft and an assignment entry point. The manager reviews the draft before deciding to assign it.
7. The value is more than storing documents. It is turning trusted knowledge into purposeful training, without handing important decisions over to an unverified ranking algorithm.
8. Now the question becomes: can an agent actually use that knowledge when a client pushes back?

### 2. Practice Studio — Applying Knowledge in Conversation

1. Knowing a product feature is one thing. Explaining it under pressure, when a prospective client objects, is another.
2. Practice Studio bridges that gap. The manager sets the learning objective, while an AI-simulated client gives the trainee a conversation to rehearse.
3. Think of training in two layers. Learn builds understanding through course material and knowledge checks. Apply develops the skill through interactive role-play.
4. Agents can rehearse premium objections, product explanations and follow-up questions in a setting where mistakes become learning opportunities.
5. Unlike simply reading a script, the trainee responds to a simulated client who can ask another question and challenge the explanation.
6. Here is one actual demonstration attempt: a fictional client raises a premium concern, the trainee responds, and the client follows up. A sample overall score of eighty-two is visible.
7. That response and the coaching feedback give a manager evidence to discuss: what was clear, what was missed and which skill deserves another round of practice.
8. Instead of assuming that training has worked, the manager can use practice evidence to make coaching more specific and actionable.

### 3. Client Studio — Coaching With Case Context

1. Of course, an agent's next appointment is not a generic simulation. Every prospective client has different needs, concerns and timing.
2. Client Studio maintains a case portfolio that records client needs, objections, interaction context, status and planned follow-up.
3. For managers, that context matters. A training score alone does not tell you what kind of real conversation the learner needs to prepare for.
4. AI can help organize the information entered into a case and suggest follow-up questions. The platform does not claim to automatically listen to or verify live customer calls.
5. In this fictional example, Elena Rivera's case records a coverage need, a premium objection and the next planned follow-up.
6. The Start Practice action connects that case context with a more focused rehearsal. The screenshot illustrates the entry point, not a completed customer outcome.
7. Now the learner can prepare for a specific concern rather than spending every practice session on the same generic sales script.
8. That is the benefit of Client Studio: connect case context to the next useful training action, so coaching addresses the conversation ahead.

### 4. Leadership Studio — Manager Judgment and Action

1. The final question is the manager's: with this information in hand, what should I do next for each learner?
2. Leadership Studio brings the manager's assignment decisions, learner results and coaching follow-up into one management workflow.
3. Review practice evidence and AI-assisted coaching suggestions, but look beyond a score. The trainee needs a manager's judgment, not an automatic verdict.
4. You can assign the next practice, review Current Assignments and their statuses, and use Message Learner to guide the person.
5. This real manager interface illustrates those actions with fictional learner data. It does not represent verified real-time chat or delivery across every device.
6. After the next practice, the manager can reassess the learner's work and choose what needs to be reinforced or changed.
7. The four Studios therefore work as a system: Knowledge organizes what matters, Practice reveals applied skill, Client adds case context, and Leadership turns evidence into action.
8. That is the Team Growth and Retention Hub in motion: evidence, manager judgment, targeted coaching and another assignment. AI facilitates. You lead.

## Evidence and marketing-claim guardrails

| Studio | What the authentic UI illustrates | Do not claim without separate verification |
| --- | --- | --- |
| Knowledge | Approved fictional training guide, AI summary, practice draft and assignment entry point | An automatic per-trainee priority-ranking algorithm, automatic approval of all generated content |
| Practice | One fictional AI client exchange, agent reply and a visible sample overall score of 82 | A completed sale, final answer after the last shown client follow-up, or fully visible unseen sub-scores |
| Client | Fictional Elena Rivera case: need, premium objection, follow-up and Start Practice | Automatic recording/analysis of actual prospect calls; verified practice result writeback |
| Leadership | Assign Practice, Current Assignments, Message Learner in a manager workspace | Real-time live chat, verified cross-device message persistence, or outcomes beyond the visible evidence |

**Important:** These are independent fictional examples, not one continuous case journey. Keep these qualifications in internal review and ensure the presentation does not imply functionality not actually tested.

## Independent AI review — before Genspark

Review this as a skeptical insurance agency owner, Sales Manager, or Training Manager who has never seen AgentTraining.ai. Please report **PASS / PASS WITH CHANGES / FAIL** with evidence and suggested replacements only where needed. Specifically examine:

1. First-view clarity: Does the narration explain the problem, distinctive capability and manager benefit for each Studio without prior context?
2. Narrative integrity: Is the PR #75 feature story preserved, with PR #80 screenshots naturally supporting it instead of dominating it?
3. Product honesty: Are any statements unverified, ambiguous or prone to mistaken assumptions about automation, insurance outcomes, messaging, or case synchronization?
4. Distinctive selling points: Does it explain why four linked Studios and manager decision-making are more valuable than isolated AI role-play?
5. Flow and pacing: Are transitions logical and is anything repetitive or missing? Do not cut critical content merely to hit a preselected runtime.
6. Screenshot/audio coordination: Does each screenshot substantiate a relevant spoken statement, and are captions readable without covering essential controls?

**Review sequence:** founder/assistant revision → independent AI reviews and revision → Genspark final production review → founder final acceptance → optional paid video production and controlled manager distribution. Any merge to master requires separate explicit approval of the exact PR revision. PR #68 and master remain untouched by this narration task.

## Engineering validation state

- GitHub branch file readback: English-only navigation, four original assets, four chapters, 8 captions/chapter and total 32 caption segments — checked.
- Browser-generated speech remains only a preview tool and does not constitute a professionally timed or encoded final film.
- Actual playback, responsive text fit, speech/caption synchronization and fresh Netlify browser UAT — **not yet signed off**.
- Netlify build success, if subsequently confirmed, cannot substitute for runtime UAT or founder approval.
