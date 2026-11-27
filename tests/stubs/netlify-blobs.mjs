// In-memory stand-in for @netlify/blobs, used only by tests via tests/loader.mjs.
// Never touches real Netlify Blobs storage.
const stores = new Map();
// Per-key write counters, used as ETags so conditional writes
// (onlyIfMatch / onlyIfNew) behave like the real service.
const versions = new Map();

export function getStore({ name }) {
  if (!stores.has(name)) stores.set(name, new Map());
  const data = stores.get(name);
  const versionKey = key => name + '\u0000' + key;
  return {
    async setJSON(key, value, opts = {}) {
      if (opts.onlyIfNew && data.has(key)) return { modified: false };
      if (opts.onlyIfMatch !== undefined && (!data.has(key) || String(versions.get(versionKey(key))) !== String(opts.onlyIfMatch))) return { modified: false };
      data.set(key, JSON.parse(JSON.stringify(value)));
      const etag = String((versions.get(versionKey(key)) || 0) + 1);
      versions.set(versionKey(key), Number(etag));
      return { modified: true, etag };
    },
    async getWithMetadata(key) {
      return data.has(key) ? { data: JSON.parse(JSON.stringify(data.get(key))), etag: String(versions.get(versionKey(key)) || 0), metadata: {} } : null;
    },
    async get(key, opts) {
      return data.has(key) ? JSON.parse(JSON.stringify(data.get(key))) : null;
    },
    async list({ prefix }) {
      const blobs = [...data.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key }));
      return { blobs };
    },
    async delete(key) {
      data.delete(key);
    }
  };
}

// Test-only helper: wipe all in-memory stores between tests.
export function __resetAllStores() {
  stores.clear();
  versions.clear();
}
