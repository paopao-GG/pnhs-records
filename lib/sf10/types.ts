/**
 * Shape of one student's SF10 record.
 *
 * These types are the contract between the database, the importer and the exporter.
 * They deliberately omit every value the template computes for itself (final ratings,
 * general averages, PASSED/FAILED), because those are Excel formulas we must not overwrite.
 */

import type { ShsCategory } from "./shs-map.ts";

export type Sex = "M" | "F";

export interface StudentIdentity {
  lrn: string;
  /**
   * True when `lrn` is a generated marker rather than the learner's real number.
   *
   * Form 137 records predate the LRN system entirely. The UI must show "No LRN" rather than
   * this value, or a number we invented could be quoted as an identifier.
   */
  lrnPlaceholder?: boolean;
  lastName: string;
  firstName: string;
  middleName?: string;
  nameExt?: string;
  sex?: Sex;
  /** As printed on the form, mm/dd/yyyy. */
  birthdate?: string;

  // Form 137 records these; the SF10 does not.
  birthplaceProvince?: string;
  birthplaceTown?: string;
  birthplaceBarrio?: string;
  guardianName?: string;
  guardianOccupation?: string;
  guardianAddress?: string;
}

export interface SubjectRecord {
  name: string;
  /** SHS only - drives the template's CORE / APPLIED / SPECIALIZED column. */
  category?: ShsCategory;
  q1?: number;
  q2?: number;
  /** JHS only; SHS semesters have two quarters. */
  q3?: number;
  q4?: number;
  /**
   * Only for subject rows the template does NOT compute - on JHS that is Homeroom Guidance
   * and CAT, which have no AVERAGE formula. Ignored for every other row, where writing it
   * would clobber the template's formula.
   */
  finalRating?: number;
  /** JHS writes this literal ("Passed"); SHS computes it with a formula. Form 137: Action Taken. */
  remarks?: string;
  /** Form 137 only — the old curriculum credited units per subject. */
  unitsEarned?: number;
  /** Form 137 only. */
  extraCurricular?: string;
}

export interface SchoolInfo {
  schoolName?: string;
  schoolId?: string;
  district?: string;
  division?: string;
  region?: string;
}

export interface TermRecord extends SchoolInfo {
  level: 7 | 8 | 9 | 10 | 11 | 12;
  /** SHS only. */
  semester?: 1 | 2;
  schoolYear?: string;
  section?: string;
  adviser?: string;
  /** SHS only. */
  trackStrand?: string;
  subjects: SubjectRecord[];
  /** JHS writes this literal ("Promoted"); on SHS it is the REMARKS line. */
  promotionRemark?: string;
  /**
   * The general average as the source form carried it. Read on import, never written back -
   * the template computes this cell itself. Absent for records created in the app.
   */
  generalAverage?: number;
  /**
   * `old` for Form 137's First-Fourth Year, `k12` (the default) for Grade 7-12.
   *
   * Load-bearing: levels 7-10 are reused for the old curriculum so existing queries work, so
   * this is the only thing stopping a 1995 record being offered a modern SF10 print.
   */
  curriculum?: "k12" | "old";
  /** How the source document names this year, e.g. "First Year". */
  yearLabel?: string;
  /**
   * Quarter columns this term is graded over — 3 under the scheme that starts SY 2026-2027,
   * 4 before it, 2 for an SHS semester.
   *
   * Absent means the historical default for the level. On import it is read from the form's own
   * quarter-header row rather than from which quarters happen to be filled, because a
   * four-quarter record encoded in November has an empty Q4 too.
   */
  gradingPeriods?: number;
}

export interface JhsEligibility {
  elemGeneralAverage?: number | string;
  citation?: string;
  elemSchoolName?: string;
  elemSchoolId?: string;
  elemSchoolAddress?: string;
  peptRating?: string;
  alsRating?: string;
  otherCredential?: string;
  examDate?: string;
  testingCenter?: string;
}

export interface ShsEligibility {
  /** Printed in the learner-information block, not the eligibility block. */
  shsAdmissionDate?: string;
  hsCompleterGenAve?: number | string;
  jhsCompleterGenAve?: number | string;
  graduationDate?: string;
  prevSchoolName?: string;
  prevSchoolAddress?: string;
  peptRating?: string;
  alsRating?: string;
  otherCredential?: string;
  examDate?: string;
  clcNameAddress?: string;
}

export interface Sf10Record {
  student: StudentIdentity;
  jhsEligibility?: JhsEligibility;
  shsEligibility?: ShsEligibility;
  terms: TermRecord[];
  /**
   * Semesters in the learner's SHS programme: 3 under the new scheme, 4 before it.
   *
   * Absent means four. On the printed form this decides whether the unused fourth semester
   * block is cleared or left as an empty section — it cannot be inferred from the terms
   * present, because a Grade 11 learner mid-programme also has no fourth semester.
   */
  shsSemesters?: number;
}

export function fullName(s: StudentIdentity): string {
  return [s.lastName, [s.firstName, s.middleName, s.nameExt].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
}
