/**
 * What a learner *is* — enrolled, graduated, gone.
 *
 * ## Why this is stored rather than computed
 *
 * The obvious implementation is a function over `enrollment_terms`, and it does not work. A
 * learner who graduated Grade 10 and a learner who left after Grade 10 with the same passing
 * marks produce **identical rows**. The only difference between them is the absence of a later
 * term, and absence is also what a learner who simply has not been encoded yet looks like.
 *
 * So the column holds a decision a person made, and everything here only ever *suggests* one.
 * That distinction is the whole design: a diploma is printed against this value, and a guess
 * dressed up as a fact is how the wrong learner gets a diploma.
 *
 * `null` means nobody has confirmed it yet. It is the starting state for every learner already
 * in the database, deliberately — see migration 5, which adds the column and backfills nothing.
 */

/**
 * The categories, as stored.
 *
 * Slugs rather than display text: the labels below are for reading, and a school that renames
 * "Left School" tomorrow should not need a migration.
 */
export const STUDENT_STATUSES = [
  "enrolled",
  "jhs_graduate",
  "shs_graduate",
  "transferred_out",
  "left_school",
  "old_curriculum",
] as const;

export type StudentStatus = (typeof STUDENT_STATUSES)[number];

export const STATUS_LABELS: Record<StudentStatus, string> = {
  enrolled: "Enrolled",
  jhs_graduate: "JHS Graduate",
  shs_graduate: "SHS Graduate",
  transferred_out: "Transferred Out",
  left_school: "Left School",
  old_curriculum: "Old Curriculum",
};

/** Reading a value back out of the database, which is `TEXT` and could be anything. */
export function isStudentStatus(value: unknown): value is StudentStatus {
  return typeof value === "string" && (STUDENT_STATUSES as readonly string[]).includes(value);
}

/** The label for a stored value, tolerant of a null or an unrecognised one. */
export function statusLabel(value: unknown): string | null {
  return isStudentStatus(value) ? STATUS_LABELS[value] : null;
}

/** Structural, like the helpers in lib/grading.ts, so this module imports no database types. */
interface StatusTerm {
  level: number;
  semester: number | null;
  curriculum: string | null;
  promotion_remark: string | null;
  general_average: number | null;
}

const PASSING_GRADE = 75;

/**
 * Did this term end in the learner moving on?
 *
 * Three sources, in order of authority:
 *
 *  1. `promotion_remark` as the source document carried it. "CONDITIONALLY PROMOTED" counts as
 *     promoted — the learner did advance, and the condition is not this system's business.
 *     "RETAINED" does not match, which is the point of testing for the word rather than for
 *     emptiness.
 *  2. The general average, for records encoded in the app, where the remark is often blank.
 *  3. Neither, in which case the answer is **null, not false**. "We cannot tell" and "did not
 *     pass" are different, and only the first should stop us suggesting anything at all.
 */
function completed(term: StatusTerm): boolean | null {
  if (term.promotion_remark && term.promotion_remark.trim() !== "") {
    return /promot/i.test(term.promotion_remark);
  }
  if (term.general_average != null) return term.general_average >= PASSING_GRADE;
  return null;
}

/**
 * A starting point for the registrar, never an answer.
 *
 * Returns null when there is nothing worth suggesting — no terms at all, or a final term whose
 * outcome cannot be read. The caller shows this beside an Accept button; nothing applies it on
 * the learner's behalf.
 *
 * **This can never return `transferred_out` or `left_school`, and no amount of work on it
 * will change that.** Nothing in `enrollment_terms` records *why* a learner stopped appearing —
 * a transfer, a dropout and an unfinished encoding are the same absent row. Those two values
 * exist precisely because only a person knows which happened.
 */
export function suggestStudentStatus(
  terms: StatusTerm[],
  student: { shs_semesters?: number | null },
): StudentStatus | null {
  if (terms.length === 0) return null;

  // Form 137 records are pre-K-12 and archive-only. Their own completion is a separate
  // question this system cannot answer - see the diploma gate, which excludes them.
  if (terms.some((t) => t.curriculum === "old")) return "old_curriculum";

  // getTerms() already orders by level then semester, but a caller could pass anything.
  const sorted = [...terms].sort(
    (a, b) => a.level - b.level || (a.semester ?? 0) - (b.semester ?? 0),
  );
  const furthest = sorted[sorted.length - 1];
  const finished = completed(furthest);

  // Cannot read the outcome of the last term, so cannot tell "graduated" from "still going".
  if (finished === null) return null;
  if (!finished) return "enrolled";

  // SHS: the programme ends at Grade 12's last semester, which is 2 under the three-semester
  // scheme and 2 under the four-semester one - both end on a second semester, so the count
  // only matters for knowing whether a Grade 12 1st Semester learner is finished. They are not.
  if (furthest.level === 12 && furthest.semester === 2) return "shs_graduate";

  // JHS ends at Grade 10, but only for a learner who did not go on to SHS here. Someone with
  // any Grade 11-12 term completed JHS on the way through and is not a "JHS Graduate" today.
  if (furthest.level === 10 && !sorted.some((t) => t.level >= 11)) return "jhs_graduate";

  return "enrolled";
}
