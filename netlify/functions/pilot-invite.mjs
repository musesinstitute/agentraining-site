import { getStore } from '@netlify/blobs';
import { getUser, verifyRequestOrigin, admin } from '@netlify/identity';

// Invite Learner (feature/invite-learner).
//
// A manager creates a secure, app-owned invitation (independent of Netlify
// Identity's own email-based invite flow, so "Copy Invite Link" works even
// with no email delivery configured). The learner opens that link, sets a
// password, and this function provisions their Netlify Identity account
// server-side with the correct roles - the learner never needs, and never
// gets, any elevated privilege of their own.
//
// admin.createUser() below needs no manual wiring: per @netlify/identity's
// own documentation ("Admin methods use the operator token from the Netlify
// runtime, which is automatically available in Netlify Functions and Edge
// Functions") and its source (verified directly against the exact installed
// version, 1.2.0, and cross-checked against the latest 2.0.0 - identical
// logic in both), the operator token is supplied by the Netlify runtime
// itself with zero configuration from this codebase. There is nothing in
// the package that reads a `context` argument passed to the handler, so
// this file does not invent one; if that runtime assumption doesn't hold in
// a real deployment, admin.createUser() throws its own clear
// "operator token" error, which the accept handler below catches and
// reports distinctly (see the real-environment-validation note in the
// completion report) rather than failing silently.
//
// Storage: reuses the existing "agentraining-pilot" Netlify Blobs store
// (same store pilot-data.mjs and pilot-roster.mjs already use), under a new
// "invites/" namespace. No new storage system.
//
// Team isolation: every manager-facing action derives teamId from the
// caller's own verified Identity role (a single "team-{id}" role, exactly
// like pilot-roster.mjs's contextFor()) - never from client input. A manager
// can only create/list invites for their own team.

const STORE_NAME = 'agentraining-pilot';
const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const jsonHeaders = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function reply(status, body) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function cleanText(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function normalizeEmail(value) {
  return cleanText(value, 254).toLowerCase();
}

function safeSegment(value, fallback) {
  const segment = cleanText(value, 100).toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  return segment || fallback;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Same shape as pilot-roster.mjs's contextFor(): requires the caller to be a
// manager/admin AND to hold exactly one "team-*" role, so which team an
// invite belongs to is never ambiguous. Fails closed (returns null) rather
// than guessing.
function managerTeamContext(user) {
  const roles = Array.isArray(user.roles) ? user.roles : [];
  const isManager = roles.includes('manager') || roles.includes('admin');
  const teamRoles = roles.filter(role => typeof role === 'string' && role.startsWith('team-'));
  if (!isManager || teamRoles.length !== 1) return null;
  return {
    id: cleanText(user.id, 100),
    email: normalizeEmail(user.email),
    roles,
    teamId: safeSegment(teamRoles[0].slice(5), 'founding-pilot')
  };
}

function byEmailKey(teamId, email) {
  return `teams/${teamId}/invites/by-email/${safeSegment(normalizeEmail(email), 'invitee')}`;
}
// Deliberately NOT team-prefixed: at accept/lookup time the team isn't known
// yet (that's what we're resolving from the token), so this index has to be
// reachable without it. It is only ever read by exact-token match, never
// listed/enumerated, so it doesn't leak across teams.
function byTokenKey(token) {
  return `invites/by-token/${token}`;
}

function createInviteRecord(teamId, email, name, invitedByEmail) {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    token: crypto.randomUUID(),
    teamId,
    email: normalizeEmail(email),
    name: cleanText(name, 120),
    invitedBy: invitedByEmail,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + INVITE_TTL_MS).toISOString(),
    status: 'pending',
    acceptedAt: '',
    acceptedUserId: ''
  };
}

async function saveInvite(store, invite) {
  await store.setJSON(byEmailKey(invite.teamId, invite.email), invite);
  await store.setJSON(byTokenKey(invite.token), invite);
}

function isExpired(invite) {
  return Date.parse(invite.expiresAt) < Date.now();
}

function publicInviteView(invite) {
  return {
    id: invite.id, token: invite.token, email: invite.email, name: invite.name,
    teamId: invite.teamId, status: invite.status, createdAt: invite.createdAt,
    expiresAt: invite.expiresAt, invitedBy: invite.invitedBy
  };
}

async function writeInviteAudit(store, teamId, actorEmail, action, outcome, details = {}) {
  try {
    const event = { id: crypto.randomUUID(), action, outcome, actorEmail, occurredAt: new Date().toISOString(), details };
    await store.setJSON(`teams/${teamId}/audit/${event.occurredAt}-${event.id}`, event, { onlyIfNew: true });
  } catch (error) {
    console.warn('pilot-invite audit write skipped', error);
  }
}

