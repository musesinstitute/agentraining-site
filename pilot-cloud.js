(function () {
  const params = new URLSearchParams(window.location.search);
  const enabled = params.get('pilot') === '1';

  // The simulator still has a legacy private-beta ref gate. Pilot access is
  // authenticated by Netlify Identity instead, so let the page bootstrap past
  // the legacy gate without exposing or consuming a real invite/referral code.
  // Restore the native URLSearchParams as soon as the document is ready.
  const NativeURLSearchParams = window.URLSearchParams;
  if (enabled && !params.get('ref')) {
    class PilotBootstrapSearchParams extends NativeURLSearchParams {
      get(name) {
        if (name === 'ref' && !super.get('ref')) return 'demo';
        return super.get(name);
      }
    }
    window.URLSearchParams = PilotBootstrapSearchParams;
    window.addEventListener('DOMContentLoaded', () => {
      window.URLSearchParams = NativeURLSearchParams;
      sessionStorage.setItem('agentraining_ref', 'pilot');
      sessionStorage.setItem('agentraining_name', 'Pilot User');
      sessionStorage.setItem('agentraining_team', 'pilot');
      const legacyWelcome = document.getElementById('gate-welcome');
      if (legacyWelcome) legacyWelcome.style.display = 'none';
      const legacyGate = document.getElementById('access-gate');
      if (legacyGate) legacyGate.style.display = 'none';
    }, { once: true });
  }

  let readyPromise;
  let finishReady;
  let switchHandled = false;
  const requestedLang = params.get('lang');
  if (requestedLang === 'en' || requestedLang === 'zh') sessionStorage.setItem('agentraining_lang', requestedLang);
  const currentLang = requestedLang || sessionStorage.getItem('agentraining_lang') || ((navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en');
  const t = (en, zh) => currentLang === 'zh' ? zh : en;
  function authError(error) {
    const message = error?.message || '';
    if (/email not confirmed/i.test(message)) return t('Netlify Identity has not confirmed this email. Open the newest confirmation or invitation link for this exact address, then sign in again.','Netlify Identity 尚未确认此邮箱。请打开这个确切邮箱地址收到的最新确认或邀请链接，完成后再登录。');
    if (/invalid.*grant|invalid.*credential|invalid login/i.test(message)) return t('The email or password is incorrect.','邮箱或密码不正确。');
    if (/access token|failed in getting/i.test(message)) return t('Your email and password were accepted, but the secure access token could not be created. This is a site configuration problem.','邮箱和密码已被接受，但网站无法建立安全访问凭证。这是网站配置问题。');
    if (currentLang !== 'zh') return message || 'Sign-in failed. Please check your email and password.';
    return message ? '登录失败：' + message : '登录失败，请检查邮箱和密码。';
  }
  function currentUser() { return window.netlifyIdentity && window.netlifyIdentity.currentUser(); }
  function roles(user) { return user?.app_metadata?.roles || []; }
  function removeAccountControls() { document.getElementById('pilot-account-controls')?.remove(); }
  async function signOut() {
    removeAccountControls();
    try { await window.netlifyIdentity.logout(); } catch (error) { try { localStorage.removeItem('gotrue.user'); } catch (storageError) {} }
    readyPromise = null; finishReady = null; window.location.reload();
  }
  function mountAccountControls(user) {
    if (!enabled || !user) return;
    let controls = document.getElementById('pilot-account-controls');
    if (!controls) {
      controls = document.createElement('div'); controls.id = 'pilot-account-controls';
      controls.style.cssText = 'position:fixed;right:14px;bottom:14px;z-index:19000;display:flex;align-items:center;gap:9px;max-width:calc(100vw - 28px);padding:9px 10px;background:#fff;border:1px solid #cbd5e1;border-radius:11px;box-shadow:0 8px 28px rgba(15,23,42,.18);font:12px Arial,sans-serif;color:#475569';
      const email = document.createElement('span'); email.id = 'pilot-account-email'; email.style.cssText = 'max-width:210px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
      const button = document.createElement('button'); button.type = 'button'; button.id = 'pilot-sign-out'; button.textContent = t('Sign out', '退出登录'); button.style.cssText = 'border:1px solid #bfdbfe;border-radius:8px;background:#eff6ff;color:#1d4ed8;padding:7px 10px;font-weight:700;cursor:pointer;white-space:nowrap';
      button.addEventListener('click', async () => { button.disabled = true; button.textContent = t('Signing out…', '正在退出…'); await signOut(); });
      controls.append(email, button); document.body.appendChild(controls);
    }
    controls.querySelector('#pilot-account-email').textContent = user.email || t('Signed in', '已登录');
  }
  function showGate(message) {
    let gate = document.getElementById('pilot-auth-gate');
    if (!gate) {
      gate = document.createElement('div'); gate.id = 'pilot-auth-gate'; gate.style.cssText = 'position:fixed;inset:0;z-index:20000;background:rgba(15,23,42,.94);display:flex;align-items:center;justify-content:center;padding:24px;font-family:Arial,sans-serif';
      const enUrl = new URL(window.location.href); enUrl.searchParams.set('lang', 'en'); const zhUrl = new URL(window.location.href); zhUrl.searchParams.set('lang', 'zh');
      gate.innerHTML = '<div style="width:100%;max-width:460px;background:#fff;border-radius:18px;padding:32px;box-shadow:0 30px 80px rgba(0,0,0,.35)"><div style="text-align:center"><h1 style="margin:0 0 10px;font-size:26px">AgentTraining.ai Pilot</h1><div style="display:flex;justify-content:center;gap:6px;margin:0 0 12px"><a href="'+enUrl.href+'" style="text-decoration:none;border:1px solid #cbd5e1;border-radius:8px;padding:6px 9px;color:#1d4ed8;font-weight:700">EN</a><a href="'+zhUrl.href+'" style="text-decoration:none;border:1px solid #cbd5e1;border-radius:8px;padding:6px 9px;color:#1d4ed8;font-weight:700">中文</a></div><p id="pilot-auth-message" style="color:#64748b;line-height:1.6"></p></div><form id="pilot-auth-form"><label for="pilot-auth-email" style="display:block;margin:18px 0 6px;color:#334155;font-weight:700">'+t('Email','邮箱')+'</label><input id="pilot-auth-email" type="email" autocomplete="username" required style="width:100%;min-width:0;border:1px solid #cbd5e1;border-radius:9px;padding:12px;font:inherit"><label for="pilot-auth-password" style="display:block;margin:14px 0 6px;color:#334155;font-weight:700">'+t('Password','密码')+'</label><div style="display:flex;border:1px solid #cbd5e1;border-radius:9px;overflow:hidden"><input id="pilot-auth-password" type="password" autocomplete="current-password" required style="width:100%;min-width:0;border:0;padding:12px;font:inherit;outline:0"><button id="pilot-auth-toggle" type="button" style="border:0;border-left:1px solid #e2e8f0;background:#f8fafc;color:#1d4ed8;padding:0 11px;font-weight:700;cursor:pointer;white-space:nowrap">'+t('👁 Show','👁 显示')+'</button></div><button id="pilot-auth-button" type="submit" style="width:100%;margin-top:20px;border:0;border-radius:9px;background:#1a56db;color:#fff;padding:13px 22px;font-weight:700;cursor:pointer">'+t('Sign in securely','安全登录')+'</button><p id="pilot-auth-status" role="status" aria-live="polite" style="min-height:20px;margin:12px 0 0;color:#b91c1c;text-align:center;font-size:13px"></p></form><p style="margin:4px 0 0;color:#64748b;text-align:center;font-size:11px;line-height:1.5">'+t('This first-party form avoids browser-blocked pop-up windows.','此站内登录表单不使用可能被浏览器阻挡的弹出窗口。')+'</p></div>';
      document.body.appendChild(gate);
      gate.querySelector('#pilot-auth-toggle').addEventListener('click', event => { const password = gate.querySelector('#pilot-auth-password'); const showing = password.type === 'text'; password.type = showing ? 'password' : 'text'; event.currentTarget.textContent = showing ? t('👁 Show','👁 显示') : t('🙈 Hide','🙈 隐藏'); });
      gate.querySelector('#pilot-auth-form').addEventListener('submit', async event => {
        event.preventDefault(); const button = gate.querySelector('#pilot-auth-button'); const status = gate.querySelector('#pilot-auth-status'); const message = gate.querySelector('#pilot-auth-message'); const email = gate.querySelector('#pilot-auth-email').value.trim(); const password = gate.querySelector('#pilot-auth-password').value;
        button.disabled = true; button.textContent = t('Signing in…', '正在登录…'); status.textContent = ''; message.textContent = t('Checking your account and secure access…','正在核对账号和安全访问凭证…');
        try { const loggedIn = await window.netlifyIdentity.gotrue.login(email, password, true); await loggedIn.jwt(); message.textContent = t('Sign-in verified. Opening your workspace…','登录验证成功，正在进入工作区…'); if (finishReady) finishReady(loggedIn); else window.location.reload(); }
        catch (error) { const friendlyError = authError(error); message.textContent = friendlyError; status.textContent = friendlyError; button.disabled = false; button.textContent = t('Sign in securely', '安全登录'); }
      });
    }
    gate.querySelector('#pilot-auth-message').textContent = message; gate.style.display = 'flex';
  }
  function hideGate() { const gate = document.getElementById('pilot-auth-gate'); if (gate) gate.style.display = 'none'; }
  async function ready(requiredRole) {
    if (!enabled) return null;
    if (!window.netlifyIdentity) throw new Error(t('Pilot sign-in could not be loaded.','无法载入试用登录功能。'));
    if (!switchHandled && params.get('switch') === '1') { switchHandled = true; window.netlifyIdentity.init(); try { await window.netlifyIdentity.logout(); } catch (error) { try { localStorage.removeItem('gotrue.user'); } catch (storageError) {} } const cleanUrl = new URL(window.location.href); cleanUrl.searchParams.delete('switch'); window.history.replaceState({}, '', cleanUrl.href); readyPromise = null; finishReady = null; }
    if (!readyPromise) {
      readyPromise = new Promise(resolve => {
        window.netlifyIdentity.init(); const finish = user => { hideGate(); mountAccountControls(user); resolve(user); }; finishReady = finish; const user = currentUser();
        if (user) Promise.resolve(user.jwt()).then(() => finish(user)).catch(async () => { try { await window.netlifyIdentity.logout(); } catch (error) { try { localStorage.removeItem('gotrue.user'); } catch (storageError) {} } removeAccountControls(); showGate(t('Old test session cleared. Sign in with your current invited account.','旧测试登录已清除。请使用当前受邀请的账号登录。')); });
        else { showGate(t('Please sign in with your invited Pilot account.','请使用受邀请的试用账号登录。')); window.netlifyIdentity.on('login', loggedIn => { window.netlifyIdentity.close(); finish(loggedIn); }); window.netlifyIdentity.on('close', () => { if (!currentUser()) showGate(t('Please sign in with your invited Pilot account.','请使用受邀请的试用账号登录。')); }); }
      });
    }
    const user = await readyPromise;
    if (requiredRole && !roles(user).includes(requiredRole) && !roles(user).includes('admin')) { showGate(t(`This page requires the ${requiredRole} role.`,`此页面需要 ${requiredRole === 'manager' ? '主管' : requiredRole} 权限。`)); throw new Error(t(`The signed-in account does not have the ${requiredRole} role.`,`当前登录账号没有${requiredRole === 'manager' ? '主管' : requiredRole}权限。`)); }
    return user;
  }
  async function resetExpiredSession() { try { await window.netlifyIdentity.logout(); } catch (error) { try { localStorage.removeItem('gotrue.user'); } catch (storageError) {} } readyPromise = null; finishReady = null; removeAccountControls(); showGate(t("This browser saved an old test session. Sign in with your current invited account.","此浏览器保存了旧的测试登录。请使用当前受邀请的账号重新登录。")); }
  async function request(resource, options = {}) {
    const { requiredRole, query, ...fetchOptions } = options; let user = await ready(requiredRole); let token;
    try { token = await user.jwt(); } catch (error) { await resetExpiredSession(); user = await ready(requiredRole); token = await user.jwt(); }
    const queryParams = new URLSearchParams({ resource }); Object.entries(query || {}).forEach(([key, value]) => { if (value !== undefined && value !== null && value !== '') queryParams.set(key, String(value)); });
    const response = await fetch(`/.netlify/functions/pilot-data?${queryParams}`, { ...fetchOptions, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(fetchOptions.headers || {}) } });
    const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.error || t(`Pilot cloud request failed (${response.status}).`,`试用云端请求失败（${response.status}）。`)); return body;
  }
  window.PilotCloud = { enabled, ready, request, currentUser, signOut };
  if (enabled) {
    const voiceScript = document.createElement('script');
    voiceScript.src = '/openai-voice.js?v=20260817-openai1';
    voiceScript.defer = true;
    document.head.appendChild(voiceScript);
  }
})();
