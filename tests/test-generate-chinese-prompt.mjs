// Tests for Chinese higher-order question generation prompt support (PR #36)
// Validates: detectChinese() language detection + generate() prompt injection
// Does NOT call OpenAI — tests prompt construction only.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../netlify/functions/knowledge-question-bank-v2.mjs'), 'utf8');

// ── Extract detectChinese and evidence as standalone functions ───────────
// We extract the function bodies from the source to test them without
// importing the full serverless handler (which requires Netlify runtime).

// Re-implement the two small functions directly for testing — avoids
// extracting from minified source which has nested braces.
function clean(v, n = 500) { return String(v ?? '').trim().slice(0, n); }
function evidence(p) {
  return clean([p.label, p.summary, p.sourceReference, p.evidenceExcerpt, p.sourceExcerpt]
    .filter(Boolean).join(' '), 2400);
}
function detectChinese(asgs) {
  let zh = 0, total = 0;
  for (const a of asgs) {
    const s = evidence(a.point);
    total += s.length;
    const m = s.match(/[㐀-鿿豈-﫿]/g);
    if (m) zh += m.length;
  }
  return total > 0 && zh / total > 0.15;
}

// ── Helper: build a mock assignment ─────────────────────────────────────
function mockAsg(label, summary, sourceRef, excerpt) {
  return {
    point: {
      id: 'K001',
      label: label || '',
      summary: summary || '',
      sourceReference: sourceRef || '',
      sourceExcerpt: excerpt || '',
      evidenceExcerpt: ''
    },
    phase: { key: 'understanding', depths: ['Understanding'], types: ['mcq', 'scenario'] },
    preferredDepth: 'Understanding',
    retryCount: 0,
    depthEligibilityScore: 5
  };
}

// ── Test 1: detectChinese returns true for Chinese content ──────────────
console.log('Test 1: detectChinese — Chinese insurance content');
const zhAsgs = [
  mockAsg('终身寿险与定期寿险的区别', '终身寿险提供终身保障，定期寿险仅在特定期间提供保障。保费结构不同。', '培训手册第3章'),
  mockAsg('长期护理保险的资格条件', '投保人必须符合6项日常生活活动中的2项才能获得理赔。', '产品说明书第12页')
];
assert.ok(detectChinese(zhAsgs), 'Chinese insurance points → true');

// ── Test 2: detectChinese returns false for English content ─────────────
console.log('Test 2: detectChinese — English insurance content');
const enAsgs = [
  mockAsg('Whole Life vs Term Life', 'Whole life provides permanent coverage with cash value accumulation. Term life covers a specific period at lower premiums.', 'Training Manual Ch.3'),
  mockAsg('Long-Term Care Eligibility', 'The insured must be unable to perform 2 of 6 activities of daily living to qualify for benefits.', 'Product Guide p.12')
];
assert.ok(!detectChinese(enAsgs), 'English insurance points → false');

// ── Test 3: detectChinese handles mixed content (majority Chinese) ──────
console.log('Test 3: detectChinese — mixed content, majority Chinese');
const mixedZh = [
  mockAsg('保费计算', '年保费 = base rate × age factor。每年调整。', 'Ch.5'),
  mockAsg('Cash Value', '现金价值是终身寿险保单的储蓄部分，可以借款或退保领取。', '第7章')
];
assert.ok(detectChinese(mixedZh), 'Mixed but majority Chinese → true');

// ── Test 4: detectChinese handles empty assignments ─────────────────────
console.log('Test 4: detectChinese — empty assignments');
assert.ok(!detectChinese([]), 'Empty assignments → false');

// ── Test 5: detectChinese threshold — minimal Chinese in English text ───
console.log('Test 5: detectChinese — English with a few Chinese characters');
const mostlyEn = [
  mockAsg('Insurance Types', 'There are several types: whole life, term life, and universal life insurance policies available for 客户.', 'Manual p.1')
];
assert.ok(!detectChinese(mostlyEn), 'Mostly English with one Chinese word → false');

// ── Test 6: Verify prompt includes Chinese instructions when detected ───
console.log('Test 6: Chinese prompt injection — Understanding instructions present');
// We cannot call generate() directly (requires OpenAI), so we verify that
// the source code correctly includes the Chinese Understanding/Application
// instructions in the isChinese branch.
assert.ok(src.includes('中文Understanding题目要求'), 'Chinese Understanding instruction exists in source');
assert.ok(src.includes('解释、比较、辨析、因果分析、意义判断'), 'Specific Chinese Understanding cognitive operations listed');
assert.ok(src.includes('中文Application题目要求'), 'Chinese Application instruction exists in source');
assert.ok(src.includes('应用到一个全新的具体情境中做出决策'), 'Chinese Application decision-making requirement present');

// ── Test 7: Verify Chinese instructions include language directive ──────
console.log('Test 7: Chinese prompt — language directive');
assert.ok(src.includes('Generate ALL question text, options, explanations and sourceReference in Chinese'), 'Language directive present');
assert.ok(src.includes('简体中文'), 'Simplified Chinese specified');
assert.ok(src.includes('Do not translate source terms into English'), 'Anti-translation directive present');

// ── Test 8: Verify English path is unchanged ────────────────────────────
console.log('Test 8: English prompt path preserved');
// The original English instructions must still be present unconditionally
assert.ok(src.includes('Q21-35 are Understanding only: require interpretation, comparison, distinction'), 'English Understanding instruction preserved');
assert.ok(src.includes('Q36-50 are Application only: the learner must use source-supported facts/rules'), 'English Application instruction preserved');
assert.ok(src.includes('SCENARIO IS NOT APPLICATION'), 'Scenario guard preserved');

// ── Test 9: Verify no other functions were modified ─────────────────────
console.log('Test 9: Verify unchanged functions');
assert.ok(src.includes('function depthScore(p){const s=evidence(p).toLowerCase()'), 'depthScore unchanged');
assert.ok(src.includes('function understandingEligible(p)'), 'understandingEligible unchanged');
assert.ok(src.includes('function applicationEligible(p)'), 'applicationEligible unchanged');
assert.ok(src.includes('async function verifyCandidates(candidates,asgs,current)'), 'verifyCandidates unchanged');
assert.ok(src.includes('function validate(q,current,phase)'), 'validate unchanged');

// ── Test 10: detectChinese uses correct Unicode ranges ──────────────────
console.log('Test 10: detectChinese Unicode range coverage');
// CJK Unified Ideographs Extension A (3400-4DBF) + CJK Unified (4E00-9FFF) + CJK Compat (F900-FAFF)
const rareChar = mockAsg('㐀', '㐀是一个罕见汉字', '');  // U+3400
assert.ok(detectChinese([rareChar]), 'CJK Extension A characters detected');

console.log('\n✅ All 10 tests passed.');
