// Cloudflare R2 storage adapter — the first real implementation of the
// provider-neutral STORAGE_ADAPTER_CONTRACT in lib/media-ingestion.mjs.
//
// See docs/engineering/media-ingestion-architecture-2026-09-14.md for why R2:
// zero egress (our own processing reads the media back), 10 GB free (covers
// the first pilot company), and S3-compatible presigning so a later move to
// S3/Supabase is a credential change behind this same contract, not a rewrite.
//
// SECURITY INVARIANTS:
//   - The bucket is private. Nothing here ever makes an object public.
//   - Credentials live only in environment variables, only on the server.
//     A presigned URL contains a signature, never the secret access key.
//   - Every URL handed to a browser or to a transcription provider is
//     short-lived and scoped to exactly one object key and one method.
//   - There is no fallback: if the environment is not configured, every entry
//     point throws MediaStorageNotConfiguredError. A silent fallback here
//     would let the product claim an upload that never happened.

import { MediaStorageNotConfiguredError } from './media-ingestion.mjs';
import { presignS3Url, signS3Request, encodeRfc3986, encodeKeyPath } from './aws-sigv4.mjs';

export const STORAGE_PROVIDER = 'cloudflare-r2';

// Every environment variable this adapter needs. Reported verbatim by
// r2ConfigFromEnv() so an operator is told exactly what is missing.
export const REQUIRED_ENV_VARS = Object.freeze([
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_NAME'
]);

// Optional overrides:
//   R2_ENDPOINT - full host for jurisdiction-specific buckets
//                 (e.g. <account>.eu.r2.cloudflarestorage.com). Defaults to
//                 <R2_ACCOUNT_ID>.r2.cloudflarestorage.com.
//   R2_REGION   - S3 signing region. R2 uses "auto".
export const OPTIONAL_ENV_VARS = Object.freeze(['R2_ENDPOINT', 'R2_REGION']);

// Returns { configured: true, config } or { configured: false, missing: [...] }.
// Never throws, so callers can report an honest "not configured" state.
export function r2ConfigFromEnv(env = process.env) {
  const missing = REQUIRED_ENV_VARS.filter(name => !String(env?.[name] || '').trim());
  if (missing.length) return { configured: false, missing };
  const accountId = String(env.R2_ACCOUNT_ID).trim();
  return {
    configured: true,
    missing: [],
    config: {
      accountId,
      accessKeyId: String(env.R2_ACCESS_KEY_ID).trim(),
      secretAccessKey: String(env.R2_SECRET_ACCESS_KEY).trim(),
      bucket: String(env.R2_BUCKET_NAME).trim(),
      host: String(env.R2_ENDPOINT || '').trim() || `${accountId}.r2.cloudflarestorage.com`,
      region: String(env.R2_REGION || '').trim() || 'auto'
    }
  };
}

function canonicalUriFor(config, key) {
  // Path-style addressing: /<bucket>/<key>. R2 supports it and it avoids
  // bucket-name-in-hostname edge cases entirely.
  return `/${encodeRfc3986(config.bucket)}/${encodeKeyPath(key)}`;
}

function requireKey(key) {
  const value = String(key ?? '').trim();
  if (!value) throw Object.assign(new Error('A storage object key is required.'), { status: 400 });
  // Defence in depth against a traversal-shaped key reaching the signer.
  if (value.includes('..') || value.startsWith('/')) {
    throw Object.assign(new Error('Invalid storage object key.'), { status: 400, code: 'invalid_storage_key' });
  }
  return value;
}

