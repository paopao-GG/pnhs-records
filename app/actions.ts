"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isAbsolute, join } from "node:path";
import {
  folderExists,
  importFolder,
  listSf10Files,
  type ImportSummary,
} from "@/lib/import/import-sf10.ts";
import {
  createStudent,
  createSubjects,
  createTerm,
  deleteStudent,
  getSchoolSettings,
  getStudent,
  resolveIssue,
  updateStudent,
  updateSubjectGrades,
  updateTerm,
} from "@/lib/db/queries.ts";
import { finalRating, generalAverage, jhsRemark, promotionRemark } from "@/lib/grading.ts";
import { jhsFinalRatingIsComputed, jhsLearningAreas } from "@/lib/sf10/jhs-map.ts";
import { shsSubjectsFor } from "@/lib/sf10/subject-templates.ts";

export interface SubjectEdit {
  id: number;
  q1: number | null;
  q2: number | null;
  q3: number | null;
  q4: number | null;
  /** Only meaningful for rows the SF10 template does not compute (JHS Homeroom Guidance, CAT). */
  finalRating: number | null;
}

export interface TermEdit {
  id: number;
  level: number;
  schoolYear: string | null;
  section: string | null;
  adviser: string | null;
  subjects: SubjectEdit[];
}

export interface RecordEdit {
  studentId: number;
  student: {
    lrn: string;
    lastName: string;
    firstName: string;
    middleName: string | null;
    nameExt: string | null;
    sex: string | null;
    birthdate: string | null;
  };
  terms: TermEdit[];
}

/**
 * Persists an edited record.
 *
 * Final ratings and promotion remarks are recomputed here rather than trusted from the
 * browser - the client display and the stored value must not be able to drift apart.
 */
export async function saveRecord(edit: RecordEdit): Promise<void> {
  updateStudent(edit.studentId, {
    lrn: edit.student.lrn.trim(),
    last_name: edit.student.lastName.trim().toUpperCase(),
    first_name: edit.student.firstName.trim().toUpperCase(),
    middle_name: edit.student.middleName?.trim().toUpperCase() || null,
    name_ext: edit.student.nameExt?.trim().toUpperCase() || null,
    sex: edit.student.sex || null,
    birthdate: edit.student.birthdate || null,
  });

  for (const term of edit.terms) {
    const isJhs = term.level <= 10;
    const finals: (number | null)[] = [];

    term.subjects.forEach((s, i) => {
      const computed = finalRating({ q1: s.q1, q2: s.q2, q3: s.q3, q4: s.q4 }, isJhs ? "jhs" : "shs");

      // The template owns the final rating everywhere it has an AVERAGE formula. The two
      // JHS rows that lack one (Homeroom Guidance, CAT) are stored instead.
      const storedFinal = isJhs && !jhsFinalRatingIsComputed(i) ? s.finalRating : null;
      const effective = storedFinal ?? computed;
      finals.push(effective);

      // JHS prints a literal Passed/Failed; SHS computes it with its own formula.
      updateSubjectGrades(
        s.id,
        { q1: s.q1, q2: s.q2, q3: s.q3, q4: s.q4 },
        storedFinal,
        isJhs ? jhsRemark(effective) : null,
      );
    });

    updateTerm(term.id, {
      section: term.section?.trim() || null,
      adviser: term.adviser?.trim() || null,
      school_year: term.schoolYear?.trim() || null,
      promotion_remark: promotionRemark(generalAverage(finals), isJhs ? "jhs" : "shs"),
    });
  }

  revalidatePath(`/students/${edit.studentId}`);
  revalidatePath("/");
}

/**
 * Permanently deletes a learner record.
 *
 * The typed LRN is re-checked here, not just in the browser: a server action is a public
 * endpoint, and this destroys a permanent academic record with no undo.
 */
export async function deleteRecord(studentId: number, confirmLrn: string): Promise<void> {
  const student = getStudent(studentId);
  if (!student) throw new Error("That learner record no longer exists.");

  if (confirmLrn.trim() !== student.lrn) {
    throw new Error("The LRN you typed does not match this learner's LRN.");
  }

  deleteStudent(studentId);

  revalidatePath("/");
  redirect("/?deleted=1");
}

export async function markIssueResolved(issueId: number): Promise<void> {
  resolveIssue(issueId);
  revalidatePath("/import/review");
  revalidatePath("/import");
}

export interface ScanResult {
  folder: string;
  exists: boolean;
  files: string[];
}

/** Look at a folder without importing, so the registrar sees what is about to happen. */
export async function scanFolder(folderInput: string): Promise<ScanResult> {
  const folder = resolveImportFolder(folderInput);
  if (!folderExists(folder)) return { folder, exists: false, files: [] };
  return { folder, exists: true, files: listSf10Files(folder) };
}

export async function runImport(folderInput: string): Promise<ImportSummary> {
  const folder = resolveImportFolder(folderInput);
  if (!folderExists(folder)) {
    throw new Error(`No folder at ${folder}`);
  }

  const summary = importFolder(folder);
  revalidatePath("/");
  revalidatePath("/import");
  return summary;
}

/** Relative paths are resolved against the project folder, which is what users type. */
function resolveImportFolder(input: string): string {
  const trimmed = input.trim() || "sf10-copy";
  return isAbsolute(trimmed) ? trimmed : join(process.cwd(), trimmed);
}

export interface NewStudentInput {
  lrn: string;
  lastName: string;
  firstName: string;
  middleName: string;
  nameExt: string;
  sex: string;
  birthdate: string;
  level: string;
  semester: string;
  schoolYear: string;
  section: string;
  adviser: string;
  trackStrand: string;
}

/** Creates a student plus their first term, pre-filled with that term's standard subjects. */
export async function createRecord(input: NewStudentInput): Promise<void> {
  const level = Number(input.level);
  const isJhs = level <= 10;
  const semester = isJhs ? null : Number(input.semester || "1");

  const studentId = createStudent({
    lrn: input.lrn.trim(),
    last_name: input.lastName.trim().toUpperCase(),
    first_name: input.firstName.trim().toUpperCase(),
    middle_name: input.middleName.trim().toUpperCase() || null,
    name_ext: input.nameExt.trim().toUpperCase() || null,
    sex: input.sex || null,
    birthdate: input.birthdate || null,
  });

  const termId = createTerm(
    studentId,
    {
      level,
      semester,
      school_year: input.schoolYear.trim() || null,
      section: input.section.trim().toUpperCase() || null,
      adviser: input.adviser.trim() || null,
      track_strand: isJhs ? null : input.trackStrand || null,
    },
    getSchoolSettings(),
  );

  const subjects = isJhs
    ? jhsLearningAreas(level as 7 | 8 | 9 | 10).map((name) => ({ name, category: null }))
    : shsSubjectsFor(level as 11 | 12, (semester ?? 1) as 1 | 2).map((s) => ({
        name: s.name,
        category: s.category,
      }));

  createSubjects(termId, subjects);

  revalidatePath("/");
  redirect(`/students/${studentId}/edit`);
}
