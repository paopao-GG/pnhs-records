/**
 * Builds one term's report card from stored rows.
 *
 * The SF9 is a **presentation of grades this system already holds**, not a second source of
 * truth. Nothing here writes, and nothing needs a new table: `grading_periods = 3` and the
 * form's TERM 1/2/3 are the same concept, confirmed in `import-jhs.ts` (which sets three when
 * the source form's fourth-quarter header is blank) and `export.ts` (which already drops the
 * fourth column for such a term).
 *
 * Two transformations happen here and nowhere near storage:
 *
 *  - **The four MAPEH components collapse into the form's two rows.** See `combineMapeh()`.
 *  - **Subjects are matched by name.** `swapSubjectOrder()` lets a registrar reorder
 *    `term_subjects`, so an ordinal would print Science's marks on the Filipino line.
 */

import {
  MAPEH_COMPONENTS,
  SF9_SUBJECT_KEYS,
  SF9_SUBJECT_SOURCE,
  type Sf9SubjectKey,
} from "../sf10/sf9-map.ts";
import { exactFinalRating, generalAverage, gradingPeriods, jhsRemark } from "../grading.ts";
import { getStudent, getSubjectsForStudent, getTerms, type SubjectRow, type TermRow } from "./queries.ts";

/** The three printed columns, plus what the row totals to. */
export interface Sf9SubjectRow {
  terms: [number | null, number | null, number | null];
  final: number | null;
  remarks: string | null;
}

export interface Sf9Record {
  learner: {
    name: string;
    lrn: string | null;
    age: number | null;
    sex: string | null;
    grade: number;
    section: string | null;
    schoolYear: string | null;
  };
  subjects: Record<Sf9SubjectKey, Sf9SubjectRow>;
  generalAverage: number | null;
}

/** `SANTOS, Maria Clara` — surname first, as every DepEd form prints it. */
function learnerName(s: {
  last_name: string;
  first_name: string;
  middle_name: string | null;
  name_ext: string | null;
}): string {
  const given = [s.first_name, s.middle_name, s.name_ext].filter(Boolean).join(" ");
  return `${s.last_name}, ${given}`;
}

/**
 * Age at the start of the school year, or null when either date is unusable.
 *
 * From the school year rather than today: a card reissued in 2030 for a 2026 term should say
 * how old the learner was then, not now.
 */
function ageAt(birthdate: string | null, schoolYear: string | null): number | null {
  if (!birthdate || !schoolYear) return null;
  const born = new Date(birthdate);
  const startYear = Number(/^(\d{4})/.exec(schoolYear)?.[1]);
  if (Number.isNaN(born.getTime()) || !Number.isFinite(startYear)) return null;
  // June, when a Philippine school year opens.
  const age = startYear - born.getFullYear() - (born.getMonth() > 5 ? 1 : 0);
  return age >= 0 && age < 120 ? age : null;
}

