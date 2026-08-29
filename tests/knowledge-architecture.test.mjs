// Validation for the Room 4D / Project 001 knowledge architecture data files
// (data/knowledge/project-001/*.json). Deliberately a small node:test file,
// not a standalone validation framework - see docs/room-4d/KNOWLEDGE-ARCHITECTURE.md.
//
// Run with: npm test
// (node --import ./tests/register.mjs --test tests/*.test.mjs)
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', 'data', 'knowledge', 'project-001');

function loadJson(name) {
  return JSON.parse(readFileSync(path.join(DATA_DIR, name), 'utf8'));
}

const domainsFile = loadJson('domains.json');
const knowledgePointsFile = loadJson('knowledge-points.json');
const questionSchema = loadJson('question-schema.json');
const sourceRegistry = loadJson('source-registry.json');

const ALLOWED_VERIFICATION_STATUSES = [
  'unverified',
  'source-confirmed',
  'authoritatively-verified',
  'needs-review',
  'outdated'
];

const REQUIRED_QUESTION_FIELDS = [
  'questionId',
  'knowledgePointIds',
  'domainId',
  'questionText',
  'choices',
  'sourceAnswer',
  'verifiedAnswer',
  'verificationStatus',
  'createdAt',
  'updatedAt'
];

describe('domains.json', () => {
  test('has at least one domain', () => {
    assert.ok(Array.isArray(domainsFile.domains) && domainsFile.domains.length > 0);
  });

  test('domain IDs are unique', () => {
    const ids = domainsFile.domains.map((d) => d.id);
    assert.equal(new Set(ids).size, ids.length, `duplicate domain ids found: ${ids}`);
  });

  test('every domain has a non-empty topics list', () => {
    for (const domain of domainsFile.domains) {
      assert.ok(Array.isArray(domain.topics) && domain.topics.length > 0, `domain ${domain.id} has no topics`);
    }
  });
});

describe('knowledge-points.json', () => {
  const domainIds = new Set(domainsFile.domains.map((d) => d.id));
  const knowledgePointIds = new Set(knowledgePointsFile.knowledgePoints.map((k) => k.id));

  test('has at least one knowledge point', () => {
    assert.ok(knowledgePointsFile.knowledgePoints.length > 0);
  });

  test('knowledge point IDs are unique', () => {
    const ids = knowledgePointsFile.knowledgePoints.map((k) => k.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate knowledge point ids found');
  });

  test('every knowledge point references a valid domain', () => {
    for (const kp of knowledgePointsFile.knowledgePoints) {
      assert.ok(domainIds.has(kp.domainId), `${kp.id} references unknown domainId ${kp.domainId}`);
    }
  });

  test('every knowledge point id is prefixed with its own domainId', () => {
    for (const kp of knowledgePointsFile.knowledgePoints) {
      assert.ok(kp.id.startsWith(`${kp.domainId}-`), `${kp.id} does not start with its domainId ${kp.domainId}`);
    }
  });

  test('relatedKnowledgePoints references resolve to real knowledge points', () => {
    for (const kp of knowledgePointsFile.knowledgePoints) {
      for (const relatedId of kp.relatedKnowledgePoints || []) {
        assert.ok(knowledgePointIds.has(relatedId), `${kp.id} has unknown relatedKnowledgePoints entry ${relatedId}`);
      }
    }
  });

  test('prerequisites references resolve to real knowledge points', () => {
    for (const kp of knowledgePointsFile.knowledgePoints) {
      for (const prereqId of kp.prerequisites || []) {
        assert.ok(knowledgePointIds.has(prereqId), `${kp.id} has unknown prerequisites entry ${prereqId}`);
      }
    }
  });

  test('a knowledge point never lists itself as a prerequisite or related point', () => {
    for (const kp of knowledgePointsFile.knowledgePoints) {
      assert.ok(!(kp.prerequisites || []).includes(kp.id), `${kp.id} lists itself as a prerequisite`);
      assert.ok(!(kp.relatedKnowledgePoints || []).includes(kp.id), `${kp.id} lists itself as related`);
    }
  });

  test('verificationStatus is from the allowed set', () => {
    for (const kp of knowledgePointsFile.knowledgePoints) {
      assert.ok(
        ALLOWED_VERIFICATION_STATUSES.includes(kp.verificationStatus),
        `${kp.id} has invalid verificationStatus ${kp.verificationStatus}`
      );
    }
  });
});

describe('question-schema.json', () => {
  test('is a well-formed JSON Schema object with a required list', () => {
    assert.equal(typeof questionSchema, 'object');
    assert.ok(Array.isArray(questionSchema.required));
  });

  test('required list covers every core question field', () => {
    for (const field of REQUIRED_QUESTION_FIELDS) {
      assert.ok(questionSchema.required.includes(field), `question-schema.json is missing required field: ${field}`);
    }
  });

  test('declares a property definition for every required field', () => {
    for (const field of questionSchema.required) {
      assert.ok(questionSchema.properties && questionSchema.properties[field], `no property definition for required field ${field}`);
    }
  });

  test('verificationStatus enum matches the allowed verification statuses', () => {
    const enumValues = questionSchema.properties.verificationStatus.enum;
    assert.deepEqual([...enumValues].sort(), [...ALLOWED_VERIFICATION_STATUSES].sort());
  });
});

describe('source-registry.json', () => {
  test('has at least one batch with at least one source', () => {
    assert.ok(Array.isArray(sourceRegistry.batches) && sourceRegistry.batches.length > 0);
    for (const batch of sourceRegistry.batches) {
      assert.ok(Array.isArray(batch.sources) && batch.sources.length > 0, `batch ${batch.batchId} has no sources`);
    }
  });

  test('sourceIds are unique across the whole registry', () => {
    const ids = sourceRegistry.batches.flatMap((b) => b.sources.map((s) => s.sourceId));
    assert.equal(new Set(ids).size, ids.length, 'duplicate sourceId found across batches');
  });

  test('every source references the batchId it is nested under', () => {
    for (const batch of sourceRegistry.batches) {
      for (const source of batch.sources) {
        assert.equal(source.batchId, batch.batchId, `${source.sourceId} has mismatched batchId`);
      }
    }
  });

  test('verificationStatus is from the allowed set', () => {
    for (const batch of sourceRegistry.batches) {
      for (const source of batch.sources) {
        assert.ok(
          ALLOWED_VERIFICATION_STATUSES.includes(source.verificationStatus),
          `${source.sourceId} has invalid verificationStatus ${source.verificationStatus}`
        );
      }
    }
  });
});
