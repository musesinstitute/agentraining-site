import { getStore } from '@netlify/blobs';
import { getUser, verifyRequestOrigin } from '@netlify/identity';
import { practiceTranscripts, checkQuotes, evidenceReport, safeTimeZone, daysBetween, localDate } from './lib/manager-evidence.mjs';

const STORE_NAME = 'agentraining-pilot';
const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};

function reply(status, body) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function cleanText(value, max = 6000) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizeEmail(value) {
  return cleanText(value, 320).toLowerCase();
}

function safeSegment(value, fallback) {
  const segment = cleanText(value, 100)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return segment || fallback;
}

function normalizeHistory(value, limit = 16) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-limit)
    .map(item => ({
      role: item?.role === 'assistant' ? 'assistant' : 'user',
      content: cleanText(item?.content),
      learnerEmail: normalizeEmail(item?.learnerEmail)
    }))
    .filter(item => item.content);
}

// Earlier turns about a different team member are left out of what the model
// sees, so evidence about one person cannot leak into an answer about another.
// Turns that were not about any member (general conversation) are kept.
function historyFor(history, learnerEmail) {
  const kept = history.filter(item => !item.learnerEmail || item.learnerEmail === learnerEmail).slice(-16);
  const previous = [...history].reverse().find(item => item.learnerEmail)?.learnerEmail || '';
  return { kept, switchedFrom: previous && learnerEmail && previous !== learnerEmail ? previous : '' };
}

function chatMessage(role, content, extras = {}) {
  return {
    id: crypto.randomUUID(),
    role,
    content: cleanText(content),
    createdAt: new Date().toISOString(),
    engine: 'ai-chat-v1',
    ...extras
  };
}

async function listJSON(store, prefix) {
  const { blobs } = await store.list({ prefix });
  const rows = await Promise.all(
    blobs.map(entry => store.get(entry.key, { type: 'json' }))
  );
  return rows.filter(Boolean);
}

