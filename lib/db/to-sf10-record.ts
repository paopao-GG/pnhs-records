/**
 * Bridges stored rows into the `Sf10Record` shape the exporter already understands.
 *
 * Note what is deliberately NOT carried across: computed final ratings and general averages.
 * Those are formulas owned by the SF10 template. The only exception is JHS Homeroom Guidance
 * and CAT, which have no formula in the template - `lib/sf10/export.ts` writes those, and
 * only those, from `subject.finalRating`.
 */

import type { Sf10Record, SubjectRecord, TermRecord, Sex } from "../sf10/types.ts";
import type { ShsCategory } from "../sf10/shs-map.ts";
import { gradingPeriods, shsSemesters } from "../grading.ts";
import {
  getEligibility,
  getStudent,
  getSubjectsForStudent,
  getTerms,
  type StudentRow,
  type SubjectRow,
  type TermRow,
} from "./queries.ts";

const nullToUndefined = <T>(v: T | null | undefined): T | undefined => v ?? undefined;

function toSubject(row: {
  subject_name: string;
  category: ShsCategory | null;
  q1: number | null;
  q2: number | null;
  q3: number | null;
  q4: number | null;
  final_rating: number | null;
  remarks: string | null;
}): SubjectRecord {
  return {
    name: row.subject_name,
    category: nullToUndefined(row.category),
    q1: nullToUndefined(row.q1),
    q2: nullToUndefined(row.q2),
    q3: nullToUndefined(row.q3),
    q4: nullToUndefined(row.q4),
    finalRating: nullToUndefined(row.final_rating),
    remarks: nullToUndefined(row.remarks),
  };
}

function toTerm(row: TermRow, subjects: SubjectRow[]): TermRecord {
  return {
    level: row.level as TermRecord["level"],
    semester: nullToUndefined(row.semester) as 1 | 2 | undefined,
    schoolYear: nullToUndefined(row.school_year),
    section: nullToUndefined(row.section),
    adviser: nullToUndefined(row.adviser),
    trackStrand: nullToUndefined(row.track_strand),
    schoolName: nullToUndefined(row.school_name),
    schoolId: nullToUndefined(row.school_id),
    district: nullToUndefined(row.district),
    division: nullToUndefined(row.division),
    region: nullToUndefined(row.region),
    promotionRemark: nullToUndefined(row.promotion_remark),
    // Resolved here rather than passed through raw, so the exporter never has to know what a
    // null means. See gradingPeriods() in lib/grading.ts.
    gradingPeriods: gradingPeriods(row),
    subjects: subjects.map(toSubject),
  };
}

function toStudent(row: StudentRow) {
  return {
    lrn: row.lrn,
    lastName: row.last_name,
    firstName: row.first_name,
    middleName: nullToUndefined(row.middle_name),
    nameExt: nullToUndefined(row.name_ext),
    sex: nullToUndefined(row.sex) as Sex | undefined,
    birthdate: nullToUndefined(row.birthdate),
  };
}

/**
 * Build the record for one printed form. Terms are filtered to that form's grade levels so
 * printing the JHS sheet for a Grade 12 student cannot leak SHS terms onto it.
 */
export async function buildSf10Record(
  studentId: number,
  form: "jhs" | "shs",
  levels?: number[],
): Promise<Sf10Record | null> {
  const student = await getStudent(studentId);
  if (!student) return null;

  // The form filter is a hard boundary — a JHS sheet can never carry Grade 11. `levels` narrows
  // within that, so a registrar can reissue just Grade 9 without the other years appearing.
  const wanted = levels && levels.length > 0 ? new Set(levels) : null;

  // One query for every subject the learner has, rather than one per term. See
  // getSubjectsForStudent() - each of those was a network round trip on the print path.
  const [allTerms, subjectsByTerm] = await Promise.all([
    getTerms(studentId),
    getSubjectsForStudent(studentId),
  ]);

  const terms = allTerms
    /*
     * Old-curriculum terms can never go on an SF10.
     *
     * Form 137 reuses levels 7-10 for First-Fourth Year, so a level filter alone would let a
     * 1995 record onto a 2017 DepEd form. The UI already hides the button, but this is the
     * guard that matters: the print endpoint is reachable by URL, and hiding a control is not
     * the same as refusing the action.
     */
    .filter((t) => (t.curriculum ?? "k12") !== "old")
    .filter((t) => (form === "jhs" ? t.level <= 10 : t.level >= 11))
    .filter((t) => !wanted || wanted.has(t.level))
    .map((t) => toTerm(t, subjectsByTerm.get(t.id) ?? []));

  const el = await getEligibility(studentId, form);

  const record: Sf10Record = {
    student: toStudent(student),
    terms,
    shsSemesters: shsSemesters(student),
  };

  if (el && form === "jhs") {
    record.jhsEligibility = {
      elemSchoolName: nullToUndefined(el.elem_school_name as string),
      elemSchoolId: nullToUndefined(el.elem_school_id as string),
      elemSchoolAddress: nullToUndefined(el.elem_school_address as string),
      elemGeneralAverage: nullToUndefined(el.elem_general_average as number),
      citation: nullToUndefined(el.citation as string),
      peptRating: nullToUndefined(el.pept_rating as string),
      alsRating: nullToUndefined(el.als_rating as string),
      otherCredential: nullToUndefined(el.other_credential as string),
      examDate: nullToUndefined(el.exam_date as string),
      testingCenter: nullToUndefined(el.testing_center as string),
    };
  }

  if (el && form === "shs") {
    record.shsEligibility = {
      shsAdmissionDate: nullToUndefined(el.shs_admission_date as string),
      jhsCompleterGenAve: nullToUndefined(el.jhs_completer_gen_ave as number),
      hsCompleterGenAve: nullToUndefined(el.hs_completer_gen_ave as number),
      graduationDate: nullToUndefined(el.graduation_date as string),
      prevSchoolName: nullToUndefined(el.prev_school_name as string),
      prevSchoolAddress: nullToUndefined(el.prev_school_address as string),
      peptRating: nullToUndefined(el.pept_rating as string),
      alsRating: nullToUndefined(el.als_rating as string),
      otherCredential: nullToUndefined(el.other_credential as string),
      examDate: nullToUndefined(el.exam_date as string),
      clcNameAddress: nullToUndefined(el.clc_name_address as string),
    };
  }

  return record;
}
