// Practice-transcript evidence for Manager AI Copilot.
//
// Manager AI used to receive only a summary of each Practice session
// (scores, tips, summary), so it could name a session but never quote it
// (issue #77). This module does two things:
//
//   1. practiceTranscripts(): selects a bounded set of verbatim transcript
//      lines from one authorized team member's own Practice sessions, each
//      tied to its session id, date, scenario, line number and speaker.
//   2. checkQuotes(): after the model answers, checks every quotation in the
//      answer against those lines, so the page can say which quotes are
//      verified, which are not, and when no transcript exists at all.
//
// Only Practice session records are read here. Private Learner Coach Chat
// lives under a different storage prefix and is never touched.

const DEFAULTS = { maxSessions: 3, sessionChars: 6000, totalChars: 14000, lineChars: 600 };

function clip(value, max) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

// The calendar date of a Practice in the manager's own time zone, so the date
// the AI states matches the date the brief and Leadership Studio display.
export function localDate(iso, timeZone) {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
  } catch {
    return at.toISOString().slice(0, 10);
  }
}

export function safeTimeZone(value) {
  const zone = String(value ?? '').trim().slice(0, 64);
  if (!zone) return 'UTC';
  try { new Intl.DateTimeFormat('en-CA', { timeZone: zone }); return zone; } catch { return 'UTC'; }
}

export function daysBetween(iso, now = Date.now()) {
  const at = Date.parse(iso);
  return Number.isNaN(at) ? null : Math.max(0, Math.floor((now - at) / 86400000));
}

// One session's lines within a character budget. When the whole transcript
// does not fit, the opening and the end are kept (how a conversation ends is
// what "next step" coaching depends on) and the gap is reported, never hidden.
function boundedLines(transcript, options) {
  const lines = (Array.isArray(transcript) ? transcript : [])
    .map((turn, i) => ({
      line: Number(turn?.index) || i + 1,
      speaker: turn?.speaker === 'agent' ? 'learner' : 'client',
      text: clip(turn?.text, options.lineChars)
    }))
    .filter(row => row.text);
  const size = rows => rows.reduce((sum, row) => sum + row.text.length + 24, 0);
  if (size(lines) <= options.sessionChars) return { lines, total: lines.length, omitted: 0 };
  const head = lines.slice(0, 2);
  const tail = [];
  for (let i = lines.length - 1; i >= 2; i -= 1) {
    if (size(head) + size(tail) + lines[i].text.length + 24 > options.sessionChars) break;
    tail.unshift(lines[i]);
  }
  const kept = [...head, ...tail];
  return { lines: kept, total: lines.length, omitted: lines.length - kept.length };
}

// sessions: full session records for ONE member (any order).
// Returns newest first, with the session the manager came from (focus) first.
export function practiceTranscripts(sessions, input = {}) {
  const options = { ...DEFAULTS, ...input };
  const ordered = [...(sessions || [])]
    .sort((a, b) => String(b.savedAt || b.createdAt).localeCompare(String(a.savedAt || a.createdAt)));
  const focus = input.focusSessionId ? ordered.find(row => row.id === input.focusSessionId) : null;
  const chosen = (focus ? [focus, ...ordered.filter(row => row !== focus)] : ordered).slice(0, options.maxSessions);
  let remaining = options.totalChars;
  return chosen.map((session, i) => {
    const bounded = remaining > 400
      ? boundedLines(session.transcript, { ...options, sessionChars: Math.min(options.sessionChars, remaining) })
      : { lines: [], total: Array.isArray(session.transcript) ? session.transcript.length : 0, omitted: Array.isArray(session.transcript) ? session.transcript.length : 0 };
    remaining -= bounded.lines.reduce((sum, row) => sum + row.text.length + 24, 0);
    const when = session.savedAt || session.createdAt || '';
    return {
      ref: `S${i + 1}`,
      sessionId: session.id,
      practiceDate: localDate(when, options.timeZone),
      savedAt: when,
      daysAgo: daysBetween(when, options.now),
      scenario: clip(session.scenario, 200),
      scores: session.scores || {},
      isFocus: !!focus && session === focus,
      // 'verbatim': the lines below are the stored words. 'unavailable': this
      // session was saved without a transcript, so nothing may be quoted from it.
      transcriptStatus: bounded.total ? 'verbatim' : 'unavailable',
      lineCount: bounded.total,
      omittedLines: bounded.omitted,
      lines: bounded.lines
    };
  });
}