function systemPrompt(role, lang) {
  const zh = lang === 'zh';
  const manager = role === 'manager';
  return [
    manager
      ? (zh ? '你是主管的长期 AI 副驾驶和管理成长伙伴。' : 'You are the manager’s long-term AI Copilot and management growth partner.')
      : (zh ? '你是学员的私人 AI 教练和成长伙伴。' : 'You are the learner’s Personal AI Coach and growth partner.'),
    zh ? '产品哲学：以人为本，关系优先，在真正相关的时候再进入训练。' : 'Product philosophy: People first. Relationship first. Training when relevant.',
    zh ? '进行自然、多轮、连续的对话，直接回应用户刚刚说的话。' : 'Have a natural, continuous, multi-turn conversation and directly answer what the user just said.',
    manager ? (zh
      ? '你就在 AgentTraining.ai 平台内部。teamEvidenceIndex 是系统实际检索到的全团队 Practice 记录统计。主管问谁记录最多时，直接按 practiceSessionCount 比较并回答。'
      : 'You operate inside AgentTraining.ai. teamEvidenceIndex is an actual retrieval of Practice records across the authorized team. When asked who has the most evidence, compare practiceSessionCount directly.') : '',
    manager ? (zh
      ? 'resolvedMember 是系统根据当前选择或主管自然语言自动匹配出的成员。selectedMember.recentSessions 是该成员真实 Practice 记录。不要要求主管重新粘贴平台已有数据。'
      : 'resolvedMember is the member resolved from the current selection or the manager’s natural-language mention. selectedMember.recentSessions contains that member’s actual Practice records. Never ask the manager to paste data the platform already has.') : '',
    manager ? (zh
      ? '判断进步时：0 次明确说 0 次；1 次只能描述本次表现，不能判断趋势；2 次以上才比较时间、场景、overall/empathy/accuracy/closing、strengths、tips、summary。不要编造。'
      : 'For progress questions: with 0 sessions say 0; with 1 describe that session but do not claim a trend; with 2 or more compare dates, scenarios, overall/empathy/accuracy/closing, strengths, tips, and summaries. Never invent evidence.') : '',
    manager ? (zh
      ? 'selectedMember.practiceTranscripts 是该成员 Practice 对话的逐字原文，按场次标为 S1、S2…，每句有行号 line；speaker 为 learner 的是这位成员本人，client 是 AI 扮演的客户。说明您的判断依据时，请从中逐字引用成员的原话，并在引文后紧跟出处，例如：“……”[S1 L4]。同时写明成员姓名、练习日期和情境；日期一律使用 practiceDate（已按主管所在时区换算），不要自行从 savedAt 推算。'
      : 'selectedMember.practiceTranscripts holds the verbatim words of this member’s Practice conversations, labelled S1, S2… with a line number per line; speaker "learner" is the team member, "client" is the AI role-play client. When you explain what your view rests on, quote the member’s exact words from those lines and put the source right after the quotation, for example: “…” [S1 L4]. Also state the member’s name, the Practice date and the scenario; always take dates from practiceDate (already in the manager’s time zone), never work them out from savedAt.') : '',
    manager ? (zh
      ? '引号只用于逐字原文。不得改写后加引号，不得拼接不同句子，不得凭印象重建对话。您建议成员下次可以怎么说时，不要用引号，以“建议说法：”开头。'
      : 'Use quotation marks only for verbatim transcript lines. Never put quotation marks around a paraphrase, never join separate lines into one quotation, and never reconstruct dialogue from memory. When you suggest what the member could say next time, do not use quotation marks; introduce it with "Suggested wording:".') : '',
    manager ? (zh
      ? '如果您所依据的那次练习 transcriptStatus 为 unavailable，或 practiceTranscripts 为空，请明确说明：这次练习没有保存逐字对话，以下辅导意见只基于分数、教练反馈和总结，不是对原话的直接观察。此时不要给出任何引文。'
      : 'If the session you rely on has transcriptStatus "unavailable", or practiceTranscripts is empty, say so plainly: no verbatim conversation was saved for that Practice, and your coaching rests only on its scores, coach feedback and summary, not on direct observation of what was said. Give no quotation in that case.') : '',
    manager ? (zh
      ? 'evidenceFreshness 说明最近一次练习距今多少天。超过 14 天时，请称之为历史记录并写明日期，不要说成“目前”“最近”或“这两周”的表现。只有一次练习时不要说进步或退步。'
      : 'evidenceFreshness says how many days ago the latest Practice was. When it is more than 14 days, call it a historical record and give its date; do not describe it as current, recent, or "the past two weeks". With a single Practice, never speak of improvement or decline.') : '',
    manager ? (zh
      ? '本轮所有关于成员的说法都必须来自本轮的 selectedMember（见 currentSubject）。如果之前的对话谈的是另一位成员，不得把那位成员的分数、原话或结论用在这位成员身上。'
      : 'Every statement about a team member in this turn must come from this turn’s selectedMember (see currentSubject). If earlier messages were about a different member, do not apply that person’s scores, words or conclusions to this one.') : '',
    manager ? (zh
      ? '您为主管起草的任何反馈或消息都只是草稿，由主管审阅后自行决定是否发送；您不会发送任何内容。'
      : 'Anything you draft for the member is a draft for the manager to review and send themselves; you send nothing.') : '',
    manager ? (zh ? '绝不访问、引用或推断学员私人 Coach Chat。' : 'Never access, quote, or infer a learner’s private Coach Chat.') : '',
    zh ? '回复温暖、专业、自然。' : 'Be warm, professional, and natural.'
  ].filter(Boolean).join('\n');
}

function evidenceContext(value, lang) {
  if (!value || typeof value !== 'object') return '';
  const safe = JSON.stringify(value).slice(0, 50000);
  return lang === 'zh'
    ? `\n\n主管授权的平台上下文（真实检索结果；私人 Coach Chat 不在其中）：\n${safe}`
    : `\n\nAuthorized manager platform context (actual retrieval; Private Coach Chat excluded):\n${safe}`;
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();
  const parts = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && content?.text) parts.push(content.text);
    }
  }
  return parts.join('\n').trim();
}

async function managerRoster(store, teamId) {
  const profiles = await listJSON(store, `teams/${teamId}/profiles/`);
  const roster = await listJSON(store, `teams/${teamId}/roster/`);
  const byEmail = new Map();
  for (const profile of profiles) {
    const email = normalizeEmail(profile.learnerEmail);
    if (email) byEmail.set(email, { learnerEmail: email, preferredName: cleanText(profile.preferredName || profile.name || email, 120) });
  }
  for (const row of roster) {
    const email = normalizeEmail(row.email);
    if (row.isLearner && email && !byEmail.has(email)) byEmail.set(email, { learnerEmail: email, preferredName: email });
  }
  return [...byEmail.values()].slice(0, 100);
}

