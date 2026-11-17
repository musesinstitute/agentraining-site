(function () {
  const params = new URLSearchParams(window.location.search);
  const enabled = params.get('pilot') === '1';
  const NativeURLSearchParams = window.URLSearchParams;
  if (enabled && !params.get('ref')) {
    class PilotBootstrapSearchParams extends NativeURLSearchParams { get(name) { if (name === 'ref' && !super.get('ref')) return 'demo'; return super.get(name); } }
    window.URLSearchParams = PilotBootstrapSearchParams;
    window.addEventListener('DOMContentLoaded', () => { window.URLSearchParams = NativeURLSearchParams; sessionStorage.setItem('agentraining_ref','pilot'); sessionStorage.setItem('agentraining_name','Pilot User'); sessionStorage.setItem('agentraining_team','pilot'); document.getElementById('gate-welcome')?.style && (document.getElementById('gate-welcome').style.display='none'); document.getElementById('access-gate')?.style && (document.getElementById('access-gate').style.display='none'); }, {once:true});
  }
  let readyPromise, finishReady, switchHandled=false;
  const requestedLang=params.get('lang'); if(requestedLang==='en'||requestedLang==='zh')sessionStorage.setItem('agentraining_lang',requestedLang);
  const currentLang=requestedLang||sessionStorage.getItem('agentraining_lang')||((navigator.language||'').toLowerCase().startsWith('zh')?'zh':'en'); const t=(en,zh)=>currentLang==='zh'?zh:en;
  function currentUser(){return window.netlifyIdentity&&window.netlifyIdentity.currentUser()} function roles(user){return user?.app_metadata?.roles||[]}
  function removeAccountControls(){document.getElementById('pilot-account-controls')?.remove()}
  async function signOut(){removeAccountControls();try{await window.netlifyIdentity.logout()}catch(e){try{localStorage.removeItem('gotrue.user')}catch(x){}}readyPromise=null;finishReady=null;window.location.reload()}
  function mountAccountControls(user){if(!enabled||!user)return;let c=document.getElementById('pilot-account-controls');if(!c){c=document.createElement('div');c.id='pilot-account-controls';c.style.cssText='position:fixed;right:14px;bottom:14px;z-index:19000;display:flex;align-items:center;gap:9px;padding:9px 10px;background:#fff;border:1px solid #cbd5e1;border-radius:11px;box-shadow:0 8px 28px rgba(15,23,42,.18);font:12px Arial,sans-serif;color:#475569';c.innerHTML='<span id="pilot-account-email"></span><button id="pilot-sign-out" type="button" style="border:1px solid #bfdbfe;border-radius:8px;background:#eff6ff;color:#1d4ed8;padding:7px 10px;font-weight:700;cursor:pointer">'+t('Sign out','退出登录')+'</button>';document.body.appendChild(c);c.querySelector('button').onclick=signOut}c.querySelector('span').textContent=user.email||t('Signed in','已登录')}
  function showGate(message){let g=document.getElementById('pilot-auth-gate');if(!g){g=document.createElement('div');g.id='pilot-auth-gate';g.style.cssText='position:fixed;inset:0;z-index:20000;background:rgba(15,23,42,.94);display:flex;align-items:center;justify-content:center;padding:24px;font-family:Arial,sans-serif';g.innerHTML='<div style="width:100%;max-width:460px;background:#fff;border-radius:18px;padding:32px"><h1 style="text-align:center">AgentTraining.ai Pilot</h1><p id="pilot-auth-message" style="color:#64748b;text-align:center"></p><form id="pilot-auth-form"><input id="pilot-auth-email" type="email" placeholder="Email" required style="width:100%;padding:12px;margin:8px 0"><input id="pilot-auth-password" type="password" placeholder="Password" required style="width:100%;padding:12px;margin:8px 0"><button type="submit" style="width:100%;padding:13px;background:#1a56db;color:white;border:0;border-radius:9px">'+t('Sign in securely','安全登录')+'</button><p id="pilot-auth-status" style="color:#b91c1c;text-align:center"></p></form></div>';document.body.appendChild(g);g.querySelector('form').onsubmit=async e=>{e.preventDefault();try{const u=await window.netlifyIdentity.gotrue.login(g.querySelector('#pilot-auth-email').value.trim(),g.querySelector('#pilot-auth-password').value,true);await u.jwt();signedIn(u)}catch(err){g.querySelector('#pilot-auth-status').textContent=err.message||t('Sign-in failed','登录失败')}}}g.querySelector('#pilot-auth-message').textContent=message;g.querySelector('#pilot-auth-status').textContent='';if(pageAccount&&!g.querySelector('#pilot-auth-email').value)g.querySelector('#pilot-auth-email').value=pageAccount;g.style.display='flex'}
  function hideGate(){const g=document.getElementById('pilot-auth-gate');if(g)g.style.display='none'}
  async function ready(requiredRole){if(!enabled)return null;if(!window.netlifyIdentity)throw new Error(t('Pilot sign-in could not be loaded.','无法载入试用登录功能。'));if(!switchHandled&&params.get('switch')==='1'){switchHandled=true;window.netlifyIdentity.init();try{await window.netlifyIdentity.logout()}catch(e){}readyPromise=null;finishReady=null}if(!readyPromise){readyPromise=new Promise(resolve=>{window.netlifyIdentity.init();const finish=user=>{hideGate();mountAccountControls(user);if(!pageAccount){pageAccount=accountOf(user);pageUser=user}resolve(user)};finishReady=finish;const u=currentUser();if(u)Promise.resolve(u.jwt()).then(()=>finish(u)).catch(()=>showGate(t('Please sign in again.','请重新登录。')));else showGate(t('Please sign in with your invited Pilot account.','请使用受邀请的试用账号登录。'))})}const u=await readyPromise;if(requiredRole&&!hasRole(u,requiredRole))throw fail('forbidden',t('This page requires the '+requiredRole+' role.','此页面需要相应权限。'));return u}
  // ---------------------------------------------------------------------------
  // Authenticated requests.
  //
  // Every Pilot function answers 401 "Please sign in to continue." when Netlify
  // does not accept the bearer token. Before this block existed, that 401 was
  // final: the page showed the raw error, and a reload sent the same token
  // again. Three ways a signed-in manager could get there, all handled here:
  //   1. The Identity widget decides expiry by the device clock. If that clock
  //      runs behind the server, a token it still calls valid has already
  //      expired server-side, and it keeps being sent until the device agrees.
  //   2. ready() used to hand back the user object captured at page load. The
  //      widget replaces its current user whenever the stored session changes
  //      (another tab refreshes or signs in), so that object can hold a stale
  //      access token and a refresh token that has already been used. The
  //      widget's live user is used now, but only while it is the same account
  //      this page loaded as: a different account signed in from another tab
  //      is never used for this page's requests.
  //   3. After signing in again through the gate, the page kept using the old
  //      object, so only a full sign-out and sign-in recovered.
  // Recovery: on 401, get a genuinely fresh token and retry once; if that is
  // not possible, sign in again in place (as the same account) and continue.
  // A 401 means the server did nothing, so retrying a POST here is safe.
  // No token, password or header value is ever logged.
  // ---------------------------------------------------------------------------
  let pageAccount='',pageUser=null,clockOffsetMs=0,refreshing=null,reauth=null;
  function fail(kind,message,status){const error=new Error(message);error.kind=kind;if(status)error.status=status;return error}
  function accountOf(user){return String(user?.email||'').trim().toLowerCase()}
  function hasRole(user,role){return roles(user).includes(role)||roles(user).includes('admin')}
  function expiryOf(jwt){try{const part=String(jwt).split('.')[1];return Number(JSON.parse(atob(part.replace(/-/g,'+').replace(/_/g,'/'))).exp)||0}catch(e){return 0}}
  function noteServerTime(response){const at=Date.parse(response.headers.get('date')||'');if(!Number.isNaN(at)){const offset=at-Date.now();clockOffsetMs=Math.abs(offset)>30000?offset:0}}
  function forceRefresh(user){if(!refreshing)refreshing=Promise.resolve(user.jwt(true)).finally(()=>{refreshing=null});return refreshing}
  function signedIn(user){
    // A different account signed in: this page's data belongs to someone else, so start clean.
    if(pageAccount&&accountOf(user)&&accountOf(user)!==pageAccount){location.reload();return}
    hideGate();mountAccountControls(user);pageUser=user;
    if(reauth){const pending=reauth;reauth=null;pending.resolve(user)}
    if(finishReady)finishReady(user);else location.reload();
  }
  function reauthenticate(reason){
    if(!reauth){let resolve;const promise=new Promise(done=>{resolve=done});reauth={promise,resolve};
      const who=pageAccount||t('your Pilot account','您的试用账号');
      showGate(reason==='account_changed'
        ?t('This browser was signed in to a different account in another tab. Sign in again as '+who+' to continue. Nothing on this page has been lost.','这个浏览器在另一个标签页登录了其他账号。请重新以 '+who+' 登录后继续，本页内容不会丢失。')
        :t('Your sign-in has expired. Sign in again as '+who+' to continue. Nothing on this page has been lost.','登录已过期。请重新以 '+who+' 登录后继续，本页内容不会丢失。'))}
    return reauth.promise;
  }
  async function token(requiredRole,rejected){
    const first=await ready(requiredRole),live=currentUser();
    // Same account: take the widget's live user (it has the newest tokens). Otherwise stay with this page's own user.
    const user=live&&accountOf(live)===pageAccount?live:(pageUser||first);
    if(!user||typeof user.jwt!=='function')throw fail('auth',t('Secure Pilot token is unavailable.','安全访问凭证不可用。'));
    if(requiredRole&&!hasRole(user,requiredRole))throw fail('forbidden',t('This page requires the '+requiredRole+' role.','此页面需要相应权限。'));
    try{
      let jwt=await user.jwt();
      const expiry=expiryOf(jwt);
      // `rejected` is a token the server just refused; never send it again.
      if(jwt===rejected||(expiry&&expiry*1000-60000<Date.now()+clockOffsetMs))jwt=await forceRefresh(user);
      if(!jwt||jwt===rejected)throw new Error('no fresh token');
      return jwt;
    }catch(error){throw fail('auth',t('Your sign-in has expired.','登录已过期。'))}
  }
  async function authorizedFetch(url,init={},requiredRole){
    const send=async jwt=>{
      let response;
      try{response=await fetch(url,{...init,headers:{...(init.headers||{}),authorization:'Bearer '+jwt}})}
      catch(error){throw fail('network',t('Could not reach the server. Check your connection and try again.','无法连接服务器。请检查网络后再试。'))}
      noteServerTime(response);return response;
    };
    let jwt=null,response=null;
    try{jwt=await token(requiredRole);response=await send(jwt)}
    catch(error){if(error.kind!=='auth')throw error}
    if(response&&response.status!==401)return response;
    if(response){
      // Diagnostic only: how the device clock and the token's expiry compare. No credential is included.
      console.warn('Pilot request was not accepted as signed in; refreshing the session.',{secondsUntilTokenExpiryOnThisDevice:expiryOf(jwt)?Math.round(expiryOf(jwt)-Date.now()/1000):null,deviceClockBehindServerSeconds:Math.round(clockOffsetMs/1000)});
      try{const fresh=await token(requiredRole,jwt);response=await send(fresh);if(response.status!==401)return response}
      catch(error){if(error.kind!=='auth')throw error}
    }
    const other=currentUser();
    await reauthenticate(other&&accountOf(other)&&accountOf(other)!==pageAccount?'account_changed':'expired');
    response=await send(await token(requiredRole));
    if(response.status===401)throw fail('auth',t('Your sign-in could not be confirmed. Sign out, sign in again, and retry.','无法确认您的登录状态。请退出后重新登录再试。'),401);
    return response;
  }
  async function request(resource,options={}){
    const {requiredRole,query,...fetchOptions}=options;
    const q=new URLSearchParams({resource});Object.entries(query||{}).forEach(([k,v])=>{if(v!==undefined&&v!==null&&v!=='')q.set(k,String(v))});
    const response=await authorizedFetch('/.netlify/functions/pilot-data?'+q,{...fetchOptions,headers:{'content-type':'application/json',...(fetchOptions.headers||{})}},requiredRole);
    const body=await response.json().catch(()=>({}));
    if(!response.ok)throw fail(response.status===403?'forbidden':response.status>=500?'server':'request',body.error||t('Pilot cloud request failed ('+response.status+').','试用云端请求失败（'+response.status+'）。'),response.status);
    return body;
  }
  window.PilotCloud={enabled,ready,token:requiredRole=>token(requiredRole),request,fetch:authorizedFetch,currentUser,signOut};
  if(enabled){const s=document.createElement('script');s.src='/openai-voice.js?v=20260817-openai1';s.defer=true;document.head.appendChild(s)}
})();