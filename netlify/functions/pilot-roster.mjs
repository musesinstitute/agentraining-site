import { getStore } from '@netlify/blobs';

const STORE_NAME = 'agentraining-pilot';
const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function reply(status, body) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function clean(value, max = 254) {
  return String(value ?? '').trim().slice(0, max);
}

function safeSegment(value) {
  return clean(value, 100).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
}

async function verifyIdentity(req) {
  const authorization = req.headers.get('authorization') || '';
  if (!/^Bearer\s+\S+/i.test(authorization)) return null;
  const origin = new URL(req.url).origin;
  const response = await fetch(`${origin}/.netlify/identity/user`, { headers: { authorization } });
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

function contextFor(user) {
  const roles = Array.isArray(user?.app_metadata?.roles) ? user.app_metadata.roles : [];
  const teamRoles = roles.filter(role => typeof role === 'string' && role.startsWith('team-'));
  if (teamRoles.length !== 1) return null;
  return {
    id: clean(user.id, 100),
    email: clean(user.email).toLowerCase(),
    roles,
    teamId: safeSegment(teamRoles[0].slice(5)),
    isManager: roles.includes('manager') || roles.includes('admin'),
    isLearner: roles.includes('learner')
  };
}

export default async function handler(req) {
  try {
    if (!['GET', 'POST'].includes(req.method)) return reply(405, { error: 'Method not allowed.' });
    const user = await verifyIdentity(req);
    if (!user) return reply(401, { error: 'Please sign in to continue.' });
    const actor = contextFor(user);
    if (!actor?.teamId) return reply(403, { error: 'Pilot team access is not configured for this account.' });

    const store = getStore({ name: STORE_NAME, consistency: 'strong' });
    const prefix = `teams/${actor.teamId}/roster/`;

    if (req.method === 'POST') {
      const record = {
        id: actor.id,
        email: actor.email,
        roles: actor.roles,
        teamId: actor.teamId,
        isLearner: actor.isLearner,
        isManager: actor.isManager,
        lastSeenAt: new Date().toISOString()
      };
      await store.setJSON(`${prefix}${safeSegment(actor.id)}`, record);
      return reply(200, { member: record });
    }

    if (!actor.isManager) return reply(403, { error: 'Manager access is required.' });
    const { blobs } = await store.list({ prefix });
    const rows = await Promise.all(blobs.map(entry => store.get(entry.key, { type: 'json' })));
    const learners = rows.filter(Boolean).filter(row => row.isLearner && row.teamId === actor.teamId);
    learners.sort((a, b) => String(a.email).localeCompare(String(b.email)));
    return reply(200, { learners: learners.map(row => ({ email: row.email, roles: row.roles, lastSeenAt: row.lastSeenAt })) });
  } catch (error) {
    console.error('pilot-roster failed', error);
    return reply(500, { error: error?.message || 'Pilot roster request failed.' });
  }
}
