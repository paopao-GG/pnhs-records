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
 * Final rating for one subject.
 *
 * Returns null when no quarter has been encoded yet, so a half-filled record shows blanks
 * rather than a misleading number. JHS averages four quarters, SHS two.
 */
export function finalRating(g: QuarterGrades, level: "jhs" | "shs"): number | null {
  const quarters = level === "jhs" ? [g.q1, g.q2, g.q3, g.q4] : [g.q1, g.q2];
  const avg = average(quarters.filter((q): q is number => q != null));
  return avg === null ? null : excelRound(avg);
}

/** Mean of the subject final ratings for a term. */
export function generalAverage(finals: (number | null | undefined)[]): number | null {
  const avg = average(finals.filter((f): f is number => f != null));
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
