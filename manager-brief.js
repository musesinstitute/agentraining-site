/* Manager AI Brief — "the AI speaks first" on the manager's Pilot Home.
 *
 * Three beats, all computed from data the manager is already authorized to
 * see (team Practice sessions, assignments, approved Company Knowledge):
 *   1. Finding  — what the team's recent Practice shows, and who to look at first.
 *   2. Evidence — the member's own words from the latest transcript, with one
 *                 passage marked so the manager can judge for themselves.
 *   3. Action   — one prepared Practice, sent only when the manager confirms.
 *
 * Nothing here calls a model and nothing is sent without a click on Confirm:
 * the finding is arithmetic over recorded scores, and every label describes
 * how a passage was chosen ("how the conversation ended") rather than
 * asserting what went wrong in it. Private Learner Coach Chat is never read.
 *
 * The first half of this file is pure logic (also loaded by Node tests);
 * mount() at the bottom is the only part that touches the DOM.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ManagerBrief = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  var DAY = 86400000;
  var WINDOW_DAYS = 14;
  var RETURN_DAYS = 7;

  // Keys match COMPETENCIES in netlify/functions/pilot-data.mjs. Order is the
  // tie-break when a member scores equally low on two of them.
  var COMPETENCIES = [
    { key: 'closing', en: 'next-step confirmation', zh: '确认下一步' },
    { key: 'empathy', en: 'empathy and trust-building', zh: '同理心与信任建立' },
    { key: 'accuracy', en: 'knowledge and explanation', zh: '知识与解释' }
  ];

  // Standard-curriculum Practice (data/curriculum/foundation.json) that
  // exercises each competency. Used when no approved Company Knowledge draft
  // exists, and always offered as an alternative.
  var CURRICULUM_FOR = { closing: 'IHFC-02', empathy: 'IHFC-23', accuracy: 'IHFC-11' };
  var CURRICULUM_FIRST = 'IHFC-01';

  var FOCUS_NOTE = {
    closing: {
      en: 'Manager coaching focus: before the conversation ends, agree one specific next step with the client — what will happen, and when.',
      zh: '主管辅导重点：在对话结束前，与客户约定一个具体的下一步——做什么、什么时候。'
    },
    empathy: {
      en: 'Manager coaching focus: before explaining anything, acknowledge the client’s concern in your own words and ask one question to understand it.',
      zh: '主管辅导重点：先用自己的话回应客户的顾虑，并问一个问题了解原因，然后再开始解释。'
    },
    accuracy: {
      en: 'Manager coaching focus: explain the key point accurately in plain language, then check that the client understood.',
      zh: '主管辅导重点：用客户听得懂的话把关键内容讲准确，再确认客户是否理解。'
    }
  };

  function norm(value) { return String(value == null ? '' : value).trim().toLowerCase(); }
  function clip(value, max) {
    var text = String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    return text.length > max ? text.slice(0, max - 1).trimEnd() + '…' : text;
  }
  function competency(key) {
    for (var i = 0; i < COMPETENCIES.length; i += 1) if (COMPETENCIES[i].key === key) return COMPETENCIES[i];
    return null;
  }
  function score(session, key) { return Number(session && session.scores && session.scores[key]) || 0; }
  function sessionEmail(session) { return norm(session && (session.learner || session.learnerEmail)); }
  function isScored(session) {
    return !!sessionEmail(session) && COMPETENCIES.some(function (c) { return score(session, c.key) > 0; });
  }
  function byTime(field) {
    return function (a, b) { return String(a[field] || '').localeCompare(String(b[field] || '')); };
  }
  function isOpen(assignment) { return assignment && assignment.status !== 'Completed'; }

  function lowestKey(session) {
    var best = null;
    COMPETENCIES.forEach(function (c) {
      var value = score(session, c.key);
      if (value > 0 && (best === null || value < best.value)) best = { key: c.key, value: value };
    });
    return best ? best.key : null;
  }

  // Up to the last three recorded scores for one competency, oldest first.
  function series(sessions, key) {
    return sessions.map(function (s) { return score(s, key); }).filter(function (v) { return v > 0; }).slice(-3);
  }
  function drop(values) { return values.length >= 2 ? values[0] - values[values.length - 1] : 0; }
  function trend(values) {
    if (values.length < 2) return 'single';
    var d = drop(values);
    return d >= 5 ? 'down' : d <= -5 ? 'up' : 'flat';
  }

  function buildBrief(input) {
    input = input || {};
    var now = input.now ? new Date(input.now).getTime() : Date.now();
    var assignments = (input.assignments || []).filter(Boolean);
    var profiles = (input.profiles || []).filter(Boolean);
    var scored = (input.sessions || []).filter(isScored).sort(byTime('savedAt'));

    var names = {};
    profiles.forEach(function (p) { var e = norm(p.learnerEmail); if (e) names[e] = p.preferredName || e; });
    scored.forEach(function (s) { var e = sessionEmail(s); if (!names[e]) names[e] = s.learnerName || e; });

    var openFor = {};
    assignments.filter(isOpen).sort(byTime('createdAt')).forEach(function (a) { openFor[norm(a.assignedTo)] = a; });

    var recent = scored.filter(function (s) { return now - Date.parse(s.savedAt) <= WINDOW_DAYS * DAY; });
    var windowed = recent.length >= 2;
    var scope = windowed ? recent : scored;

    var history = {};
    scored.forEach(function (s) { var e = sessionEmail(s); (history[e] = history[e] || []).push(s); });
    var inScope = {};
    scope.forEach(function (s) { inScope[sessionEmail(s)] = true; });

    var members = Object.keys(inScope).map(function (email) {
      var all = history[email], latest = all[all.length - 1], key = lowestKey(latest);
      var values = series(all, key);
      return {
        email: email, name: names[email] || email, sessions: all, latest: latest,
        sessionCount: all.length, focusKey: key, focusScore: score(latest, key),
        series: values, drop: drop(values), trend: trend(values),
        open: openFor[email] || null
      };
    });

    var rosterOnly = Object.keys(names).filter(function (e) { return !history[e]; }).map(function (email) {
      return { email: email, name: names[email], sessions: [], latest: null, sessionCount: 0, focusKey: null, focusScore: 0, series: [], drop: 0, trend: 'none', open: openFor[email] || null };
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });

    var pattern = null;
    if (members.length) {
      var ranked = COMPETENCIES.map(function (c, order) {
        var low = members.filter(function (m) { return m.focusKey === c.key; });
        var values = members.map(function (m) { return score(m.latest, c.key); }).filter(function (v) { return v > 0; });
        var average = values.length ? values.reduce(function (a, b) { return a + b; }, 0) / values.length : 100;
        return { key: c.key, count: low.length, average: average, order: order };
      }).sort(function (a, b) { return b.count - a.count || a.average - b.average || a.order - b.order; });
      pattern = { key: ranked[0].key, count: ranked[0].count };
    }

    // Who to look at first: someone in the pattern who is not already
    // waiting on an assignment, then steepest drop, then lowest score.
    function rank(a, b) {
      var ap = pattern && a.focusKey === pattern.key ? 0 : 1, bp = pattern && b.focusKey === pattern.key ? 0 : 1;
      return ap - bp || (a.open ? 1 : 0) - (b.open ? 1 : 0) || b.drop - a.drop || a.focusScore - b.focusScore || a.name.localeCompare(b.name);
    }
    members.sort(rank);

    var sessionById = {};
    scored.forEach(function (s) { sessionById[s.id] = s; });
    var returns = assignments.filter(function (a) {
      return a.status === 'Completed' && a.completedAt && now - Date.parse(a.completedAt) <= RETURN_DAYS * DAY;
    }).sort(byTime('completedAt')).reverse().slice(0, 3).map(function (a) {
      var email = norm(a.assignedTo), result = sessionById[a.resultSessionId] || null, before = null;
      if (result) {
        var earlier = (history[email] || []).filter(function (s) { return String(s.savedAt) < String(result.savedAt); });
        before = earlier.length ? earlier[earlier.length - 1] : null;
      }
      var key = before ? lowestKey(before) : null;
      return {
        assignmentId: a.id, email: email, name: names[email] || a.learner || email,
        scenarioName: a.scenarioName || (result && result.scenario) || '', completedAt: a.completedAt,
        overall: result ? score(result, 'overall') : Number(a.score) || 0,
        key: key, before: key ? score(before, key) : null, after: key && result ? score(result, key) : null
      };
    });

    var waiting = assignments.filter(isOpen).sort(byTime('createdAt')).reverse().slice(0, 4).map(function (a) {
      var email = norm(a.assignedTo);
      return {
        assignmentId: a.id, email: email, name: names[email] || a.learner || email, scenarioName: a.scenarioName || '',
        status: a.status || 'Assigned', days: Math.max(0, Math.floor((now - Date.parse(a.createdAt)) / DAY))
      };
    });

    return {
      state: members.length ? 'finding' : (rosterOnly.length ? 'no_evidence' : 'no_team'),
      windowed: windowed, windowDays: WINDOW_DAYS,
      basis: { memberCount: members.length, sessionCount: scope.length },
      pattern: pattern, members: members, rosterOnly: rosterOnly,
      focus: members[0] || rosterOnly[0] || null,
      returns: returns, waiting: waiting
    };
  }

  // Chooses one passage of the transcript to put in front of the manager.
  // `reason` says how it was chosen — a fact about the transcript, not a
  // judgment of the member.
  function pickExcerpt(session, key) {
    var turns = ((session && session.transcript) || []).filter(function (t) { return t && String(t.text || '').trim(); });
    var agentAt = [];
    turns.forEach(function (t, i) { if (t.speaker === 'agent') agentAt.push(i); });
    if (!agentAt.length) return null;
    var at, reason;
    if (key === 'accuracy') {
      at = agentAt.reduce(function (best, i) { return turns[i].text.length > turns[best].text.length ? i : best; }, agentAt[0]);
      reason = { en: 'the longest explanation in this conversation', zh: '这次对话里解释得最长的一段' };
    } else if (key === 'empathy') {
      var longestClient = -1;
      turns.forEach(function (t, i) {
        if (t.speaker !== 'agent' && turns[i + 1] && turns[i + 1].speaker === 'agent' && (longestClient < 0 || t.text.length > turns[longestClient].text.length)) longestClient = i;
      });
      at = longestClient >= 0 ? longestClient + 1 : agentAt[0];
      reason = { en: 'the reply to the client’s longest statement', zh: '客户说得最多之后的那句回应' };
    } else {
      at = agentAt[agentAt.length - 1];
      reason = { en: 'the last thing said to the client', zh: '对客户说的最后一句话' };
    }
    var shown = [];
    if (at > 0) shown.push({ speaker: turns[at - 1].speaker === 'agent' ? 'agent' : 'client', text: clip(turns[at - 1].text, 300), marked: false });
    shown.push({ speaker: 'agent', text: clip(turns[at].text, 340), marked: true });
    if (turns[at + 1]) shown.push({ speaker: turns[at + 1].speaker === 'agent' ? 'agent' : 'client', text: clip(turns[at + 1].text, 220), marked: false });
    return { turns: shown, reason: reason, turnCount: turns.length };
  }

  function localized(value, lang) {
    if (value && typeof value === 'object') return value[lang] || value.en || value.zh || '';
    return value || '';
  }

  // Practices the manager could assign, best match first. Approved Company
  // Knowledge comes first; when a source carries a team-relevance assessment
  // (knowledge relevance, PR #69) its tagged competencies and priority decide
  // the order. One standard-curriculum Practice is always the last option.
  function practiceCandidates(input) {
    input = input || {};
    var key = input.key || null, lang = input.lang === 'zh' ? 'zh' : 'en', list = [];
    (input.knowledge || []).forEach(function (source) {
      var draft = source && source.analysis && source.analysis.practiceDraft;
      if (!source || source.status !== 'approved' || !draft || !draft.title || !draft.situation || !draft.objective) return;
      var rel = source.relevance || null;
      var covers = !!(key && rel && Array.isArray(rel.competencies) && rel.competencies.indexOf(key) >= 0);
      var priority = rel && /^P[123]$/.test(rel.priority || '') ? rel.priority : '';
      list.push({
        kind: 'knowledge', id: 'knowledge-' + source.id, sourceId: source.id, sourceTitle: source.title || '',
        title: draft.title, situation: draft.situation, objective: draft.objective,
        clientName: draft.clientName || '', clientOpening: draft.clientOpening || '',
        successCriteria: Array.isArray(draft.successCriteria) ? draft.successCriteria.slice(0, 6) : [],
        covers: covers, priority: priority, overall: rel && Number(rel.overall) ? Number(rel.overall) : null,
        why: rel && rel.whyItMatters ? String(rel.whyItMatters) : '',
        rank: (covers ? 4 : 0) + (priority === 'P1' ? 2 : priority === 'P2' ? 1 : 0) + (source.analysis.quality === 'important' ? 1 : 0),
        at: String(source.approvedAt || source.updatedAt || '')
      });
    });
    list.sort(function (a, b) { return b.rank - a.rank || b.at.localeCompare(a.at); });
    list = list.slice(0, 4);
    var wanted = (key && CURRICULUM_FOR[key]) || CURRICULUM_FIRST;
    var lessons = input.curriculum || [];
    var lesson = lessons.filter(function (x) { return x && String(x.id) === wanted; })[0];
    if (lesson) {
      list.push({
        kind: 'curriculum', id: String(lesson.id), title: localized(lesson.title, lang) || String(lesson.id),
        objective: localized(lesson.objective, lang), clientName: lesson.clientName || '',
        clientOpening: localized(lesson.preview, lang), targeted: !!(key && CURRICULUM_FOR[key])
      });
    }
    return list;
  }

  function focusNote(key, lang) {
    return key && FOCUS_NOTE[key] ? FOCUS_NOTE[key][lang === 'zh' ? 'zh' : 'en'] : '';
  }

  // Exactly the record POST ?resource=assignments expects (same shape that
  // knowledge.html and manager.html already send).
  function assignmentPayload(input) {
    var candidate = input.candidate, member = input.member, lang = input.lang === 'zh' ? 'zh' : 'en';
    var mode = ['quick', 'standard', 'full'].indexOf(input.mode) >= 0 ? input.mode : 'quick';
    var base = { learner: member.name || member.email, assignedTo: member.email, scenarioId: candidate.id, scenarioName: candidate.title, mode: mode, dueDate: '' };
    if (candidate.kind !== 'knowledge') return base;
    var note = input.addFocus ? focusNote(input.key, lang) : '';
    var objective = String(candidate.objective || '');
    if (note) objective = clip(objective, 1000 - note.length - 2) + '\n' + note;
    var criteria = (candidate.successCriteria || []).slice(0, note ? 5 : 6);
    if (note) criteria.push(note);
    base.sourceType = 'company_knowledge';
    base.sourceLabel = 'Company Knowledge · ' + candidate.sourceTitle;
    base.sourceKnowledgeId = candidate.sourceId;
    base.customScenario = {
      title: candidate.title, situation: candidate.situation, objective: objective,
      clientName: candidate.clientName, clientOpening: candidate.clientOpening, successCriteria: criteria
    };
    return base;
  }

  /* ---------------------------------------------------------------------
   * DOM. Everything below runs only in the browser.
   * ------------------------------------------------------------------- */

  function mount(root, options) {
    var lang = options.lang === 'zh' ? 'zh' : 'en';
    var t = function (en, zh) { return lang === 'zh' ? zh : en; };
    var esc = function (s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
      });
    };
    var data = { sessions: options.sessions || [], assignments: (options.assignments || []).slice(), profiles: options.profiles || [], knowledge: options.knowledge || [], curriculum: options.curriculum || [], ready: options.ready !== false };
    var ui = { email: null, order: null, candidateId: null, mode: 'quick', addFocus: true, busy: false, error: '', sent: {}, first: true };
    var label = function (key) { var c = competency(key); return c ? c[lang] : ''; };
    var day = function (iso) { return iso ? new Date(iso).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric' }) : ''; };
    var q = function (email) { return encodeURIComponent(email); };

    function headline(model) {
      var f = model.focus, p = model.pattern, name = esc(f.name), comp = esc(label(f.focusKey)), arrow = f.series.join(' → ');
      var lead, follow;
      if (p.count >= 2 && f.focusKey === p.key) {
        lead = model.windowed
          ? t('In the past ' + model.windowDays + ' days, ' + p.count + ' team members scored lowest on ' + comp + '.', '过去 ' + model.windowDays + ' 天，' + p.count + ' 位成员在「' + comp + '」上得分最低。')
          : t('Across the Practice on record, ' + p.count + ' team members scored lowest on ' + comp + '.', '从现有的练习记录看，' + p.count + ' 位成员在「' + comp + '」上得分最低。');
        var peers = model.members.filter(function (m) { return m.focusKey === p.key; });
        var steepest = peers.every(function (m) { return m.drop <= f.drop; });
        var lowest = peers.every(function (m) { return m.focusScore >= f.focusScore; });
        follow = f.trend === 'down'
          ? (steepest ? t(name + ' has dropped the most: ' + arrow + '.', name + ' 下滑最快：' + arrow + '。') : t(name + ' is slipping too: ' + arrow + '.', name + ' 也在下滑：' + arrow + '。'))
          : (lowest ? t(name + ' is lowest right now: ' + f.focusScore + '/100.', name + ' 目前最低：' + f.focusScore + '/100。') : t(name + ' is at ' + f.focusScore + '/100.', name + ' 目前 ' + f.focusScore + '/100。'));
      } else {
        lead = t('The first thing to look at is ' + name + '’s ' + comp + ': ' + f.focusScore + '/100.', '现在最值得您先看的，是 ' + name + ' 的「' + comp + '」：' + f.focusScore + '/100。');
        follow = f.trend === 'down' ? t('The last ' + f.series.length + ' sessions: ' + arrow + '.', '最近 ' + f.series.length + ' 次：' + arrow + '。')
          : f.trend === 'up' ? t('It is improving (' + arrow + '), but it is still the lowest area.', '这一项在进步（' + arrow + '），但仍然是最低的一项。') : '';
      }
      if (f.sessionCount === 1) follow += t(' This rests on one session, so treat it as a lead, not a conclusion.', '目前只有 1 次练习，请先当作线索，不是结论。');
      return '<h2 class="brief-headline" id="ai-brief-title">' + lead + (follow ? '<span class="brief-follow">' + follow + '</span>' : '') + '</h2>';
    }

    function chips(model, selected) {
      var people = model.members.slice(0, 6);
      if (people.length < 2) return '';
      return '<div class="brief-chips" role="group" aria-label="' + t('Choose a team member', '选择一位成员') + '"><span class="brief-chips-label">' + t('Look at someone else', '换一位成员看') + '</span>' + people.map(function (m) {
        var mark = m.trend === 'down' ? '↓' : m.trend === 'up' ? '↑' : '';
        return '<button type="button" class="brief-chip" data-brief-member="' + esc(m.email) + '" aria-pressed="' + (m.email === selected.email) + '"><b>' + esc(m.name) + '</b><span>' + esc(label(m.focusKey)) + ' ' + m.focusScore + (mark ? ' ' + mark : '') + '</span></button>';
      }).join('') + '</div>';
    }

    function evidence(member) {
      var s = member.latest, key = member.focusKey, excerpt = pickExcerpt(s, key), tip = (s.tips || []).filter(Boolean)[0];
      var who = esc(member.name);
      var body;
      if (excerpt) {
        body = '<div class="brief-transcript">' + excerpt.turns.map(function (turn) {
          var speaker = turn.speaker === 'agent' ? who : t('Client', '客户');
          return '<div class="brief-turn' + (turn.marked ? ' is-marked' : '') + '"><span class="brief-speaker">' + speaker + '</span><p>' + (turn.marked ? '<mark>' + esc(turn.text) + '</mark>' : esc(turn.text)) + '</p></div>';
        }).join('') + '</div><p class="brief-margin">' + t('Marked: ' + excerpt.reason.en + '. Read it and judge for yourself.', '标出的是：' + excerpt.reason.zh + '。请您看一眼，自己判断。') + '</p>';
      } else {
        body = '<p class="brief-plain">' + (s.summary ? esc(clip(s.summary, 420)) : t('This session was saved without a transcript, so there is no passage to show.', '这次练习没有保存对话记录，所以没有原话可以展示。')) + '</p>';
      }
      var caseLine = s.clientCaseName ? '<p class="brief-case">' + t('Practised against the client file “' + esc(s.clientCaseName) + '” from Client Studio.', '这次练习对应 Client Studio 里的客户档案「' + esc(s.clientCaseName) + '」。') + '</p>' : '';
      return '<section class="brief-col brief-evidence" aria-labelledby="brief-evidence-title"><h3 id="brief-evidence-title">' + t('What ' + who + ' actually said', who + ' 的原话') + '</h3>'
        + '<p class="brief-context">' + t('Latest Practice: “' + esc(s.scenario || 'Practice') + '”, ' + day(s.savedAt) + '. Overall ' + score(s, 'overall') + '/100, ' + esc(label(key)) + ' ' + member.focusScore + '/100.', '最近一次练习：「' + esc(s.scenario || '练习') + '」，' + day(s.savedAt) + '。总分 ' + score(s, 'overall') + '/100，' + esc(label(key)) + ' ' + member.focusScore + '/100。') + '</p>'
        + caseLine + body
        + (tip ? '<p class="brief-tip"><b>' + t('Coach feedback from this session', '这次练习的教练反馈') + '</b>' + esc(clip(tip, 260)) + '</p>' : '')
        + '<a class="brief-link" href="learner-profile.html?pilot=1&learner=' + q(member.email) + '">' + t('Open ' + who + '’s full evidence', '查看 ' + who + ' 的完整练习证据') + '</a></section>';
    }

    function candidatesFor(member) {
      return practiceCandidates({ knowledge: data.knowledge, curriculum: data.curriculum, key: member.focusKey, lang: lang });
    }

    function action(member, model) {
      var who = esc(member.name), key = member.focusKey;
      var sent = ui.sent[member.email];
      if (sent) {
        var next = model.members.filter(function (m) { return m.email !== member.email && !m.open && !ui.sent[m.email]; })[0];
        return '<section class="brief-col brief-action is-done" aria-live="polite"><h3>' + t('Assigned to ' + who, '已指派给 ' + who) + '</h3><p class="brief-done-line">' + t('“' + esc(sent.scenarioName) + '” is in ' + who + '’s Assignment Inbox now. When it is finished, the score and the full conversation come back to this page.', '「' + esc(sent.scenarioName) + '」已经在 ' + who + ' 的练习收件箱里。练完以后，分数和完整对话会回到这个页面。') + '</p>'
          + (next ? '<button type="button" class="brief-secondary" data-brief-member="' + esc(next.email) + '">' + t('Look at ' + esc(next.name) + ' next', '接着看 ' + esc(next.name)) + '</button>' : '')
          + '<a class="brief-link" href="team-messages.html?pilot=1&learner=' + q(member.email) + '">' + t('Send ' + who + ' a note', '给 ' + who + ' 留一句话') + '</a></section>';
      }
      if (member.open) {
        return '<section class="brief-col brief-action"><h3>' + t(who + ' already has a Practice in hand', who + ' 手上已有一项练习') + '</h3><p class="brief-plain">' + t('“' + esc(member.open.scenarioName) + '” was assigned ' + ago(member.open.createdAt) + ' and is not finished yet. Let it come back before adding another.', '「' + esc(member.open.scenarioName) + '」' + ago(member.open.createdAt) + '指派，还没有完成。建议等这一项回来，再安排新的。') + '</p><a class="brief-secondary" href="team-messages.html?pilot=1&learner=' + q(member.email) + '">' + t('Message ' + who, '给 ' + who + ' 发消息') + '</a></section>';
      }
      if (!data.ready) {
        return '<section class="brief-col brief-action" aria-busy="true"><h3>' + t('Getting a Practice ready for ' + who, '正在为 ' + who + ' 准备练习') + '</h3><p class="brief-plain">' + t('Checking the company material you have approved…', '正在查看您审核通过的公司资料…') + '</p></section>';
      }
      var list = candidatesFor(member);
      if (!list.length) {
        return '<section class="brief-col brief-action"><h3>' + t('Nothing ready to assign yet', '还没有可以指派的练习') + '</h3><p class="brief-plain">' + t('Approve one piece of company material in Knowledge Studio and I will turn it into a Practice for ' + who + '.', '在 Knowledge Studio 审核通过一份公司资料后，我就能把它变成给 ' + who + ' 的练习。') + '</p><a class="brief-secondary" href="knowledge.html?pilot=1">' + t('Open Knowledge Studio', '打开 Knowledge Studio') + '</a></section>';
      }
      var chosen = list.filter(function (c) { return c.id === ui.candidateId; })[0] || list[0];
      var note = chosen.kind === 'knowledge' ? focusNote(key, lang) : '';
      var source = chosen.kind === 'knowledge'
        ? t('Built in Knowledge Studio from material you approved: “' + esc(chosen.sourceTitle) + '”.', '来自 Knowledge Studio，用您审核通过的资料《' + esc(chosen.sourceTitle) + '》生成。')
        : t('From the standard curriculum' + (chosen.targeted ? ', chosen for ' + esc(label(key)) : '') + '.', '来自标准课程' + (chosen.targeted ? '，针对「' + esc(label(key)) + '」挑选' : '') + '。');
      var relevance = chosen.kind === 'knowledge' && (chosen.covers || chosen.priority)
        ? '<p class="brief-relevance">' + [chosen.covers ? t('Assessed as covering ' + esc(label(key)), '评估结果：覆盖「' + esc(label(key)) + '」') : '', chosen.priority ? t('team relevance ' + chosen.priority + (chosen.overall ? ' (' + chosen.overall + '/100)' : ''), '团队相关度 ' + chosen.priority + (chosen.overall ? '（' + chosen.overall + '/100）' : '')) : ''].filter(Boolean).join(t(', ', '，')) + (chosen.why ? t('. ', '。') + esc(clip(chosen.why, 200)) : '') + '</p>' : '';
      var picker = list.length > 1 ? '<label class="brief-field"><span>' + t('Practice', '练习') + '</span><select data-brief-candidate>' + list.map(function (c) {
        return '<option value="' + esc(c.id) + '"' + (c.id === chosen.id ? ' selected' : '') + '>' + esc(clip(c.title, 60)) + (c.kind === 'curriculum' ? t(' (standard curriculum)', '（标准课程）') : '') + '</option>';
      }).join('') + '</select></label>' : '';
      var modes = [['quick', t('Quick: 3 exchanges, about 5 minutes', '快速：3 轮对话，约 5 分钟')], ['standard', t('Standard: 6 exchanges', '标准：6 轮对话')], ['full', t('Full: 10 exchanges', '完整：10 轮对话')]];
      return '<section class="brief-col brief-action" aria-labelledby="brief-action-title"><h3 id="brief-action-title">' + t('A Practice I have ready for ' + who, '我为 ' + who + ' 准备好的练习') + '</h3>'
        + '<p class="brief-context">' + source + '</p>' + relevance
        + '<div class="brief-practice"><b>' + esc(chosen.title) + '</b>' + (chosen.objective ? '<p>' + esc(clip(chosen.objective, 260)) + '</p>' : '')
        + (chosen.clientOpening ? '<p class="brief-opening">' + (chosen.kind === 'knowledge' ? t('The client opens with: ', '客户的第一句话：') : '') + esc(clip(chosen.clientOpening, 220)) + '</p>' : '') + '</div>'
        + (note ? '<label class="brief-focus"><input type="checkbox" data-brief-focus' + (ui.addFocus ? ' checked' : '') + '><span>' + esc(note) + '</span></label>' : '')
        + '<div class="brief-fields">' + picker + '<label class="brief-field"><span>' + t('Length', '长度') + '</span><select data-brief-mode>' + modes.map(function (m) { return '<option value="' + m[0] + '"' + (m[0] === ui.mode ? ' selected' : '') + '>' + m[1] + '</option>'; }).join('') + '</select></label></div>'
        + (ui.error ? '<p class="brief-error" role="alert">' + t('Not sent: ', '没有发出：') + esc(ui.error) + t(' Try again.', ' 请再试一次。') + '</p>' : '')
        + '<div class="brief-buttons"><button type="button" class="brief-primary" data-brief-confirm' + (ui.busy ? ' disabled' : '') + '>' + (ui.busy ? t('Assigning…', '正在指派…') : t('Confirm and assign to ' + who, '确认并指派给 ' + who)) + '</button>'
        + (member.latest ? '<a class="brief-secondary" href="manager-chat.html?pilot=1&lang=' + lang + '&learner=' + q(member.email) + '&brief=' + esc(key) + '">' + t('Ask the AI why first', '先问 AI 为什么') + '</a>' : '') + '</div>'
        + '<p class="brief-fine">' + t('Nothing is sent until you confirm. The AI never assigns on your behalf.', '在您确认之前，不会发出任何内容。AI 不会替您指派。') + '</p></section>';
    }

    function ago(iso) {
      var days = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / DAY));
      return days === 0 ? t('today', '今天') : days === 1 ? t('yesterday', '昨天') : t(days + ' days ago', days + ' 天前');
    }

    function loop(model) {
      var back = model.returns.map(function (r) {
        var change = r.key && r.before && r.after ? esc(label(r.key)) + ' ' + r.before + ' → ' + r.after + (r.after !== r.before ? t(' (', '（') + (r.after > r.before ? '+' : '') + (r.after - r.before) + t(')', '）') : '') : t('overall ' + r.overall + '/100', '总分 ' + r.overall + '/100');
        return '<li class="' + (r.key && r.after > r.before ? 'is-up' : '') + '"><b>' + esc(r.name) + '</b> ' + t('finished “' + esc(r.scenarioName) + '”: ', '完成了「' + esc(r.scenarioName) + '」：') + change + ' <a href="learner-profile.html?pilot=1&learner=' + q(r.email) + '">' + t('See the result', '查看结果') + '</a></li>';
      }).join('');
      var waiting = model.waiting.map(function (w) {
        return '<li><b>' + esc(w.name) + '</b> ' + t('“' + esc(w.scenarioName) + '”, ', '「' + esc(w.scenarioName) + '」，') + (w.status === 'In Progress' ? t('in progress', '进行中') : t('not started', '还没开始')) + t(', assigned ', '，') + (w.days === 0 ? t('today', '今天指派') : w.days === 1 ? t('yesterday', '昨天指派') : t(w.days + ' days ago', w.days + ' 天前指派')) + '</li>';
      }).join('');
      if (!back && !waiting) return '';
      return '<div class="brief-loop">' + (back ? '<div><h3>' + t('Back on your desk', '已经回到您这里') + '</h3><ul>' + back + '</ul></div>' : '') + (waiting ? '<div><h3>' + t('Still out with the team', '还在成员手上') + '</h3><ul>' + waiting + '</ul></div>' : '') + '</div>';
    }

    function footer() {
      return '<p class="brief-foot">' + t('A coaching lead, not a verdict on a person. Built only from authorized Practice records; a learner’s private AI Coach conversation is never read. ', '这是辅导线索，不是对人的评价。只使用已授权的练习记录，不读取学员与私人 AI 教练的对话。') + '<a href="manager-chat.html?pilot=1&onboarding=1&lang=' + lang + '">' + t('Rather start by talking about you and your team?', '想先聊聊您自己和团队？') + '</a></p>';
    }

    // The opening line and the order of people stay as first shown for the
    // life of the page, so confirming an assignment does not rewrite the
    // finding the manager just acted on. The next visit starts fresh.
    function pinned() {
      var model = buildBrief(data);
      if (!ui.order) ui.order = model.members.map(function (m) { return m.email; });
      var at = function (m) { var i = ui.order.indexOf(m.email); return i < 0 ? ui.order.length : i; };
      model.members.sort(function (a, b) { return at(a) - at(b); });
      if (model.members.length) model.focus = model.members[0];
      return model;
    }

    function render() {
      var model = pinned();
      var html = '<div class="brief-top"><span class="brief-who">' + t('Your AI Copilot, before you ask', 'AI Copilot 先向您报告') + '</span>';
      if (model.state === 'finding') {
        var member = model.members.filter(function (m) { return m.email === ui.email; })[0] || model.focus;
        ui.email = member.email;
        html += '<span class="brief-basis">' + t('From ' + model.basis.sessionCount + ' Practice session' + (model.basis.sessionCount === 1 ? '' : 's') + ' by ' + model.basis.memberCount + ' team member' + (model.basis.memberCount === 1 ? '' : 's'), '依据 ' + model.basis.memberCount + ' 位成员的 ' + model.basis.sessionCount + ' 次练习') + '</span></div>'
          + headline(model) + chips(model, member)
          + '<div class="brief-body">' + evidence(member) + action(member, model) + '</div>' + loop(model) + footer();
      } else {
        var roster = model.rosterOnly;
        var person = roster.filter(function (m) { return m.email === ui.email; })[0] || roster[0] || null;
        html += '</div><h2 class="brief-headline" id="ai-brief-title">' + t('There is no Practice on record yet, so I am not going to guess about anyone.', '还没有练习记录，所以我现在不对任何人下判断。') + '<span class="brief-follow">' + (person
          ? t('The fastest first step: give one team member a five-minute Practice. When it comes back, I will tell you what I see.', '最快的第一步：给一位成员指派一个约 5 分钟的练习。结果回来以后，我会告诉您我看到了什么。')
          : t('Invite your first team member and this page will start working for you.', '先邀请第一位成员，这个页面就会开始为您工作。')) + '</span></h2>';
        if (person) {
          ui.email = person.email;
          html += (roster.length > 1 ? '<div class="brief-chips" role="group"><span class="brief-chips-label">' + t('Start with', '先从谁开始') + '</span>' + roster.slice(0, 6).map(function (m) {
            return '<button type="button" class="brief-chip" data-brief-member="' + esc(m.email) + '" aria-pressed="' + (m.email === person.email) + '"><b>' + esc(m.name) + '</b></button>';
          }).join('') + '</div>' : '') + '<div class="brief-body is-single">' + action(person, { members: roster }) + '</div>';
        } else {
          html += '<div class="brief-body is-single"><section class="brief-col brief-action"><a class="brief-primary" href="manager.html?pilot=1">' + t('Invite a team member', '邀请团队成员') + '</a></section></div>';
        }
        html += loop(model) + footer();
      }
      root.innerHTML = html;
      root.classList.toggle('is-entering', ui.first);
      ui.first = false;
    }

    // Swaps only the action column, so the opening reveal is not replayed
    // when Company Knowledge arrives or the manager changes a control.
    function refreshAction() {
      var model = pinned(), node = root.querySelector('.brief-action');
      var member = model.members.concat(model.rosterOnly).filter(function (m) { return m.email === ui.email; })[0];
      if (!node || !member) { render(); return; }
      node.outerHTML = action(member, model.state === 'finding' ? model : { members: model.rosterOnly });
    }

    function selectedMember() {
      var model = pinned();
      return model.members.concat(model.rosterOnly).filter(function (m) { return m.email === ui.email; })[0] || null;
    }

    root.addEventListener('click', function (event) {
      var pick = event.target.closest('[data-brief-member]');
      if (pick) { ui.email = pick.getAttribute('data-brief-member'); ui.candidateId = null; ui.error = ''; render(); return; }
      if (!event.target.closest('[data-brief-confirm]') || ui.busy) return;
      var member = selectedMember();
      if (!member) return;
      var list = candidatesFor(member), chosen = list.filter(function (c) { return c.id === ui.candidateId; })[0] || list[0];
      if (!chosen) return;
      var payload = assignmentPayload({ candidate: chosen, member: member, mode: ui.mode, addFocus: ui.addFocus, key: member.focusKey, lang: lang });
      ui.busy = true; ui.error = ''; refreshAction();
      Promise.resolve(options.assign(payload)).then(function (result) {
        var record = (result && result.assignment) || Object.assign({ id: 'pending-' + Date.now(), status: 'Assigned', createdAt: new Date().toISOString() }, payload);
        data.assignments.unshift(record);
        ui.sent[member.email] = record;
        if (options.onAssigned) options.onAssigned(record);
      }).catch(function (error) {
        ui.error = (error && error.message) || t('The assignment could not be created.', '指派没有建立成功。');
      }).then(function () { ui.busy = false; render(); });
    });
    root.addEventListener('change', function (event) {
      if (event.target.matches('[data-brief-candidate]')) { ui.candidateId = event.target.value; refreshAction(); }
      else if (event.target.matches('[data-brief-mode]')) ui.mode = event.target.value;
      else if (event.target.matches('[data-brief-focus]')) ui.addFocus = event.target.checked;
    });

    render();
    return {
      update: function (patch) {
        var keys = Object.keys(patch || {});
        keys.forEach(function (k) { data[k] = patch[k]; });
        if (keys.every(function (k) { return k === 'knowledge' || k === 'curriculum' || k === 'ready'; })) refreshAction(); else render();
      }
    };
  }

  return {
    COMPETENCIES: COMPETENCIES, buildBrief: buildBrief, pickExcerpt: pickExcerpt,
    practiceCandidates: practiceCandidates, assignmentPayload: assignmentPayload, focusNote: focusNote, mount: mount
  };
});
