(function () {
  const params = new URLSearchParams(window.location.search);
  const enabled = params.get('pilot') === '1';
  let readyPromise;
  let finishReady;
  let switchHandled = false;
  const requestedLang = params.get('lang');
  if (requestedLang === 'en' || requestedLang === 'zh') sessionStorage.setItem('agentraining_lang', requestedLang);
  const currentLang = requestedLang || sessionStorage.getItem('agentraining_lang') || ((navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en');
  const t = (en, zh) => currentLang === 'zh' ? zh : en;
  function authError(error) {
    const message = error?.message || '';
    if (currentLang !== 'zh') return message || 'Sign-in failed. Please check your email and password.';
    if (/email not confirmed/i.test(message)) return '邮箱尚未确认。请先打开邀请邮件并完成注册。';
    if (/invalid.*grant|invalid.*credential|invalid login/i.test(message)) return '邮箱或密码不正确，请重新检查。';
    return message ? '登录失败：' + message : '登录失败，请检查邮箱和密码。';
  }

  function currentUser() {
    return window.netlifyIdentity && window.netlifyIdentity.currentUser();
  }

  function roles(user) {
    return user?.app_metadata?.roles || [];
  }

  function removeAccountControls() {
    document.getElementById('pilot-account-controls')?.remove();
  }

  async function signOut() {
    removeAccountControls();
    try {
      await window.netlifyIdentity.logout();
    } catch (error) {
      try { localStorage.removeItem('gotrue.user'); } catch (storageError) {}
    }
    readyPromise = null;
    finishReady = null;
    window.location.reload();
  }

  function mountAccountControls(user) {
    if (!enabled || !user) return;
    let controls = document.getElementById('pilot-account-controls');
    if (!controls) {
      controls = document.createElement('div');
      controls.id = 'pilot-account-controls';
      controls.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:19000;display:flex;align-items:center;gap:9px;max-width:calc(100vw - 28px);padding:9px 10px;background:#fff;border:1px solid #cbd5e1;border-radius:11px;box-shadow:0 8px 28px rgba(15,23,42,.18);font:12px Arial,sans-serif;color:#475569';
      const email = document.createElement('span');
      email.id = 'pilot-account-email';
      email.style.cssText = 'max-width:210px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      const button = document.createElement('button');
      button.type = 'button';
      button.id = 'pilot-sign-out';
      button.textContent = t('Sign out', '退出登录');
      button.style.cssText = 'border:1px solid #bfdbfe;border-radius:8px;background:#eff6ff;color:#1d4ed8;padding:7px 10px;font-weight:700;cursor:pointer;white-space:nowrap';
      button.addEventListener('click', async () => {
        button.disabled = true;
        button.textContent = t('Signing out…', '正在退出…');
        await signOut();
      });
      controls.append(email, button);
      document.body.appendChild(controls);
    }
    controls.querySelector('#pilot-account-email').textContent = user.email || t('Signed in', '已登录');
  }

  function showGate(message) {
    let gate = document.getElementById('pilot-auth-gate');
    if (!gate) {
      gate = document.createElement('div');
      gate.id = 'pilot-auth-gate';
      gate.style.cssText = 'position:fixed;inset:0;z-index:20000;background:rgba(15,23,42,.94);display:flex;align-items:center;justify-content:center;padding:24px;font-family:Arial,sans-serif';
      const enUrl = new URL(window.location.href); enUrl.searchParams.set('lang', 'en');
      const zhUrl = new URL(window.location.href); zhUrl.searchParams.set('lang', 'zh');
      gate.innerHTML = '<div style="width:100%;max-width:460px;background:#fff;border-radius:18px;padding:32px;box-shadow:0 30px 80px rgba(0,0,0,.35)"><div style="text-align:center"><h1 style="margin:0 0 10px;font-size:26px">AgentTraining.ai Pilot</h1><div style="display:flex;justify-content:center;gap:6px;margin:0 0 12px"><a href="'+enUrl.href+'" style="text-decoration:none;border:1px solid #cbd5e1;border-radius:8px;padding:6px 9px;color:#1d4ed8;font-weight:700">EN</a><a href="'+zhUrl.href+'" style="text-decoration:none;border:1px solid #cbd5e1;border-radius:8px;padding:6px 9px;color:#1d4ed8;font-weight:700">中文</a></div><p id="pilot-auth-message" style="color:#64748b;line-height:1.6"></p></div><button id="pilot-open-login" type="button" style="width:100%;margin-top:18px;border:0;border-radius:9px;background:#1a56db;color:#fff;padding:13px 22px;font-weight:700;cursor:pointer">'+t('Open secure sign-in','打开安全登录')+'</button><p style="margin:13px 0 0;color:#64748b;text-align:center;font-size:12px;line-height:1.55">'+t('Use your existing invited account. Password recovery is available in the Netlify sign-in window.','请使用已经接受邀请的现有账号。Netlify 登录窗口内可以恢复密码。')+'</p></div>';
      document.body.appendChild(gate);
      gate.querySelector('#pilot-open-login').addEventListener('click', () => {
        if (window.netlifyIdentity.setLocale) window.netlifyIdentity.setLocale(currentLang === 'zh' ? 'zhCN' : 'en');
        window.netlifyIdentity.open('login');
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
    if (!window.netlifyIdentity) throw new Error(t('Pilot sign-in could not be loaded.','无法载入试用登录功能。'));
    if (!switchHandled && params.get('switch') === '1') {
      switchHandled = true;
      window.netlifyIdentity.init();
      try {
        await window.netlifyIdentity.logout();
      } catch (error) {
        try { localStorage.removeItem('gotrue.user'); } catch (storageError) {}
      }
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('switch');
      window.history.replaceState({}, '', cleanUrl.href);
      readyPromise = null;
      finishReady = null;
    }
    if (!readyPromise) {
      readyPromise = new Promise(resolve => {
        window.netlifyIdentity.init();
        const finish = user => { hideGate(); mountAccountControls(user); resolve(user); };
        finishReady = finish;
        const user = currentUser();
        if (user) finish(user);
        else {
          showGate(t('Please sign in with your invited Pilot account.','请使用受邀请的试用账号登录。'));
          window.netlifyIdentity.on('login', loggedIn => { window.netlifyIdentity.close(); finish(loggedIn); });
        }
      });
    }
    const user = await readyPromise;
    if (requiredRole && !roles(user).includes(requiredRole) && !roles(user).includes('admin')) {
      showGate(t(`This page requires the ${requiredRole} role.`,`此页面需要 ${requiredRole === 'manager' ? '主管' : requiredRole} 权限。`));
      throw new Error(t(`The signed-in account does not have the ${requiredRole} role.`,`当前登录账号没有${requiredRole === 'manager' ? '主管' : requiredRole}权限。`));
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
    removeAccountControls();
    showGate(t('Your secure session expired. Please sign in again to continue.','您的安全登录已过期，请重新登录后继续。'));
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
    if (!response.ok) throw new Error(body.error || t(`Pilot cloud request failed (${response.status}).`,`试用云端请求失败（${response.status}）。`));
    return body;
  }

  window.PilotCloud = { enabled, ready, request, currentUser, signOut };
})();