function averageOf(values: (number | null | undefined)[]): number | null {
  const nums = values.filter((v): v is number => typeof v === "number" && !Number.isNaN(v));
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

/**
 * The form's two MAPEH rows, from the four components the SF10 records.
 *
 * **This averaging is an assumption.** No DepEd rule and nothing else in this project
 * establishes that "Music and Arts" is the mean of Music and Arts; it is the obvious reading of
 * a form that prints two figures where the record holds four. It should be checked against a
 * real filled SF9 before the school relies on it — see the note in the README.
 *
 * The stored `MAPEH` row is a fifth, separately encoded figure and is printed on its own line
 * unchanged; it cannot produce the two split values.
 *
 * A component with no mark contributes nothing rather than counting as zero, so a half-encoded
 * term shows the marks it has instead of a wrong average.
 */
function combineMapeh(
  byName: Map<string, SubjectRow>,
  key: "musicArts" | "peHealth",
  fields: readonly ("q1" | "q2" | "q3" | "q4")[],
): Sf9SubjectRow {
  const parts = MAPEH_COMPONENTS[key]
    .map((name) => byName.get(name))
    .filter((row): row is SubjectRow => row !== undefined);

  const terms = [0, 1, 2].map((i) => {
    const field = fields[i];
    if (!field) return null;
    const combined = averageOf(parts.map((p) => p[field]));
    return combined === null ? null : Math.round(combined);
  }) as [number | null, number | null, number | null];

  const final = averageOf(terms);
  const rounded = final === null ? null : Math.round(final);
  return { terms, final: rounded, remarks: jhsRemark(rounded) };
}

/**
 * The quarters a term actually uses, as `exactFinalRating` wants them.
 *
 * **Not the whole row.** `exactFinalRating()` averages every quarter it is given and knows
 * nothing about the term's period count, so handing it a `SubjectRow` averages four columns
 * even on a three-period term - which is exactly wrong for a term switched from four to three,
 * where the fourth-quarter marks are deliberately kept but must stop counting.
 */
function usedQuarters(
  row: SubjectRow,
  fields: readonly ("q1" | "q2" | "q3" | "q4")[],
): { q1?: number | null; q2?: number | null; q3?: number | null; q4?: number | null } {
  const out: Record<string, number | null> = {};
  for (const field of fields) out[field] = row[field];
  return out;
}

function subjectRow(
  row: SubjectRow | undefined,
  fields: readonly ("q1" | "q2" | "q3" | "q4")[],
): Sf9SubjectRow {
  if (!row) return { terms: [null, null, null], final: null, remarks: null };

  const terms = [0, 1, 2].map((i) => {
    const field = fields[i];
    return field ? (row[field] ?? null) : null;
  }) as [number | null, number | null, number | null];

  // The card shows a whole number, as the SF10 template does.
  const exact = exactFinalRating(usedQuarters(row, fields), "jhs");
  const final = exact === null ? null : Math.round(exact);
  return { terms, final, remarks: jhsRemark(final) };
}

/**
 * The term a report card is for.
 *
 * Only three-period JHS terms qualify: the form has three TERM columns and no defined layout
 * for a fourth, so a four-quarter term would print with a quarter silently missing.
 */
export function sf9Terms(terms: TermRow[]): TermRow[] {
  return terms.filter(
    (t) => t.level <= 10 && (t.curriculum ?? "k12") !== "old" && gradingPeriods(t) === 3,
  );
}

/** Null when the learner has no term the SF9 can represent. */
export async function buildSf9Record(studentId: number, level?: number): Promise<Sf9Record | null> {
  const student = await getStudent(studentId);
  if (!student) return null;

  const eligible = sf9Terms(await getTerms(studentId));
  const term = level === undefined ? eligible[eligible.length - 1] : eligible.find((t) => t.level === level);
  if (!term) return null;

  const subjects = (await getSubjectsForStudent(studentId)).get(term.id) ?? [];
  const byName = new Map(subjects.map((s) => [s.subject_name, s]));

  // Three, because sf9Terms() has already established this is a three-period term.
  const fields = ["q1", "q2", "q3"] as const;

  const rows = {} as Record<Sf9SubjectKey, Sf9SubjectRow>;
  for (const key of SF9_SUBJECT_KEYS) {
    const source = SF9_SUBJECT_SOURCE[key];
    rows[key] =
      source === null
        ? combineMapeh(byName, key as "musicArts" | "peHealth", fields)
        : subjectRow(byName.get(source), fields);
  }

  /*
   * The general average comes from the SAME eight subjects the SF10 counts, in that order -
   * not from the ten rows this form prints. Averaging the printed rows would count MAPEH three
   * times over (the parent row plus its two combined children) and disagree with the permanent
   * record for the same term.
   */
  const eightFinals = [
    "filipino",
    "english",
    "mathematics",
    "science",
    "ap",
    "values",
    "tle",
    "mapeh",
  ].map((key) => {
    const source = SF9_SUBJECT_SOURCE[key as Sf9SubjectKey];
    const row = source ? byName.get(source) : undefined;
    // Same restriction as above: a fourth quarter that is kept but not counted must not creep
    // into the general average either.
    return row ? exactFinalRating(usedQuarters(row, fields), "jhs") : null;
  });

  return {
    learner: {
      name: learnerName(student),
      lrn: student.lrn_placeholder ? null : student.lrn,
      age: ageAt(student.birthdate, term.school_year),
      sex: student.sex,
      grade: term.level,
      section: term.section,
      schoolYear: term.school_year,
    },
    subjects: rows,
    generalAverage: term.general_average ?? generalAverage(eightFinals, "jhs"),
  };
}
