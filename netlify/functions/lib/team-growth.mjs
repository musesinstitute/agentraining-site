// Team Growth & Retention — deterministic manager attention signals (V1).
//
// Pure function: no I/O, no AI, no prediction. It only restates facts found in
// existing Pilot data (roster, sessions, assignments, assignment-events) as
// evidence-backed "worth a check-in" signals. It never produces a risk score,
// churn probability, or any judgment about a person's intent.
//
// Dates follow the rest of pilot-data.mjs: ISO timestamps compared in UTC.

const DAY_MS = 86400000;

// No explicit pass/fail rule exists anywhere in the project; scores.overall is
// 0–100 (every surface renders it as "/100"), so V1 uses 60 as the pass line.
export const PASS_THRESHOLD = 60;
export const PRACTICE_BREAK_DAYS = 14;
export const ASSIGNMENT_OPEN_DAYS = 7;
export const NEW_MEMBER_DAYS = 30;
export const NEW_MEMBER_START_DAYS = 7;
export const MIN_SESSIONS_FOR_DECLINE = 6;
export const DECLINE_POINTS = 10;
export const STUCK_MIN_ATTEMPTS = 3;
export const FOCUS_LIMIT = 3;
export const RECENT_RESULT_DAYS = 14;
export const RECENT_RESULT_LIMIT = 3;

function email(value) {
  return String(value ?? '').trim().toLowerCase();
}

