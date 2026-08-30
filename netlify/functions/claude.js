// netlify/functions/claude.js
// Public AI proxy for the (login-free) simulator demo.
// Contract preserved: forwards { system, messages } verbatim to Anthropic,
// model 'claude-sonnet-4-6', max_tokens 1000. (See AGENTS.md §5.)
//
// Abuse protections added (anonymous, but bounded):
//   1) Origin/Referer allowlist  — blocks other sites & casual cross-site abuse
//   2) Per-IP rate limit (Blobs) — bounds scripted abuse; fails OPEN if Blobs down
//   3) Input length cap          — the biggest cost hole was uncapped input
//   4) Tightened CORS            — reflects the matched origin instead of '*'

const { getStore } = require('@netlify/blobs');

const ALLOWED_HOSTS = [
  'agentraining.ai',
  'www.agentraining.ai',
  'magical-platypus-ba1dfe.netlify.app'
];
const DEFAULT_ORIGIN = 'https://agentraining.ai';

const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_REQUESTS = 40;          // per IP, per window
const MAX_INPUT_CHARS = 20000;    // system + all message content

function hostAllowed(host) {
  if (!host) return false;
  host = host.toLowerCase();
  if (ALLOWED_HOSTS.includes(host)) return true;
  return host.endsWith('--magical-platypus-ba1dfe.netlify.app');
}

function checkOrigin(headers) {
  const origin = headers.origin || headers.Origin || '';
  if (origin) {
    try {
      const host = new URL(origin).host;
      return { present: true, allowed: hostAllowed(host), origin };
    } catch (e) {
      return { present: true, allowed: false, origin: null };
    }
  }
  const referer = headers.referer || headers.Referer || '';
  if (referer) {
    try {
      const url = new URL(referer);
      return { present: true, allowed: hostAllowed(url.host), origin: url.origin };
    } catch (e) {
      return { present: true, allowed: false, origin: null };
    }
  }
  return { present: false, allowed: true, origin: null };
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || DEFAULT_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin'
  };
}

function clientIp(headers) {
  const direct = headers['x-nf-client-connection-ip'];
  if (direct) return direct;
  const fwd = headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return 'unknown';
}

function ipKey(ip) {
  return 'ip-' + String(ip).replace(/[^a-zA-Z0-9]/g, '-').slice(0, 60);
}

async function underRateLimit(ip) {
  try {
    const store = getStore('claude-proxy-rate-limit');
    const key = ipKey(ip);
    const now = Date.now();
    const raw = await store.get(key, { type: 'json' });
    const hits = (Array.isArray(raw) ? raw : []).filter((t) => now - t < WINDOW_MS);
    if (hits.length >= MAX_REQUESTS) return false;
    hits.push(now);
    await store.setJSON(key, hits);
    return true;
  } catch (e) {
    return true;
  }
}

function inputLength(body) {
  let total = (typeof body.system === 'string') ? body.system.length : 0;
  if (Array.isArray(body.messages)) {
    for (const m of body.messages) {
      if (!m) continue;
      if (typeof m.content === 'string') {
        total += m.content.length;
      } else if (Array.isArray(m.content)) {
        for (const block of m.content) {
          if (block && typeof block.text === 'string') total += block.text.length;
        }
      }
    }
  }
  return total;
}

exports.handler = async (event) => {
  const headers = event.headers || {};
  const { present, allowed, origin } = checkOrigin(headers);

  if (event.httpMethod === 'OPTIONS') {
    if (present && !allowed) {
      return { statusCode: 403, body: 'Forbidden' };
    }
    return { statusCode: 204, headers: corsHeaders(origin), body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  if (present && !allowed) {
    return {
      statusCode: 403,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Forbidden origin' })
    };
  }

  const ip = clientIp(headers);
  if (!(await underRateLimit(ip))) {
    return {
      statusCode: 429,
      headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Too many requests. Please slow down.' })
    };
  }

  try {
    const body = JSON.parse(event.body);

    if (inputLength(body) > MAX_INPUT_CHARS) {
      return {
        statusCode: 413,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Request too large.' })
      };
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1000,
        system: body.system || '',
        messages: body.messages
      })
    });

    const data = await response.json();

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(origin),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
