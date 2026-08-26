import { getStore } from '@netlify/blobs';
import { getUser, verifyRequestOrigin } from '@netlify/identity';

const STORE_NAME = 'agentraining-pilot';
const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function reply(status, body) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function cleanText(value, max = 6000) {
  return String(value ?? '').trim().slice(0, max);
}

function safeSegment(value, fallback) {
  const segment = cleanText(value, 100).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return segment || fallback;
}

function normalizeHistory(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-16).map(item => ({
    role: item?.role === 'assistant' ? 'assistant' : 'user',
    content: cleanText(item?.content, 6000)
  })).filter(item => item.content);
}

function chatMessage(role, content, extras = {}) {
  return {
    id: crypto.randomUUID(),
    role,
    content: cleanText(content, 6000),
    createdAt: new Date().toISOString(),
    visibility: 'learner_only',
    engine: 'ai-chat-v1',
    ...extras
  };
}

async function listJSON(store, prefix) {
  const { blobs } = await store.list({ prefix });
  const rows = await Promise.all(blobs.map(entry => store.get(entry.key, { type: 'json' })));
  return rows.filter(Boolean);
}

function systemPrompt(role, lang) {
  const zh = lang === 'zh';
  const identity = role === 'manager' ? (zh ? '你是主管的 AI 副驾驶。' : 'You are the manager’s AI Copilot.') : (zh ? '你是学员的私人 AI 教练和成长伙伴。' : 'You are the learner’s Personal AI Coach and growth partner.');
  return [
    identity,
    zh ? '最重要的原则：以人为本。先理解用户本人和当前问题，再提供帮助。不要把用户当作菜单或数据对象。' : 'Highest principle: people first. Understand the person and their current need before offering help. Never treat the user like a menu or a data object.',
    zh ? '进行自然、多轮、连续的对话。直接回应用户刚刚说的话，并使用最近对话保持上下文。' : 'Have a natural, continuous, multi-turn conversation. Directly answer what the user just said and use recent conversation history to preserve context.',
    zh ? '如果用户只是打招呼、介绍自己、谈压力、困扰、目标或一般工作问题，不要强行跳到练习分数、证据或任务。' : 'If the user is greeting you, introducing themselves, discussing stress, challenges, goals, or a general work issue, do not force the conversation into Practice scores, evidence, or assignments.',
    zh ? '只有当用户明确询问练习结果、训练证据、某位学员表现、训练任务或相关建议时，才使用提供的工作证据上下文。' : 'Use supplied work-evidence context only when the user explicitly asks about Practice results, training evidence, a learner’s performance, assignments, or related recommendations.',
    zh ? '第一次认识用户时，一次只问一个自然的问题，例如怎么称呼、目前做什么、最想解决什么。不要像填写表格。' : 'When getting to know a user, ask one natural question at a time, such as how to address them, what they do, or what they most want help with. Do not behave like a form.',
    zh ? '如果用户明确同意逐步建立成长档案，可以在对话中记住其主动提供的信息；不要假装已经知道用户没有说过的事情。' : 'If the user explicitly agrees to gradually build a growth profile, remember information they voluntarily provide in the conversation; never pretend to know facts they did not share.',
    zh ? '不要声称具有主观意识。不要编造用户信息。' : 'Do not claim subjective consciousness. Do not invent user information.',
    zh ? '回复简洁、温暖、专业，通常 2–5 段或更短；如果用户需要深入再展开。' : 'Keep replies concise, warm, and professional, usually 2–5 short paragraphs or less; go deeper when the user asks.'
  ].join('\n');
}

function evidenceContext(value, lang) {
  if (!value || typeof value !== 'object') return '';
  const safe = JSON.stringify(value).slice(0, 12000);
  if (!safe || safe === '{}') return '';
  return lang === 'zh'
    ? `\n\n以下是仅在相关时才使用的授权工作上下文。不要主动把对话拉到这里：\n${safe}`
    : `\n\nThe following is authorized work context to use only when relevant. Do not proactively steer the conversation into it:\n${safe}`;
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

export default async function handler(req) {
  try {
    if (req.method !== 'POST') return reply(405, { error: 'POST required.' });
    verifyRequestOrigin(req);
    const user = await getUser();
    if (!user) return reply(401, { error: 'Please sign in to continue.' });

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return reply(503, { error: 'AI conversation is not configured yet. OPENAI_API_KEY is missing on the server.' });

    const input = await req.json();
    const role = input.role === 'manager' ? 'manager' : 'learner';
    const lang = input.lang === 'zh' ? 'zh' : 'en';
    const message = cleanText(input.message, 6000);
    if (!message) return reply(400, { error: 'Message is required.' });

    if (role === 'manager') return reply(501, { error: 'Manager free conversation will be enabled after learner chat validation.' });

    const metadata = user.appMetadata || {};
    const teamId = safeSegment(metadata.team_id, 'founding-pilot');
    const userId = cleanText(user.id, 100);
    const store = getStore({ name: STORE_NAME, consistency: 'strong' });
    const prefix = `teams/${teamId}/private-coach/${safeSegment(userId, 'learner')}/`;

    const stored = await listJSON(store, prefix);
    stored.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
    const durableHistory = normalizeHistory(stored.filter(item => item.engine === 'ai-chat-v1'));
    const suppliedHistory = normalizeHistory(input.history);
    const history = durableHistory.length ? durableHistory : suppliedHistory;

    const userMessage = chatMessage('user', message);
    await store.setJSON(`${prefix}${userMessage.createdAt}-${userMessage.id}`, userMessage, { onlyIfNew: true });

    const instructions = systemPrompt(role, lang) + evidenceContext(input.context, lang);
    const model = process.env.OPENAI_CHAT_MODEL || 'gpt-5.4-mini';

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        instructions,
        input: [
          ...history.map(item => ({ role: item.role, content: item.content })),
          { role: 'user', content: message }
        ],
        max_output_tokens: 700
      })
    });

    const payload = await response.json();
    if (!response.ok) {
      console.error('ai-chat OpenAI error', response.status, payload?.error?.message || payload);
      return reply(502, { error: payload?.error?.message || 'AI conversation request failed.', userMessage });
    }

    const text = extractOutputText(payload);
    if (!text) return reply(502, { error: 'AI conversation returned no text.', userMessage });

    const assistantMessage = chatMessage('assistant', text, { model });
    await store.setJSON(`${prefix}${assistantMessage.createdAt}-${assistantMessage.id}`, assistantMessage, { onlyIfNew: true });

    return reply(200, { text, model, role, lang, userMessage, assistantMessage });
  } catch (error) {
    console.error('ai-chat failed', error);
    return reply(error?.status || 500, { error: error?.message || 'AI conversation failed.' });
  }
}
