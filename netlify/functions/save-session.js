const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const data = JSON.parse(event.body);
    const { ref, name, team, scenario, industry, scores, strengths, tips, summary, lang } = data;

    if (!ref || !scores) {
      return { statusCode: 400, body: 'Missing required fields' };
    }

    const store = getStore('agentraining-sessions');

    // Build session record
    const session = {
      ref,
      name: name || ref,
      team: team || 'default',
      scenario,
      industry,
      lang,
      scores,
      strengths: strengths || [],
      tips: tips || [],
      summary: summary || '',
      timestamp: new Date().toISOString(),
      date: new Date().toLocaleDateString('en-US', {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
      })
    };

    // Key: team/ref/timestamp — so each session is stored separately
    const key = `${session.team}/${ref}/${Date.now()}`;
    await store.setJSON(key, session);

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, key })
    };
  } catch (err) {
    console.error('save-session error:', err);
    return { statusCode: 500, body: 'Server error: ' + err.message };
  }
};
