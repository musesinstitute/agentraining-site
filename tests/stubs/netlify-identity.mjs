// Stand-in for @netlify/identity, used only by tests via tests/loader.mjs.
// Mirrors the real package's observable behavior closely enough for these
// tests without ever making a network call. Never touches real Netlify
// Identity.
//
// Per the actual installed package (verified directly against its source,
// both the pinned 1.2.0 and the latest 2.0.0 - identical logic in both) and
// its documented README, admin.* methods are authorized by an "operator
// token" that the real Netlify runtime supplies automatically inside a
// genuine Netlify Function - application code never wires this itself.
// This stub models that as an environment property (__operatorTokenAvailable,
// true by default, matching a real deployed Function), NOT something the
// code under test has to set up - so these tests exercise the same contract
// pilot-invite.mjs actually relies on, without inventing any wiring of our
// own on either side.
//
// createUser() does NOT persist data.app_metadata/data.user_metadata. This
// is deliberate, not an oversight: production evidence (two real Invite
// Learner accounts created with "No roles set" and no name, despite both
// being sent in the createUser call) showed the real Identity admin
// create-user endpoint does not reliably persist metadata supplied at
// creation time - only email/password/confirm are guaranteed to land. An
// earlier version of this stub "helpfully" stored data.app_metadata anyway,
// which let every test pass while hiding exactly this production bug. This
// stub now reproduces the real gap, so pilot-invite.mjs's tests only pass if
// the code actually performs the follow-up admin.updateUser() +
// admin.getUser() verification - never if it trusts createUser() alone.

export let __currentUser = null;
const __usersById = new Map(); // id -> { id, email, app_metadata, user_metadata }
let __operatorTokenAvailable = true;
let __updateUserShouldFailOnce = false;
let __getUserStaleOnce = false;

export function __setUser(u) { __currentUser = u; }
export function __setOperatorTokenAvailable(v) { __operatorTokenAvailable = v; }
export function __resetIdentityStub() {
  __currentUser = null;
  __usersById.clear();
  __operatorTokenAvailable = true;
  __updateUserShouldFailOnce = false;
  __getUserStaleOnce = false;
}
// Seed an email as "already registered" in the fake GoTrue user directory,
// so tests can exercise the existing-account-refusal path.
export function __seedExistingUser(email) {
  const id = 'existing-' + email;
  __usersById.set(id, { id, email: String(email).toLowerCase(), app_metadata: {}, user_metadata: {} });
}
// Fault injection for the two provisioning-fix scenarios that can only
// happen mid-request (not simulatable by mutating the Blobs store between
// calls, unlike a Blobs-write failure): the very next admin.updateUser()
// call throws once, or the very next admin.getUser() call returns a stale
// (pre-update) view once - modeling a verification read that doesn't yet
// reflect a write that actually succeeded. Both self-reset after firing.
export function __failNextUpdateUser() { __updateUserShouldFailOnce = true; }
export function __makeNextGetUserStale() { __getUserStaleOnce = true; }

export async function getUser() { return __currentUser; }
export function verifyRequestOrigin() { return true; }

class StubAuthError extends Error {
  constructor(message, status) { super(message); this.name = 'AuthError'; this.status = status; }
}

function requireOperatorToken() {
  if (!__operatorTokenAvailable) {
    throw new StubAuthError('Admin operations require an operator token (only available in Netlify Functions)');
  }
}

function findByEmail(email) {
  return [...__usersById.values()].find(u => u.email === email);
}

// Mirrors the real package's toUser() projection (roles array flattened
// from app_metadata.roles, camelCase appMetadata/userMetadata) so tests
// exercise the exact shape pilot-invite.mjs's verification logic reads -
// not a convenience shape invented for testing.
function toUser(record) {
  const appMeta = record.app_metadata || {};
  const userMeta = record.user_metadata || {};
  return {
    id: record.id,
    email: record.email,
    roles: Array.isArray(appMeta.roles) ? appMeta.roles : undefined,
    appMetadata: appMeta,
    userMetadata: userMeta
  };
}

const createUser = async (params) => {
  requireOperatorToken();
  const email = String(params.email || '').toLowerCase();
  if (findByEmail(email)) {
    throw new StubAuthError('A user with this email address has already been registered', 422);
  }
  if (!params.password || params.password.length < 6) {
    throw new StubAuthError('Password should be at least 6 characters', 400);
  }
  // Deliberately ignores params.data - see file header.
  const record = { id: 'user-' + Math.random().toString(36).slice(2), email, app_metadata: {}, user_metadata: {} };
  __usersById.set(record.id, record);
  return toUser(record);
};

const updateUser = async (userId, attributes) => {
  requireOperatorToken();
  if (__updateUserShouldFailOnce) {
    __updateUserShouldFailOnce = false;
    throw new StubAuthError('Simulated updateUser failure', 500);
  }
  const record = __usersById.get(userId);
  if (!record) throw new StubAuthError('User not found', 404);
  if (attributes && 'app_metadata' in attributes) record.app_metadata = attributes.app_metadata;
  if (attributes && 'user_metadata' in attributes) record.user_metadata = attributes.user_metadata;
  return toUser(record);
};

const listUsers = async () => { requireOperatorToken(); return [...__usersById.values()].map(toUser); };
const getUserAdmin = async (id) => {
  requireOperatorToken();
  const record = __usersById.get(id);
  if (!record) return null;
  if (__getUserStaleOnce) {
    __getUserStaleOnce = false;
    return toUser({ id: record.id, email: record.email, app_metadata: {}, user_metadata: {} });
  }
  return toUser(record);
};
const deleteUser = async () => { requireOperatorToken(); };

export const admin = { listUsers, getUser: getUserAdmin, createUser, updateUser, deleteUser };
