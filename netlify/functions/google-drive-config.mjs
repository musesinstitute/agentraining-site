import { getUser } from '@netlify/identity';

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function reply(status, body) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

// ROOM 4C — Google Drive Single-File Import Pilot.
//
// Serves the OAuth Client ID and a domain/API-restricted browser API key
// that knowledge.html's Google Picker flow needs, read from server-side
// environment variables (GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_API_KEY) so
// nothing Google-related is ever hardcoded into the repository.
//
// Neither value is a client secret. This Pilot deliberately uses Google
// Identity Services' browser token-client flow + Picker (drive.file scope),
// which by design needs no client secret and no server-side token exchange
// at all - the Client ID and a referrer-restricted API key are meant to be
// visible in the browser once the picker runs; the security boundary is
// Google Cloud Console's "Authorized JavaScript origins" / API key
// restrictions, not secrecy of these two values. This endpoint still
// requires a signed-in Pilot manager so the import entry point stays
// manager-only end to end, matching the existing Company Knowledge write
// endpoints (see requireKnowledgeManager in pilot-data.mjs).
//
// This file intentionally never invents or hardcodes real values - if the
// environment variables are unset, `enabled` is false and the frontend
// shows a clear "not configured yet" state instead of guessing.
export default async function handler(req) {
  try {
    if (req.method !== 'GET') return reply(405, { error: 'Method not allowed.' });
    const user = await getUser();
    if (!user) return reply(401, { error: 'Please sign in to continue.' });
    const roles = Array.isArray(user.roles) ? user.roles : [];
    if (!roles.includes('manager') && !roles.includes('admin')) {
      return reply(403, { error: 'Manager access is required.' });
    }
    const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID || '';
    const apiKey = process.env.GOOGLE_DRIVE_API_KEY || '';
    return reply(200, { enabled: Boolean(clientId && apiKey), clientId, apiKey });
  } catch (error) {
    console.error('google-drive-config failed', error);
    return reply(500, { error: 'Could not load Google Drive configuration.' });
  }
}
