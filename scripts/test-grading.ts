/**
 * Checks lib/grading.ts against the arithmetic the SF10 templates perform themselves.
 *
 * The templates compute finals with ROUND(AVERAGE(...), 0) and decide PASSED/FAILED at 75.
 * If this file and the spreadsheet ever disagree, the screen would show one number and the
 * printed permanent record another - so these cases are pinned.
 *
 * Run: npm test
 */

import { strict as assert } from "node:assert";
import {
  finalRating,
  generalAverage,
  isPassing,
  jhsRemark,
  promotionRemark,
  shsActionTaken,
} from "../lib/grading.ts";

let passed = 0;
const check = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
};

check("JHS final averages four quarters", () => {
  assert.equal(finalRating({ q1: 88, q2: 90, q3: 85, q4: 87 }, "jhs"), 88); // 87.5 -> 88
  assert.equal(finalRating({ q1: 90, q2: 90, q3: 90, q4: 90 }, "jhs"), 90);
});

check("SHS final averages two quarters", () => {
  assert.equal(finalRating({ q1: 86, q2: 89 }, "shs"), 88); // 87.5 -> 88
  assert.equal(finalRating({ q1: 90, q2: 91 }, "shs"), 91); // 90.5 -> 91
});

check("rounding is half-away-from-zero, matching Excel ROUND", () => {
  assert.equal(finalRating({ q1: 84, q2: 85, q3: 84, q4: 85 }, "jhs"), 85); // 84.5 -> 85
  assert.equal(finalRating({ q1: 83, q2: 84, q3: 83, q4: 84 }, "jhs"), 84); // 83.5 -> 84
});

check("a subject with no encoded quarter has no final", () => {
  assert.equal(finalRating({}, "jhs"), null);
  assert.equal(finalRating({ q1: null, q2: null, q3: null, q4: null }, "jhs"), null);
});

check("a partially encoded subject averages only what exists", () => {
  // Mid-year: two quarters in. Averaging over 4 would understate the learner's standing.
  assert.equal(finalRating({ q1: 90, q2: 92 }, "jhs"), 91);
});

check("general average ignores unencoded subjects", () => {
  assert.equal(generalAverage([90, 92, null, 88]), 90);
  assert.equal(generalAverage([null, null]), null);
});

check("75 is passing, 74 is not", () => {
  assert.equal(isPassing(75), true);
  assert.equal(isPassing(74), false);
  assert.equal(isPassing(null), null);
});

check("remarks use the casing each form prints", () => {
  assert.equal(jhsRemark(90), "Passed");
  assert.equal(jhsRemark(70), "Failed");
  assert.equal(shsActionTaken(90), "PASSED");
  assert.equal(shsActionTaken(70), "FAILED");
  assert.equal(promotionRemark(90, "jhs"), "Promoted");
  assert.equal(promotionRemark(90, "shs"), "PROMOTED");
  assert.equal(promotionRemark(70, "jhs"), "Retained");
});

check("an empty record produces no remark rather than a false one", () => {
  assert.equal(jhsRemark(null), null);
  assert.equal(promotionRemark(null, "jhs"), null);
});

console.log(
  process.exitCode
    ? "\ngrading: FAILURES above\n"
    : `\ngrading: ${passed} checks passed\n`,
);
