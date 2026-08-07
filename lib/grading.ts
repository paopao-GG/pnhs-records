/**
 * DepEd grade computation, in one place, used by the record view and the edit grid.
 *
 * These rules mirror the formulas already embedded in the SF10 templates:
 *   JHS  final rating  = ROUND(AVERAGE(q1..q4), 0)
 *   SHS  semester final = ROUND(AVERAGE(q1, q2), 0)
 *   action taken        = grade >= 75 ? passed : failed
 *
 * Because the printed form recomputes all of this with its own formulas, every print is an
 * independent cross-check on this module. If the two ever disagree, this module is wrong.
 */

import { JHS_GENERAL_AVERAGE_SUBJECT_ROWS } from "./sf10/jhs-map.ts";

export const PASSING_GRADE = 75;

/**
 * Excel's ROUND is half-away-from-zero; JavaScript's Math.round is half-up, which differs
 * for negatives. Grades are never negative, but matching Excel exactly keeps the printed
 * form and the screen in agreement without a special case to remember later.
 */
function excelRound(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n));
}

function average(values: number[]): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export interface QuarterGrades {
  q1?: number | null;
  q2?: number | null;
  q3?: number | null;
  q4?: number | null;
}

/**
 * Final rating for one subject, as the form displays it.
 *
 * Returns null when no quarter has been encoded yet, so a half-filled record shows blanks
 * rather than a misleading number. JHS averages four quarters, SHS two.
 *
 * Both templates display this as a whole number (`numFmt 0` on JHS, an explicit `ROUND(...,0)`
 * on SHS), so rounding here matches what prints in both cases.
 */
export function finalRating(g: QuarterGrades, level: "jhs" | "shs"): number | null {
  const exact = exactFinalRating(g, level);
  return exact === null ? null : excelRound(exact);
}

/**
 * The unrounded final rating.
 *
 * JHS needs this: its template stores `AVERAGE(U,Y,AC,AG)` with no ROUND, and the general
 * average is computed from those *exact* values before being rounded once for display.
 * Rounding twice shifts the result.
 */
export function exactFinalRating(g: QuarterGrades, level: "jhs" | "shs"): number | null {
  const quarters = level === "jhs" ? [g.q1, g.q2, g.q3, g.q4] : [g.q1, g.q2];
  return average(quarters.filter((q): q is number => q != null));
}

/**
 * General average for a term, matching the template's own formula.
 *
 * **JHS counts only the first eight subjects** — see `JHS_GENERAL_AVERAGE_SUBJECT_ROWS` in
 * jhs-map.ts for why — and averages their *unrounded* finals. Averaging all thirteen rounded
 * finals instead disagreed with the school's real forms on 37 of 85 grade blocks.
 *
 * SHS averages every subject in the semester, which is what its template does.
 *
 * Pass exact finals from `exactFinalRating()`, not rounded ones.
 */
export function generalAverage(
  finals: (number | null | undefined)[],
  level: "jhs" | "shs" = "shs",
): number | null {
  const counted = level === "jhs" ? finals.slice(0, JHS_GENERAL_AVERAGE_SUBJECT_ROWS) : finals;
  const avg = average(counted.filter((f): f is number => f != null));
  return avg === null ? null : excelRound(avg);
}

export function isPassing(grade: number | null | undefined): boolean | null {
  if (grade == null) return null;
  return grade >= PASSING_GRADE;
}

/** JHS writes a literal remark into the form; SHS computes it with a formula. */
export function jhsRemark(grade: number | null | undefined): string | null {
  const passing = isPassing(grade);
  return passing === null ? null : passing ? "Passed" : "Failed";
}

export function shsActionTaken(grade: number | null | undefined): string | null {
  const passing = isPassing(grade);
  return passing === null ? null : passing ? "PASSED" : "FAILED";
}

export function promotionRemark(
  genAve: number | null | undefined,
  level: "jhs" | "shs",
): string | null {
  const passing = isPassing(genAve);
  if (passing === null) return null;
  if (level === "shs") return passing ? "PROMOTED" : "RETAINED";
  return passing ? "Promoted" : "Retained";
}
