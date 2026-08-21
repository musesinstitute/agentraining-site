// In-memory stand-in for @netlify/blobs, used only by tests via tests/loader.mjs.
// Never touches real Netlify Blobs storage.
const stores = new Map();

export function getStore({ name }) {
  if (!stores.has(name)) stores.set(name, new Map());
  const data = stores.get(name);
  return {
    async setJSON(key, value) {
      data.set(key, JSON.parse(JSON.stringify(value)));
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
}
