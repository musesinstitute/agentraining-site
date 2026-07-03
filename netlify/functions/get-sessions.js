// Valid manager codes -> team names
const MANAGER_CODES = {
  'mgr-AT2026': 'vip',
  'mgr-wechat': 'wechat',
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { code } = event.queryStringParameters || {};

  if (!code || !MANAGER_CODES[code]) {
    return {
      statusCode: 401,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid manager code' })
    };
  }

  const team = MANAGER_CODES[code];

  try {
    const { blobs } = await netlifyBlobs(event, team);
    const sessions = blobs
      .filter(Boolean)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team, sessions })
    };
  } catch (err) {
    // Return empty sessions if blobs not available yet
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team, sessions: [] })
    };
  }
};

async function netlifyBlobs(event, team) {
  try {
    const { getStore } = require('@netlify/blobs');
    const store = getStore('agentraining-sessions');
    const { blobs: keys } = await store.list({ prefix: `${team}/` });
    const blobs = await Promise.all(
      keys.map(async (blob) => {
        try { return await store.get(blob.key, { type: 'json' }); }
        catch { return null; }
      })
    );
    return { blobs };
  } catch {
    return { blobs: [] };
  }
}
