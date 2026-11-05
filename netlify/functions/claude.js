// netlify/functions/claude.js
// Public AI proxy for the (login-free) simulator demo.
// Contract: forwards { system, messages } verbatim to Anthropic (See AGENTS.md §5).
// An optional `role` picks one of two fixed model settings; the browser can never
// name a model itself:
//   role 'client'  -> AI client role-play: Claude Haiku 5.5, thinking off (cheap, fast)
//   anything else  -> scoring + AI coach:   Claude Sonnet 5.5, adaptive thinking, low effort
// The response keeps the Anthropic shape, but `content` holds only text blocks so
// callers can keep reading content[0].text (newer models may return thinking blocks first).
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

// Rate limit per IP, per 10-minute window, in two parts (both must pass):
//  1) a cost-weighted budget: a Sonnet 5.5 call (scoring, coach) counts 1 unit, a Haiku 5.5
//     call (AI client) counts 0.1 unit, matching their relative price (~20x cheaper). One full
//     10-turn practice is ~12 units, and a learner who also uses all 30 coach messages and
//     5 redos is ~50, so a few learners behind the same office Wi-Fi no longer starve each
//     other. Worst-case spend for one IP is ~RATE_LIMIT_UNITS x US$0.007 per window.
//  2) a raw request-count ceiling, so many tiny calls can't be used to flood the function.
// Both are tunable per deploy with environment variables, without a code change.
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
function envNumber(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
const RATE_LIMIT_UNITS = () => envNumber('CLAUDE_RATE_LIMIT_UNITS', 100);
const RATE_LIMIT_REQUESTS = () => envNumber('CLAUDE_RATE_LIMIT_REQUESTS', 250);
const WEIGHT_COACH = 1;
const WEIGHT_CLIENT = 0.1;
const MAX_INPUT_CHARS = 20000;    // system + all message content

const MODEL_SETTINGS = {
  client: {
    model: 'claude-haiku-5-5',
    max_tokens: 1000,
    thinking: { type: 'disabled' },
    output_config: { effort: 'low' }
  },
  coach: {
    model: 'claude-sonnet-5-5',
    max_tokens: 2000,                      // headroom: thinking counts toward max_tokens
    output_config: { effort: 'low' },      // low effort skips thinking on most simple requests
    fallbacks: 'default'                   // server-side retry if a safety classifier declines
  }
};

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

async function underRateLimit(ip, weight) {
  try {
    const store = getStore('claude-proxy-rate-limit');
    const key = ipKey(ip);
    const now = Date.now();
    const raw = await store.get(key, { type: 'json' });
    // Entries are { t, w }; plain numbers are the older format (1 unit each).
    const hits = (Array.isArray(raw) ? raw : [])
      .map((h) => (typeof h === 'number' ? { t: h, w: 1 } : h))
      .filter((h) => h && typeof h.t === 'number' && now - h.t < WINDOW_MS);
    const used = hits.reduce((sum, h) => sum + (typeof h.w === 'number' ? h.w : 1), 0);
    if (hits.length >= RATE_LIMIT_REQUESTS()) return false;
    if (used + weight > RATE_LIMIT_UNITS()) return false;
    hits.push({ t: now, w: weight });
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

  let body;
  try {
    body = JSON.parse(event.body);
  } catch (err) {
    return {
      statusCode: 400,
      headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid JSON body.' })
    };
  }
  if (!body || typeof body !== 'object') {
    return {
      statusCode: 400,
      headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Invalid request.' })
    };
  }

  const ip = clientIp(headers);
  const weight = body.role === 'client' ? WEIGHT_CLIENT : WEIGHT_COACH;
  if (!(await underRateLimit(ip, weight))) {
    return {
      statusCode: 429,
      headers: { ...corsHeaders(origin), 'Content-Type': 'application/json', 'Retry-After': '60' },
      body: JSON.stringify({ error: 'Too many requests. Please slow down.' })
    };
  }

  try {
    if (inputLength(body) > MAX_INPUT_CHARS) {
      return {
        statusCode: 413,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Request too large.' })
      };
    }

    const settings = body.role === 'client' ? MODEL_SETTINGS.client : MODEL_SETTINGS.coach;
    const apiHeaders = {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    };
    if (settings.fallbacks) apiHeaders['anthropic-beta'] = 'server-side-fallback-2026-07-01';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: apiHeaders,
      body: JSON.stringify({
        ...settings,
        system: body.system || '',
        messages: body.messages
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return {
        statusCode: response.status >= 500 ? 502 : response.status,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      };
    }

    // Keep only text blocks so content[0].text is the answer. A safety decline
    // (stop_reason "refusal") or an empty answer is reported as an error.
    const textBlocks = (Array.isArray(data.content) ? data.content : [])
      .filter((b) => b && b.type === 'text' && b.text);
    if (data.stop_reason === 'refusal' || textBlocks.length === 0) {
      return {
        statusCode: 502,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'No answer from the model.', stop_reason: data.stop_reason || null })
      };
    }
    data.content = textBlocks;

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
