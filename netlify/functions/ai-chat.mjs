import { getStore } from '@netlify/blobs';
import { getUser, verifyRequestOrigin } from '@netlify/identity';

const STORE_NAME = 'agentraining-pilot';
const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function reply(status, body) { return new Response(JSON.stringify(body), { status, headers: jsonHeaders }); }
function cleanText(value, max = 6000) { return String(value ?? '').trim().slice(0, max); }
function safeSegment(value, fallback) { const segment = cleanText(value, 100).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, ''); return segment || fallback; }
function normalizeEmail(value) { return cleanText(value, 320).toLowerCase(); }
function normalizeHistory(value) { if (!Array.isArray(value)) return []; return value.slice(-16).map(item => ({ role: item?.role === 'assistant' ? 'assistant' : 'user', content: cleanText(item?.content, 6000) })).filter(item => item.content); }
function chatMessage(role, content, extras = {}) { return { id: crypto.randomUUID(), role, content: cleanText(content, 6000), createdAt: new Date().toISOString(), engine: 'ai-chat-v1', ...extras }; }
async function listJSON(store, prefix) { const { blobs } = await store.list({ prefix }); const rows = await Promise.all(blobs.map(entry => store.get(entry.key, { type: 'json' }))); return rows.filter(Boolean); }

function systemPrompt(role, lang) {
  const zh = lang === 'zh';
  const manager = role === 'manager';
  return [
    manager ? (zh ? '你是主管的长期 AI 副驾驶和管理成长伙伴。' : 'You are the manager’s long-term AI Copilot and management growth partner.') : (zh ? '你是学员的私人 AI 教练和成长伙伴。' : 'You are the learner’s Personal AI Coach and growth partner.'),
    zh ? '产品哲学：以人为本，关系优先，在真正相关的时候再进入训练。' : 'Product philosophy: People first. Relationship first. Training when relevant.',
    zh ? '先理解用户本人和当前问题，再提供帮助。不要把用户当作菜单、数据对象或培训任务。' : 'Understand the person and their current need before offering help. Never treat the user like a menu, data object, or training task.',
    zh ? '进行自然、多轮、连续的对话。直接回应用户刚刚说的话，并使用最近对话保持上下文。' : 'Have a natural, continuous, multi-turn conversation. Directly answer what the user just said and use recent conversation history to preserve context.',
    manager ? (zh ? '主管进入对话时绝不要求先选择学员。可以先认识主管：怎么称呼、负责什么工作或团队、最近最关心什么、管理上有什么困难。一次自然地问一个问题。' : 'Never require a manager to select a learner before talking. First get to know the manager naturally: how to address them, their work or team, what matters most right now, and their management challenges. Ask one natural question at a time.') : (zh ? '第一次认识学员时，可以自然了解怎么称呼、目前做什么、最关心什么、有什么目标或困扰。一次只问一个自然的问题，不要像填写表格。' : 'When first meeting a learner, naturally learn how to address them, what they do, what matters to them, and their goals or challenges. Ask one natural question at a time; do not behave like a form.'),
    manager ? (zh ? '只有当主管主动谈到某位学员、团队成员、练习结果、工作证据或训练安排时，才使用所提供的学员工作证据。绝不访问或推断学员的私人 Coach Chat。' : 'Only use supplied learner work evidence when the manager brings up a learner, team member, Practice result, work evidence, or training decision. Never access or infer content from a learner’s private Coach Chat.') : (zh ? '如果用户只是打招呼、介绍自己、谈压力、困扰、目标或一般工作问题，不要强行跳到练习分数、证据或任务。只有明确相关时才使用练习上下文。' : 'If the user is greeting you, introducing themselves, discussing stress, challenges, goals, or a general work issue, do not force the conversation into Practice scores, evidence, or assignments. Use Practice context only when clearly relevant.'),
    zh ? '如果用户明确同意逐步建立成长档案，可以在对话中记住其主动提供的信息；不要编造用户没有说过的事情。' : 'If the user explicitly agrees to gradually build a growth profile, remember information they voluntarily provide; never invent facts they did not share.',
    zh ? '不要声称具有主观意识。回复温暖、专业、自然；需要深入时可以深入，不要为了简短而打断有价值的交流。' : 'Do not claim subjective consciousness. Be warm, professional, and natural; go deeper when useful rather than cutting off valuable conversation merely to be brief.'
  ].join('\n');
}

