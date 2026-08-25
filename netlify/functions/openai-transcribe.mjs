import { verifyRequestOrigin } from '@netlify/identity';

const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store'
};
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;

// Vocabulary-priming prompt for gpt-4o-transcribe. Deliberately a bare list
// of terms, NOT a sentence describing or instructing the transcription
// ("This is a sales training conversation, please accurately transcribe...").
// The earlier instructional phrasing is the confirmed root cause of the
// production regression: gpt-4o-transcribe is an LLM-based decoder, not
// plain Whisper, and on quiet/short/unclear audio it can "continue" a
// prompt that reads like natural narration instead of admitting it didn't
// catch real speech - regurgitating a paraphrase of the prompt itself as
// the "transcript". A bare term list has nothing sentence-shaped for the
// model to continue. See isPromptEcho() below for the second half of the
// fix - a defense-in-depth check for the cases a better-shaped prompt alone
// doesn't prevent.
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

// Character-level longest common subsequence length. Character-level (not
// word-level) because the Chinese prompt/transcripts don't tokenize on
// whitespace. Inputs here are always short (a transcript and a ~140-char
// prompt), so a plain O(n*m) table is fine.
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

// Detects whether the model's own output is substantially a reproduction
// of what WE sent it as the priming prompt, rather than transcribing the
// learner. This is not a blocklist of specific bad phrases (which would be
// fragile, and could silently mangle a real transcript that legitimately
// uses one of these vocabulary words) - it measures what fraction of the
// prompt's own content shows up, in order, inside the returned text.
// A genuine sentence that happens to use one or two of the primed terms
// only ever reproduces a small fraction of the ~140-character prompt, so it
// scores far below the threshold; only a near-total echo of the prompt
// (the actual production symptom) trips it.
function isPromptEcho(transcriptText, promptText) {
  const transcript = normalizeForComparison(transcriptText);
  const prompt = normalizeForComparison(promptText);
  if (!transcript || !prompt) return false;
  const overlapRatio = lcsLength(transcript, prompt) / prompt.length;
  return overlapRatio >= 0.6;
}

async function verifyLegacyIdentity(req) {
  const authorization = req.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+/i.test(authorization)) return null;

  const origin = new URL(req.url).origin;
  const response = await fetch(`${origin}/.netlify/identity/user`, {
    method: 'GET',
    headers: { authorization }
  });
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

    const prompt = TRANSCRIBE_PROMPT[language];
    const form = new FormData();
    form.append('file', new Blob([audioBuffer], { type: mimeType }), `recording.${extension}`);
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
      console.error('OpenAI transcription API error', response.status, data?.error?.type || 'unknown');
      return reply(response.status >= 500 ? 502 : response.status, {
        error: data?.error?.message || 'OpenAI transcription failed.'
      });
    }

    const rawText = String(data.text || '').trim();
    if (rawText && isPromptEcho(rawText, prompt)) {
      // The model talked back the priming prompt instead of transcribing
      // real speech - report it exactly like inaudible/no speech, which
      // the existing frontend already handles correctly ("No clear speech
      // was detected. Please try again."). Never surface the prompt text
      // itself as if it were the learner's own words.
      console.warn('pilot voice transcription: discarded a response that looks like a priming-prompt echo rather than real speech');
      return reply(200, { text: '' });
    }

    return reply(200, { text: rawText });
  } catch (error) {
    console.error('Transcription function error', error);
    return reply(error?.status || 500, { error: error?.message || 'Transcription failed.' });
  }
}
