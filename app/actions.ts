"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { join, resolve as resolvePath, sep } from "node:path";
import { readdirSync } from "node:fs";
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
  appendSubject,
  deleteStudent,
  deleteSubject,
  getSchoolSettings,
  getStudent,
  recordChange,
  resolveIssue,
  updateSubjectField,
  updateStudent,
  updateSubjectGrades,
  updateTerm,
} from "@/lib/db/queries.ts";
import {
  exactFinalRating,
  finalRating,
  generalAverage,
  jhsRemark,
  promotionRemark,
} from "@/lib/grading.ts";
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
    const level = isJhs ? "jhs" : "shs";
    // Exact, unrounded finals — the general average is computed from these and rounded once.
    const finals: (number | null)[] = [];

    term.subjects.forEach((s, i) => {
      const quarters = { q1: s.q1, q2: s.q2, q3: s.q3, q4: s.q4 };
      const computed = finalRating(quarters, level);

      // The template owns the final rating everywhere it has an AVERAGE formula. The two
      // JHS rows that lack one (Homeroom Guidance, CAT) are stored instead.
      const storedFinal = isJhs && !jhsFinalRatingIsComputed(i) ? s.finalRating : null;
      const effective = storedFinal ?? computed;
      finals.push(storedFinal ?? exactFinalRating(quarters, level));

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
      promotion_remark: promotionRemark(generalAverage(finals, level), level),
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

/**
 * Autosave one grade cell.
 *
 * Deliberately granular: the editor saves the field that changed rather than the whole record,
 * so a slow save cannot clobber a value the user typed meanwhile, and `record_history` shows
 * exactly what moved. Returns nothing — the client already has the value it sent.
 */
export async function saveSubjectField(
  subjectId: number,
  field: "q1" | "q2" | "q3" | "q4" | "final_rating",
  value: number | null,
): Promise<void> {
  if (value != null && (!Number.isFinite(value) || value < 0 || value > 100)) {
    throw new Error(`Grade ${value} is outside 0–100.`);
  }

  const { studentId } = updateSubjectField(subjectId, field, value);
  if (studentId) revalidatePath(`/students/${studentId}`);
}

/** Save the learner-identity fields. Called on blur, not per keystroke — see the editor. */
export async function saveLearnerInfo(
  studentId: number,
  fields: RecordEdit["student"],
): Promise<void> {
  const before = getStudent(studentId);
  if (!before) throw new Error("That learner record no longer exists.");

  const next = {
    lrn: fields.lrn.trim(),
    last_name: fields.lastName.trim().toUpperCase(),
    first_name: fields.firstName.trim().toUpperCase(),
    middle_name: fields.middleName?.trim().toUpperCase() || null,
    name_ext: fields.nameExt?.trim().toUpperCase() || null,
    sex: fields.sex || null,
    birthdate: fields.birthdate || null,
  };

  if (!next.lrn || !next.last_name || !next.first_name) {
    throw new Error("LRN, last name and first name are required.");
  }

  updateStudent(studentId, next);

  for (const [field, value] of Object.entries(next)) {
    recordChange(studentId, "students", studentId, field, (before as never)[field], value);
  }

  revalidatePath(`/students/${studentId}`);
  revalidatePath("/");
}

/** Append a subject to a term, taking the next ordinal. */
export async function addSubject(
  termId: number,
  name: string,
  category: string | null,
): Promise<number> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A subject needs a name.");

  const id = appendSubject(termId, trimmed, category);
  revalidatePath("/");
  return id;
}

export async function removeSubject(subjectId: number): Promise<void> {
  deleteSubject(subjectId);
  revalidatePath("/");
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

export interface FolderListing {
  /** Path relative to the import root, "" at the top. */
  path: string;
  parent: string | null;
  folders: { name: string; path: string; fileCount: number }[];
  fileCount: number;
}

/**
 * List the subfolders of one folder, for the import browser.
 *
 * Confined to IMPORT_ROOT. A typed path cannot escape it — `..` segments resolve and are then
 * rejected — so this cannot be used to enumerate the server's filesystem. That matters little
 * on a single-user machine and matters a great deal once accounts exist and this is reachable
 * over the school network.
 */
export async function browseFolder(relative: string): Promise<FolderListing> {
  const dir = safeResolve(relative);
  const rel = toRelative(dir);

  const entries = readdirSync(dir, { withFileTypes: true });
  const folders = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => {
      const childPath = rel ? `${rel}/${e.name}` : e.name;
      let fileCount = 0;
      try {
        fileCount = listSf10Files(join(dir, e.name)).length;
      } catch {
        fileCount = 0; // unreadable folder; show it with zero rather than failing the listing
      }
      return { name: e.name, path: childPath, fileCount };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    path: rel,
    parent: rel === "" ? null : rel.split("/").slice(0, -1).join("/"),
    folders,
    fileCount: listSf10Files(dir).length,
  };
}

/** Everything importable lives under the project folder. */
const IMPORT_ROOT = process.cwd();

function safeResolve(relative: string): string {
  const cleaned = (relative ?? "").trim().replace(/^[/\\]+/, "");
  const resolved = resolvePath(IMPORT_ROOT, cleaned);
  const withinRoot =
    resolved === IMPORT_ROOT || resolved.startsWith(IMPORT_ROOT + sep);
  if (!withinRoot) {
    throw new Error("That folder is outside the records folder.");
  }
  return resolved;
}

function toRelative(absolute: string): string {
  const rel = absolute.slice(IMPORT_ROOT.length).replace(/^[/\\]+/, "");
  return rel.split(/[\\/]/).filter(Boolean).join("/");
}

/** Relative paths are resolved against the project folder, which is what users type. */
function resolveImportFolder(input: string): string {
  return safeResolve(input.trim() || "sf10-files");
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

/**
 * Creates a learner plus their first enrolment term.
 *
 * The term starts with **no subjects**. They are added one at a time in the editor, because
 * the school's real records contain subject sets that differ from the standard catalogue, and
 * a pre-filled grid invites encoding a grade against the wrong row.
 */
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

  createTerm(
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

  revalidatePath("/");
  redirect(`/students/${studentId}/edit`);
}