function time(value) {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function scoreOf(session) {
  const value = session?.scores?.overall;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function round1(value) {
  return Math.round(value * 10) / 10;
}

// Monday 00:00 UTC of the week containing `now`.
export function startOfWeek(nowMs) {
  const d = new Date(nowMs);
  const sinceMonday = (d.getUTCDay() + 6) % 7;
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - sinceMonday);
}

function sessionEvidence(session) {
  const score = scoreOf(session);
  return {
    date: session.savedAt,
    scenario: session.scenario || '',
    ...(score === null ? {} : { score })
  };
}

function latestDate(evidence) {
  return evidence.reduce((max, item) => Math.max(max, time(item.date) ?? 0), 0);
}

function practiceBreakSignal(sessions, nowMs) {
  const last = sessions[sessions.length - 1];
  if (!last) return null;
  const lastMs = time(last.savedAt);
  if (lastMs === null || nowMs - lastMs < PRACTICE_BREAK_DAYS * DAY_MS) return null;
  return {
    type: 'practice_break',
    days: PRACTICE_BREAK_DAYS,
    evidence: [sessionEvidence(last)]
  };
}

function scoreDeclineSignal(sessions) {
  const scored = sessions.filter(session => scoreOf(session) !== null);
  if (scored.length < MIN_SESSIONS_FOR_DECLINE) return null;
  const lastSix = scored.slice(-MIN_SESSIONS_FOR_DECLINE);
  const previous = lastSix.slice(0, 3);
  const recent = lastSix.slice(3);
  const avg = rows => rows.reduce((sum, session) => sum + scoreOf(session), 0) / rows.length;
  const previousAverage = avg(previous);
  const recentAverage = avg(recent);
  if (previousAverage - recentAverage < DECLINE_POINTS) return null;
  return {
    type: 'score_decline',
    previousAverage: round1(previousAverage),
    recentAverage: round1(recentAverage),
    evidence: lastSix.map(sessionEvidence)
  };
}

function scenarioIdFor(scenarioName, failures, assignmentsById, assignments) {
  for (let i = failures.length - 1; i >= 0; i -= 1) {
    const linked = assignmentsById.get(failures[i].assignmentId);
    if (linked?.scenarioId) return linked.scenarioId;
  }
  const byName = assignments.find(item => item.scenarioId && item.scenarioName === scenarioName);
  return byName ? byName.scenarioId : null;
}

function repeatedStuckSignal(sessions, assignmentsById, assignments) {
  const byScenario = new Map();
  const latestPassed = new Map();
  for (const session of sessions) {
    const score = scoreOf(session);
    const scenario = String(session.scenario || '').trim();
    if (!scenario || score === null) continue;
    latestPassed.set(scenario, score >= PASS_THRESHOLD);
    if (score >= PASS_THRESHOLD) continue;
    if (!byScenario.has(scenario)) byScenario.set(scenario, []);
    byScenario.get(scenario).push(session);
  }
  // A scenario whose most recent attempt passed is no longer "stuck", so the
  // signal can clear once the member gets past it.
  const qualifying = [...byScenario.entries()]
    .filter(([scenario, failures]) => failures.length >= STUCK_MIN_ATTEMPTS && !latestPassed.get(scenario))
    .map(([scenario, failures]) => ({ scenario, failures, lastMs: time(failures[failures.length - 1].savedAt) ?? 0 }));
  if (!qualifying.length) return null;
  // Most below-pass attempts first; ties go to the scenario with the most
  // recent below-pass attempt; then name for a stable order.
  qualifying.sort((a, b) => b.failures.length - a.failures.length || b.lastMs - a.lastMs || a.scenario.localeCompare(b.scenario));
  const primary = qualifying[0];
  return {
    type: 'repeated_stuck',
    passThreshold: PASS_THRESHOLD,
    scenario: primary.scenario,
    attempts: primary.failures.length,
    scenarioId: scenarioIdFor(primary.scenario, primary.failures, assignmentsById, assignments),
    scenarios: qualifying.map(item => ({ scenario: item.scenario, attempts: item.failures.length })),
    evidence: qualifying.flatMap(item => item.failures.map(sessionEvidence))
  };
}

function openAssignmentSignal(assignments, completedIds, assignedAtById, nowMs) {
  const today = new Date(nowMs).toISOString().slice(0, 10);
  const evidence = [];
  for (const assignment of assignments) {
    if (assignment.status === 'Completed' || completedIds.has(assignment.id)) continue;
    const assignedAt = assignedAtById.get(assignment.id) || assignment.createdAt;
    const assignedMs = time(assignedAt);
    const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(assignment.dueDate || '')) ? assignment.dueDate : '';
    const openTooLong = assignedMs !== null && nowMs - assignedMs > ASSIGNMENT_OPEN_DAYS * DAY_MS;
    const pastDue = Boolean(dueDate) && today > dueDate;
    if (!openTooLong && !pastDue) continue;
    evidence.push({
      date: assignedAt,
      scenario: assignment.scenarioName || '',
      assignmentId: assignment.id,
      scenarioId: assignment.scenarioId || '',
      dueDate: dueDate || null,
      completed: false,
      reason: pastDue ? 'past_due_date' : 'open_over_7_days'
    });
  }
  if (!evidence.length) return null;
  evidence.sort((a, b) => (time(a.date) ?? 0) - (time(b.date) ?? 0));
  return { type: 'assignment_open', evidence };
}

function newNotStartedSignal(member, sessions, nowMs) {
  const joinedMs = time(member.joinedAt);
  if (joinedMs === null || sessions.length) return null;
  if (nowMs - joinedMs < NEW_MEMBER_START_DAYS * DAY_MS) return null;
  return {
    type: 'new_not_started',
    evidence: [{ date: member.joinedAt, joinedAt: member.joinedAt, sessionCount: 0 }]
  };
}

function isTeamGrowthIntervention(assignment) {
  return assignment?.source === 'team-growth' && assignment.intervention
    && email(assignment.intervention.learner) === email(assignment.assignedTo);
}

