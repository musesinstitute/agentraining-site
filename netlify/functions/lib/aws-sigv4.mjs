// Minimal AWS Signature Version 4 query-string (presigned URL) signer for
// S3-compatible object storage.
//
// Why hand-written instead of a dependency: the entire algorithm is ~60 lines
// of node:crypto, whereas @aws-sdk/s3-request-presigner pulls in the whole
// AWS SDK v3 client graph (tens of packages, several MB) into a Netlify
// Function bundle for one string-building operation. This repo's house
// pattern for every outbound integration is already a bare fetch() with an
// env-var key and no SDK (see lib/send-email.mjs), and adding no dependency
// also means nothing new to audit or keep patched.
//
// Correctness is pinned by a known-answer test against AWS's own published
// presigned-URL example vector (tests/aws-sigv4.test.mjs), so this is not
// "trust me" code.
//
// Deliberately generic (host + canonicalUri are inputs): the same signer works
// for Cloudflare R2 today and for AWS S3 or any other S3-compatible provider
// later, which is what keeps the storage decision reversible.

import { createHash, createHmac } from 'node:crypto';

const ALGORITHM = 'AWS4-HMAC-SHA256';
const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

const sha256Hex = value => createHash('sha256').update(value, 'utf8').digest('hex');
const hmac = (key, value) => createHmac('sha256', key).update(value, 'utf8').digest();

// RFC 3986 encoding. encodeURIComponent leaves ! ' ( ) * unescaped, which AWS
// requires to be percent-encoded.
export function encodeRfc3986(value) {
  return encodeURIComponent(String(value ?? '')).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

// Object keys keep their '/' separators; every other character is encoded.
export function encodeKeyPath(key) {
  return String(key ?? '').split('/').map(encodeRfc3986).join('/');
}

// 20260914T120000Z
export function amzDate(date) {
  return date.toISOString().replace(/[:-]/g, '').replace(/\.\d{3}/, '');
}

function signingKey(secretAccessKey, dateStamp, region, service) {
  return hmac(hmac(hmac(hmac('AWS4' + secretAccessKey, dateStamp), region), service), 'aws4_request');
}

// Returns { url, expiresAt, canonicalRequest, stringToSign }. The last two are
// returned for testability/debugging only - never log them, they describe a
// signed request.
export function presignS3Url({
  method = 'GET',
  host,
  canonicalUri,
  accessKeyId,
  secretAccessKey,
  region = 'auto',
  service = 's3',
  expiresIn = 900,
  signedContentType = '',
  now = new Date()
}) {
  if (!host || !canonicalUri || !accessKeyId || !secretAccessKey) {
    throw Object.assign(new Error('presignS3Url requires host, canonicalUri, accessKeyId and secretAccessKey.'), { status: 500 });
  }
  const date = amzDate(now);
  const dateStamp = date.slice(0, 8);
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;

  // Canonical headers must be sorted by lowercase header name: content-type
  // sorts before host.
  const headerPairs = signedContentType
    ? [['content-type', signedContentType], ['host', host]]
    : [['host', host]];
  const canonicalHeaders = headerPairs.map(([name, value]) => `${name}:${value}\n`).join('');
  const signedHeaders = headerPairs.map(([name]) => name).join(';');

  // Query parameters must be sorted by key; these five already are.
  const queryPairs = [
    ['X-Amz-Algorithm', ALGORITHM],
    ['X-Amz-Credential', `${accessKeyId}/${scope}`],
    ['X-Amz-Date', date],
    ['X-Amz-Expires', String(Math.max(1, Math.floor(expiresIn)))],
    ['X-Amz-SignedHeaders', signedHeaders]
  ];
  const canonicalQueryString = queryPairs.map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`).join('&');

  const canonicalRequest = [
    String(method).toUpperCase(),
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    UNSIGNED_PAYLOAD
  ].join('\n');

  const stringToSign = [ALGORITHM, date, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = hmac(signingKey(secretAccessKey, dateStamp, region, service), stringToSign).toString('hex');

  return {
    url: `https://${host}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`,
    expiresAt: new Date(now.getTime() + Math.floor(expiresIn) * 1000).toISOString(),
    signature,
    canonicalRequest,
    stringToSign
  };
}

// Header-based (non-presigned) SigV4 for server-to-server calls such as HEAD
// and DELETE, where there is no reason to put credentials in a URL at all.
export function signS3Request({
  method = 'GET',
  host,
  canonicalUri,
  accessKeyId,
  secretAccessKey,
  region = 'auto',
  service = 's3',
  now = new Date()
}) {
  if (!host || !canonicalUri || !accessKeyId || !secretAccessKey) {
    throw Object.assign(new Error('signS3Request requires host, canonicalUri, accessKeyId and secretAccessKey.'), { status: 500 });
  }
  const date = amzDate(now);
  const dateStamp = date.slice(0, 8);
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const payloadHash = sha256Hex('');
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${date}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = [String(method).toUpperCase(), canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const stringToSign = [ALGORITHM, date, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = hmac(signingKey(secretAccessKey, dateStamp, region, service), stringToSign).toString('hex');
  return {
    url: `https://${host}${canonicalUri}`,
    headers: {
      authorization: `${ALGORITHM} Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': date
    }
  };
}
