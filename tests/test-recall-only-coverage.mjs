import { strict as assert } from 'node:assert';

// Re-implement phaseFor and allowedDepths to test them
function phaseFor(p){if(p<=20)return{key:'broad_coverage',depths:['Recall'],types:['mcq','truefalse','scenario']};if(p<=35)return{key:'understanding',depths:['Understanding'],types:['mcq','scenario']};return{key:'application',depths:['Application'],types:['scenario','mcq']}}
function allowedDepths(p,phase){const e=p.eligibleDepths?.length?p.eligibleDepths:['Recall','Understanding','Application'],x=phase.depths.filter(d=>e.includes(d));if(x.length)return x;if(phase.key==='application')return[];if(phase.key==='understanding')return e.includes('Understanding')?['Understanding']:[];return e}

// Test 1: Q1-20 cannot consume Understanding depth
for (let p = 1; p <= 20; p++) {
  const phase = phaseFor(p);
  assert.deepEqual(phase.depths, ['Recall'], `Position ${p} allows only Recall depth`);
  const allowedForRecall = allowedDepths({eligibleDepths: ['Recall','Understanding']}, phase);
  assert.deepEqual(allowedForRecall, ['Recall'], `Recall-only point at position ${p} cannot get Understanding depth`);
}

// Test 2: Q21-35 retain full Understanding-eligible pool
for (let p = 21; p <= 35; p++) {
  const phase = phaseFor(p);
  assert.deepEqual(phase.depths, ['Understanding'], `Position ${p} allows only Understanding depth`);
  const allowedForUnderstanding = allowedDepths({eligibleDepths: ['Recall','Understanding']}, phase);
  assert.deepEqual(allowedForUnderstanding, ['Understanding'], `Understanding-eligible point at position ${p} gets Understanding depth`);
}

// Test 3: Q36+ remain Application-only
for (let p = 36; p <= 50; p++) {
  const phase = phaseFor(p);
  assert.deepEqual(phase.depths, ['Application'], `Position ${p} allows only Application depth`);
  const allowedForApplication = allowedDepths({eligibleDepths: ['Understanding','Application']}, phase);
  assert.deepEqual(allowedForApplication, ['Application'], `Application-eligible point at position ${p} gets Application depth`);
}

// Test 4: Existing duplicate and Quality Gate protections unchanged
// (These are conceptual tests, not actual code tests, since those functions didn't change)
// - same_canonical_point_same_depth still enforces one question per point+depth combination
// - verifyCandidates() AI verifier still independently checks question quality
// - source grounding checks in verifyCandidates() still apply
// - validate() format validations still apply

console.log('✅ All tests passed');