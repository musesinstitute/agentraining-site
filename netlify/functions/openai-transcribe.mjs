import { verifyRequestOrigin } from '@netlify/identity';

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MIN_AUDIO_BYTES = 256;

const TRANSCRIBE_PROMPT = {
  en: 'IUL, Whole Life, Term Life, annuity, Medicare, premium, coverage, ETF, S&P 500, buy-sell agreement, key person insurance.',
  zh: 'IUL、Whole Life、Term Life、annuity、Medicare、premium、coverage、ETF、S&P 500、buy-sell agreement、key person insurance'
};

function reply(status, body) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function normalizeForComparison(value) {
  return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function lcsLength(a, b) {
  const m = a.length, n = b.length;
  if (!m || !n) return 0;
  let prev = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    const curr = new Array(n + 1).fill(0);
    for (let j = 1; j <= n; j++) {
      curr[j] = a[i - 1] === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    prev = curr;
  }
  return prev[n];
}

function isPromptEcho(transcriptText, promptText) {
  const transcript = normalizeForComparison(transcriptText);
  const prompt = normalizeForComparison(promptText);
  if (!transcript || !prompt) return false;
  return lcsLength(transcript, prompt) / prompt.length >= 0.6;
}

function detectAudioFormat(buffer, declaredMimeType) {
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE') {
    return { mimeType: 'audio/wav', extension: 'wav', detected: 'wav' };
  }
  if (buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) {
    return { mimeType: 'audio/webm', extension: 'webm', detected: 'webm' };
  }
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    return { mimeType: 'audio/mp4', extension: 'mp4', detected: 'mp4' };
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === 'OggS') {
    return { mimeType: 'audio/ogg', extension: 'ogg', detected: 'ogg' };
  }
  if (buffer.length >= 3 && buffer.subarray(0, 3).toString('ascii') === 'ID3') {
    return { mimeType: 'audio/mpeg', extension: 'mp3', detected: 'mp3' };
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) {
    return { mimeType: 'audio/mpeg', extension: 'mp3', detected: 'mp3' };
  }

  const declared = String(declaredMimeType || '').toLowerCase();
  if (declared.includes('webm')) return { mimeType: 'audio/webm', extension: 'webm', detected: 'declared-webm' };
  if (declared.includes('mp4') || declared.includes('m4a')) return { mimeType: 'audio/mp4', extension: 'mp4', detected: 'declared-mp4' };
  if (declared.includes('wav')) return { mimeType: 'audio/wav', extension: 'wav', detected: 'declared-wav' };
  if (declared.includes('mpeg') || declared.includes('mp3')) return { mimeType: 'audio/mpeg', extension: 'mp3', detected: 'declared-mp3' };
  return null;
}

async function verifyLegacyIdentity(req) {
  const authorization = req.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+/i.test(authorization)) return null;
  const origin = new URL(req.url).origin;
  const response = await fetch(`${origin}/.netlify/identity/user`, { method: 'GET', headers: { authorization } });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

export default async function handler(req) {
  try {
    if (req.method !== 'POST') return reply(405, { error: 'Method not allowed.' });
    verifyRequestOrigin(req);

    const user = await verifyLegacyIdentity(req);
    if (!user?.id) return reply(401, { error: 'Please sign in to continue.' });
    if (!process.env.OPENAI_API_KEY) return reply(500, { error: 'OPENAI_API_KEY is not configured.' });

    const input = await req.json().catch(() => ({}));
    const audioBase64 = String(input.audioBase64 || '');
    const declaredMimeType = String(input.mimeType || '').slice(0, 80);
    const language = input.language === 'zh' ? 'zh' : 'en';
    const recordingDurationMs = Number(input.recordingDurationMs) || 0;
    const chunkCount = Number(input.chunkCount) || 0;
    if (!audioBase64) return reply(400, { error: 'Missing audio data.' });

    const audioBuffer = Buffer.from(audioBase64, 'base64');
    if (!audioBuffer.length) return reply(400, { error: 'The recording was empty.' });
    if (audioBuffer.length < MIN_AUDIO_BYTES) return reply(400, { error: 'The recording was too short or incomplete. Please try again.' });
    if (audioBuffer.length > MAX_AUDIO_BYTES) return reply(413, { error: 'The recording is too large. Please record a shorter turn.' });

    const format = detectAudioFormat(audioBuffer, declaredMimeType);
    if (!format) {
      console.warn('pilot voice rejected unsupported audio container', { bytes: audioBuffer.length, declaredMimeType, recordingDurationMs, chunkCount });
      return reply(400, { error: 'The recording format was not recognized. Please try again.' });
    }

    console.info('pilot voice upload', {
      bytes: audioBuffer.length,
      declaredMimeType,
      detectedFormat: format.detected,
      recordingDurationMs,
      chunkCount
    });

    const prompt = TRANSCRIBE_PROMPT[language];
    const form = new FormData();
    form.append('file', new Blob([audioBuffer], { type: format.mimeType }), `recording.${format.extension}`);
    form.append('model', 'gpt-4o-transcribe');
    form.append('language', language);
    form.append('response_format', 'json');
    form.append('prompt', prompt);

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: form
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('OpenAI transcription API error', {
        status: response.status,
        type: data?.error?.type || 'unknown',
        bytes: audioBuffer.length,
        detectedFormat: format.detected,
        recordingDurationMs,
        chunkCount
      });
      return reply(response.status >= 500 ? 502 : response.status, { error: data?.error?.message || 'OpenAI transcription failed.' });
    }

    const rawText = String(data.text || '').trim();
    if (rawText && isPromptEcho(rawText, prompt)) {
      console.warn('pilot voice transcription: discarded a response that looks like a priming-prompt echo rather than real speech');
      return reply(200, { text: '' });
    }
    return reply(200, { text: rawText });
  } catch (error) {
    console.error('Transcription function error', error);
    return reply(error?.status || 500, { error: error?.message || 'Transcription failed.' });
  }
}
