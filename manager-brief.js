/* Manager AI Brief — "the AI speaks first" on the manager's Pilot Home.
 *
 * Three beats, all computed from data the manager is already authorized to
 * see (team Practice sessions, assignments, approved Company Knowledge):
 *   1. Finding  — what the team's recent Practice shows, and who to look at first.
 *   2. Evidence — the member's own words from the latest transcript, with one
 *                 passage marked so the manager can judge for themselves.
 *   3. Action   — one prepared Practice, sent only when the manager confirms.
 *
 * A 14-day observation and a historical record are kept apart: Practice older
 * than 14 days is always shown with its date and age and never described as
 * current performance, and a single Practice is never read as a trend.
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

  function daysSince(iso, now) {
    var at = Date.parse(iso);
    return isNaN(at) ? null : Math.max(0, Math.floor((now - at) / DAY));
  }

  // The brief makes two different kinds of statement and never mixes them:
  //   - a 14-day observation, built only from Practice saved in the last 14 days;
  //   - a historical record, which is shown with its date and age and is never
  //     described as current performance.
  // state 'finding'     : at least one member practiced in the last 14 days.
  // state 'stale'       : there is Practice on record, but none in the last 14 days.
  // state 'no_evidence' : team members exist, nobody has a scored Practice.
  // state 'no_team'     : nobody on the roster yet.
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
    assignments.filter(isOpen).sort(byTime('createdAt')).forEach(function (a) {
      openFor[norm(a.assignedTo)] = {
        id: a.id, scenarioName: a.scenarioName || '', status: a.status === 'In Progress' ? 'In Progress' : 'Assigned',
        createdAt: a.createdAt, days: daysSince(a.createdAt, now), mode: a.mode || ''
      };
    });

    var history = {};
    scored.forEach(function (s) { var e = sessionEmail(s); (history[e] = history[e] || []).push(s); });
    var recent = scored.filter(function (s) { return now - Date.parse(s.savedAt) <= WINDOW_DAYS * DAY; });

    var members = Object.keys(history).map(function (email) {
      var all = history[email], latest = all[all.length - 1], key = lowestKey(latest);
      var used = all.filter(function (s) { return score(s, key) > 0; }).slice(-3);
      var values = used.map(function (s) { return score(s, key); });
      var age = daysSince(latest.savedAt, now);
      return {
        email: email, name: names[email] || email, sessions: all, latest: latest, hasEvidence: true,
        sessionCount: all.length, focusKey: key, focusScore: score(latest, key),
        // A single Practice is one data point: no drop, no trend.
        series: values, seriesFrom: used.length ? used[0].savedAt : null, drop: drop(values), trend: trend(values),
        lastPracticeAt: latest.savedAt, daysSince: age, fresh: age !== null && age <= WINDOW_DAYS,
        open: openFor[email] || null
      };
    });
    var fresh = members.filter(function (m) { return m.fresh; });

    var rosterOnly = Object.keys(names).filter(function (e) { return !history[e]; }).map(function (email) {
      return { email: email, name: names[email], sessions: [], latest: null, hasEvidence: false, sessionCount: 0, focusKey: null, focusScore: 0, series: [], seriesFrom: null, drop: 0, trend: 'none', lastPracticeAt: null, daysSince: null, fresh: false, open: openFor[email] || null };
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });

    // The shared pattern is a 14-day observation, so only members who
    // practiced in the last 14 days are counted in it.
    var pattern = null;
    if (fresh.length) {
      var ranked = COMPETENCIES.map(function (c, order) {
        var low = fresh.filter(function (m) { return m.focusKey === c.key; });
        var values = fresh.map(function (m) { return score(m.latest, c.key); }).filter(function (v) { return v > 0; });
        var average = values.length ? values.reduce(function (a, b) { return a + b; }, 0) / values.length : 100;
        return { key: c.key, count: low.length, average: average, order: order };
      }).sort(function (a, b) { return b.count - a.count || a.average - b.average || a.order - b.order; });
      pattern = { key: ranked[0].key, count: ranked[0].count, of: fresh.length };
    }

    // Who to open on: recent Practice before historical records; then someone
    // a Practice can actually be recommended for (no assignment still open);
    // then the shared pattern, the steepest drop, and the lowest score.
    members.sort(function (a, b) {
      var ap = pattern && a.fresh && a.focusKey === pattern.key ? 0 : 1, bp = pattern && b.fresh && b.focusKey === pattern.key ? 0 : 1;
      return (a.fresh ? 0 : 1) - (b.fresh ? 0 : 1)
        || (a.open ? 1 : 0) - (b.open ? 1 : 0)
        || (a.fresh ? (ap - bp || b.drop - a.drop || a.focusScore - b.focusScore) : String(b.lastPracticeAt).localeCompare(String(a.lastPracticeAt)))
        || a.name.localeCompare(b.name);
    });

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
        resultSessionId: result ? result.id : null,
        overall: result ? score(result, 'overall') : Number(a.score) || 0,
        key: key, before: key ? score(before, key) : null, beforeAt: before ? before.savedAt : null,
        after: key && result ? score(result, key) : null, afterAt: result ? result.savedAt : null
      };
    });

    var waiting = assignments.filter(isOpen).sort(byTime('createdAt')).reverse().slice(0, 4).map(function (a) {
      var email = norm(a.assignedTo);
      return {
        assignmentId: a.id, email: email, name: names[email] || a.learner || email, scenarioName: a.scenarioName || '',
        status: a.status || 'Assigned', days: daysSince(a.createdAt, now) || 0
      };
    });

    var latestAt = scored.length ? scored[scored.length - 1].savedAt : null;
    return {
      state: fresh.length ? 'finding' : members.length ? 'stale' : (rosterOnly.length ? 'no_evidence' : 'no_team'),
      windowDays: WINDOW_DAYS,
      recent: { sessionCount: recent.length, memberCount: fresh.length },
      allTime: { sessionCount: scored.length, memberCount: members.length, latestAt: latestAt, daysSinceLatest: latestAt ? daysSince(latestAt, now) : null },
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
    return { turns: shown, reason: reason, turnCount: turns.length, line: Number(turns[at].index) || at + 1 };
  }

  function localized(value, lang) {
    if (value && typeof value === 'object') return value[lang] || value.en || value.zh || '';
    return value || '';
  }

  // How well one Practice fits the competency a member needs to work on.
  //   strong     : approved company material assessed as covering it, rated P1 or 75+ for the team
  //   partial    : assessed as covering it, but with a lower team-relevance rating
  //   unassessed : approved company material with no relevance assessment to go on
  //   standard   : the standard-curriculum Practice written for that competency
  //   off_target : company material that was assessed and is NOT tagged for it
  //   general    : nothing to match against yet (the member has no Practice on record)
  var MATCH_ORDER = { strong: 6, partial: 5, unassessed: 4, general: 4, standard: 3, starter: 3, off_target: 1 };

  // Practices the manager could assign, best fit first. Company material the
  // manager approved leads when it fits or has not been assessed; when every
  // approved source has been assessed and none covers the competency, the
  // standard Practice written for it is offered first instead.
  function practiceCandidates(input) {
    input = input || {};
    var key = input.key || null, lang = input.lang === 'zh' ? 'zh' : 'en', list = [];
    (input.knowledge || []).forEach(function (source) {
      var draft = source && source.analysis && source.analysis.practiceDraft;
      if (!source || source.status !== 'approved' || !draft || !draft.title || !draft.situation || !draft.objective) return;
      var rel = source.relevance || null;
      var assessed = !!(rel && (Array.isArray(rel.competencies) || rel.priority || rel.overall));
      var covers = !!(key && rel && Array.isArray(rel.competencies) && rel.competencies.indexOf(key) >= 0);
      var priority = rel && /^P[123]$/.test(rel.priority || '') ? rel.priority : '';
      var overall = rel && Number(rel.overall) ? Number(rel.overall) : null;
      var match = !key ? 'general' : covers ? ((priority === 'P1' || (overall !== null && overall >= 75)) ? 'strong' : 'partial') : assessed ? 'off_target' : 'unassessed';
      list.push({
        kind: 'knowledge', id: 'knowledge-' + source.id, sourceId: source.id, sourceTitle: source.title || '',
        title: draft.title, situation: draft.situation, objective: draft.objective,
        clientName: draft.clientName || '', clientOpening: draft.clientOpening || '',
        successCriteria: Array.isArray(draft.successCriteria) ? draft.successCriteria.slice(0, 6) : [],
        match: match, covers: covers, assessed: assessed, priority: priority, overall: overall,
        why: rel && rel.whyItMatters ? String(rel.whyItMatters) : '',
        rank: MATCH_ORDER[match] * 10 + (priority === 'P1' ? 3 : priority === 'P2' ? 2 : priority === 'P3' ? 1 : 0) + (source.analysis.quality === 'important' ? 0.5 : 0),
        at: String(source.approvedAt || source.updatedAt || '')
      });
    });
    list.sort(function (a, b) { return b.rank - a.rank || b.at.localeCompare(a.at); });
    list = list.slice(0, 4);
    var wanted = (key && CURRICULUM_FOR[key]) || CURRICULUM_FIRST;
    var lesson = (input.curriculum || []).filter(function (x) { return x && String(x.id) === wanted; })[0];
    if (lesson) {
      var standard = !!(key && CURRICULUM_FOR[key]);
      list.push({
        kind: 'curriculum', id: String(lesson.id), title: localized(lesson.title, lang) || String(lesson.id),
        objective: localized(lesson.objective, lang), clientName: lesson.clientName || '',
        clientOpening: localized(lesson.preview, lang), targeted: standard,
        match: standard ? 'standard' : 'starter', rank: MATCH_ORDER[standard ? 'standard' : 'starter'] * 10, at: ''
      });
      list.sort(function (a, b) { return b.rank - a.rank || b.at.localeCompare(a.at); });
    }
    return list;
  }

  // Why the first candidate is first, as a fact about the list (never a
  // promise about results).
  function rankReason(list) {
    if (!list.length) return null;
    var first = list[0], company = list.filter(function (c) { return c.kind === 'knowledge'; });
    var covering = company.filter(function (c) { return c.covers; });
    if (list.length === 1) return { code: 'only_option', total: 1 };
    if (first.kind === 'curriculum') return { code: company.length ? 'none_covers' : 'only_option', total: list.length, company: company.length };
    if (first.covers) return { code: covering.length === 1 ? 'only_cover' : 'best_cover', total: list.length, covering: covering.length };
    if (first.match === 'unassessed') return { code: 'unassessed_latest', total: list.length, company: company.length };
    return { code: 'general', total: list.length, company: company.length };
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

  // What should be observable in the next Practice, per competency. Written
  // as behaviour a manager can check in the transcript, not as a score target.
  var EXPECTED = {
    closing: {
      en: 'Before the conversation ends, {name} proposes one specific next step with a day or time, and the client answers it. You can check this in the last lines of the next transcript.',
      zh: '在对话结束前，{name} 提出一个具体的下一步（含日期或时间），并且客户对此作出回应。您可以在下一次对话记录的最后几句里核对。'
    },
    empathy: {
      en: '{name}’s first reply to the client’s concern restates that concern and asks one question before explaining anything. You can check this in the reply right after the client’s first objection.',
      zh: '客户提出顾虑后，{name} 的第一句回应先复述这个顾虑并问一个问题，然后才开始解释。您可以在客户第一次提出异议后的那句回应里核对。'
    },
    accuracy: {
      en: '{name} states the key product point correctly in plain words, then asks the client to confirm they understood. You can check this in the longest explanation of the next transcript.',
      zh: '{name} 用通俗的话把关键的产品要点讲准确，再请客户确认是否理解。您可以在下一次对话记录里解释最长的那一段核对。'
    }
  };

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
    var ui = { email: null, order: null, candidateId: null, mode: 'quick', addFocus: true, busy: false, error: null, another: {}, request: null, first: true };
    var label = function (key) { var c = competency(key); return c ? c[lang] : ''; };
    var day = function (iso) { return iso ? new Date(iso).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : ''; };
    var q = function (value) { return encodeURIComponent(value); };
    var ago = function (days) { return days === null || days === undefined ? '' : days === 0 ? t('today', '今天') : days === 1 ? t('yesterday', '昨天') : t(days + ' days ago', days + ' 天前'); };
    var plural = function (n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); };
    var transcriptHref = function (sessionId) { return 'manager.html?pilot=1&result=' + q(sessionId); };

    // Opening line. A 14-day observation and a historical record are worded
    // differently on purpose; see buildBrief().
    function headline(model) {
      var f = model.focus, p = model.pattern, name = esc(f.name), comp = esc(label(f.focusKey)), arrow = f.series.join(' → ');
      var lead, follow = '';
      if (model.state === 'stale') {
        lead = t('No one on the team has practiced in the past ' + model.windowDays + ' days.', '过去 ' + model.windowDays + ' 天，团队里没有人做过练习。');
        follow = t('The most recent Practice on record is from ' + day(model.allTime.latestAt) + ', ' + ago(model.allTime.daysSinceLatest) + '. What is shown below is a historical record, not current performance.',
          '最近的一次练习记录是 ' + day(model.allTime.latestAt) + '，距今 ' + model.allTime.daysSinceLatest + ' 天。下面显示的是历史记录，不代表目前的表现。');
      } else if (!f.fresh) {
        // Only reached when the manager's pinned opening member has aged out; say so plainly.
        lead = t(name + '’s latest Practice was ' + day(f.lastPracticeAt) + ', ' + ago(f.daysSince) + '.', name + ' 最近一次练习是 ' + day(f.lastPracticeAt) + '，距今 ' + f.daysSince + ' 天。');
        follow = t('That is a historical record, not a 14-day observation.', '这是历史记录，不是近 14 天的观察。');
      } else if (model.recent.sessionCount === 1) {
        lead = t('One Practice in the past ' + model.windowDays + ' days: ' + name + ', on ' + day(f.lastPracticeAt) + '.', '过去 ' + model.windowDays + ' 天只有 1 次练习：' + name + '，' + day(f.lastPracticeAt) + '。');
        follow = t('Lowest area in that session: ' + comp + ', ' + f.focusScore + '/100.', '这次练习里最低的一项是「' + comp + '」，' + f.focusScore + '/100。');
      } else if (p.count >= 2 && f.focusKey === p.key) {
        lead = t('In the past ' + model.windowDays + ' days, ' + p.count + ' of the ' + p.of + ' team members who practiced scored lowest on ' + comp + '.', '过去 ' + model.windowDays + ' 天做过练习的 ' + p.of + ' 位成员中，有 ' + p.count + ' 位在「' + comp + '」上得分最低。');
        var peers = model.members.filter(function (m) { return m.fresh && m.focusKey === p.key; });
        var steepest = peers.every(function (m) { return m.drop <= f.drop; });
        var lowest = peers.every(function (m) { return m.focusScore >= f.focusScore; });
        follow = f.trend === 'down'
          ? (steepest ? t(name + ' has dropped the most: ' + arrow + '.', name + ' 下滑最快：' + arrow + '。') : t(name + ' is slipping too: ' + arrow + '.', name + ' 也在下滑：' + arrow + '。'))
          : (lowest ? t(name + ' is lowest: ' + f.focusScore + '/100 on ' + day(f.lastPracticeAt) + '.', name + ' 最低：' + f.focusScore + '/100（' + day(f.lastPracticeAt) + '）。') : t(name + ' scored ' + f.focusScore + '/100 on ' + day(f.lastPracticeAt) + '.', name + ' 在 ' + day(f.lastPracticeAt) + ' 得到 ' + f.focusScore + '/100。'));
      } else {
        lead = t('In the past ' + model.windowDays + ' days, the first thing to look at is ' + name + '’s ' + comp + ': ' + f.focusScore + '/100 on ' + day(f.lastPracticeAt) + '.', '过去 ' + model.windowDays + ' 天里，最值得您先看的是 ' + name + ' 的「' + comp + '」：' + f.focusScore + '/100（' + day(f.lastPracticeAt) + '）。');
        follow = f.trend === 'down' ? t('Last ' + f.series.length + ' sessions: ' + arrow + '.', '最近 ' + f.series.length + ' 次：' + arrow + '。')
          : f.trend === 'up' ? t('Last ' + f.series.length + ' sessions: ' + arrow + '. It is still the lowest area.', '最近 ' + f.series.length + ' 次：' + arrow + '。这一项仍然是最低的。') : '';
      }
      // One Practice is one data point: say so, and claim no direction.
      if (f.sessionCount === 1 && model.state !== 'stale') follow += t(' This is ' + name + '’s only Practice on record, so treat it as a lead, not a trend.', name + ' 目前只有这 1 次练习记录，请当作线索，不能看作趋势。');
      return '<h2 class="brief-headline" id="ai-brief-title">' + lead + (follow ? '<span class="brief-follow">' + follow + '</span>' : '') + '</h2>';
    }

    function basis(model) {
      var older = model.members.filter(function (m) { return !m.fresh; }).length;
      if (model.state === 'stale') {
        return t('No Practice in the past ' + model.windowDays + ' days. All-time record: ' + plural(model.allTime.sessionCount, 'session') + ' by ' + plural(model.allTime.memberCount, 'member'),
          '近 ' + model.windowDays + ' 天没有练习。历史记录共 ' + model.allTime.memberCount + ' 位成员、' + model.allTime.sessionCount + ' 次练习');
      }
      return t('Past ' + model.windowDays + ' days: ' + plural(model.recent.sessionCount, 'Practice session') + ' by ' + plural(model.recent.memberCount, 'member') + (older ? '. ' + plural(older, 'more member') + ' with older records only' : ''),
        '近 ' + model.windowDays + ' 天：' + model.recent.memberCount + ' 位成员、' + model.recent.sessionCount + ' 次练习' + (older ? '。另有 ' + older + ' 位成员只有更早的记录' : ''));
    }

    // Every chip says what kind of record stands behind that person: a recent
    // Practice, an older one (with its date), or none at all.
    function chips(model, selected) {
      var people = model.members.slice(0, 8).concat(model.rosterOnly.slice(0, 6));
      if (people.length < 2) return '';
      return '<div class="brief-chips" role="group" aria-label="' + t('Choose a team member', '选择一位成员') + '"><span class="brief-chips-label">' + t('Team members', '团队成员') + '</span>' + people.map(function (m) {
        var mark = m.trend === 'down' ? ' ↓' : m.trend === 'up' ? ' ↑' : '';
        var state = !m.hasEvidence ? t('no Practice yet', '还没有练习')
          : m.fresh ? esc(label(m.focusKey)) + ' ' + m.focusScore + mark
            : t('last Practice ' + day(m.lastPracticeAt), '上次练习 ' + day(m.lastPracticeAt));
        var kind = !m.hasEvidence ? ' is-none' : m.fresh ? '' : ' is-old';
        return '<button type="button" class="brief-chip' + kind + '" data-brief-member="' + esc(m.email) + '" aria-pressed="' + (m.email === selected.email) + '"><b>' + esc(m.name) + '</b><span>' + state + '</span>'
          + (m.open ? '<i>' + t('assignment open', '有未完成的指派') + '</i>' : '') + '</button>';
      }).join('') + '</div>';
    }

    function evidence(member) {
      var who = esc(member.name);
      if (!member.hasEvidence) {
        return '<section class="brief-col brief-evidence" aria-labelledby="brief-evidence-title"><p class="brief-label">' + t('Evidence', '依据') + '</p><h3 id="brief-evidence-title">' + t('No Practice evidence for ' + who + ' yet', who + ' 还没有练习证据') + '</h3>'
          + '<p class="brief-plain">' + t(who + ' has not completed a Practice, so there is nothing to score or quote. This is different from an old record: there is no record at all.', who + ' 还没有完成过任何练习，所以没有分数，也没有原话可以引用。这和“记录较旧”不同：这里是完全没有记录。') + '</p></section>';
      }
      var s = member.latest, key = member.focusKey, excerpt = pickExcerpt(s, key), tip = (s.tips || []).filter(Boolean)[0];
      var body;
      if (excerpt) {
        body = '<div class="brief-transcript">' + excerpt.turns.map(function (turn) {
          var speaker = turn.speaker === 'agent' ? who : t('Client', '客户');
          return '<div class="brief-turn' + (turn.marked ? ' is-marked' : '') + '"><span class="brief-speaker">' + speaker + '</span><p>' + (turn.marked ? '<mark>' + esc(turn.text) + '</mark>' : esc(turn.text)) + '</p></div>';
        }).join('') + '</div><p class="brief-margin">' + t('Marked: ' + excerpt.reason.en + ' (line ' + excerpt.line + ' of ' + excerpt.turnCount + '). Read it and judge for yourself.', '标出的是：' + excerpt.reason.zh + '（共 ' + excerpt.turnCount + ' 句中的第 ' + excerpt.line + ' 句）。请您看一眼，自己判断。') + '</p>';
      } else {
        body = '<p class="brief-plain brief-nolines">' + t('This Practice was saved without a transcript, so there are no words to quote. What follows is its summary, not a direct observation.', '这次练习没有保存逐字对话，所以没有原话可以引用。以下是它的总结，不是对原话的直接观察。') + '</p>'
          + (s.summary ? '<p class="brief-plain">' + esc(clip(s.summary, 420)) + '</p>' : '');
      }
      var freshness = member.fresh
        ? '<p class="brief-when">' + t('Practiced ' + day(s.savedAt) + ', ' + ago(member.daysSince) + '. Within the past ' + WINDOW_DAYS + ' days.', '练习日期：' + day(s.savedAt) + '（' + ago(member.daysSince) + '）。在近 ' + WINDOW_DAYS + ' 天内。') + '</p>'
        : '<p class="brief-when is-old">' + t('Historical record. Practiced ' + day(s.savedAt) + ', ' + ago(member.daysSince) + ': older than ' + WINDOW_DAYS + ' days, so it does not describe current performance.', '历史记录。练习日期：' + day(s.savedAt) + '（' + ago(member.daysSince) + '），已超过 ' + WINDOW_DAYS + ' 天，不代表目前的表现。') + '</p>';
      var record = member.sessionCount === 1
        ? t('The only Practice on record for ' + who + '.', '这是 ' + who + ' 唯一的一次练习记录。')
        : member.series.length >= 2
          ? t(esc(label(key)) + ' over the last ' + member.series.length + ' of ' + member.sessionCount + ' sessions (' + day(member.seriesFrom) + ' to ' + day(s.savedAt) + '): ' + member.series.join(' → ') + '.', '共 ' + member.sessionCount + ' 次练习，最近 ' + member.series.length + ' 次的「' + esc(label(key)) + '」（' + day(member.seriesFrom) + ' 至 ' + day(s.savedAt) + '）：' + member.series.join(' → ') + '。')
          : t(member.sessionCount + ' sessions on record.', '共 ' + member.sessionCount + ' 次练习记录。');
      var caseLine = s.clientCaseName ? '<p class="brief-case">' + t('Practised against the client file “' + esc(s.clientCaseName) + '” from Client Studio.', '这次练习对应 Client Studio 里的客户档案「' + esc(s.clientCaseName) + '」。') + '</p>' : '';
      return '<section class="brief-col brief-evidence" aria-labelledby="brief-evidence-title"><p class="brief-label">' + t('Evidence', '依据') + '</p><h3 id="brief-evidence-title">' + (member.fresh ? t('What ' + who + ' actually said', who + ' 的原话') : t('What ' + who + ' said on ' + day(s.savedAt), who + ' 在 ' + day(s.savedAt) + ' 的原话')) + '</h3>'
        + freshness
        + '<p class="brief-context">' + t('“' + esc(s.scenario || 'Practice') + '”. Overall ' + score(s, 'overall') + '/100, ' + esc(label(key)) + ' ' + member.focusScore + '/100. ', '「' + esc(s.scenario || '练习') + '」。总分 ' + score(s, 'overall') + '/100，' + esc(label(key)) + ' ' + member.focusScore + '/100。') + record + '</p>'
        + caseLine + body
        + (tip ? '<p class="brief-tip"><b>' + t('Coach feedback from this session', '这次练习的教练反馈') + '</b>' + esc(clip(tip, 260)) + '</p>' : '')
        + '<a class="brief-link" href="' + transcriptHref(s.id) + '">' + t('Open this Practice and its full transcript', '打开这次练习和完整对话') + '</a></section>';
    }

    function candidatesFor(member) {
      return practiceCandidates({ knowledge: data.knowledge, curriculum: data.curriculum, key: member.focusKey, lang: lang });
    }

    // The assignment a member already holds: what it is, how long it has been
    // open, and what the manager can do about it. Nothing here sends anything.
    function existing(member, model) {
      var who = esc(member.name), a = member.open, justNow = a.days === 0;
      var overdue = a.days >= WINDOW_DAYS;
      var status = a.status === 'In Progress' ? t('In progress', '进行中') : t('Not started', '还没开始');
      var next = model.members.concat(model.rosterOnly).filter(function (m) { return m.email !== member.email && !m.open; })[0];
      return '<div class="brief-existing' + (justNow ? ' is-new' : overdue ? ' is-overdue' : '') + '" aria-live="polite"><p class="brief-label">' + t('Existing assignment', '已有的指派') + '</p>'
        + '<h3>' + (justNow ? t('Assigned to ' + who + ' today', '今天已指派给 ' + who) : t(who + ' already has a Practice assigned', who + ' 已经有一项指派') ) + '</h3>'
        + '<p class="brief-status"><b>' + esc(a.scenarioName) + '</b><span class="brief-pill">' + status + '</span></p>'
        + '<p class="brief-plain">' + (justNow
          ? t('It is in ' + who + '’s Assignment Inbox. When it is finished, the score and the full conversation come back to this page.', '它已经在 ' + who + ' 的练习收件箱里。练完以后，分数和完整对话会回到这个页面。')
          : overdue
            ? t('Assigned ' + day(a.createdAt) + ' and still open after ' + a.days + ' days. A reminder is probably more useful than another assignment.', day(a.createdAt) + ' 指派，已经 ' + a.days + ' 天没有完成。这时候提醒一下，可能比再指派一项更有用。')
            : t('Assigned ' + day(a.createdAt) + ', ' + ago(a.days) + '. It has not come back yet.', day(a.createdAt) + ' 指派（' + ago(a.days) + '），还没有完成。')) + '</p>'
        + '<div class="brief-buttons">'
        + (justNow && next ? '<button type="button" class="brief-secondary" data-brief-member="' + esc(next.email) + '">' + t('Look at ' + esc(next.name) + ' next', '接着看 ' + esc(next.name)) + '</button>' : '')
        + '<a class="brief-secondary" href="team-messages.html?pilot=1&learner=' + q(member.email) + '">' + (justNow ? t('Send ' + who + ' a note', '给 ' + who + ' 留一句话') : t('Write ' + who + ' a reminder', '给 ' + who + ' 写一条提醒')) + '</a>'
        + (justNow || ui.another[member.email] ? '' : '<button type="button" class="brief-secondary" data-brief-another>' + t('Recommend a different Practice', '另外推荐一个练习') + '</button>')
        + (!justNow && next ? '<button type="button" class="brief-secondary" data-brief-member="' + esc(next.email) + '">' + t('Look at ' + esc(next.name) + ' next', '接着看 ' + esc(next.name)) + '</button>' : '') + '</div>'
        + '<p class="brief-fine">' + (justNow ? t('The note opens in Team Messages for you to write and send. Nothing is sent from here.', '留言会在团队消息里打开，由您自己写好再发送。这里不会自动发出任何内容。') : t('The reminder opens in Team Messages for you to write and send. Nothing is sent from here.', '提醒会在团队消息里打开，由您自己写好再发送。这里不会自动发出任何内容。')) + '</p></div>';
    }

    // Why this Practice: the need, what supports it, how good the fit is,
    // why it is listed first, and what to look for afterwards.
    function reasons(member, chosen, list) {
      var who = esc(member.name), key = member.focusKey, comp = esc(label(key)), rows = [];
      if (key) {
        rows.push([t('Needs work', '需要加强'), t(comp + ': ' + member.focusScore + '/100 on ' + day(member.lastPracticeAt) + (member.fresh ? '' : ' (historical record, ' + ago(member.daysSince) + ')') + '.', '「' + comp + '」：' + member.focusScore + '/100（' + day(member.lastPracticeAt) + (member.fresh ? '' : '，历史记录，' + ago(member.daysSince)) + '）。')]);
      } else {
        rows.push([t('Needs work', '需要加强'), t('Not known yet. ' + who + ' has no Practice on record, so this first Practice is to get a reading.', '还不知道。' + who + ' 还没有练习记录，这第一个练习是为了先了解情况。')]);
      }
      var relevance = chosen.priority ? t('team relevance ' + chosen.priority + (chosen.overall ? ', ' + chosen.overall + '/100' : ''), '团队相关度 ' + chosen.priority + (chosen.overall ? '，' + chosen.overall + '/100' : '')) : '';
      var fit = chosen.match === 'strong' ? t('Strong match. This material is assessed as covering ' + comp + (relevance ? ' (' + relevance + ')' : '') + '.', '匹配度高。这份资料经评估覆盖「' + comp + '」' + (relevance ? '（' + relevance + '）' : '') + '。')
        : chosen.match === 'partial' ? t('Partial match. This material is assessed as covering ' + comp + ', but its team relevance is only moderate' + (relevance ? ' (' + relevance + ')' : '') + '.', '部分匹配。这份资料经评估覆盖「' + comp + '」，但团队相关度只是中等' + (relevance ? '（' + relevance + '）' : '') + '。')
          : chosen.match === 'off_target' ? t('Weak match. This material was assessed and is not tagged for ' + comp + (relevance ? ' (' + relevance + ')' : '') + '. It is a real company situation; only the coaching focus below points it at ' + comp + '.', '匹配度低。这份资料经过评估，但没有标记为覆盖「' + comp + '」' + (relevance ? '（' + relevance + '）' : '') + '。它是真实的公司情境，只有下面的辅导重点把练习引向「' + comp + '」。')
            : chosen.match === 'unassessed' ? t('Match not assessed. This material has no relevance assessment yet, so how well it fits ' + comp + ' is unknown. The coaching focus below points the Practice at ' + comp + '.', '匹配度未评估。这份资料还没有做相关度评估，所以它与「' + comp + '」的匹配程度未知。下面的辅导重点会把练习引向「' + comp + '」。')
              : chosen.match === 'standard' ? t('Written for ' + comp + '. This is a standard-curriculum Practice, not built from your company material.', '专为「' + comp + '」编写。这是标准课程里的练习，不是用您的公司资料生成的。')
                : t('A general first Practice. There is no weak area to match it to yet.', '一个通用的入门练习。目前还没有可以对应的弱项。');
      rows.push([t('How well it fits', '匹配程度'), fit + (chosen.why ? ' ' + esc(clip(chosen.why, 180)) : '')]);
      var why = rankReason(list), first = list[0] && list[0].id === chosen.id;
      if (why && list.length > 1) {
        var others = list.length - 1;
        var text = !first ? t('Your choice. The first-listed Practice is “' + esc(clip(list[0].title, 60)) + '”.', '这是您自己选的。排在第一位的是「' + esc(clip(list[0].title, 60)) + '」。')
          : why.code === 'only_cover' ? t('Listed first of ' + list.length + ' because it is the only approved material assessed as covering ' + comp + '.', '在 ' + list.length + ' 个可选练习中排第一，因为它是唯一经评估覆盖「' + comp + '」的已审核资料。')
            : why.code === 'best_cover' ? t('Listed first of ' + list.length + ' because, of the ' + why.covering + ' approved materials assessed as covering ' + comp + ', it has the highest team relevance.', '在 ' + list.length + ' 个可选练习中排第一，因为在 ' + why.covering + ' 份经评估覆盖「' + comp + '」的已审核资料里，它的团队相关度最高。')
              : why.code === 'none_covers' ? t('Listed first because none of your ' + why.company + ' approved materials is assessed as covering ' + comp + '. You can still choose one of them below.', '排在第一位，是因为您审核通过的 ' + why.company + ' 份资料里，没有一份经评估覆盖「' + comp + '」。您仍然可以在下面改选其中一份。')
                : why.code === 'unassessed_latest' ? t('Listed first because it is your most recently approved material. No relevance assessment exists to rank the ' + plural(others, 'other option') + ' against it.', '排在第一位，是因为它是您最近审核通过的资料。目前没有相关度评估，无法把它和其余 ' + others + ' 个选项作比较。')
                  : t('Listed first of ' + list.length + ' as your approved company material with the highest team relevance.', '在 ' + list.length + ' 个可选练习中排第一，因为它是团队相关度最高的已审核公司资料。');
        rows.push([t('Why this one', '为什么是这一个'), text]);
      }
      if (key && EXPECTED[key]) rows.push([t('What to look for next', '下次要看什么'), EXPECTED[key][lang].replace('{name}', who)]);
      return '<dl class="brief-why">' + rows.map(function (r) { return '<dt>' + r[0] + '</dt><dd>' + r[1] + '</dd>'; }).join('') + '</dl>'
        + '<p class="brief-fine">' + t('A relevance rating describes the material. It does not predict that ' + who + '’s score will improve.', '相关度评分描述的是资料本身，并不能预测 ' + who + ' 的分数会提高。') + '</p>';
    }

    function errorLine() {
      if (!ui.error) return '';
      var e = ui.error, text = e.kind === 'auth' ? t('Not sent. Your sign-in could not be confirmed. Sign in again with your manager account, then press Confirm once more. Nothing was assigned.', '没有发出。无法确认您的登录状态。请用主管账号重新登录，然后再按一次确认。目前没有指派任何内容。')
        : e.kind === 'forbidden' ? t('Not sent. This account does not have manager access, so it cannot assign Practice.', '没有发出。这个账号没有主管权限，不能指派练习。')
            : e.kind === 'network' ? t('Not confirmed. The connection dropped before the server answered. Press Confirm again: if the first attempt did arrive, it will not create a second assignment.', '尚未确认。服务器回应之前网络中断了。请再按一次确认：如果第一次其实已经送达，也不会产生重复的指派。')
              : t('Not sent: ', '没有发出：') + esc(e.message || t('the assignment could not be created.', '指派没有建立成功。')) + t(' Try again.', ' 请再试一次。');
      return '<p class="brief-error" role="alert">' + text + '</p>';
    }

    function recommended(member) {
      var who = esc(member.name), key = member.focusKey;
      if (!data.ready) {
        return '<div class="brief-recommended" aria-busy="true"><p class="brief-label">' + t('Recommended Practice', '推荐的练习') + '</p><h3>' + t('Getting a Practice ready for ' + who, '正在为 ' + who + ' 准备练习') + '</h3><p class="brief-plain">' + t('Checking the company material you have approved…', '正在查看您审核通过的公司资料…') + '</p></div>';
      }
      var list = candidatesFor(member);
      if (!list.length) {
        return '<div class="brief-recommended"><p class="brief-label">' + t('Recommended Practice', '推荐的练习') + '</p><h3>' + t('Nothing ready to assign yet', '还没有可以指派的练习') + '</h3><p class="brief-plain">' + t('Approve one piece of company material in Knowledge Studio and it becomes a Practice you can assign to ' + who + '.', '在 Knowledge Studio 审核通过一份公司资料后，它就能成为可以指派给 ' + who + ' 的练习。') + '</p><a class="brief-secondary" href="knowledge.html?pilot=1">' + t('Open Knowledge Studio', '打开 Knowledge Studio') + '</a></div>';
      }
      var chosen = list.filter(function (c) { return c.id === ui.candidateId; })[0] || list[0];
      var note = chosen.kind === 'knowledge' ? focusNote(key, lang) : '';
      var source = chosen.kind === 'knowledge'
        ? t('From Knowledge Studio, built from material you approved: “' + esc(chosen.sourceTitle) + '”.', '来自 Knowledge Studio，用您审核通过的资料《' + esc(chosen.sourceTitle) + '》生成。')
        : t('From the standard curriculum.', '来自标准课程。');
      var picker = list.length > 1 ? '<label class="brief-field"><span>' + t('Practice', '练习') + '</span><select data-brief-candidate>' + list.map(function (c) {
        return '<option value="' + esc(c.id) + '"' + (c.id === chosen.id ? ' selected' : '') + '>' + esc(clip(c.title, 60)) + (c.kind === 'curriculum' ? t(' (standard curriculum)', '（标准课程）') : '') + '</option>';
      }).join('') + '</select></label>' : '';
      var modes = [['quick', t('Quick: 3 exchanges, about 5 minutes', '快速：3 轮对话，约 5 分钟')], ['standard', t('Standard: 6 exchanges', '标准：6 轮对话')], ['full', t('Full: 10 exchanges', '完整：10 轮对话')]];
      var second = !!member.open;
      return '<div class="brief-recommended" aria-labelledby="brief-action-title"><p class="brief-label">' + t('Recommended Practice', '推荐的练习') + '</p><h3 id="brief-action-title">' + (member.hasEvidence && !member.fresh ? t('A fresh Practice for ' + who, '给 ' + who + ' 的一次新练习') : t('A Practice ready for ' + who, '为 ' + who + ' 准备好的练习')) + '</h3>'
        + (member.hasEvidence && !member.fresh ? '<p class="brief-plain">' + t('The last record is ' + member.daysSince + ' days old. A new Practice shows where ' + who + ' is now.', '上一条记录已经是 ' + member.daysSince + ' 天前的。做一次新练习，才能知道 ' + who + ' 现在的情况。') + '</p>' : '')
        + '<p class="brief-context">' + source + '</p>'
        + '<div class="brief-practice"><b>' + esc(chosen.title) + '</b>' + (chosen.objective ? '<p><span>' + t('Training objective: ', '训练目标：') + '</span>' + esc(clip(chosen.objective, 260)) + '</p>' : '')
        + (chosen.clientOpening ? '<p class="brief-opening">' + (chosen.kind === 'knowledge' ? t('The client opens with: ', '客户的第一句话：') : '') + esc(clip(chosen.clientOpening, 220)) + '</p>' : '') + '</div>'
        + reasons(member, chosen, list)
        + (note ? '<label class="brief-focus"><input type="checkbox" data-brief-focus' + (ui.addFocus ? ' checked' : '') + '><span>' + esc(note) + '</span></label>' : '')
        + '<div class="brief-fields">' + picker + '<label class="brief-field"><span>' + t('Length', '长度') + '</span><select data-brief-mode>' + modes.map(function (m) { return '<option value="' + m[0] + '"' + (m[0] === ui.mode ? ' selected' : '') + '>' + m[1] + '</option>'; }).join('') + '</select></label></div>'
        + errorLine()
        + '<div class="brief-buttons"><button type="button" class="brief-primary" data-brief-confirm' + (ui.busy ? ' disabled' : '') + '>' + (ui.busy ? t('Assigning…', '正在指派…') : second ? t('Confirm and assign a second Practice to ' + who, '确认并再指派一项给 ' + who) : t('Confirm and assign to ' + who, '确认并指派给 ' + who)) + '</button>'
        + (member.latest ? '<a class="brief-secondary" href="manager-chat.html?pilot=1&lang=' + lang + '&learner=' + q(member.email) + '&brief=' + esc(key) + '&session=' + q(member.latest.id) + '">' + t('Ask the AI why first', '先问 AI 为什么') + '</a>' : '') + '</div>'
        + '<p class="brief-fine">' + (second ? t(who + ' will then have two open assignments. ', '这样 ' + who + ' 会同时有两项未完成的指派。') : '') + t('Nothing is sent until you confirm. The AI never assigns on your behalf.', '在您确认之前，不会发出任何内容。AI 不会替您指派。') + '</p></div>';
    }

    // Right-hand column: the assignment the member already holds (if any),
    // then the recommended Practice. They are separate blocks with separate
    // labels so one is never mistaken for the other.
    function action(member, model) {
      var parts = '';
      if (member.open) parts += existing(member, model);
      if (!member.open || ui.another[member.email]) parts += recommended(member);
      return '<section class="brief-col brief-action' + (member.open && member.open.days === 0 ? ' is-done' : '') + '">' + parts + '</section>';
    }

    function loop(model) {
      var back = model.returns.map(function (r) {
        var change = r.key && r.before && r.after
          ? esc(label(r.key)) + ' ' + r.before + t(' (', '（') + day(r.beforeAt) + t(') → ', '）→ ') + r.after + t(' (', '（') + day(r.afterAt) + t(')', '）')
          : t('overall ' + r.overall + '/100', '总分 ' + r.overall + '/100');
        return '<li><b>' + esc(r.name) + '</b> ' + t('finished “' + esc(r.scenarioName) + '”: ', '完成了「' + esc(r.scenarioName) + '」：') + change + ' <a href="' + (r.resultSessionId ? transcriptHref(r.resultSessionId) : 'manager.html?pilot=1') + '">' + t('See the result', '查看结果') + '</a></li>';
      }).join('');
      var waiting = model.waiting.map(function (w) {
        return '<li' + (w.days >= WINDOW_DAYS ? ' class="is-overdue"' : '') + '><b>' + esc(w.name) + '</b> ' + t('“' + esc(w.scenarioName) + '”, ', '「' + esc(w.scenarioName) + '」，') + (w.status === 'In Progress' ? t('in progress', '进行中') : t('not started', '还没开始')) + t(', assigned ', '，') + (w.days === 0 ? t('today', '今天指派') : w.days === 1 ? t('yesterday', '昨天指派') : t(w.days + ' days ago', w.days + ' 天前指派')) + '</li>';
      }).join('');
      if (!back && !waiting) return '';
      return '<div class="brief-loop">' + (back ? '<div><h3>' + t('Back on your desk (past 7 days)', '已经回到您这里（近 7 天）') + '</h3><ul>' + back + '</ul></div>' : '') + (waiting ? '<div><h3>' + t('Still out with the team', '还在成员手上') + '</h3><ul>' + waiting + '</ul></div>' : '') + '</div>';
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
    function everyone(model) { return model.members.concat(model.rosterOnly); }

    function render() {
      var model = pinned();
      var html = '<div class="brief-top"><span class="brief-who">' + t('Your AI Copilot, before you ask', 'AI Copilot 先向您报告') + '</span>';
      if (model.state === 'finding' || model.state === 'stale') {
        var member = everyone(model).filter(function (m) { return m.email === ui.email; })[0] || model.focus;
        ui.email = member.email;
        html += '<span class="brief-basis">' + basis(model) + '</span></div>'
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
          html += (roster.length > 1 ? '<div class="brief-chips" role="group"><span class="brief-chips-label">' + t('Start with', '先从谁开始') + '</span>' + roster.slice(0, 8).map(function (m) {
            return '<button type="button" class="brief-chip" data-brief-member="' + esc(m.email) + '" aria-pressed="' + (m.email === person.email) + '"><b>' + esc(m.name) + '</b>' + (m.open ? '<i>' + t('assignment open', '有未完成的指派') + '</i>' : '') + '</button>';
          }).join('') + '</div>' : '') + '<div class="brief-body is-single">' + action(person, model) + '</div>';
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
      var member = everyone(model).filter(function (m) { return m.email === ui.email; })[0];
      if (!node || !member) { render(); return; }
      node.outerHTML = action(member, model);
    }

    function selectedMember() {
      var model = pinned();
      return everyone(model).filter(function (m) { return m.email === ui.email; })[0] || null;
    }

    function newRequestId() {
      if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
      return 'xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx'.replace(/x/g, function () { return Math.floor(Math.random() * 16).toString(16); });
    }

    root.addEventListener('click', function (event) {
      var pick = event.target.closest('[data-brief-member]');
      if (pick) { ui.email = pick.getAttribute('data-brief-member'); ui.candidateId = null; ui.error = null; render(); return; }
      if (event.target.closest('[data-brief-another]')) { ui.another[ui.email] = true; ui.error = null; refreshAction(); return; }
      if (!event.target.closest('[data-brief-confirm]') || ui.busy) return;
      var member = selectedMember();
      if (!member) return;
      var list = candidatesFor(member), chosen = list.filter(function (c) { return c.id === ui.candidateId; })[0] || list[0];
      if (!chosen) return;
      var payload = assignmentPayload({ candidate: chosen, member: member, mode: ui.mode, addFocus: ui.addFocus, key: member.focusKey, lang: lang });
      // One id per confirmed assignment. Pressing Confirm again after a failure
      // repeats the same id, so the server returns the first assignment
      // instead of creating a second; changing anything starts a new one.
      var signature = JSON.stringify(payload);
      if (!ui.request || ui.request.signature !== signature) ui.request = { signature: signature, id: newRequestId() };
      payload.requestId = ui.request.id;
      ui.busy = true; ui.error = null; refreshAction();
      Promise.resolve().then(function () { return options.assign(payload); }).then(function (result) {
        var record = (result && result.assignment) || Object.assign({ id: payload.requestId, status: 'Assigned', createdAt: new Date().toISOString() }, payload);
        if (!data.assignments.some(function (a) { return a.id === record.id; })) data.assignments.unshift(record);
        ui.request = null; delete ui.another[member.email];
        if (options.onAssigned) options.onAssigned(record);
      }).catch(function (error) {
        ui.error = { kind: (error && error.kind) || 'request', message: (error && error.message) || '' };
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
    practiceCandidates: practiceCandidates, rankReason: rankReason, assignmentPayload: assignmentPayload, focusNote: focusNote, mount: mount
  };
});