function evidenceContext(value, lang) {
  if (!value || typeof value !== 'object') return '';
  const safe = JSON.stringify(value).slice(0, 16000);
  if (!safe || safe === '{}') return '';
  return lang === 'zh' ? `\n\n以下是仅在用户当前话题真正相关时才使用的授权工作上下文。不要主动把对话拉到这里，也不要把它当作私人信息：\n${safe}` : `\n\nThe following is authorized work context to use only when genuinely relevant to the current topic. Do not proactively steer the conversation into it and do not treat it as private personal information:\n${safe}`;
}

function extractOutputText(payload) {
  if (typeof payload?.output_text === 'string' && payload.output_text.trim()) return payload.output_text.trim();
  const parts = []; for (const item of payload?.output || []) for (const content of item?.content || []) if (content?.type === 'output_text' && content?.text) parts.push(content.text);
  return parts.join('\n').trim();
}

async function authorizedManagerContext(store, teamId, learnerEmail) {
  if (!learnerEmail) return null;
  const teamPrefix = `teams/${teamId}`;
  const profiles = await listJSON(store, `${teamPrefix}/profiles/`);
  const profile = profiles.find(row => normalizeEmail(row.learnerEmail) === learnerEmail) || null;
  const sessions = (await listJSON(store, `${teamPrefix}/sessions/`)).filter(row => normalizeEmail(row.learner || row.learnerEmail) === learnerEmail).sort((a,b)=>String(b.savedAt||b.createdAt).localeCompare(String(a.savedAt||a.createdAt))).slice(0,5);
  const assignments = (await listJSON(store, `${teamPrefix}/assignments/`)).filter(row => normalizeEmail(row.assignedTo) === learnerEmail).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,8);
  return { learnerEmail, profile, recentSessions: sessions, assignments, privacy: 'Authorized work and Practice evidence only. Private Learner Coach Chat is excluded.' };
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

    const metadata = user.appMetadata || {};
    const roles = Array.isArray(metadata.roles) ? metadata.roles.map(x=>String(x).toLowerCase()) : [];
    if (role === 'manager' && !roles.includes('manager') && metadata.role !== 'manager') return reply(403, { error: 'Manager access is required.' });

    const teamId = safeSegment(metadata.team_id, 'founding-pilot');
    const userId = safeSegment(user.id, role);
    const store = getStore({ name: STORE_NAME, consistency: 'strong' });
    const prefix = role === 'manager' ? `teams/${teamId}/manager-ai/${userId}/` : `teams/${teamId}/private-coach/${userId}/`;

    const stored = await listJSON(store, prefix);
    stored.sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
    const durableHistory = normalizeHistory(stored.filter(item => item.engine === 'ai-chat-v1'));
    const suppliedHistory = normalizeHistory(input.history);
    const history = durableHistory.length ? durableHistory : suppliedHistory;

    let context = input.context && typeof input.context === 'object' ? input.context : null;
    let learnerEmail = '';
    if (role === 'manager') {
      learnerEmail = normalizeEmail(input.learnerEmail);
      const workContext = await authorizedManagerContext(store, teamId, learnerEmail);
      context = workContext || context;
    }

    const visibility = role === 'manager' ? 'manager_only' : 'learner_only';
    const userMessage = chatMessage('user', message, { visibility, learnerEmail: learnerEmail || undefined });
    await store.setJSON(`${prefix}${userMessage.createdAt}-${userMessage.id}`, userMessage, { onlyIfNew: true });

    const model = process.env.OPENAI_CHAT_MODEL || 'gpt-5.4-mini';
    const response = await fetch('https://api.openai.com/v1/responses', {
      method:'POST', headers:{'content-type':'application/json','authorization':`Bearer ${apiKey}`},
      body:JSON.stringify({ model, instructions: systemPrompt(role, lang) + evidenceContext(context, lang), input:[...history.map(item=>({role:item.role,content:item.content})),{role:'user',content:message}], max_output_tokens:900 })
    });
    const payload = await response.json();
    if (!response.ok) { console.error('ai-chat OpenAI error', response.status, payload?.error?.message || payload); return reply(502,{error:payload?.error?.message||'AI conversation request failed.',userMessage}); }
    const text = extractOutputText(payload);
    if (!text) return reply(502,{error:'AI conversation returned no text.',userMessage});
    const assistantMessage = chatMessage('assistant', text, { visibility, model, learnerEmail: learnerEmail || undefined });
    await store.setJSON(`${prefix}${assistantMessage.createdAt}-${assistantMessage.id}`, assistantMessage, { onlyIfNew:true });
    return reply(200,{text,model,role,lang,userMessage,assistantMessage,learnerEmail:learnerEmail||null,privacy:role==='manager'?'Private Learner Coach Chat was not accessed.':'Private learner conversation.'});
  } catch(error) { console.error('ai-chat failed',error); return reply(error?.status||500,{error:error?.message||'AI conversation failed.'}); }
}
