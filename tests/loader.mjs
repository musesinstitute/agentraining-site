// Node ESM loader hook: redirects @netlify/blobs and @netlify/identity to
// in-memory test stubs (tests/stubs/) so the test suite never calls real
// Netlify Blobs or Netlify Identity (including its admin API). Everything
// else resolves normally.
const STUB_MAP = {
  '@netlify/blobs': new URL('./stubs/netlify-blobs.mjs', import.meta.url).href,
  '@netlify/identity': new URL('./stubs/netlify-identity.mjs', import.meta.url).href
};

export async function resolve(specifier, context, nextResolve) {
  if (STUB_MAP[specifier]) return { url: STUB_MAP[specifier], shortCircuit: true };
  return nextResolve(specifier, context);
}
