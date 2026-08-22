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

export let __currentUser = null;
const __adminUsersByEmail = new Map();
let __operatorTokenAvailable = true;

export function __setUser(u) { __currentUser = u; }
export function __setOperatorTokenAvailable(v) { __operatorTokenAvailable = v; }
export function __resetIdentityStub() {
  __currentUser = null;
  __adminUsersByEmail.clear();
  __operatorTokenAvailable = true;
}
// Seed an email as "already registered" in the fake GoTrue user directory,
// so tests can exercise the existing-account-refusal path.
export function __seedExistingUser(email) {
  __adminUsersByEmail.set(String(email).toLowerCase(), { id: 'existing-' + email });
}

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

const createUser = async (params) => {
  requireOperatorToken();
  const email = String(params.email || '').toLowerCase();
  if (__adminUsersByEmail.has(email)) {
    throw new StubAuthError('A user with this email address has already been registered', 422);
  }
  if (!params.password || params.password.length < 6) {
    throw new StubAuthError('Password should be at least 6 characters', 400);
  }
  const user = {
    id: 'user-' + Math.random().toString(36).slice(2),
    email,
    app_metadata: params.data?.app_metadata || {},
    user_metadata: params.data?.user_metadata || {}
  };
  __adminUsersByEmail.set(email, user);
  return { id: user.id, email: user.email, appMetadata: user.app_metadata, userMetadata: user.user_metadata };
};

const updateUser = async () => {
  requireOperatorToken();
  throw new StubAuthError('updateUser stub not used by these tests');
};

const listUsers = async () => { requireOperatorToken(); return [...__adminUsersByEmail.values()]; };
const getUserAdmin = async (id) => { requireOperatorToken(); return [...__adminUsersByEmail.values()].find(u => u.id === id) || null; };
const deleteUser = async () => { requireOperatorToken(); };

export const admin = { listUsers, getUser: getUserAdmin, createUser, updateUser, deleteUser };
