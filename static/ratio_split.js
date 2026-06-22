/*
 * ratio_split.js
 * ---------------
 * The Total.Del.Pcs.N <-> {PCL.Del.Pcs.N, Agent.Del.Pcs.N} write-back logic,
 * pulled out into its own file so it can be:
 *   - loaded by index.html for the live app, and
 *   - loaded by tests/test_ratio_split.js (Node, no browser) for unit tests.
 *
 * This file has NO dependency on the DOM, fetch, Chart.js, or any other
 * global from index.html -- it's pure data in, data out.
 */

const COMPONENT_A = "PCL.Del.Pcs.N";
const COMPONENT_B = "Agent.Del.Pcs.N";
const TOTAL_METRIC = "Total.Del.Pcs.N";

/**
 * Given the row being edited, the new value the user entered, and which
 * metric is currently selected, compute the resulting per-component
 * override values.
 *
 * - Editing PCL or Agent directly: only that component's override changes.
 * - Editing Total: both components are scaled by the same ratio,
 *   ratio = newTotal / oldTotal. This preserves whatever PCL:Agent split
 *   the forecast currently has -- a +20% edit to Total means +20% to both
 *   PCL and Agent, not a shift toward some other year's ratio.
 *
 *   ratio*curA + ratio*curB = ratio*(curA+curB) = ratio*oldTotal = newTotal,
 *   so the components always sum back to the edited total exactly.
 *
 *   If oldTotal is 0 (ratio undefined), falls back to a 50/50 split of the
 *   raw delta -- there's no existing mix to preserve in that case.
 *
 * @param {boolean} fromOriginal - if true, "old" values come from
 *   row.original/row.orig_a/row.orig_b (the pristine server forecast,
 *   ignoring any prior overrides on this row) rather than
 *   row.value/row.fc_a/row.fc_b (current, override-adjusted). Used by
 *   applyOp() so repeating an operation replaces a prior edit instead of
 *   compounding on top of it. Direct inline edits (one-off) use the
 *   current values (the default).
 *
 * @returns {overrideA, overrideB} -- either may be `undefined` if that
 *   component isn't affected by this edit.
 */
function computeOverrides(row, newValue, metric, fromOriginal) {
  if (metric === COMPONENT_A) {
    return { overrideA: newValue, overrideB: undefined };
  }
  if (metric === COMPONENT_B) {
    return { overrideA: undefined, overrideB: newValue };
  }
  if (metric === TOTAL_METRIC) {
    const oldTotal = fromOriginal ? row.original : row.value;
    const curA = (fromOriginal ? row.orig_a : row.fc_a);
    const curB = (fromOriginal ? row.orig_b : row.fc_b);
    const a = curA != null ? curA : 0;
    const b = curB != null ? curB : 0;

    if (oldTotal) {
      const ratio = newValue / oldTotal;
      return { overrideA: a * ratio, overrideB: b * ratio };
    }

    // oldTotal is 0 (or missing) -- no existing mix to scale, split 50/50
    const delta = newValue - (oldTotal || 0);
    return { overrideA: a + delta * 0.5, overrideB: b + delta * 0.5 };
  }
  return { overrideA: undefined, overrideB: undefined };
}

// Support both browser <script src> (globals) and Node require() (CommonJS).
if (typeof module !== "undefined" && module.exports) {
  module.exports = { computeOverrides, COMPONENT_A, COMPONENT_B, TOTAL_METRIC };
}
