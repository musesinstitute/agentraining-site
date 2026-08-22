// Bootstrap loaded via `node --import ./tests/register.mjs`. Registers the
// module-mocking loader (tests/loader.mjs) before any test file imports the
// real netlify/functions/*.mjs handlers, so those handlers transparently get
// the in-memory stubs instead of the real @netlify/blobs / @netlify/identity.
import { register } from 'node:module';

register('./loader.mjs', import.meta.url);
