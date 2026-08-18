import { getUser, verifyRequestOrigin } from '@netlify/identity';

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

function reply(status, body) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

export default async function handler(req) {
  try {
    if (req.method !== 'POST') return reply(405, { error: 'Method not allowed.' });
    verifyRequestOrigin(req);

    const user = await getUser();
    if (!user) return reply(401, { error: 'Please sign in to continue.' });
    if (!process.env.OPENAI_API_KEY) return reply(500, { error: 'OPENAI_API_KEY is not configured.' });

    const input = await req.json().catch(() => ({}));
    const audioBase64 = String(input.audioBase64 || '');
    const mimeType = String(input.mimeType || 'audio/webm').slice(0, 80);
    const language = input.language === 'zh' ? 'zh' : 'en';
    if (!audioBase64) return reply(400, { error: 'Missing audio data.' });

    const audioBuffer = Buffer.from(audioBase64, 'base64');
    if (!audioBuffer.length) return reply(400, { error: 'The recording was empty.' });
    if (audioBuffer.length > MAX_AUDIO_BYTES) return reply(413, { error: 'The recording is too large. Please record a shorter turn.' });

    const extension = mimeType.includes('mp4') ? 'mp4'
      : mimeType.includes('ogg') ? 'ogg'
      : mimeType.includes('wav') ? 'wav'
      : 'webm';

    const form = new FormData();
    form.append('file', new Blob([audioBuffer], { type: mimeType }), `recording.${extension}`);
    form.append('model', 'gpt-4o-transcribe');
    form.append('language', language);
    form.append('response_format', 'json');
    form.append('prompt', language === 'zh'
      ? '這是一段銷售訓練對話。請準確辨識繁體中文、英文與專業詞彙，例如 IUL、Whole Life、Term Life、annuity、Medicare、premium、coverage、ETF、S&P 500、buy-sell agreement、key person insurance。'
      : 'This is a sales training conversation. Accurately transcribe insurance, finance, and real-estate terms such as IUL, Whole Life, Term Life, annuity, Medicare, premium, coverage, ETF, S&P 500, buy-sell agreement, and key person insurance.');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('OpenAI transcription API error', response.status, data?.error?.type || 'unknown');
      return reply(response.status >= 500 ? 502 : response.status, {
        error: data?.error?.message || 'OpenAI transcription failed.'
      });
    }

    return reply(200, { text: String(data.text || '').trim() });
  } catch (error) {
    console.error('Transcription function error', error);
    return reply(error?.status || 500, { error: error?.message || 'Transcription failed.' });
  }
}
