/*
 * test_ratio_split.js
 *
 * Tests static/ratio_split.js -- the Total <-> {PCL, Agent} write-back math
 * used by the table's inline-edit and "apply operation" features.
 *
 * Run: node tests/test_ratio_split.js
 * Plain Node assertions, no dependencies, exits non-zero on failure.
 */

const assert = require('assert');
const { computeOverrides, COMPONENT_A, COMPONENT_B, TOTAL_METRIC } =
  require('../static/ratio_split.js');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  - ${name}`);
    passed++;
  } catch (err) {
    console.error(`FAIL  - ${name}`);
    console.error(`        ${err.message}`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Editing PCL or Agent directly: only that component's override is set.
// ---------------------------------------------------------------------------

test('editing PCL directly sets overrideA only', () => {
  const row = { value: 1000, fc_a: 1000, fc_b: 500, original: 1500, orig_a: 1000, orig_b: 500 };
  const { overrideA, overrideB } = computeOverrides(row, 1200, COMPONENT_A);
  assert.strictEqual(overrideA, 1200);
  assert.strictEqual(overrideB, undefined);
});

test('editing Agent directly sets overrideB only', () => {
  const row = { value: 1500, fc_a: 1000, fc_b: 500, original: 1500, orig_a: 1000, orig_b: 500 };
  const { overrideA, overrideB } = computeOverrides(row, 700, COMPONENT_B);
  assert.strictEqual(overrideA, undefined);
  assert.strictEqual(overrideB, 700);
});

// ---------------------------------------------------------------------------
// Editing Total: scale both components by ratio = newTotal / oldTotal,
// preserving the current PCL:Agent mix.
// ---------------------------------------------------------------------------

test('editing Total scales both components by the same ratio', () => {
  // Current Total = 1500 (fc_a=1000, fc_b=500, i.e. a 2:1 mix).
  // User edits Total to 3000 -> ratio = 2.
  const row = { value: 1500, fc_a: 1000, fc_b: 500, original: 1500, orig_a: 1000, orig_b: 500 };
  const { overrideA, overrideB } = computeOverrides(row, 3000, TOTAL_METRIC);

  assert.ok(Math.abs(overrideA - 2000) < 1e-9, `overrideA=${overrideA}, expected 2000`);
  assert.ok(Math.abs(overrideB - 1000) < 1e-9, `overrideB=${overrideB}, expected 1000`);

  // The 2:1 mix is preserved, and the components sum back to the new total.
  assert.ok(Math.abs((overrideA + overrideB) - 3000) < 1e-9);
  assert.ok(Math.abs(overrideA / overrideB - row.fc_a / row.fc_b) < 1e-9);
});

test('editing Total down scales both components down by the same ratio', () => {
  // Current Total = 1000 (fc_a=700, fc_b=300, a 70:30 mix). Edit to 800 -> ratio = 0.8.
  const row = { value: 1000, fc_a: 700, fc_b: 300, original: 1000, orig_a: 700, orig_b: 300 };
  const { overrideA, overrideB } = computeOverrides(row, 800, TOTAL_METRIC);

  assert.ok(Math.abs(overrideA - 560) < 1e-9, `overrideA=${overrideA}, expected 560`);
  assert.ok(Math.abs(overrideB - 240) < 1e-9, `overrideB=${overrideB}, expected 240`);
  assert.ok(Math.abs((overrideA + overrideB) - 800) < 1e-9);
});

test('a small percentage change to Total applies that same percentage to both components', () => {
  // +20% on Total (1500 -> 1800) should mean +20% on each component too.
  const row = { value: 1500, fc_a: 900, fc_b: 600, original: 1500, orig_a: 900, orig_b: 600 };
  const { overrideA, overrideB } = computeOverrides(row, 1800, TOTAL_METRIC);

  assert.ok(Math.abs(overrideA - 1080) < 1e-9, `overrideA=${overrideA}, expected 1080 (900*1.2)`);
  assert.ok(Math.abs(overrideB - 720) < 1e-9, `overrideB=${overrideB}, expected 720 (600*1.2)`);
});

test('editing Total when oldTotal is 0 falls back to a 50/50 split of the delta', () => {
  const row = { value: 0, fc_a: 0, fc_b: 0, original: 0, orig_a: 0, orig_b: 0 };
  const { overrideA, overrideB } = computeOverrides(row, 1000, TOTAL_METRIC);

  assert.ok(Math.abs(overrideA - 500) < 1e-9, `overrideA=${overrideA}, expected 500`);
  assert.ok(Math.abs(overrideB - 500) < 1e-9, `overrideB=${overrideB}, expected 500`);
  assert.ok(Math.abs((overrideA + overrideB) - 1000) < 1e-9);
});

// ---------------------------------------------------------------------------
// fromOriginal: applyOp() always scales from the row's pristine values, so
// re-running an operation on an already-edited week REPLACES the prior
// edit instead of compounding on top of it.
// ---------------------------------------------------------------------------

test('fromOriginal scales from row.original/orig_a/orig_b, ignoring prior overrides', () => {
  // row.value/fc_a/fc_b reflect a PREVIOUS edit (e.g. user already bumped
  // this week once). row.original/orig_a/orig_b are the pristine server
  // values from before any edits.
  const row = {
    value: 2250, fc_a: 1500, fc_b: 750,        // already-edited current state
    original: 1500, orig_a: 1000, orig_b: 500, // pristine
  };

  // Apply a fresh +50% operation. With fromOriginal=true this should act on
  // the PRISTINE total (1500 -> 2250), not the already-edited one (2250 -> 3375).
  const { overrideA, overrideB } = computeOverrides(row, 2250, TOTAL_METRIC, true);

  assert.ok(Math.abs(overrideA - 1500) < 1e-9, `overrideA=${overrideA}, expected 1500 (1000*1.5)`);
  assert.ok(Math.abs(overrideB - 750) < 1e-9, `overrideB=${overrideB}, expected 750 (500*1.5)`);
  assert.ok(Math.abs((overrideA + overrideB) - 2250) < 1e-9);
});

test('two consecutive +50% applyOp-style calls produce the same result as one (replace, not compound)', () => {
  // Simulates: select week, apply +50%, then apply +50% again without
  // reselecting. Both calls use fromOriginal=true and the SAME pristine
  // baseline (original/orig_a/orig_b never change), so the second call
  // should produce an identical result to the first -- not 1.5x of 1.5x.
  const pristine = { original: 1000, orig_a: 600, orig_b: 400 };

  const target = pristine.original * 1.5; // +50% of the pristine total = 1500

  const first = computeOverrides({ ...pristine, value: 1000, fc_a: 600, fc_b: 400 }, target, TOTAL_METRIC, true);
  // After "applying", row.value/fc_a/fc_b would be updated to first's results --
  // but a second +50% applyOp call still targets pristine.original * 1.5,
  // and still reads orig_a/orig_b (unchanged), so:
  const second = computeOverrides({ ...pristine, value: first.overrideA + first.overrideB, fc_a: first.overrideA, fc_b: first.overrideB }, target, TOTAL_METRIC, true);

  assert.ok(Math.abs(first.overrideA - second.overrideA) < 1e-9, 'repeated +50% should not compound');
  assert.ok(Math.abs(first.overrideB - second.overrideB) < 1e-9, 'repeated +50% should not compound');
  assert.ok(Math.abs(first.overrideA - 900) < 1e-9, `expected 900 (600*1.5), got ${first.overrideA}`);
  assert.ok(Math.abs(first.overrideB - 600) < 1e-9, `expected 600 (400*1.5), got ${first.overrideB}`);
});

// ---------------------------------------------------------------------------
// Unknown metric: no-op (defensive default, shouldn't happen in practice
// since the UI only ever passes PCL/Agent/Total).
// ---------------------------------------------------------------------------

test('an unrecognized metric returns no overrides', () => {
  const row = { value: 1000, fc_a: 600, fc_b: 400, original: 1000, orig_a: 600, orig_b: 400 };
  const { overrideA, overrideB } = computeOverrides(row, 1234, 'Some.Other.Metric');
  assert.strictEqual(overrideA, undefined);
  assert.strictEqual(overrideB, undefined);
});

console.log(`\n${passed} passed${process.exitCode ? ', some FAILED' : ''}`);
