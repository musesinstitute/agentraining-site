// Node ESM loader hook: redirects @netlify/blobs, @netlify/identity, and
// pilot-invite.mjs's own send-email helper to in-memory test stubs
// (tests/stubs/) so the test suite never calls real Netlify Blobs, Netlify
// Identity (including its admin API), or the real Resend API. Everything
// else resolves normally.
const STUB_MAP = {
  '@netlify/blobs': new URL('./stubs/netlify-blobs.mjs', import.meta.url).href,
  '@netlify/identity': new URL('./stubs/netlify-identity.mjs', import.meta.url).href,
  './lib/send-email.mjs': new URL('./stubs/send-email.mjs', import.meta.url).href
};

export async function resolve(specifier, context, nextResolve) {
  if (STUB_MAP[specifier]) return { url: STUB_MAP[specifier], shortCircuit: true };
  return nextResolve(specifier, context);
}
