/* Manager "did this help?" marks on past Practice assignments.
   Self-contained: loaded once by manager.html after its main script.
   Only runs in the signed-in Pilot workspace; manager-only; never shown to learners. */
(function () {
  'use strict';
  if (!window.PilotCloud || !PilotCloud.enabled) return;

  var params = new URLSearchParams(location.search);
  var lang = (typeof currentLang !== 'undefined' && currentLang) || params.get('lang') || sessionStorage.getItem('agentraining_lang') || 'en';
  var zh = lang === 'zh';
  var tr = function (en, cn) { return zh ? cn : en; };
  // Ask once an assignment is this many days old. ?fbdays=0 lets Deploy Preview UAT see cards immediately.
  var override = Number(params.get('fbdays'));
  var MIN_DAYS = params.has('fbdays') && isFinite(override) && override >= 0 ? override : 7;
  var MAX_CARDS = 3;
  var DAY = 86400000;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function ensureRoot() {
    var root = document.getElementById('judgmentFeedback');
    if (root) return root;
    root = document.createElement('section');
    root.id = 'judgmentFeedback';
    root.hidden = true;
    root.setAttribute('aria-labelledby', 'jfTitle');
    root.style.cssText = 'background:#fff;border:1px solid #e5e7eb;border-left:4px solid #1a56db;border-radius:12px;padding:16px 18px;margin:0 0 18px';
    var anchor = document.getElementById('nextAction');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(root, anchor.nextSibling);
    else (document.querySelector('main') || document.body).insertBefore(root, (document.querySelector('main') || document.body).firstChild);
    return root;
  }

  function btn(outcome, label, primary) {
    return '<button type="button" data-outcome="' + outcome + '" style="padding:8px 12px;border-radius:8px;border:1px solid #bfdbfe;font-weight:700;cursor:pointer;' +
      (primary ? 'background:#1a56db;color:#fff;border-color:#1a56db' : 'background:#fff;color:#1a56db') + '">' + esc(label) + '</button>';
  }

  function render(root, pending, status) {
    if (!pending.length) {
      root.hidden = !status;
      root.innerHTML = status ? '<p style="margin:0;color:#065f46;font-size:14px">' + esc(status) + '</p>' : '';
      return;
    }
    root.hidden = false;
    root.innerHTML =
      '<h2 id="jfTitle" style="margin:0 0 4px;font-size:18px">' + esc(tr('Did your earlier assignments help?', '之前的指派有帮助吗？')) + '</h2>' +
      '<p style="margin:0 0 12px;color:#6b7280;font-size:13px">' + esc(tr(
        'One tap each. Your marks are private to managers and help calibrate the system; they do not change any learner’s profile or score.',
        '每项点一下即可。标记仅主管可见，用于校准系统；不会改变学员的画像或分数。')) + '</p>' +
      pending.map(function (a) {
        var who = a.learner || a.assignedTo || '';
        var age = Math.max(0, Math.floor((Date.now() - Date.parse(a.createdAt)) / DAY));
        return '<div class="jf-item" data-id="' + esc(a.id) + '" style="border-top:1px solid #e5e7eb;padding:12px 0">' +
          '<div style="font-weight:700">' + esc(who) + ' · ' + esc(a.scenarioName) + '</div>' +
          '<div style="color:#6b7280;font-size:12px;margin:2px 0 8px">' + esc(tr('Assigned ' + age + ' day(s) ago', '指派于 ' + age + ' 天前')) +
          (a.status === 'Completed' ? esc(tr(' · completed', ' · 已完成')) : esc(tr(' · not completed', ' · 未完成'))) + '</div>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">' +
          btn('helpful', tr('Helped', '有帮助'), true) + btn('not_helpful', tr('Did not help', '没帮助')) + btn('unclear', tr('Can’t tell yet', '还看不出来')) +
          '<input type="text" maxlength="300" placeholder="' + esc(tr('Reason (optional)', '原因（选填）')) + '" aria-label="' + esc(tr('Reason (optional)', '原因（选填）')) +
          '" style="flex:1;min-width:160px;padding:8px 10px;border:1px solid #e5e7eb;border-radius:8px">' +
          '</div><div class="jf-err" role="alert" style="color:#b91c1c;font-size:12px;margin-top:6px"></div></div>';
      }).join('');
  }

  async function load() {
    var root = ensureRoot();
    try {
      await PilotCloud.ready('manager');
      var results = await Promise.all([
        PilotCloud.request('assignments', { requiredRole: 'manager' }),
        PilotCloud.request('judgment-feedback', { requiredRole: 'manager' })
      ]);
      var marked = {};
      (results[1].feedback || []).forEach(function (f) { marked[f.assignmentId] = true; });
      var cutoff = Date.now() - MIN_DAYS * DAY;
      var due = (results[0].assignments || [])
        .filter(function (a) { return !marked[a.id] && Date.parse(a.createdAt) <= cutoff; })
        .sort(function (a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)); });
      render(root, due.slice(0, MAX_CARDS));

      root.addEventListener('click', async function (event) {
        var button = event.target.closest('button[data-outcome]');
        if (!button) return;
        var item = button.closest('.jf-item');
        var err = item.querySelector('.jf-err');
        err.textContent = '';
        item.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
        try {
          await PilotCloud.request('judgment-feedback', {
            method: 'POST', requiredRole: 'manager',
            body: JSON.stringify({ assignmentId: item.dataset.id, outcome: button.dataset.outcome, note: item.querySelector('input').value })
          });
          item.remove();
          if (!root.querySelector('.jf-item')) render(root, [], tr('Thanks — marked.', '谢谢，已标记。'));
        } catch (e) {
          err.textContent = e.message || tr('Could not save. Please try again.', '保存失败，请重试。');
          item.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
        }
      });
    } catch (e) {
      root.hidden = true; // Feedback is optional; never block the manager page.
    }
  }

  load();
})();