function compactSession(session) {
  return {
    id: session.id, savedAt: session.savedAt, scenario: session.scenario,
    practiceMode: session.practiceMode, scores: session.scores,
    strengths: session.strengths, tips: session.tips, summary: session.summary,
    assignmentId: session.assignmentId, sourceType: session.sourceType, sourceLabel: session.sourceLabel
  };
}

function editDistance(a, b) {
  a = String(a); b = String(b);
  const d = Array.from({ length: a.length + 1 }, () => Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) d[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) for (let j = 1; j <= b.length; j += 1) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

function speechTokens(value) {
  return String(value || '').toLowerCase()
    .replace(/@/g, ' at ')
    .replace(/\+/g, ' plus ')
    .replace(/\./g, ' ')
    .replace(/[^a-z0-9\s]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveMember(message, requested, roster) {
  const raw = String(message || '').toLowerCase();
  const collapsed = raw.replace(/\s+/g, '');

  // The member named in the CURRENT turn must outrank a stale UI selection.
  for (const row of roster) {
    if (raw.includes(row.learnerEmail) || collapsed.includes(row.learnerEmail)) {
      return { email: row.learnerEmail, method: 'exact_mention' };
    }
  }

  // A member named by their display name in this turn.
  const named = roster.filter(row => {
    const name = String(row.preferredName || '').trim().toLowerCase();
    if (name.length < 3 || name === row.learnerEmail) return false;
    if (/^[\x20-\x7e]+$/.test(name)) return new RegExp(`(^|[^a-z0-9])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(raw);
    return raw.includes(name);
  });
  if (named.length === 1) return { email: named[0].learnerEmail, method: 'name_mention' };

  // Dictation-aware matching for phrases such as "ana dot ruiz at gmail dot
  // com". Whole words only, every word of the part before the @ must be
  // spoken (plus the mail provider when that part is a single word), and the
  // match must be unique. Ordinary words such as "learner" or "gmail" in a
  // message must never pick a team member by themselves.
  const spoken = new Set(speechTokens(raw).split(' ').filter(Boolean));
  const dictated = roster.filter(row => {
    const [local, domain = ''] = row.learnerEmail.split('@');
    const words = speechTokens(local.replace(/\+/g, ' ')).split(' ').filter(Boolean);
    if (!words.length || !words.every(word => spoken.has(word))) return false;
    return words.length >= 2 || spoken.has(speechTokens(domain).split(' ')[0]);
  });
  if (dictated.length === 1) {
    // "learner" must not be chosen when "learner2" is also on the roster: a
    // spoken digit ("learner two") would otherwise resolve to the wrong person.
    const compact = value => value.split('@')[0].replace(/[^a-z0-9]+/g, '');
    const chosen = compact(dictated[0].learnerEmail);
    const shadowed = roster.some(row => row !== dictated[0] && compact(row.learnerEmail).startsWith(chosen));
    if (chosen.length >= 3 && !shadowed) return { email: dictated[0].learnerEmail, method: 'dictated_alias' };
  }

  const mentions = collapsed.match(/[a-z0-9._+%-]+@[a-z0-9.-]+\.[a-z]{2,}/g) || [];
  let best = null;
  for (const mention of mentions) {
    for (const row of roster) {
      const distance = editDistance(mention, row.learnerEmail);
      const ratio = distance / Math.max(mention.length, row.learnerEmail.length);
      if (!best || ratio < best.ratio) best = { email: row.learnerEmail, method: 'fuzzy_mention', mentioned: mention, distance, ratio };
    }
  }
  if (best && best.ratio <= 0.28) return best;

  const selected = normalizeEmail(requested);
  if (selected && roster.some(row => row.learnerEmail === selected)) return { email: selected, method: 'selected' };
  return { email: '', method: 'none' };
}

async function teamEvidence(store, teamId, roster) {
  const sessions = await listJSON(store, `teams/${teamId}/sessions/`);
  const map = new Map(roster.map(row => [row.learnerEmail, {
    learnerEmail: row.learnerEmail, preferredName: row.preferredName,
    practiceSessionCount: 0, oldestObservedAt: null, latestObservedAt: null
  }]));
  for (const session of sessions) {
    const email = normalizeEmail(session.learner || session.learnerEmail);
    if (!map.has(email)) continue;
    const row = map.get(email);
    const when = session.savedAt || session.createdAt || null;
    row.practiceSessionCount += 1;
    if (when && (!row.oldestObservedAt || when < row.oldestObservedAt)) row.oldestObservedAt = when;
    if (when && (!row.latestObservedAt || when > row.latestObservedAt)) row.latestObservedAt = when;
  }
  return { sessions, index: [...map.values()].sort((a, b) => b.practiceSessionCount - a.practiceSessionCount || String(a.learnerEmail).localeCompare(String(b.learnerEmail))) };
}

async function memberContext(store, teamId, email, allSessions, options = {}) {
  if (!email) return null;
  const root = `teams/${teamId}`;
  const profiles = await listJSON(store, `${root}/profiles/`);
  const profile = profiles.find(row => normalizeEmail(row.learnerEmail) === email) || null;
  // Team-scoped by storage prefix, then narrowed to this one member's own
  // Practice sessions. Nothing under private-coach/ is read here.
  const own = (allSessions || await listJSON(store, `${root}/sessions/`))
    .filter(row => normalizeEmail(row.learner || row.learnerEmail) === email)
    .sort((a, b) => String(a.savedAt || a.createdAt).localeCompare(String(b.savedAt || b.createdAt)));
  const sessions = own.slice(-12).map(row => ({ ...compactSession(row), practiceDate: localDate(row.savedAt || row.createdAt, options.timeZone) }));
  const transcripts = practiceTranscripts(own, { focusSessionId: options.focusSessionId, timeZone: options.timeZone, now: options.now });
  const assignments = (await listJSON(store, `${root}/assignments/`))
    .filter(row => normalizeEmail(row.assignedTo || row.learner) === email)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 8).map(row => ({ id: row.id, scenarioName: row.scenarioName, mode: row.mode, dueDate: row.dueDate, status: row.status, createdAt: row.createdAt }));
  const latestAt = sessions[sessions.length - 1]?.savedAt || null;
  const daysSinceLatest = latestAt ? daysBetween(latestAt, options.now) : null;
  return {
    learnerEmail: email,
    preferredName: cleanText(profile?.preferredName || email, 120),
    evidenceFreshness: {
      latestPracticeAt: latestAt, daysSinceLatest,
      window: daysSinceLatest === null ? 'no_practice_on_record' : daysSinceLatest <= 14 ? 'within_last_14_days' : 'historical_older_than_14_days'
    },
    practiceTranscripts: transcripts,
    profile: profile ? { preferredName: profile.preferredName, claims: profile.claims, goals: profile.goals, updatedAt: profile.updatedAt } : null,
    recentSessions: sessions, assignments,
    evidenceSummary: { practiceSessionCount: sessions.length, oldestObservedAt: sessions[0]?.savedAt || null, latestObservedAt: latestAt },
    // Record text that may be quoted without being transcript.
    knownText: [...own.slice(-12).flatMap(row => [row.scenario, row.summary, ...(row.strengths || []), ...(row.tips || [])]), ...assignments.map(row => row.scenarioName)]
  };
}

export default async function handler(req) {
  try {
    if (req.method !== 'POST') return reply(405, { error: 'POST required.' });
    verifyRequestOrigin(req);
    const user = await getUser();
    if (!user) return reply(401, { error: 'Please sign in to continue.' });
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return reply(503, { error: 'AI conversation is not configured yet.' });
    const input = await req.json();
    const role = input.role === 'manager' ? 'manager' : 'learner';
    const lang = input.lang === 'zh' ? 'zh' : 'en';
    const message = cleanText(input.message);
    if (!message) return reply(400, { error: 'Message is required.' });
    const metadata = user.appMetadata || {};
    const roles = Array.isArray(metadata.roles) ? metadata.roles.map(item => String(item).toLowerCase()) : [];
    if (role === 'manager' && !roles.includes('manager') && !roles.includes('admin') && metadata.role !== 'manager') return reply(403, { error: 'Manager access is required.' });
    const teamId = safeSegment(metadata.team_id, 'founding-pilot');
    const userId = safeSegment(user.id, role);
    const store = getStore({ name: STORE_NAME, consistency: 'strong' });
    const prefix = role === 'manager' ? `teams/${teamId}/manager-ai/${userId}/` : `teams/${teamId}/private-coach/${userId}/`;
    const stored = await listJSON(store, prefix);
    stored.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const durable = normalizeHistory(stored.filter(row => row.engine === 'ai-chat-v1'), role === 'manager' ? 120 : 16);
    const supplied = normalizeHistory(input.history);
    let history = durable.length ? durable : supplied;
    let learnerEmail = '';
    let context = {};
    let member = null;
    let knownText = [];
    if (role === 'manager') {
      const roster = await managerRoster(store, teamId);
      const team = await teamEvidence(store, teamId, roster);
      const resolved = resolveMember(message, input.learnerEmail, roster);
      learnerEmail = resolved.email;
      member = await memberContext(store, teamId, learnerEmail, team.sessions, {
        focusSessionId: cleanText(input.focusSessionId, 100), timeZone: safeTimeZone(input.timeZone)
      });
      const subject = historyFor(history, learnerEmail);
      history = subject.kept;
      if (member) { knownText = member.knownText; delete member.knownText; }
      // selectedMember goes first so its transcript lines are never the part
      // cut off by the overall size limit in evidenceContext().
      context = {
        currentSubject: member
          ? { learnerEmail, preferredName: member.preferredName, switchedFromAnotherMember: subject.switchedFrom ? true : undefined }
          : { learnerEmail: '', note: 'No team member is selected for this turn. Make no claim about any individual member’s Practice.' },
        selectedMember: member, resolvedMember: resolved,
        authorizedTeamRoster: roster, teamEvidenceIndex: team.index,
        privacy: 'Authorized roster/work evidence only. Private Learner Coach Chat is excluded.'
      };
    }
    const visibility = role === 'manager' ? 'manager_only' : 'learner_only';
    const userMessage = chatMessage('user', message, { visibility, learnerEmail: learnerEmail || undefined });
    await store.setJSON(`${prefix}${userMessage.createdAt}-${userMessage.id}`, userMessage, { onlyIfNew: true });
    const model = process.env.OPENAI_CHAT_MODEL || 'gpt-5.4-mini';
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, instructions: systemPrompt(role, lang) + evidenceContext(context, lang), input: [...history.map(item => ({ role: item.role, content: item.content })), { role: 'user', content: message }], max_output_tokens: 900 })
    });
    const payload = await response.json();
    if (!response.ok) return reply(502, { error: payload?.error?.message || 'AI conversation request failed.', userMessage });
    const text = extractOutputText(payload);
    if (!text) return reply(502, { error: 'AI conversation returned no text.', userMessage });
    // Check every quotation in the answer against the transcript lines the
    // model was actually given, so the page can label what is verified.
    const evidence = role === 'manager'
      ? evidenceReport({
        member: member ? { learnerEmail, preferredName: member.preferredName } : null,
        transcripts: member?.practiceTranscripts || [],
        check: checkQuotes(text, member?.practiceTranscripts || [], [...knownText, message])
      })
      : undefined;
    const assistantMessage = chatMessage('assistant', text, { visibility, model, learnerEmail: learnerEmail || undefined, evidence });
    await store.setJSON(`${prefix}${assistantMessage.createdAt}-${assistantMessage.id}`, assistantMessage, { onlyIfNew: true });
    return reply(200, { text, model, role, lang, userMessage, assistantMessage, learnerEmail: learnerEmail || null, evidence, resolvedMember: context.resolvedMember || null, evidenceSummary: context?.selectedMember?.evidenceSummary || null, teamEvidenceIndex: role === 'manager' ? context.teamEvidenceIndex : undefined, privacy: role === 'manager' ? 'Private Learner Coach Chat was not accessed.' : 'Private learner conversation.' });
  } catch (error) {
    console.error('ai-chat failed', error);
    return reply(error?.status || 500, { error: error?.message || 'AI conversation failed.' });
  }
}
