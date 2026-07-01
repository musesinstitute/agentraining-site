const { getStore } = require('@netlify/blobs');

// Valid manager codes -> team names
// Add your managers here: 'manager-code': 'team-name'
const MANAGER_CODES = {
  'mgr-AT2026': 'vip',     // View all VIP manager sessions
  'mgr-wechat': 'wechat',  // View WeChat channel sessions
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
    const store = getStore('agentraining-sessions');

    // List all sessions for this team
    const { blobs } = await store.list({ prefix: `${team}/` });

    // Fetch all session records
    const sessions = await Promise.all(
      blobs.map(async (blob) => {
        try {
          return await store.get(blob.key, { type: 'json' });
        } catch {
          return null;
        }
      })
    );

    // Filter nulls and sort newest first
    const valid = sessions
      .filter(Boolean)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team, sessions: valid })
    };
  } catch (err) {
    console.error('get-sessions error:', err);
    return { statusCode: 500, body: 'Server error: ' + err.message };
  }
};
