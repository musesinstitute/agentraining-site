// Anonymous demo speech transcription. Audio is forwarded once to OpenAI, not persisted.
// Requires OPENAI_API_KEY in the Netlify function runtime environment.
const { getStore } = require('@netlify/blobs');
const MAX_BYTES = 2500000;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 12;
const ALLOWED_HOSTS = new Set([
  'agentraining.ai', 'www.agentraining.ai', 'magical-platypus-ba1dfe.netlify.app'
]);
const MIME_EXT = {
  'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'mp4',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav'
};
const keywords = [
  'Roth IRA', 'traditional IRA', 'annuity', '年金',
  'IUL', 'indexed universal life', 'whole life',
  'term life', 'life insurance', 'Medicare', 'premium', '401(k)'
];
const json = (statusCode, body, origin) => ({
  statusCode, headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin'
  }, body: JSON.stringify(body)
});
function authorizedOrigin(headers) {
  const raw = headers.origin || headers.Origin || headers.referer || headers.Referer;
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' && !(host === 'localhost' || host === '127.0.0.1')) return null;
    if (!ALLOWED_HOSTS.has(host) && !host.endsWith('--magical-platypus-ba1dfe.netlify.app') &&
        host !== 'localhost' && host !== '127.0.0.1') return null;
    return url.origin;
  } catch (_) { return null; }
}
async function allowRequest(headers) {
  const ip = String(headers['x-nf-client-connection-ip'] || headers['x-forwarded-for'] || 'unknown').split(',')[0].trim();
  const key = 'ip-' + ip.replace(/[^a-zA-Z0-9]/g, '-').slice(0, 80);
  try {
    const store = getStore('demo-transcription-rate-limit');
    const now = Date.now();
    const prior = await store.get(key, { type: 'json' });
    const recent = (Array.isArray(prior) ? prior : []).filter(n => Number.isFinite(n) && now - n < WINDOW_MS);
    if (recent.length >= MAX_REQUESTS) return false;
    await store.setJSON(key, [...recent, now]);
    return true;
  } catch (_) {
    // Audio billing is sensitive: do not fail open if rate-limiting is unavailable.
    return null;
  }
}
exports.handler = async (event) => {
  const origin = authorizedOrigin(event.headers || {});
  if (!origin) return json(403, { error: 'Unrecognized site origin.' }, 'https://agentraining.ai');
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }, body: '' };
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' }, origin);
  if (!process.env.OPENAI_API_KEY) return json(503, { error: 'Voice transcription is not configured for this preview. Please type your answer.' }, origin);
  if ((event.body || '').length > 3550000) return json(413, { error: 'Recording too large; please try a shorter segment.' }, origin);
  let input;
  try { input = JSON.parse(event.body || '{}'); }
  catch (_) { return json(400, { error: 'Invalid audio request.' }, origin); }
  const mime = String(input.mimeType || '').split(';')[0].toLowerCase().trim();
  if (!MIME_EXT[mime] || typeof input.audioBase64 !== 'string' ||
      input.audioBase64.length < 100 || input.audioBase64.length > 3350000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(input.audioBase64)) {
    return json(400, { error: 'Unsupported or invalid audio recording.' }, origin);
  }
  const audio = Buffer.from(input.audioBase64, 'base64');
  if (audio.length < 100 || audio.length > MAX_BYTES) return json(413, { error: 'Audio size is outside the allowed range.' }, origin);
  const allowed = await allowRequest(event.headers || {});
  if (allowed === false) return json(429, { error: 'Voice transcription limit reached. Try again later or type your answer.' }, origin);
  if (allowed === null) return json(503, { error: 'Voice transcription is temporarily unavailable. Please type your answer.' }, origin);
  try {
    const form = new FormData();
    form.append('model', 'gpt-transcribe');
    form.append('file', new Blob([audio], { type: mime }), 'answer.' + MIME_EXT[mime]);
    form.append('prompt', 'Training demonstration for insurance advisors. The speaker may alternate between Mandarin Chinese and English, using insurance and retirement terms. Preserve the original words, English acronyms and Chinese characters. Do not insert terms that were not spoken.');
    for (const keyword of keywords) form.append('keywords[]', keyword);
    form.append('languages[]', 'zh');
    form.append('languages[]', 'en');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45000);
    let response;
    try {
      response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST', headers: { Authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
        body: form, signal: controller.signal
      });
    } finally { clearTimeout(timeout); }
    if (!response.ok) {
      const status = response.status === 429 ? 429 : 502;
      return json(status, { error: status === 429 ? 'Speech service is busy. Try again later.' : 'Speech service could not transcribe this recording.' }, origin);
    }
    const result = await response.json();
    const text = typeof result.text === 'string' ? result.text.trim() : '';
    if (!text) return json(422, { error: 'No recognizable speech was found. Please try again.' }, origin);
    if (text.length > 8000) return json(413, { error: 'Transcript is too long. Please record shorter sections.' }, origin);
    return json(200, { text, languages: Array.isArray(result.languages) ? result.languages.slice(0, 4) : [] }, origin);
  } catch (_) {
    return json(504, { error: 'Voice transcription timed out or is unavailable. Your typed text is unchanged.' }, origin);
  }
};
