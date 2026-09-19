// Provider-neutral asynchronous transcription adapter.
//
// Shape (see docs/engineering/media-ingestion-architecture-2026-09-14.md §6):
// submit a short-lived signed READ url for the media, get a provider job id
// back in under a second, and receive a webhook when the transcript is ready.
// Nothing here knows anything about Company Knowledge - the webhook endpoint
// owns that hand-off. That separation is what keeps the provider swappable.
//
// Why asynchronous and not the existing openai-transcribe.mjs path: that
// endpoint POSTs the audio bytes inside a JSON body (capped ~4.5 MB by
// Netlify) to a synchronous 25 MB-per-file API, and a Netlify function has 60
// seconds. None of that can carry a one-hour training video. A URL+webhook
// provider also demuxes video containers for us, which is what removes the
// need for ffmpeg we have nowhere to run.
//
// openai-transcribe.mjs is deliberately left untouched: live Practice
// microphone turns are a few hundred KB and that path already works.
//
// ⚠ PROVIDER BEHAVIOUR TO VERIFY against current provider documentation
//   before enabling in production (flagged rather than assumed):
//     - exact accepted video containers for URL submission (MP4/MOV/WebM)
//     - webhook payload field names and retry/duplicate-delivery semantics
//     - whether a ~6 hour signed URL lifetime fits the provider's fetch window
//     - current language-code values for Mandarin/Cantonese content
//   The adapter boundary below is what makes correcting any of these a
//   one-file change.

export const TRANSCRIPTION_PROVIDERS = Object.freeze(['assemblyai']);
export const DEFAULT_TRANSCRIPTION_PROVIDER = 'assemblyai';

// Env vars this adapter needs.
export const REQUIRED_ENV_VARS = Object.freeze(['ASSEMBLYAI_API_KEY', 'MEDIA_WEBHOOK_SECRET']);
export const OPTIONAL_ENV_VARS = Object.freeze(['TRANSCRIPTION_PROVIDER', 'ASSEMBLYAI_API_URL']);

// The header the provider is asked to send back on its webhook, carrying the
// shared secret. Checked with a timing-safe comparison at the webhook.
export const WEBHOOK_AUTH_HEADER = 'x-agentraining-webhook-secret';

export class TranscriptionNotConfiguredError extends Error {
  constructor(missing = []) {
    super('Transcription provider is not configured for this deployment.');
    this.name = 'TranscriptionNotConfiguredError';
    this.status = 503;
    this.code = 'transcription_not_configured';
    this.missing = missing;
  }
}

export function transcriptionConfigFromEnv(env = process.env) {
  const provider = String(env?.TRANSCRIPTION_PROVIDER || '').trim() || DEFAULT_TRANSCRIPTION_PROVIDER;
  if (!TRANSCRIPTION_PROVIDERS.includes(provider)) {
    return { configured: false, provider, missing: ['TRANSCRIPTION_PROVIDER (unsupported value)'] };
  }
  const missing = REQUIRED_ENV_VARS.filter(name => !String(env?.[name] || '').trim());
  if (missing.length) return { configured: false, provider, missing };
  return {
    configured: true,
    provider,
    missing: [],
    config: {
      provider,
      apiKey: String(env.ASSEMBLYAI_API_KEY).trim(),
      apiUrl: String(env.ASSEMBLYAI_API_URL || '').trim() || 'https://api.assemblyai.com/v2',
      webhookSecret: String(env.MEDIA_WEBHOOK_SECRET).trim()
    }
  };
}

// AssemblyAI uses BCP-47-ish codes; we only map the two languages this product
// actually serves and otherwise let the provider auto-detect.
function languageFields(languageHint) {
  const hint = String(languageHint || '').toLowerCase();
  if (hint.startsWith('zh')) return { language_code: 'zh' };
  if (hint.startsWith('en')) return { language_code: 'en' };
  return { language_detection: true };
}

function createAssemblyAiAdapter(config, { fetchImpl } = {}) {
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  const authHeaders = { authorization: config.apiKey, 'content-type': 'application/json' };

  return {
    provider: 'assemblyai',
    // Recorded on the transcription job record for lineage/traceability.
    model: 'assemblyai-async',

    async submitTranscription({ mediaReadUrl, languageHint = '', webhookUrl }) {
      if (!mediaReadUrl) throw Object.assign(new Error('A media read URL is required to submit transcription.'), { status: 400 });
      if (!webhookUrl) throw Object.assign(new Error('A webhook URL is required to submit transcription.'), { status: 400 });
      const body = {
        audio_url: mediaReadUrl,
        webhook_url: webhookUrl,
        webhook_auth_header_name: WEBHOOK_AUTH_HEADER,
        webhook_auth_header_value: config.webhookSecret,
        ...languageFields(languageHint)
      };
      const response = await doFetch(`${config.apiUrl}/transcript`, { method: 'POST', headers: authHeaders, body: JSON.stringify(body) });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload?.id) {
        throw Object.assign(new Error(payload?.error || `Transcription provider returned ${response.status}.`), { status: response.status >= 500 ? 503 : 502, code: 'transcription_submit_failed' });
      }
      return { providerJobId: String(payload.id), status: String(payload.status || 'queued'), provider: 'assemblyai', model: 'assemblyai-async' };
    },

    // The webhook announces completion but does not carry the transcript, so
    // the text is always fetched over an authenticated server-to-server call.
    // That means a forged webhook body can never inject transcript content.
    async fetchTranscript(providerJobId) {
      const id = String(providerJobId || '').trim();
      if (!id) throw Object.assign(new Error('providerJobId is required.'), { status: 400 });
      const response = await doFetch(`${config.apiUrl}/transcript/${encodeURIComponent(id)}`, { method: 'GET', headers: { authorization: config.apiKey } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw Object.assign(new Error(payload?.error || `Transcription provider returned ${response.status}.`), { status: response.status >= 500 ? 503 : 502, code: 'transcription_fetch_failed' });
      }
      const status = String(payload?.status || '').toLowerCase();
      if (status === 'error') return { status: 'failed', text: '', error: String(payload?.error || 'Transcription failed at the provider.') };
      if (status !== 'completed') return { status: 'pending', text: '', error: '' };
      return { status: 'completed', text: String(payload?.text ?? ''), error: '' };
    },

    // Normalizes the provider's webhook body to our own shape.
    parseWebhook(body) {
      const providerJobId = String(body?.transcript_id || body?.id || '').trim();
      const raw = String(body?.status || '').toLowerCase();
      const status = raw === 'completed' ? 'completed' : raw === 'error' ? 'failed' : 'pending';
      return { providerJobId, status };
    }
  };
}

export function transcriptionAdapterFromEnv(env = process.env, options = {}) {
  const result = transcriptionConfigFromEnv(env);
  if (!result.configured) return { adapter: null, missing: result.missing, provider: result.provider };
  return { adapter: createAssemblyAiAdapter(result.config, options), missing: [], provider: result.provider, webhookSecret: result.config.webhookSecret };
}

// Throws rather than returning null, for the call sites that genuinely cannot
// continue without a provider (submitting a job).
export function requireTranscriptionAdapter(env = process.env, options = {}) {
  const { adapter, missing, provider, webhookSecret } = transcriptionAdapterFromEnv(env, options);
  if (!adapter) throw new TranscriptionNotConfiguredError(missing);
  return { adapter, provider, webhookSecret };
}