export default async function handler(req) {
  try {
    const url = new URL(req.url);
    const action = cleanText(url.searchParams.get('action'), 40);
    const store = getStore({ name: STORE_NAME, consistency: 'strong' });

    // ---- Manager-authenticated actions ----
    if (req.method === 'POST' && action === 'create') {
      verifyRequestOrigin(req);
      const user = await getUser();
      if (!user) return reply(401, { error: 'Please sign in to continue.' });
      const actor = managerTeamContext(user);
      if (!actor) return reply(403, { error: 'Manager access with a single assigned team is required.' });

      const input = await req.json().catch(() => ({}));
      const email = normalizeEmail(input.email);
      const name = cleanText(input.name, 120);
      if (!email || !EMAIL_RE.test(email)) return reply(400, { error: 'Enter a valid learner email address.' });

      const existing = await store.get(byEmailKey(actor.teamId, email), { type: 'json' });
      if (existing && existing.status === 'pending' && !isExpired(existing)) {
        // Duplicate invite: reuse the still-valid pending invite instead of
        // minting a second live token for the same person.
        await writeInviteAudit(store, actor.teamId, actor.email, 'invite_create', 'reused_pending', { email });
        return reply(200, { invite: publicInviteView(existing), reused: true });
      }

      const invite = createInviteRecord(actor.teamId, email, name, actor.email);
      await saveInvite(store, invite);
      await writeInviteAudit(store, actor.teamId, actor.email, 'invite_create', 'success', { email, inviteId: invite.id });
      return reply(201, { invite: publicInviteView(invite), reused: false });
    }

    if (req.method === 'GET' && action === 'list') {
      const user = await getUser();
      if (!user) return reply(401, { error: 'Please sign in to continue.' });
      const actor = managerTeamContext(user);
      if (!actor) return reply(403, { error: 'Manager access with a single assigned team is required.' });

      const { blobs } = await store.list({ prefix: `teams/${actor.teamId}/invites/by-email/` });
      const rows = (await Promise.all(blobs.map(entry => store.get(entry.key, { type: 'json' })))).filter(Boolean);
      rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return reply(200, { invites: rows.map(publicInviteView) });
    }

    // ---- Public actions (the invited learner has no Identity session yet) ----
    if (req.method === 'GET' && action === 'lookup') {
      const token = cleanText(url.searchParams.get('token'), 100);
      if (!token) return reply(400, { error: 'Missing invitation link.' });
      const invite = await store.get(byTokenKey(token), { type: 'json' });
      if (!invite) return reply(404, { error: 'This invitation link is invalid.' });
      if (invite.status === 'accepted') return reply(200, { status: 'accepted', email: invite.email });
      if (isExpired(invite)) return reply(410, { error: 'This invitation link has expired. Ask your manager for a new one.' });
      return reply(200, { status: 'pending', email: invite.email, name: invite.name });
    }

    if (req.method === 'POST' && action === 'accept') {
      verifyRequestOrigin(req);
      const input = await req.json().catch(() => ({}));
      const token = cleanText(input.token, 100);
      const password = String(input.password || '');
      if (!token) return reply(400, { error: 'Missing invitation link.' });
      if (password.length < 8) return reply(400, { error: 'Choose a password with at least 8 characters.' });

      const invite = await store.get(byTokenKey(token), { type: 'json' });
      if (!invite) return reply(404, { error: 'This invitation link is invalid.' });

      // Re-opening an already-accepted invite is idempotent: never attempt
      // to re-provision (which would also just fail against GoTrue's own
      // uniqueness constraint) - tell the learner to sign in instead.
      if (invite.status === 'accepted') {
        return reply(200, { status: 'already_accepted', email: invite.email });
      }
      if (isExpired(invite)) return reply(410, { error: 'This invitation link has expired. Ask your manager for a new one.' });

      let created;
      try {
        // Roles are set here, at creation, not via a later update - so the
        // very first JWT this account ever gets (on its first sign-in)
        // already reflects app_metadata.roles / team_id correctly. There is
        // no stale-token window to account for, because the account never
        // existed with different (or no) roles before this point.
        created = await admin.createUser({
          email: invite.email,
          password,
          data: {
            app_metadata: {
              roles: ['learner', `team-${invite.teamId}`],
              team_id: invite.teamId
            },
            user_metadata: invite.name ? { full_name: invite.name } : {}
          }
        });
      } catch (error) {
        const msg = error?.message || '';
        // GoTrue rejects a duplicate email itself - we NEVER call updateUser
        // on an account we didn't just create in this same request, so an
        // unrelated pre-existing account is never touched, let alone
        // overwritten.
        if (/already exist|already (been )?registered/i.test(msg)) {
          return reply(409, { error: 'An account already exists for this email address. Please sign in instead, or contact your manager if this seems wrong.' });
        }
        if (/operator token|identity endpoint url/i.test(msg)) {
          console.error('pilot-invite accept: Identity admin operations unavailable in this function context (missing operator token / endpoint) - Invite Learner cannot provision accounts until this is verified in a real deployment', error);
          return reply(503, { error: 'Account creation is temporarily unavailable. Please contact your manager.' });
        }
        const status = Number(error?.status) || 0;
        if (status >= 400 && status < 500) {
          return reply(status, { error: msg || 'That password could not be accepted. Please try a different one.' });
        }
        console.error('pilot-invite accept: admin.createUser failed', error);
        return reply(502, { error: 'Could not create the account right now. Please try again or ask your manager for a new invite link.' });
      }

      const accepted = { ...invite, status: 'accepted', acceptedAt: new Date().toISOString(), acceptedUserId: created.id };
      await saveInvite(store, accepted);
      await writeInviteAudit(store, invite.teamId, invite.email, 'invite_accept', 'success', { inviteId: invite.id, userId: created.id });
      return reply(201, { status: 'created', email: invite.email });
    }

    return reply(404, { error: 'Unknown invite operation.' });
  } catch (error) {
    console.error('pilot-invite failed', error);
    return reply(500, { error: error?.message || 'Invite request failed.' });
  }
}