// Builds the adapter. `fetchImpl` is injectable so tests exercise the real
// request-shaping code against a stub instead of the network.
export function createR2Adapter(config, { fetchImpl } = {}) {
  if (!config?.accessKeyId || !config?.secretAccessKey || !config?.bucket || !config?.host) {
    throw new MediaStorageNotConfiguredError();
  }
  const doFetch = fetchImpl || ((...args) => fetch(...args));
  const signing = { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey, region: config.region, service: 's3', host: config.host };

  return {
    provider: STORAGE_PROVIDER,

    // Short-lived presigned PUT the BROWSER uses to upload the media bytes
    // directly. The bytes never pass through a Netlify Function.
    //
    // Note on size: a plain presigned PUT cannot itself enforce a maximum
    // object size (only a POST policy can). The declared size is validated
    // before this ticket is issued, and the ACTUAL stored size is verified
    // with headObject() at confirm time - an object that exceeds the limit is
    // rejected and deleted there rather than trusted here.
    createUploadTicket({ key, contentType, expiresInSeconds = 900, now = new Date() }) {
      const safeKey = requireKey(key);
      const { url, expiresAt } = presignS3Url({
        ...signing,
        method: 'PUT',
        canonicalUri: canonicalUriFor(config, safeKey),
        expiresIn: expiresInSeconds,
        // Binding content-type into the signature means the upload must use
        // exactly the type that was authorized.
        signedContentType: contentType || '',
        now
      });
      return { url, method: 'PUT', headers: contentType ? { 'content-type': contentType } : {}, expiresAt, provider: STORAGE_PROVIDER };
    },

    // Short-lived presigned GET handed to the transcription provider so it can
    // fetch the media once. Never stored, never returned to a browser.
    createReadTicket({ key, expiresInSeconds = 21600, now = new Date() }) {
      const safeKey = requireKey(key);
      const { url, expiresAt } = presignS3Url({
        ...signing,
        method: 'GET',
        canonicalUri: canonicalUriFor(config, safeKey),
        expiresIn: expiresInSeconds,
        now
      });
      return { url, expiresAt, provider: STORAGE_PROVIDER };
    },

    // Server-to-server HEAD, signed with headers rather than a URL so no
    // credential material is ever placed in a URL that could be logged.
    async headObject(key) {
      const safeKey = requireKey(key);
      const signed = signS3Request({ ...signing, method: 'HEAD', canonicalUri: canonicalUriFor(config, safeKey) });
      const response = await doFetch(signed.url, { method: 'HEAD', headers: signed.headers });
      if (response.status === 404) return { exists: false, byteSize: 0, contentType: '' };
      if (!response.ok) {
        throw Object.assign(new Error(`Storage HEAD failed (${response.status}).`), { status: 502, code: 'storage_head_failed' });
      }
      return {
        exists: true,
        byteSize: Number(response.headers.get('content-length') || 0),
        contentType: response.headers.get('content-type') || '',
        etag: (response.headers.get('etag') || '').replace(/"/g, '')
      };
    },

    async openObject(key) {
      const safeKey = requireKey(key);
      const signed = signS3Request({ ...signing, method: 'GET', canonicalUri: canonicalUriFor(config, safeKey) });
      const response = await doFetch(signed.url, { method: 'GET', headers: signed.headers });
      if (!response.ok) {
        throw Object.assign(new Error(`Storage GET failed (${response.status}).`), { status: 502, code: 'storage_get_failed' });
      }
      return response.body;
    },

    async deleteObject(key) {
      const safeKey = requireKey(key);
      const signed = signS3Request({ ...signing, method: 'DELETE', canonicalUri: canonicalUriFor(config, safeKey) });
      const response = await doFetch(signed.url, { method: 'DELETE', headers: signed.headers });
      // S3 DELETE is idempotent: 204 on success, 404 if already gone.
      if (!response.ok && response.status !== 404) {
        throw Object.assign(new Error(`Storage DELETE failed (${response.status}).`), { status: 502, code: 'storage_delete_failed' });
      }
      return { deleted: true };
    }
  };
}

// One call sites use: returns a ready adapter, or null when the deployment has
// no storage configured (so the caller can report that honestly rather than
// pretending). Throws only on a genuinely malformed configuration.
export function storageAdapterFromEnv(env = process.env, options = {}) {
  const result = r2ConfigFromEnv(env);
  if (!result.configured) return { adapter: null, missing: result.missing, provider: STORAGE_PROVIDER };
  return { adapter: createR2Adapter(result.config, options), missing: [], provider: STORAGE_PROVIDER };
}
