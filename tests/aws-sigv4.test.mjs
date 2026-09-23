// Known-answer tests for the hand-written SigV4 signer
// (netlify/functions/lib/aws-sigv4.mjs).
//
// The point of this file: a signing bug produces a URL that looks perfectly
// fine and fails only against the real provider. Pinning it to AWS's own
// published example vector means the implementation is verifiably correct
// without a credential, a network call, or an SDK dependency.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { presignS3Url, signS3Request, encodeRfc3986, encodeKeyPath, amzDate } from '../netlify/functions/lib/aws-sigv4.mjs';

// From AWS's "Signing AWS requests with Signature Version 4" documentation,
// the presigned-URL (query-string authentication) worked example.
const AWS_EXAMPLE = {
  method: 'GET',
  host: 'examplebucket.s3.amazonaws.com',
  canonicalUri: '/test.txt',
  accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
  secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
  region: 'us-east-1',
  service: 's3',
  expiresIn: 86400,
  now: new Date('2013-05-24T00:00:00Z')
};
const AWS_EXPECTED_SIGNATURE = 'aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404';
const AWS_EXPECTED_CANONICAL_REQUEST = [
  'GET',
  '/test.txt',
  'X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=AKIAIOSFODNN7EXAMPLE%2F20130524%2Fus-east-1%2Fs3%2Faws4_request&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host',
  'host:examplebucket.s3.amazonaws.com',
  '',
  'host',
  'UNSIGNED-PAYLOAD'
].join('\n');

describe('SigV4 presigning', () => {
  test('reproduces AWS\'s published example canonical request byte for byte', () => {
    assert.equal(presignS3Url(AWS_EXAMPLE).canonicalRequest, AWS_EXPECTED_CANONICAL_REQUEST);
  });

  test('reproduces AWS\'s published example signature exactly', () => {
    assert.equal(presignS3Url(AWS_EXAMPLE).signature, AWS_EXPECTED_SIGNATURE);
  });

  test('the signed URL carries a signature but never the secret key', () => {
    const { url } = presignS3Url(AWS_EXAMPLE);
    assert.ok(!url.includes(AWS_EXAMPLE.secretAccessKey));
    assert.match(url, new RegExp(`X-Amz-Signature=${AWS_EXPECTED_SIGNATURE}$`));
  });

  test('is deterministic for a fixed clock and changes when anything signed changes', () => {
    const base = presignS3Url(AWS_EXAMPLE).signature;
    assert.equal(presignS3Url(AWS_EXAMPLE).signature, base);
    assert.notEqual(presignS3Url({ ...AWS_EXAMPLE, canonicalUri: '/other.txt' }).signature, base);
    assert.notEqual(presignS3Url({ ...AWS_EXAMPLE, expiresIn: 900 }).signature, base);
    assert.notEqual(presignS3Url({ ...AWS_EXAMPLE, method: 'PUT' }).signature, base);
    assert.notEqual(presignS3Url({ ...AWS_EXAMPLE, now: new Date('2013-05-25T00:00:00Z') }).signature, base);
  });

  test('binding a content type adds it to the signed headers in canonical order', () => {
    const { canonicalRequest } = presignS3Url({ ...AWS_EXAMPLE, method: 'PUT', signedContentType: 'video/mp4' });
    assert.match(canonicalRequest, /content-type:video\/mp4\nhost:/);
    assert.match(canonicalRequest, /X-Amz-SignedHeaders=content-type%3Bhost/);
  });

  test('expiry is reported as an absolute instant the caller can display', () => {
    assert.equal(presignS3Url({ ...AWS_EXAMPLE, expiresIn: 900 }).expiresAt, '2013-05-24T00:15:00.000Z');
  });

  test('refuses to sign without complete credentials rather than emitting a broken URL', () => {
    assert.throws(() => presignS3Url({ ...AWS_EXAMPLE, secretAccessKey: '' }), /requires host, canonicalUri/);
    assert.throws(() => presignS3Url({ ...AWS_EXAMPLE, host: '' }), /requires host, canonicalUri/);
  });
});

describe('encoding helpers', () => {
  test('percent-encodes the characters encodeURIComponent leaves behind', () => {
    assert.equal(encodeRfc3986("a!b'c(d)e*f"), 'a%21b%27c%28d%29e%2Af');
  });

  test('object key separators survive, everything else is encoded', () => {
    assert.equal(encodeKeyPath('teams/team a/media/file name.mp4'), 'teams/team%20a/media/file%20name.mp4');
  });

  test('formats the AWS basic date', () => {
    assert.equal(amzDate(new Date('2026-09-14T12:34:56.789Z')), '20260914T123456Z');
  });
});

describe('header-based signing (server-to-server HEAD/DELETE)', () => {
  test('puts the credential in the Authorization header, never in the URL', () => {
    const signed = signS3Request({ ...AWS_EXAMPLE, method: 'HEAD' });
    assert.equal(signed.url, 'https://examplebucket.s3.amazonaws.com/test.txt');
    assert.ok(!signed.url.includes('X-Amz'));
    assert.match(signed.headers.authorization, /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20130524\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/);
    assert.ok(!JSON.stringify(signed).includes(AWS_EXAMPLE.secretAccessKey));
    // Empty-payload SHA-256, as required for a body-less signed request.
    assert.equal(signed.headers['x-amz-content-sha256'], 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
