// Validation for the Room 4D / Project 001 D-001B question-bank layer
// (data/knowledge/project-001/questions/*.json and .../import/*.json).
// Deliberately a small node:test file, following the same pattern as
// tests/knowledge-architecture.test.mjs (D-001A) - see
// docs/room-4d/D-001B-IMPORT-REPORT.md.
//
// Run with: npm test
// (node --import ./tests/register.mjs --test tests/*.test.mjs)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data', 'knowledge', 'project-001');

function loadJson(...parts) {
  return JSON.parse(readFileSync(path.join(DATA_DIR, ...parts), 'utf8'));
}

const domainsFile = loadJson('domains.json');
const knowledgePointsFile = loadJson('knowledge-points.json');
const sourceRegistry = loadJson('source-registry.json');
const duplicateGroups = loadJson('import', 'duplicate-groups.json');
const verificationQueue = loadJson('import', 'verification-queue.json');

const domainIds = new Set(domainsFile.domains.map((d) => d.id));
const knowledgePointIds = new Set(knowledgePointsFile.knowledgePoints.map((k) => k.id));
const registeredSourceIds = new Set(sourceRegistry.batches.flatMap((b) => b.sources.map((s) => s.sourceId)));

const ALLOWED_VERIFICATION_STATUSES = [
  'unverified',
  'source-confirmed',
  'authoritatively-verified',
  'needs-review',
  'outdated'
];

// PHASE 1 of D-001B only processes these two sources - importing S001/S002/S004
// is explicitly out of scope until a later phase.
const PHASE_1_SOURCE_IDS = ['S003', 'S005'];

const questionFiles = readdirSync(path.join(DATA_DIR, 'questions')).filter((f) => f.endsWith('.json'));
const sourceDocs = questionFiles.map((f) => ({ file: f, doc: loadJson('questions', f) }));
const allQuestions = sourceDocs.flatMap(({ doc }) => doc.questions);
const allQuestionIds = new Set(allQuestions.map((q) => q.questionId));

describe('question bank source files', () => {
  test('only the Phase 1 sources (S003, S005) have been imported', () => {
    const importedSourceIds = sourceDocs.map(({ doc }) => doc.sourceId);
    assert.deepEqual([...importedSourceIds].sort(), [...PHASE_1_SOURCE_IDS].sort());
  });

  test("each source file's declared sourceId matches its filename", () => {
    for (const { file, doc } of sourceDocs) {
      assert.equal(`${doc.sourceId}.json`, file);
    }
  });

  test("each source file's questionCount matches its questions array length", () => {
    for (const { doc } of sourceDocs) {
      assert.equal(doc.questionCount, doc.questions.length);
    }
  });
});

