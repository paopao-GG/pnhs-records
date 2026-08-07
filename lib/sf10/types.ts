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
  lastName: string;
  firstName: string;
  middleName?: string;
  nameExt?: string;
  sex?: Sex;
  /** As printed on the form, mm/dd/yyyy. */
  birthdate?: string;
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
  /** JHS writes this literal ("Passed"); SHS computes it with a formula. */
  remarks?: string;
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
}

export function fullName(s: StudentIdentity): string {
  return [s.lastName, [s.firstName, s.middleName, s.nameExt].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
}
