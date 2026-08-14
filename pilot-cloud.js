(function () {
  const params = new URLSearchParams(window.location.search);
  const enabled = params.get('pilot') === '1';
  let readyPromise;
  let finishReady;

  function currentUser() {
    return window.netlifyIdentity && window.netlifyIdentity.currentUser();
  }

  function roles(user) {
    return user?.app_metadata?.roles || [];
  }

  function showGate(message) {
    let gate = document.getElementById('pilot-auth-gate');
    if (!gate) {
      gate = document.createElement('div');
      gate.id = 'pilot-auth-gate';
      gate.style.cssText = 'position:fixed;inset:0;z-index:20000;background:rgba(15,23,42,.94);display:flex;align-items:center;justify-content:center;padding:24px;font-family:Arial,sans-serif';
      gate.innerHTML = '<div style="width:100%;max-width:460px;background:#fff;border-radius:18px;padding:32px;box-shadow:0 30px 80px rgba(0,0,0,.35)"><div style="text-align:center"><h1 style="margin:0 0 10px;font-size:26px">AgentTraining.ai Pilot</h1><p id="pilot-auth-message" style="color:#64748b;line-height:1.6"></p></div><form id="pilot-auth-form"><label for="pilot-auth-email" style="display:block;margin:18px 0 6px;color:#334155;font-weight:700">Email</label><input id="pilot-auth-email" type="email" autocomplete="username" required style="width:100%;min-width:0;border:1px solid #cbd5e1;border-radius:9px;padding:12px;font:inherit"><label for="pilot-auth-password" style="display:block;margin:14px 0 6px;color:#334155;font-weight:700">Password</label><input id="pilot-auth-password" type="password" autocomplete="current-password" required style="width:100%;min-width:0;border:1px solid #cbd5e1;border-radius:9px;padding:12px;font:inherit"><button id="pilot-auth-button" type="submit" style="width:100%;margin-top:20px;border:0;border-radius:9px;background:#1a56db;color:#fff;padding:12px 22px;font-weight:700;cursor:pointer">Sign in securely</button><p id="pilot-auth-status" role="status" aria-live="polite" style="min-height:20px;margin:12px 0 0;color:#b91c1c;text-align:center;font-size:13px"></p></form></div>';
      document.body.appendChild(gate);
      gate.querySelector('#pilot-auth-form').addEventListener('submit', async event => {
        event.preventDefault();
        const button = gate.querySelector('#pilot-auth-button');
        const status = gate.querySelector('#pilot-auth-status');
        const email = gate.querySelector('#pilot-auth-email').value.trim();
        const password = gate.querySelector('#pilot-auth-password').value;
        button.disabled = true;
        button.textContent = 'Signing in…';
        status.textContent = '';
        try {
          const loggedIn = await window.netlifyIdentity.gotrue.login(email, password, true);
          if (finishReady) finishReady(loggedIn);
          else window.location.reload();
        } catch (error) {
          status.textContent = error?.message || 'Sign-in failed. Please check your email and password.';
          button.disabled = false;
          button.textContent = 'Sign in securely';
        }
      });
    }
    gate.querySelector('#pilot-auth-message').textContent = message;
    gate.style.display = 'flex';
  }

  function hideGate() {
    const gate = document.getElementById('pilot-auth-gate');
    if (gate) gate.style.display = 'none';
  }

  async function ready(requiredRole) {
    if (!enabled) return null;
    if (!window.netlifyIdentity) throw new Error('Pilot sign-in could not be loaded.');
    if (!readyPromise) {
      readyPromise = new Promise(resolve => {
        window.netlifyIdentity.init();
        const finish = user => { hideGate(); resolve(user); };
        finishReady = finish;
        const user = currentUser();
        if (user) finish(user);
        else {
          showGate('Please sign in with your invited Pilot account.');
          window.netlifyIdentity.on('login', loggedIn => { window.netlifyIdentity.close(); finish(loggedIn); });
        }
      });
    }
    const user = await readyPromise;
    if (requiredRole && !roles(user).includes(requiredRole) && !roles(user).includes('admin')) {
      showGate(`This page requires the ${requiredRole} role.`);
      throw new Error(`The signed-in account does not have the ${requiredRole} role.`);
    }
    return user;
  }

  async function resetExpiredSession() {
    try {
      await window.netlifyIdentity.logout();
    } catch (error) {
      try { localStorage.removeItem('gotrue.user'); } catch (storageError) {}
    }
    readyPromise = null;
    finishReady = null;
    showGate('Your secure session expired. Please sign in again to continue.');
  }

  async function request(resource, options = {}) {
    const { requiredRole, query, ...fetchOptions } = options;
    let user = await ready(requiredRole);
    let token;
    try {
      token = await user.jwt();
    } catch (error) {
      await resetExpiredSession();
      user = await ready(requiredRole);
      token = await user.jwt();
    }
    const params = new URLSearchParams({ resource });
    Object.entries(query || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    });
    const response = await fetch(`/.netlify/functions/pilot-data?${params}`, {
      ...fetchOptions,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(fetchOptions.headers || {}) }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Pilot cloud request failed (${response.status}).`);
    return body;
  }

  window.PilotCloud = { enabled, ready, request, currentUser };
})();