// Shared per-team indexes used by both the focus signals and intervention
// status, so every rule reads the same sorted, roster-scoped data.
function analyzeTeam({ members = [], sessions = [], assignments = [], assignmentEvents = [], now = Date.now() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : (typeof now === 'number' ? now : Date.parse(now));

  const roster = new Map();
  for (const member of members) {
    const key = email(member.email);
    if (key && !roster.has(key)) roster.set(key, { ...member, email: key });
  }

  const sessionsByLearner = new Map();
  for (const session of sessions) {
    const key = email(session.learner);
    if (!roster.has(key) || time(session.savedAt) === null || time(session.savedAt) > nowMs) continue;
    if (!sessionsByLearner.has(key)) sessionsByLearner.set(key, []);
    sessionsByLearner.get(key).push(session);
  }
  for (const rows of sessionsByLearner.values()) {
    rows.sort((a, b) => time(a.savedAt) - time(b.savedAt) || String(a.id || '').localeCompare(String(b.id || '')));
  }

  const assignmentsById = new Map(assignments.filter(item => item?.id).map(item => [item.id, item]));
  const completedAtById = new Map();
  for (const event of assignmentEvents) {
    if (event?.type === 'completed' && event.assignmentId) completedAtById.set(event.assignmentId, event.createdAt || '');
  }
  for (const assignment of assignments) {
    if (assignment?.status === 'Completed' && !completedAtById.has(assignment.id)) completedAtById.set(assignment.id, assignment.completedAt || '');
  }
  const assignedAtById = new Map(assignmentEvents.filter(event => event?.type === 'assigned' && event.createdAt).map(event => [event.assignmentId, event.createdAt]));
  const assignmentsByLearner = new Map();
  for (const assignment of assignments) {
    const key = email(assignment.assignedTo);
    if (!roster.has(key)) continue;
    if (!assignmentsByLearner.has(key)) assignmentsByLearner.set(key, []);
    assignmentsByLearner.get(key).push(assignment);
  }

  const candidates = new Map();
  for (const member of roster.values()) {
    const memberSessions = sessionsByLearner.get(member.email) || [];
    const memberAssignments = assignmentsByLearner.get(member.email) || [];
    const stuck = repeatedStuckSignal(memberSessions, assignmentsById, memberAssignments);
    const signals = [
      stuck,
      scoreDeclineSignal(memberSessions),
      openAssignmentSignal(memberAssignments, new Set(completedAtById.keys()), assignedAtById, nowMs),
      practiceBreakSignal(memberSessions, nowMs),
      newNotStartedSignal(member, memberSessions, nowMs)
    ].filter(Boolean);
    if (!signals.length) continue;
    const latestSession = memberSessions[memberSessions.length - 1];
    candidates.set(member.email, {
      learner: member.email,
      name: member.name || latestSession?.learnerName || member.email,
      signals,
      suggestedScenarioId: stuck?.scenarioId || null,
      latestEvidenceAt: new Date(Math.max(...signals.map(signal => latestDate(signal.evidence)))).toISOString()
    });
  }

  return { nowMs, roster, sessionsByLearner, assignmentsById, completedAtById, assignedAtById, assignmentsByLearner, candidates };
}

/**
 * Current signals for one learner, recomputed from server data. Used when a
 * team-growth assignment is created so intervention metadata never comes
 * from the browser. Returns null when the learner has no current signal.
 */
export function currentSignalsFor(input, learnerEmail) {
  return analyzeTeam(input).candidates.get(email(learnerEmail)) || null;
}

function outcome(type, state, extra = {}) {
  return { type, state, ...extra };
}

// Phase 2 rules: only data after assignedAt counts as new evidence, and the
// state is only judged once the intervention assignment itself is completed.
function evaluateSignalOutcome(type, intervention, ctx) {
  const { newSessions, allSessions, completedAtById, assignmentsById } = ctx;
  if (type === 'repeated_stuck') {
    const scenario = String(intervention.stuckScenario || '').trim();
    if (!scenario) return outcome(type, 'completed');
    const attempts = newSessions.filter(session => String(session.scenario || '').trim() === scenario && scoreOf(session) !== null);
    const pass = attempts.find(session => scoreOf(session) >= PASS_THRESHOLD);
    if (pass) return outcome(type, 'improved', { improvementType: 'scenario_passed', evidenceAt: pass.savedAt, scenario, evidence: [sessionEvidence(pass)] });
    if (attempts.length) return outcome(type, 'still-needs-attention', { scenario, evidence: attempts.map(sessionEvidence) });
    return outcome(type, 'completed', { scenario });
  }
  if (type === 'practice_break' || type === 'new_not_started') {
    const first = newSessions[0];
    if (!first) return outcome(type, 'completed');
    return outcome(type, 'improved', {
      improvementType: type === 'practice_break' ? 'practice_resumed' : 'first_practice',
      evidenceAt: first.savedAt, evidence: [sessionEvidence(first)]
    });
  }
  if (type === 'assignment_open') {
    const ids = Array.isArray(intervention.sourceAssignmentIds) ? intervention.sourceAssignmentIds.filter(Boolean) : [];
    if (!ids.length) return outcome(type, 'completed');
    const evidence = ids.map(id => ({
      assignmentId: id,
      scenario: assignmentsById.get(id)?.scenarioName || '',
      date: completedAtById.get(id) || assignmentsById.get(id)?.createdAt || '',
      completed: completedAtById.has(id)
    }));
    if (evidence.every(item => item.completed)) {
      return outcome(type, 'improved', { improvementType: 'original_assignment_completed', evidenceAt: new Date(latestDate(evidence)).toISOString(), evidence });
    }
    return outcome(type, 'still-needs-attention', { evidence });
  }
  if (type === 'score_decline') {
    // Re-run the Phase 1 rule once the latest three scored sessions are all
    // post-intervention; before that the original rule cannot be re-judged.
    if (newSessions.filter(session => scoreOf(session) !== null).length < 3) return outcome(type, 'completed');
    const scored = allSessions.filter(session => scoreOf(session) !== null);
    const lastSix = scored.slice(-MIN_SESSIONS_FOR_DECLINE);
    const signal = scoreDeclineSignal(allSessions);
    if (signal) return outcome(type, 'still-needs-attention', { previousAverage: signal.previousAverage, recentAverage: signal.recentAverage, evidence: signal.evidence });
    const avg = rows => round1(rows.reduce((sum, session) => sum + scoreOf(session), 0) / rows.length);
    const latest = lastSix[lastSix.length - 1];
    return outcome(type, 'improved', {
      improvementType: 'score_decline_resolved', evidenceAt: latest.savedAt,
      previousAverage: lastSix.length === 6 ? avg(lastSix.slice(0, 3)) : null,
      recentAverage: avg(lastSix.slice(-3)),
      evidence: lastSix.map(sessionEvidence)
    });
  }
  return outcome(type, 'completed');
}

function evaluateIntervention(assignment, team) {
  const intervention = assignment.intervention;
  const learner = email(assignment.assignedTo);
  const assignedAt = team.assignedAtById.get(assignment.id) || assignment.createdAt;
  const base = {
    assignmentId: assignment.id,
    scenario: assignment.scenarioName || '',
    assignedAt,
    completedAt: null,
    signalTypes: Array.isArray(intervention.signalTypes) ? intervention.signalTypes : []
  };
  if (!team.completedAtById.has(assignment.id)) return { state: 'assigned', ...base };
  const completedAt = team.completedAtById.get(assignment.id) || null;
  const allSessions = team.sessionsByLearner.get(learner) || [];
  const assignedMs = time(assignedAt) ?? Infinity;
  const newSessions = allSessions.filter(session => time(session.savedAt) > assignedMs);
  const outcomes = base.signalTypes.map(type => evaluateSignalOutcome(type, intervention, {
    newSessions, allSessions, completedAtById: team.completedAtById, assignmentsById: team.assignmentsById
  }));
  let state = 'completed';
  if (outcomes.some(item => item.state === 'still-needs-attention')) state = 'still-needs-attention';
  else if (outcomes.length && outcomes.every(item => item.state === 'improved')) state = 'improved';
  const result = { state, ...base, completedAt, outcomes };
  if (state === 'improved') {
    result.improvementEvidenceAt = new Date(Math.max(...outcomes.map(item => time(item.evidenceAt) ?? 0))).toISOString();
    result.improvementType = outcomes[0].improvementType;
  }
  return result;
}

/**
 * @param {object} input
 * @param {{email:string,name?:string,joinedAt?:string|null}[]} input.members
 * @param {object[]} input.sessions          pilot sessions (learner, savedAt, scenario, scores.overall, assignmentId)
 * @param {object[]} input.assignments       pilot assignments (team-growth ones carry source + intervention)
 * @param {object[]} input.assignmentEvents  pilot assignment-events (type 'assigned' | 'completed')
 * @param {string|number|Date} input.now
 */
export function computeTeamGrowth(input = {}) {
  const team = analyzeTeam(input);
  const { nowMs, roster, sessionsByLearner } = team;
  const weekStart = startOfWeek(nowMs);

  // Evaluate every team-growth intervention for roster members, oldest first.
  const interventionsByLearner = new Map();
  for (const [learner, rows] of team.assignmentsByLearner) {
    const evaluated = rows.filter(isTeamGrowthIntervention)
      .sort((a, b) => String(a.intervention.createdAt || a.createdAt).localeCompare(String(b.intervention.createdAt || b.createdAt)) || String(a.id).localeCompare(String(b.id)))
      .map(assignment => evaluateIntervention(assignment, team));
    if (evaluated.length) interventionsByLearner.set(learner, evaluated);
  }

  // Focus only ever contains members with a current signal; intervention
  // history alone never keeps someone here.
  const focus = [...team.candidates.values()]
    .sort((a, b) => b.signals.length - a.signals.length
      || Date.parse(b.latestEvidenceAt) - Date.parse(a.latestEvidenceAt)
      || a.learner.localeCompare(b.learner))
    .slice(0, FOCUS_LIMIT)
    .map(person => {
      const history = interventionsByLearner.get(person.learner) || [];
      return { ...person, interventionStatus: history.length ? history[history.length - 1] : { state: 'none' } };
    });

  const nameFor = learner => {
    const member = roster.get(learner);
    const rows = sessionsByLearner.get(learner) || [];
    return member?.name || rows[rows.length - 1]?.learnerName || learner;
  };
  const recentResults = [];
  for (const [learner, history] of interventionsByLearner) {
    const improved = history
      .filter(item => item.state === 'improved')
      .filter(item => {
        const at = time(item.improvementEvidenceAt);
        return at !== null && at <= nowMs && nowMs - at <= RECENT_RESULT_DAYS * DAY_MS;
      })
      .sort((a, b) => Date.parse(b.improvementEvidenceAt) - Date.parse(a.improvementEvidenceAt))[0];
    if (!improved) continue;
    recentResults.push({
      learner,
      name: nameFor(learner),
      state: 'improved',
      assignmentId: improved.assignmentId,
      scenario: improved.scenario,
      assignedAt: improved.assignedAt,
      completedAt: improved.completedAt,
      improvementEvidenceAt: improved.improvementEvidenceAt,
      improvementType: improved.improvementType,
      outcomes: improved.outcomes
    });
  }
  recentResults.sort((a, b) => Date.parse(b.improvementEvidenceAt) - Date.parse(a.improvementEvidenceAt) || a.learner.localeCompare(b.learner));

  const practicedThisWeek = [...roster.keys()].filter(key => (sessionsByLearner.get(key) || [])
    .some(session => time(session.savedAt) >= weekStart)).length;
  // Only members with a recorded joinedAt can be counted as new; members
  // without one (everyone added before joinedAt existed) are never guessed.
  const withJoinDate = [...roster.values()].filter(member => time(member.joinedAt) !== null);
  const newMembersAvailable = withJoinDate.length > 0;
  const newMembers = newMembersAvailable
    ? withJoinDate.filter(member => nowMs - time(member.joinedAt) <= NEW_MEMBER_DAYS * DAY_MS).length
    : null;

  return {
    summary: {
      teamSize: roster.size,
      practicedThisWeek,
      newMembers,
      newMembersAvailable,
      membersWithoutJoinDate: roster.size - withJoinDate.length,
      weekStart: new Date(weekStart).toISOString()
    },
    focus,
    recentResults: recentResults.slice(0, RECENT_RESULT_LIMIT),
    rules: {
      passThreshold: PASS_THRESHOLD,
      practiceBreakDays: PRACTICE_BREAK_DAYS,
      assignmentOpenDays: ASSIGNMENT_OPEN_DAYS,
      newMemberDays: NEW_MEMBER_DAYS,
      recentResultDays: RECENT_RESULT_DAYS,
      timezone: 'UTC'
    },
    generatedAt: new Date(nowMs).toISOString()
  };
}
