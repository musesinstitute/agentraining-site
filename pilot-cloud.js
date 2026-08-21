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

  // ── ROOM 4C — Role-based User Guide ──────────────────────────────────────
  // A compact, always-available help entry for the authenticated Pilot UI.
  // Mounted centrally here (not duplicated into every page's own <nav>)
  // because these pages have no shared header component — see AGENTS.md §7.
  // Static content only: no network calls, no writes, nothing that touches
  // assignments, scoring, sessions, transcripts, chat, or intent routing.
  function guideLang() {
    try { const stored = sessionStorage.getItem('agentraining_lang'); if (stored === 'en' || stored === 'zh') return stored; } catch (e) {}
    return currentLang;
  }
  function roleForUser(user) {
    const r = roles(user);
    return (r.includes('manager') || r.includes('admin')) ? 'manager' : 'learner';
  }
  function escGuide(value) { return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
  const GUIDE_CONTENT = {
    en: {
      manager: {
        eyebrow: 'Manager Guide',
        title: 'Manager Studio — how it works',
        intro: 'One place to assign Practice, review results, and coach with evidence.',
        steps: [
          { title: '1 · Sign in and confirm your role', text: 'Sign in with your invited Manager account. Your role is detected automatically from your account — you never have to choose it.' },
          { title: '2 · Manager Studio overview', text: 'Manager Studio (manager.html) brings Assign Practice, Current Assignments, Client Cases, and Practice Results together on one page.' },
          { title: '3 · Assign Practice', text: 'In the Assign Practice panel, choose an invited learner’s email, a curriculum scenario, and a practice length (Quick, Standard, or Full). Add an optional due date, then click Assign Practice.' },
          { title: '4 · Current Assignments', text: 'Current Assignments lists every practice you’ve assigned with its live status — Assigned, In Progress, or Completed — and a Message Learner shortcut for follow-up.' },
          { title: '5 · Completed assignment → View details', text: 'Once an assignment shows Completed, click View details to jump straight to that session in Practice Results below.' },
          { title: '6 · Practice Results, Coach Summary, Transcript', text: 'Each Practice Result shows the overall score plus Empathy, Knowledge, and Closing sub-scores, a Coach summary, and the full Transcript of the conversation.' },
          { title: '7 · Message Learner / Team Messages', text: 'Use Message Learner from an assignment row, or open Team Messages directly, to send a work message about an assignment or follow-up. This shared channel is separate from the learner’s private AI Coach.' },
          { title: '8 · Manager AI', text: 'Manager AI (manager-chat.html) lets you select a team member and ask about their Practice evidence — for example “Summarize this member,” “Show evidence,” or “Recommend next Practice.” Every answer is grounded in authorized work evidence shown in the Evidence drawer — never in the learner’s private Coach Chat.' },
          { title: '9 · Assignment recommendations need your confirmation', text: 'When Manager AI proposes a next Practice, it appears as an Assignment draft with its rationale. Nothing is sent to the learner until you choose a curriculum scenario and practice length and click Confirm Assignment.' },
          { title: '10 · Company Knowledge', text: 'In Company Knowledge (knowledge.html): Add source (video link + transcript, meeting transcript, procedures/scripts, or notes) → Save secure draft → Analyze with AI → review the AI summary yourself → Approve for team → Assign this Practice to turn it into a learner assignment.' },
          { title: '11 · Google Drive single-file import', text: 'Once Google Drive import is configured for your site, click Import from Google Drive on the Add source panel to pick one Google Doc or text file. The text is imported into the same draft field for you to review — it is never saved, analyzed, or approved automatically.' },
          { title: '12 · Troubleshooting', text: 'If something looks stuck, the checklist below covers the most common cases.' }
        ],
        checklistTitle: 'Quick checklist',
        checklist: [
          'No assignments appear: confirm you’re signed in with the account invited as this team’s manager, then click Refresh.',
          'Analyze with AI is missing: save the secure draft first — Analyze only appears once a draft exists.',
          'Import from Google Drive does nothing: Google Drive import must be configured for your site first; a message will say so if it isn’t yet.',
          'A learner isn’t in the email list: they need to accept their Pilot invitation first.'
        ]
      },
      learner: {
        eyebrow: 'Learner Guide',
        title: 'Your Practice loop — how it works',
        intro: 'From your Assignment Inbox to your score and your private Coach.',
        steps: [
          { title: '1 · Sign in and confirm your account', text: 'Sign in with your invited Learner account. The app recognizes you as a learner automatically.' },
          { title: '2 · Assignment Inbox', text: 'Your Personal AI Coach page (coach-chat.html) includes your Assignment Inbox, showing every Practice your manager has assigned and its status — New or In Progress.' },
          { title: '3 · Open assigned Practice', text: 'Click Start Practice (or Continue Practice) on an assignment to open it directly in the Practice Studio.' },
          { title: '4 · Read the Situation and Objective', text: 'Before you begin, read the scenario’s situation and your objective so you know who you’re talking to and what a successful conversation looks like.' },
          { title: '5 · Start Practice', text: 'When you’re ready, begin the role-play conversation with the AI client.' },
          { title: '6 · Conduct the conversation', text: 'Respond naturally, as you would with a real client, for the length of your assigned Practice — Quick, Standard, or Full.' },
          { title: '7 · Complete Practice', text: 'Finish the conversation to end the session and generate your result.' },
          { title: '8 · Read your Score and Feedback', text: 'Your session summary shows an overall score out of 100, plus strengths and tips to improve, based on that conversation.' },
          { title: '9 · Your Learner AI Coach', text: 'Your Personal AI Coach page also has a Coach Chat. Ask why a score was given, prepare for your next Practice, ask what skill to work on next, or reflect on your progress — the built-in prompts “Explain my latest result,” “Help me prepare,” and “What should I practice next?” are a fast way to start.' },
          { title: '10 · Challenge a score', text: 'If a score or observation looks wrong, ask your Coach to explain it — it grounds every answer in your actual Practice evidence. For a formal correction, open My Success Profile and click Flag as inaccurate on that specific claim; it’s then excluded from automatic recommendations until reviewed.' },
          { title: '11 · Team Messages', text: 'Team Messages is a separate, shared channel with your manager for work messages about assignments and follow-up.' },
          { title: '12 · Privacy', text: 'Your Coach Chat conversation is private. Managers can see your work-related Practice evidence, assignments, and profile claims — but never this private conversation.' },
          { title: '13 · Troubleshooting', text: 'If something looks stuck, the checklist below covers the most common cases.' }
        ],
        checklistTitle: 'Quick checklist',
        checklist: [
          'No assignment appears: ask your manager to assign a Practice, or open Free Practice from Practice Studio to practice anytime.',
          'My score seems wrong: ask your Coach to explain the evidence behind it, or flag the specific claim as inaccurate on My Success Profile.',
          'I don’t see a message from my manager: open Team Messages directly — new messages also arrive automatically every few seconds while the page is open.'
        ]
      }
    },
    zh: {
      manager: {
        eyebrow: '主管操作指南',
        title: '主管工作台使用说明',
        intro: '在这里指派练习、查看结果，并根据练习证据进行辅导。',
        steps: [
          { title: '1 · 登录并确认身份', text: '请使用受邀请的 Manager 主管账号登录。系统会根据您的账号自动识别身份，不需要自己选择。' },
          { title: '2 · 主管工作台总览', text: '主管工作台（manager.html）把指派练习、当前练习指派、客户案例和练习结果集中显示在同一页面。' },
          { title: '3 · 指派练习', text: '在「指派练习」区块，选择已受邀请的 Learner 邮箱、一个培训情境，以及练习时长（快速、标准或完整）。可以选填截止日期，然后点击「指派练习」。' },
          { title: '4 · 当前练习指派', text: '「当前练习指派」列出您指派过的每一项练习，以及即时状态——已指派、进行中或已完成，并提供「联系 Learner」的快捷方式方便跟进。' },
          { title: '5 · 已完成的指派 → 查看详情', text: '当某项指派状态显示为「已完成」，点击「查看详情」即可直接跳转到下方对应的练习结果。' },
          { title: '6 · 练习结果、教练总结、完整对话记录', text: '每一笔练习结果都会显示总分，以及同理心、知识准确度、推进与结尾的子项分数、教练总结，以及完整对话记录（Transcript）。' },
          { title: '7 · 联系 Learner／团队消息', text: '可以从某项指派点击「联系 Learner」，或直接打开「团队消息」，发送关于练习任务或后续跟进的工作消息。这是双方可见的工作沟通，与学员的私人 AI 教练对话完全分开。' },
          { title: '8 · 主管 AI', text: '主管 AI（manager-chat.html）可以让您选择一名团队成员，并询问 TA 的练习证据——例如「总结这名成员」「显示练习证据」或「建议下一项练习」。所有回答都根据已授权的工作证据（显示在「练习证据」栏），绝不包含学员的私人 AI 教练对话。' },
          { title: '9 · 练习建议需要主管确认', text: '当主管 AI 建议下一项练习时，会显示为「练习指派草案」及其理由。在您选择培训情境和练习时长并点击「确认并指派」之前，不会发送给学员。' },
          { title: '10 · 企业知识库', text: '在「企业知识库」（knowledge.html）：加入来源（影片连结＋逐字稿、会议逐字稿、公司流程／话术，或培训笔记）→ 储存安全草稿 → AI 分析 → 由您检查 AI 摘要 → 批准给团队 → 指派此练习，转化为学员的练习任务。' },
          { title: '11 · Google Drive 单文件导入', text: '当网站已完成 Google Drive 导入设定后，可以在「加入来源」区块点击「从 Google Drive 导入」，选择一份 Google 文件或文字文件。文字会导入到与手动贴上／上传相同的草稿栏位，让您先检查——系统不会自动储存、分析或批准。' },
          { title: '12 · 疑难排解', text: '如果遇到卡住的情况，下方的快速检查清单涵盖最常见的状况。' }
        ],
        checklistTitle: '快速检查清单',
        checklist: [
          '看不到任何练习指派：请确认目前登录的账号就是本团队受邀请的主管账号，然后点击「刷新」。',
          '找不到「AI 分析」按钮：请先储存安全草稿——只有草稿存在后才会出现「AI 分析」。',
          '「从 Google Drive 导入」没有反应：网站需要先完成 Google Drive 导入设定；如果尚未设定，画面会显示提示信息。',
          '学员邮箱不在清单里：该学员需要先接受 Pilot 邀请。'
        ]
      },
      learner: {
        eyebrow: '学员操作指南',
        title: '您的练习流程使用说明',
        intro: '从练习任务收件箱，到练习结果，再到您的私人 AI 教练。',
        steps: [
          { title: '1 · 登录并确认账号', text: '请使用受邀请的 Learner 账号登录。系统会自动识别您是学员身份。' },
          { title: '2 · 练习任务收件箱', text: '「我的私人 AI 教练」页面（coach-chat.html）包含您的「练习任务收件箱」，显示主管指派给您的每一项练习及其状态——新任务或进行中。' },
          { title: '3 · 打开指定的练习', text: '在某项任务上点击「开始练习」（或「继续练习」），即可直接在练习工作室中打开这项练习。' },
          { title: '4 · 阅读情况说明与目标', text: '开始之前，请先阅读这个情境的情况说明和您的目标，了解对方是谁，以及一次成功的对话应该是什么样子。' },
          { title: '5 · 开始练习', text: '准备好之后，就可以开始与 AI 客户进行角色扮演对话。' },
          { title: '6 · 进行对话', text: '像面对真实客户一样自然地回应，持续到您这项练习指定的长度——快速、标准或完整。' },
          { title: '7 · 完成练习', text: '完成对话即可结束这次练习，并生成练习结果。' },
          { title: '8 · 查看分数与回馈', text: '练习结果摘要会显示总分（满分 100），以及根据这次对话给出的优点和改进建议。' },
          { title: '9 · 您的私人 AI 教练', text: '「我的私人 AI 教练」页面也包含 AI 教练对话。您可以询问某次分数的原因、准备下一次练习、询问下一步该加强哪项技能，或反思自己的进步——内建的快速提问「解释最近一次结果」「帮助我准备练习」「下一步练习什么？」是很好的开始。' },
          { title: '10 · 对分数提出异议', text: '如果某个分数或记录看起来不准确，可以先请 AI 教练解释——所有回答都会依据您实际的练习证据。如果需要正式更正，请打开「我的成长档案」，在该项记录上点击「标记为不准确」；该记录会被排除在自动建议之外，直到经过审核。' },
          { title: '11 · 团队消息', text: '「团队消息」是与主管之间另外一个双方可见的工作沟通管道，用于练习任务和后续跟进。' },
          { title: '12 · 隐私说明', text: '您与 AI 教练的对话是私人的。主管可以查看您与工作相关的练习证据、练习任务和档案记录，但绝对看不到这段私人对话。' },
          { title: '13 · 疑难排解', text: '如果遇到卡住的情况，下方的快速检查清单涵盖最常见的状况。' }
        ],
        checklistTitle: '快速检查清单',
        checklist: [
          '没有出现任何练习任务：请主管指派练习，或者在练习工作室打开「自由练习」，随时可以练习。',
          '分数看起来不对：可以请 AI 教练解释背后的依据，或在「我的成长档案」上把该项记录标记为不准确。',
          '看不到主管发来的消息：请直接打开「团队消息」查看——只要页面开着，新消息也会每隔几秒自动更新。'
        ]
      }
    }
  };
  function guideStepsHTML(guide) {
    return guide.steps.map((step, i) => (
      '<div style="display:flex;gap:12px;padding:13px 0;border-bottom:1px solid #eef2f7">' +
        '<div style="flex:0 0 auto;width:26px;height:26px;border-radius:50%;background:#eff6ff;color:#1d4ed8;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px">' + (i + 1) + '</div>' +
        '<div style="flex:1 1 auto;min-width:0"><b style="display:block;margin-bottom:4px;color:#111827;font-size:13.5px">' + escGuide(step.title) + '</b><p style="margin:0;color:#475569;line-height:1.6;font-size:13px">' + escGuide(step.text) + '</p>' +
        (step.screenshot ? '<img src="' + escGuide(step.screenshot) + '" alt="" style="margin-top:8px;max-width:100%;border-radius:8px;border:1px solid #e2e8f0">' : '') +
        '</div></div>'
    )).join('');
  }
  function guideModalHTML(guide) {
    return '<div style="width:100%;max-width:640px;background:#fff;border-radius:16px;box-shadow:0 30px 80px rgba(0,0,0,.35);max-height:calc(100vh - 52px);display:flex;flex-direction:column">' +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:14px;padding:20px 22px;border-bottom:1px solid #e2e8f0;flex:0 0 auto">' +
        '<div><div style="font-size:11px;font-weight:800;letter-spacing:.5px;color:#1d4ed8;text-transform:uppercase">' + escGuide(guide.eyebrow) + '</div><h2 style="margin:6px 0 4px;font-size:20px;color:#111827">' + escGuide(guide.title) + '</h2><p style="margin:0;color:#64748b;font-size:12.5px;line-height:1.5">' + escGuide(guide.intro) + '</p></div>' +
        '<button id="pilot-guide-close" type="button" aria-label="Close" style="border:0;background:#f1f5f9;color:#475569;border-radius:8px;width:32px;height:32px;font-size:16px;cursor:pointer;flex:0 0 auto">✕</button>' +
      '</div>' +
      '<div style="padding:2px 22px 4px;overflow-y:auto">' + guideStepsHTML(guide) + '</div>' +
      (guide.checklist ? '<div style="margin:14px 22px 22px;padding:14px 16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;flex:0 0 auto"><b style="display:block;margin-bottom:8px;font-size:13px;color:#111827">' + escGuide(guide.checklistTitle) + '</b><ul style="margin:0;padding-left:18px;color:#475569;font-size:12.5px;line-height:1.7">' + guide.checklist.map(item => '<li>' + escGuide(item) + '</li>').join('') + '</ul></div>' : '') +
    '</div>';
  }
  function closeGuide() { const modal = document.getElementById('pilot-guide-modal'); if (modal) modal.style.display = 'none'; }
  function openGuide() {
    const bar = document.getElementById('pilot-guide-bar');
    const role = bar?.dataset.role === 'manager' ? 'manager' : 'learner';
    const guide = GUIDE_CONTENT[guideLang()][role];
    let modal = document.getElementById('pilot-guide-modal');
    if (!modal) {
      modal = document.createElement('div'); modal.id = 'pilot-guide-modal';
      modal.style.cssText = 'position:fixed;inset:0;z-index:19700;background:rgba(15,23,42,.55);display:none;align-items:flex-start;justify-content:center;padding:26px 16px;overflow:auto';
      modal.addEventListener('click', event => { if (event.target === modal) closeGuide(); });
      document.addEventListener('keydown', event => { if (event.key === 'Escape') closeGuide(); });
      document.body.appendChild(modal);
    }
    modal.innerHTML = guideModalHTML(guide);
    modal.querySelector('#pilot-guide-close').addEventListener('click', closeGuide);
    modal.style.display = 'flex';
  }
  function mountGuideEntry(user) {
    if (!enabled || !user) return;
    let bar = document.getElementById('pilot-guide-bar');
    if (!bar) {
      bar = document.createElement('div'); bar.id = 'pilot-guide-bar';
      bar.style.cssText = 'background:transparent;padding:7px 5%;display:flex;justify-content:flex-end;border-bottom:1px solid #e2e8f0';
      const btn = document.createElement('button'); btn.type = 'button'; btn.id = 'pilot-guide-btn';
      btn.textContent = '📘 使用指南 / User Guide';
      btn.style.cssText = 'border:0;border-radius:99px;background:#1a56db;color:#fff;padding:7px 13px;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap';
      btn.addEventListener('click', openGuide);
      bar.appendChild(btn);
      const nav = document.querySelector('nav');
      if (nav && nav.parentNode) nav.insertAdjacentElement('afterend', bar);
      else document.body.insertBefore(bar, document.body.firstChild);
    }
    bar.dataset.role = roleForUser(user);
  }
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
        window.netlifyIdentity.init(); const finish = user => { hideGate(); mountAccountControls(user); mountGuideEntry(user); resolve(user); }; finishReady = finish; const user = currentUser();
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
