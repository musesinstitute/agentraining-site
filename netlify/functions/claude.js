const { getStore } = require('@netlify/blobs');

// ── Origin allow-list ──
// Browsers always send an Origin header on a cross-site (and, per the current
// Fetch spec, same-site) POST, so legitimate calls from the public demo carry
// one. curl / server-to-server abuse does not, and gets rejected below.
const ALLOWED_ORIGINS = new Set([
  'https://agentraining.ai',
  'https://www.agentraining.ai',
  'https://magical-platypus-ba1dfe.netlify.app'
]);
// Netlify deploy previews / branch deploys, e.g.
// https://deploy-preview-12--magical-platypus-ba1dfe.netlify.app
const DEPLOY_PREVIEW_SUFFIX = '--magical-platypus-ba1dfe.netlify.app';

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.has(origin)) return true;
  return origin.endsWith(DEPLOY_PREVIEW_SUFFIX);
}

// Origin header wins; fall back to Referer (some browsers/proxies omit Origin).
function getRequestOrigin(event) {
  const headers = event.headers || {};
  const originHeader = headers.origin || headers.Origin;
  if (isAllowedOrigin(originHeader)) return originHeader;

  const referer = headers.referer || headers.Referer;
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      if (isAllowedOrigin(refOrigin)) return refOrigin;
    } catch {
      // malformed Referer, ignore
    }
  }
  return null;
}

// ── Per-IP rate limit (rolling window, backed by Netlify Blobs) ──
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_MAX = 40; // requests per IP per window

function getClientIp(event) {
  const headers = event.headers || {};
  const direct = headers['x-nf-client-connection-ip'];
  if (direct) return direct;
  const forwarded = headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return 'unknown';
}

async function isRateLimited(ip) {
  try {
    const store = getStore('claude-proxy-rate-limit');
    const key = `ip/${ip}`;
    const now = Date.now();

    let record = await store.get(key, { type: 'json' });
    if (!record || typeof record.windowStart !== 'number' || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
      record = { windowStart: now, count: 0 };
    }

    record.count += 1;
    await store.setJSON(key, record);

    return record.count > RATE_LIMIT_MAX;
  } catch (err) {
    // If Blobs is unavailable for any reason, fail open — the public demo
    // must keep working even if rate limiting can't be enforced right now.
    console.error('rate limit check failed:', err.message);
    return false;
  }
}

// ── Input size cap ──
const MAX_INPUT_CHARS = 20000;

function inputLength(body) {
  let total = 0;
  if (typeof body.system === 'string') total += body.system.length;

  if (Array.isArray(body.messages)) {
    for (const message of body.messages) {
      const content = message && message.content;
      if (typeof content === 'string') {
        total += content.length;
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (typeof block === 'string') total += block.length;
          else if (block && typeof block.text === 'string') total += block.text.length;
        }
      }
    }
  }
  return total;
}

exports.handler = async (event) => {
  const origin = getRequestOrigin(event);
  const corsHeaders = origin
    ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' }
    : {};

  // CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    if (!origin) {
      return { statusCode: 403, body: 'Forbidden' };
    }
    return {
      statusCode: 204,
      headers: {
        ...corsHeaders,
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  if (!origin) {
    return {
      statusCode: 403,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Forbidden: origin not allowed' })
    };
  }

  const ip = getClientIp(event);
  if (await isRateLimited(ip)) {
    return {
      statusCode: 429,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ error: 'Too many requests, please try again later.' })
    };
  }

  try {
    const body = JSON.parse(event.body);

    if (inputLength(body) > MAX_INPUT_CHARS) {
      return {
        statusCode: 413,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'Request too large' })
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
        ...corsHeaders,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(data)
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: corsHeaders,
      body: JSON.stringify({ error: err.message })
    };
  }
};
