// Synthetic team data for the Manager AI Brief tests. Every person, score and
// sentence here is invented; shapes match what pilot-data.mjs returns.
export const NOW = '2026-11-16T18:00:00.000Z';
const day = n => new Date(Date.parse(NOW) - n * 86400000).toISOString();

function session(id, email, name, daysAgo, scenario, scores, extra = {}) {
  return {
    id, learner: email, learnerName: name, savedAt: day(daysAgo), scenario, lang: 'zh',
    scores: { overall: Math.round((scores[0] + scores[1] + scores[2]) / 3), empathy: scores[0], accuracy: scores[1], closing: scores[2] },
    tips: [], summary: '', transcript: [], ...extra
  };
}

export const MICHELLE = 'michelle@example.com';
export const DAVID = 'david@example.com';
export const AMY = 'amy@example.com';
export const KEVIN = 'kevin@example.com';

export const sessions = [
  session('s-m1', MICHELLE, 'Michelle Chen', 12, '保費太高', [78, 74, 72]),
  session('s-m2', MICHELLE, 'Michelle Chen', 7, '我的另一半不同意', [80, 75, 61]),
  session('s-m3', MICHELLE, 'Michelle Chen', 2, '我會再考慮看看', [82, 76, 55], {
    tips: ['客户说“再考虑”时，可以先问清楚他在考虑什么，再约一个具体的回访时间。'],
    transcript: [
      { index: 1, speaker: 'client', text: '你讲的我大概听懂了，不过这件事不急。' },
      { index: 2, speaker: 'agent', text: '我理解，保障规划确实需要想清楚。您主要是在考虑预算，还是保障内容？' },
      { index: 3, speaker: 'client', text: '都有吧。我想再考虑一下，回去跟太太商量。' },
      { index: 4, speaker: 'agent', text: '好的，没问题，那您慢慢考虑，有需要随时找我。' },
      { index: 5, speaker: 'client', text: '好，那就先这样。' }
    ]
  }),
  session('s-d1', DAVID, 'David Liu', 9, '終身壽險 vs. 定期壽險', [70, 66, 64]),
  session('s-d2', DAVID, 'David Liu', 3, '我會再考慮看看', [72, 68, 58]),
  session('s-a1', AMY, 'Amy Wong', 5, '保費太高', [75, 79, 60]),
  session('s-k1', KEVIN, 'Kevin Zhao', 20, '我的另一半不同意', [66, 70, 52]),
  session('s-k2', KEVIN, 'Kevin Zhao', 1, '我的另一半不同意', [64, 73, 70], { assignmentId: 'a-kevin' })
];

export const profiles = [
  { learnerEmail: MICHELLE, preferredName: 'Michelle Chen', claims: [] },
  { learnerEmail: DAVID, preferredName: 'David Liu', claims: [] },
  { learnerEmail: AMY, preferredName: 'Amy Wong', claims: [] },
  { learnerEmail: KEVIN, preferredName: 'Kevin Zhao', claims: [] },
  { learnerEmail: 'grace@example.com', preferredName: 'Grace Lin', claims: [] }
];

export const assignments = [
  { id: 'a-kevin', assignedTo: KEVIN, learner: 'Kevin Zhao', scenarioId: 'IHFC-04', scenarioName: '我的另一半不同意', mode: 'quick', status: 'Completed', createdAt: day(4), completedAt: day(1), resultSessionId: 's-k2', score: 71 },
  { id: 'a-amy', assignedTo: AMY, learner: 'Amy Wong', scenarioId: 'IHFC-02', scenarioName: '我會再考慮看看', mode: 'quick', status: 'Assigned', createdAt: day(2) }
];

export const knowledge = [
  {
    id: 'k-hnw', title: '高净值客户首次面谈指引', status: 'approved', approvedAt: day(6), updatedAt: day(6),
    analysis: {
      summary: '如何争取与高收入企业主的第一次面谈。', quality: 'important',
      practiceDraft: {
        title: '争取与企业主的第一次面谈', situation: '客户是一位经营十年的餐饮企业主，朋友转介绍，对保险顾问有戒心。',
        objective: '用公司指引里的方法建立信任，并让客户同意一次正式面谈。', clientName: '周先生',
        clientOpening: '我朋友说你想跟我聊聊，不过我很忙，你有什么事直接说。', successCriteria: ['先了解客户的生意', '不急着介绍产品']
      }
    }
  },
  { id: 'k-draft', title: '尚未审核的资料', status: 'analyzed', updatedAt: day(1), analysis: { practiceDraft: { title: 'x', situation: 'y', objective: 'z' } } }
];

// Owner UAT of 2026-11-16: the only Practice on record was three months old.
// Two members, one session each (Aug 13 and Aug 19), one assignment that has
// been open for 42 days, a relevance-assessed source (P2, 60/100).
export const ANA = 'ana@example.com';
export const BEN = 'ben@example.com';
export const staleSessions = [
  session('s-ana', ANA, 'Ana Ruiz', 95, "I'll Think About It", [55, 46, 25], {
    tips: ['Ask what the client still needs to think about before the conversation ends.'],
    transcript: [
      { index: 1, speaker: 'client', text: 'I understand the coverage, but I want to think about it.' },
      { index: 2, speaker: 'agent', text: 'Of course, take all the time you need.' },
      { index: 3, speaker: 'client', text: 'Thanks. I will talk to my wife.' },
      { index: 4, speaker: 'agent', text: 'Sounds good, just reach out whenever you are ready.' }
    ]
  }),
  session('s-ben', BEN, 'Ben Cho', 89, 'Premium Is Too High', [35, 60, 58], { summary: 'Moved to price before acknowledging the concern.' })
];
export const staleProfiles = [
  { learnerEmail: ANA, preferredName: 'Ana Ruiz', claims: [] },
  { learnerEmail: BEN, preferredName: 'Ben Cho', claims: [] },
  { learnerEmail: 'cara@example.com', preferredName: 'Cara Diaz', claims: [] }
];
export const staleAssignments = [
  { id: 'a-ben', assignedTo: BEN, learner: 'Ben Cho', scenarioId: 'IHFC-23', scenarioName: 'Handling Skeptical Clients', mode: 'quick', status: 'Assigned', createdAt: day(42) }
];
export const assessedKnowledge = [
  {
    id: 'k-uw', title: 'Sample Life Underwriting Guide', status: 'approved', approvedAt: day(10), updatedAt: day(10),
    relevance: { competencies: ['closing', 'accuracy'], priority: 'P2', overall: 60, whyItMatters: 'Field underwriting conversations end with a concrete next step.' },
    analysis: {
      quality: 'important',
      practiceDraft: {
        title: 'Field Underwriting Practice: Term Coverage Conversation', situation: 'A client is ready to apply for term coverage and asks what happens next.',
        objective: 'Explain the underwriting steps accurately and agree the next step.', clientName: 'Mr. Lee',
        clientOpening: 'So what do I need to do after today?', successCriteria: ['Explain the exam', 'Set expectations on timing']
      }
    }
  },
  {
    id: 'k-brand', title: 'Company History Deck', status: 'approved', approvedAt: day(3), updatedAt: day(3),
    relevance: { competencies: ['empathy'], priority: 'P3', overall: 30 },
    analysis: { practiceDraft: { title: 'Telling the company story', situation: 'A client asks who the company is.', objective: 'Tell the story briefly.' } }
  }
];