describe('question records', () => {
  test('has at least one question', () => {
    assert.ok(allQuestions.length > 0);
  });

  test('questionIds are unique across all sources', () => {
    const ids = allQuestions.map((q) => q.questionId);
    assert.equal(new Set(ids).size, ids.length, 'duplicate questionId found');
  });

  test('every question references a registered, Phase-1 sourceId', () => {
    for (const q of allQuestions) {
      assert.ok(registeredSourceIds.has(q.sourceId), `${q.questionId} references unregistered sourceId ${q.sourceId}`);
      assert.ok(PHASE_1_SOURCE_IDS.includes(q.sourceId), `${q.questionId} references a sourceId outside Phase 1 scope: ${q.sourceId}`);
    }
  });

  test('every question references a valid domainId', () => {
    for (const q of allQuestions) {
      assert.ok(domainIds.has(q.domainId), `${q.questionId} references unknown domainId ${q.domainId}`);
    }
  });

  test('every knowledgePointIds entry resolves to a real knowledge point', () => {
    for (const q of allQuestions) {
      assert.ok(Array.isArray(q.knowledgePointIds) && q.knowledgePointIds.length > 0, `${q.questionId} has no knowledgePointIds`);
      for (const kpId of q.knowledgePointIds) {
        assert.ok(knowledgePointIds.has(kpId), `${q.questionId} references unknown knowledge point ${kpId}`);
      }
    }
  });

  test('verificationStatus is from the allowed set', () => {
    for (const q of allQuestions) {
      assert.ok(ALLOWED_VERIFICATION_STATUSES.includes(q.verificationStatus), `${q.questionId} has invalid verificationStatus ${q.verificationStatus}`);
    }
  });

  test('sourceAnswer and verifiedAnswer remain distinct fields (verifiedAnswer is null unless independently verified)', () => {
    for (const q of allQuestions) {
      assert.ok('sourceAnswer' in q && 'verifiedAnswer' in q, `${q.questionId} is missing sourceAnswer/verifiedAnswer`);
      // Phase 1 performed no independent verification, so every record must
      // still have verifiedAnswer unset - a handwritten/marked source answer
      // is evidence, not verification.
      if (q.verificationStatus === 'unverified') {
        assert.equal(q.verifiedAnswer, null, `${q.questionId} is 'unverified' but has a non-null verifiedAnswer`);
      }
    }
  });

  test("sourceAnswer, when set, is one of the question's own choice keys", () => {
    for (const q of allQuestions) {
      if (q.sourceAnswer === null) continue;
      const keys = q.choices.map((c) => c.key);
      assert.ok(keys.includes(q.sourceAnswer), `${q.questionId} sourceAnswer ${q.sourceAnswer} is not among its choice keys ${keys}`);
    }
  });

  test('regulatorySensitivity is always a boolean', () => {
    for (const q of allQuestions) {
      assert.equal(typeof q.regulatorySensitivity, 'boolean', `${q.questionId} regulatorySensitivity is not boolean`);
    }
  });

  test('humanAnnotations/memoryAids/bilingualNotes are always arrays when present', () => {
    for (const q of allQuestions) {
      for (const field of ['humanAnnotations', 'memoryAids', 'bilingualNotes']) {
        assert.ok(Array.isArray(q[field]), `${q.questionId}.${field} is not an array`);
      }
    }
  });
});

describe('duplicate-groups.json', () => {
  test('every questionId in every group resolves to a real question', () => {
    for (const group of duplicateGroups.groups) {
      for (const qid of group.questionIds) {
        assert.ok(allQuestionIds.has(qid), `duplicate group ${group.groupId} references unknown questionId ${qid}`);
      }
    }
  });

  test('every group has at least 2 questionIds (a group of 1 is not a duplicate)', () => {
    for (const group of duplicateGroups.groups) {
      assert.ok(group.questionIds.length >= 2, `duplicate group ${group.groupId} has fewer than 2 questionIds`);
    }
  });

  test('duplicateType is exactDuplicate or conceptualDuplicate', () => {
    for (const group of duplicateGroups.groups) {
      assert.ok(['exactDuplicate', 'conceptualDuplicate'].includes(group.duplicateType), `duplicate group ${group.groupId} has invalid duplicateType ${group.duplicateType}`);
    }
  });
});

describe('verification-queue.json', () => {
  test('every queue entry references a real questionId', () => {
    for (const entry of verificationQueue.queue) {
      assert.ok(allQuestionIds.has(entry.questionId), `verification queue references unknown questionId ${entry.questionId}`);
    }
  });

  test('every question appears in the queue exactly once', () => {
    const queueIds = verificationQueue.queue.map((e) => e.questionId);
    assert.equal(new Set(queueIds).size, queueIds.length, 'duplicate entry in verification queue');
    for (const qid of allQuestionIds) {
      assert.ok(queueIds.includes(qid), `question ${qid} is missing from the verification queue`);
    }
  });

  test('priority is one of P0-P3', () => {
    for (const entry of verificationQueue.queue) {
      assert.ok(['P0', 'P1', 'P2', 'P3'].includes(entry.priority), `${entry.questionId} has invalid priority ${entry.priority}`);
    }
  });

  test('reported counts match the actual queue contents', () => {
    for (const p of ['P0', 'P1', 'P2', 'P3']) {
      const actual = verificationQueue.queue.filter((e) => e.priority === p).length;
      assert.equal(verificationQueue.counts[p], actual, `counts.${p} (${verificationQueue.counts[p]}) does not match actual (${actual})`);
    }
  });
});