// ---------------------------------------------------------------------------
// Quote checking
// ---------------------------------------------------------------------------

function normalize(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

function trimEdges(value) {
  return value.replace(/^[\s"'.,;:!?。，；：！？、…-]+|[\s"'.,;:!?。，；：！？、…-]+$/g, '');
}

const HAS_CJK = /[぀-ヿ㐀-鿿]/;

// Long enough to count as a claim about what somebody said, rather than a
// quoted term such as "closing" or a scenario title fragment.
function substantial(text) {
  return HAS_CJK.test(text) ? text.length >= 6 : (text.length >= 14 && /\s/.test(text));
}

// A quotation may be shortened with an ellipsis; each remaining piece must
// then appear, in order, inside the same transcript line.
function foundIn(lineText, quote) {
  const pieces = quote.split(/…|\.{3,}/).map(trimEdges).filter(Boolean);
  if (!pieces.length) return false;
  let from = 0;
  for (const piece of pieces) {
    const at = lineText.indexOf(piece, from);
    if (at < 0) return false;
    from = at + piece.length;
  }
  return true;
}

const QUOTE = /[“"「『]([^“”"「」『』\n]{2,600})[”"」』](\s*[[［(（]\s*(S\d+)\s*[·,，、:：\s-]*L(?:ine)?\s*(\d+)\s*[\]］)）])?/gi;

// answer: the model's text. transcripts: the practiceTranscripts() list that
// was given to the model. known: other record text that may legitimately be
// quoted without being transcript (scenario titles, coach feedback, the
// manager's own question).
export function checkQuotes(answer, transcripts, known = []) {
  const lines = [];
  for (const session of transcripts || []) {
    for (const row of session.lines || []) {
      lines.push({ ref: session.ref, sessionId: session.sessionId, line: row.line, speaker: row.speaker, text: normalize(row.text) });
    }
  }
  const knownText = normalize((known || []).filter(Boolean).join('\n'));
  const verified = [];
  const unverified = [];
  const seen = new Set();
  for (const match of String(answer ?? '').matchAll(QUOTE)) {
    const raw = match[1].trim();
    const quote = trimEdges(normalize(raw));
    if (!quote || seen.has(quote)) continue;
    const cited = match[3] ? { ref: match[3].toUpperCase(), line: Number(match[4]) } : null;
    const exact = cited && lines.find(row => row.ref === cited.ref && row.line === cited.line && foundIn(row.text, quote));
    const anywhere = exact || lines.find(row => foundIn(row.text, quote));
    if (anywhere && (cited || substantial(quote))) {
      seen.add(quote);
      verified.push({ text: raw, ref: anywhere.ref, sessionId: anywhere.sessionId, line: anywhere.line, speaker: anywhere.speaker });
      continue;
    }
    if (anywhere) continue; // a short phrase that does occur in the transcript: not worth a badge either way
    // Not in the transcript. It only matters if it is presented as evidence:
    // either it carries a citation, or it is long enough to read as something
    // a person said and is not text from elsewhere in the record.
    if (cited || (substantial(quote) && !knownText.includes(quote))) {
      seen.add(quote);
      unverified.push({ text: raw, cited: cited ? `${cited.ref} L${cited.line}` : null });
    }
  }
  return { verified, unverified };
}

// What the page should say about the evidence behind one answer.
export function evidenceReport({ member, transcripts, check, now = Date.now() }) {
  const sessions = (transcripts || []).map(row => ({
    ref: row.ref, sessionId: row.sessionId, practiceDate: row.practiceDate, savedAt: row.savedAt, daysAgo: row.daysAgo,
    scenario: row.scenario, overall: Number(row.scores?.overall) || 0,
    transcriptStatus: row.transcriptStatus, lineCount: row.lineCount, isFocus: row.isFocus
  }));
  const withTranscript = sessions.filter(row => row.transcriptStatus === 'verbatim');
  const latest = sessions.slice().sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)))[0] || null;
  return {
    member: member || null,
    // verbatim: at least one session's stored words were available to the AI.
    // summary_only: sessions exist but none has a stored transcript.
    // none: this member has no Practice session on record.
    status: !sessions.length ? 'none' : withTranscript.length ? 'verbatim' : 'summary_only',
    sessions,
    latestPracticeAt: latest ? latest.savedAt : null,
    daysSinceLatest: latest ? daysBetween(latest.savedAt, now) : null,
    verifiedQuotes: check?.verified || [],
    unverifiedQuotes: check?.unverified || []
  };
}
