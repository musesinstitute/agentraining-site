import { getStore } from '@netlify/blobs';
import { getUser, verifyRequestOrigin } from '@netlify/identity';

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

function normalizeHistory(value) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(-16)
    .map(item => ({
      role: item?.role === 'assistant' ? 'assistant' : 'user',
      content: cleanText(item?.content)
    }))
    .filter(item => item.content);
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

function emailAlias(email) {
  return speechTokens(String(email || '').replace(/@/g, ' at ').replace(/\+/g, ' plus '));
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

  // Dictation-aware matching for phrases such as
  // "muses institute plus learner at gmail dot com".
  const speech = speechTokens(raw);
  let aliasBest = null;
  for (const row of roster) {
    const alias = emailAlias(row.learnerEmail);
    const tokens = alias.split(' ').filter(token => token && !['at', 'com'].includes(token));
    const hits = tokens.filter(token => speech.includes(token)).length;
    const coverage = tokens.length ? hits / tokens.length : 0;
    if (!aliasBest || coverage > aliasBest.coverage) {
      aliasBest = { email: row.learnerEmail, method: 'dictated_alias', coverage, alias };
    }
  }
  if (aliasBest && aliasBest.coverage >= 0.6) return aliasBest;

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

async function memberContext(store, teamId, email, allSessions) {
  if (!email) return null;
  const root = `teams/${teamId}`;
  const profiles = await listJSON(store, `${root}/profiles/`);
  const profile = profiles.find(row => normalizeEmail(row.learnerEmail) === email) || null;
  const sessions = (allSessions || await listJSON(store, `${root}/sessions/`))
    .filter(row => normalizeEmail(row.learner || row.learnerEmail) === email)
    .sort((a, b) => String(a.savedAt || a.createdAt).localeCompare(String(b.savedAt || b.createdAt)))
    .slice(-12).map(compactSession);
  const assignments = (await listJSON(store, `${root}/assignments/`))
    .filter(row => normalizeEmail(row.assignedTo || row.learner) === email)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, 8).map(row => ({ id: row.id, scenarioName: row.scenarioName, mode: row.mode, dueDate: row.dueDate, status: row.status, createdAt: row.createdAt }));
  return {
    learnerEmail: email,
    profile: profile ? { preferredName: profile.preferredName, claims: profile.claims, goals: profile.goals, updatedAt: profile.updatedAt } : null,
    recentSessions: sessions, assignments,
    evidenceSummary: { practiceSessionCount: sessions.length, oldestObservedAt: sessions[0]?.savedAt || null, latestObservedAt: sessions[sessions.length - 1]?.savedAt || null }
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
    const durable = normalizeHistory(stored.filter(row => row.engine === 'ai-chat-v1'));
    const supplied = normalizeHistory(input.history);
    const history = durable.length ? durable : supplied;
    let learnerEmail = '';
    let context = {};
    if (role === 'manager') {
      const roster = await managerRoster(store, teamId);
      const team = await teamEvidence(store, teamId, roster);
      const resolved = resolveMember(message, input.learnerEmail, roster);
      learnerEmail = resolved.email;
      const member = await memberContext(store, teamId, learnerEmail, team.sessions);
      context = { authorizedTeamRoster: roster, teamEvidenceIndex: team.index, resolvedMember: resolved, selectedMember: member, privacy: 'Authorized roster/work evidence only. Private Learner Coach Chat is excluded.' };
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
    const assistantMessage = chatMessage('assistant', text, { visibility, model, learnerEmail: learnerEmail || undefined });
    await store.setJSON(`${prefix}${assistantMessage.createdAt}-${assistantMessage.id}`, assistantMessage, { onlyIfNew: true });
    return reply(200, { text, model, role, lang, userMessage, assistantMessage, learnerEmail: learnerEmail || null, resolvedMember: context.resolvedMember || null, evidenceSummary: context?.selectedMember?.evidenceSummary || null, teamEvidenceIndex: role === 'manager' ? context.teamEvidenceIndex : undefined, privacy: role === 'manager' ? 'Private Learner Coach Chat was not accessed.' : 'Private learner conversation.' });
  } catch (error) {
    console.error('ai-chat failed', error);
    return reply(error?.status || 500, { error: error?.message || 'AI conversation failed.' });
  }
}
