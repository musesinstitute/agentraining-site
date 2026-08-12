(function () {
  const params = new URLSearchParams(window.location.search);
  const enabled = params.get('pilot') === '1';
  let readyPromise;

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
      gate.innerHTML = '<div style="max-width:460px;background:#fff;border-radius:18px;padding:32px;text-align:center;box-shadow:0 30px 80px rgba(0,0,0,.35)"><h1 style="margin:0 0 10px;font-size:26px">AgentTraining.ai Pilot</h1><p id="pilot-auth-message" style="color:#64748b;line-height:1.6"></p><button id="pilot-auth-button" style="border:0;border-radius:9px;background:#1a56db;color:#fff;padding:12px 22px;font-weight:700;cursor:pointer">Sign in</button></div>';
      document.body.appendChild(gate);
      gate.querySelector('#pilot-auth-button').onclick = () => window.netlifyIdentity.open('login');
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

  async function request(resource, options = {}) {
    const user = await ready(options.requiredRole);
    const token = await user.jwt();
    const response = await fetch(`/.netlify/functions/pilot-data?resource=${encodeURIComponent(resource)}`, {
      ...options,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(options.headers || {}) }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `Pilot cloud request failed (${response.status}).`);
    return body;
  }

  window.PilotCloud = { enabled, ready, request, currentUser };
})();
