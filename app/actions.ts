"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createStudent,
  createSubjects,
  createTerm,
  appendSubject,
  deleteStudent,
  deleteSubject,
  getOriginalFile,
  getSchoolSettings,
  getStudent,
  getTerm,
  getTermForSubject,
  listDocuments,
  resolveIssue,
  swapSubjectOrder,
  updateStudent,
  updateSubjectField,
  updateStudentStatus,
  updateTermPeriods,
  updateStudentWithHistory,
  updateSubjectGradesMany,
  updateTerm,
} from "@/lib/db/queries.ts";
import { isStudentStatus, type StudentStatus } from "@/lib/status.ts";
import {
  exactFinalRating,
  finalRating,
  generalAverage,
  gradingPeriods,
  jhsRemark,
  promotionRemark,
  quarterFieldsFor,
} from "@/lib/grading.ts";
import { jhsFinalRatingIsComputed, jhsLearningAreas } from "@/lib/sf10/jhs-map.ts";
import { shsSubjectsFor } from "@/lib/sf10/subject-templates.ts";
import { requireUnlocked } from "@/lib/auth/guard.ts";
import { deleteOriginal } from "@/lib/blob/store.ts";

/*
 * Every action below begins with `requireUnlocked()`.
 *
 * A server action is a public HTTP endpoint with a generated name - not an internal function
 * call. Hiding the button that invokes it protects nothing, exactly as hiding the SF10 print
 * button did not stop the print endpoint answering for a Form 137 learner. There is no
 * middleware to fall back on either; it was deleted with the hosted deployment. If an action
 * added later touches learner data, it starts with this line too.
 *
 * ## Why the history calls pass null
 *
 * `record_history` used to carry the id of whoever made each change. The app is now opened
 * with one password on one machine and has nobody to name, so new rows are written with a
 * null user. The history keeps the job that matters day to day — autosave writes as you type
 * with no undo, and this is what makes a mistyped grade recoverable — and loses the
 * attribution half. Rows written while accounts existed keep their user ids, which is why
 * migration 4 keeps the `users` table.
 */

/** Nobody to attribute a change to. See the note above. */
const NO_USER = null;

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
  await requireUnlocked();

  await updateStudent(edit.studentId, {
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

    const updates = term.subjects.map((s, i) => {
      const quarters = { q1: s.q1, q2: s.q2, q3: s.q3, q4: s.q4 };
      const computed = finalRating(quarters, level);

      // The template owns the final rating everywhere it has an AVERAGE formula. The two
      // JHS rows that lack one (Homeroom Guidance, CAT) are stored instead.
      const storedFinal = isJhs && !jhsFinalRatingIsComputed(i) ? s.finalRating : null;
      const effective = storedFinal ?? computed;
      finals.push(storedFinal ?? exactFinalRating(quarters, level));

      // JHS prints a literal Passed/Failed; SHS computes it with its own formula.
      return {
        subjectId: s.id,
        grades: quarters,
        finalRating: storedFinal,
        remarks: isJhs ? jhsRemark(effective) : null,
      };
    });

    await updateSubjectGradesMany(updates);

    await updateTerm(term.id, {
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
 * Permanently deletes a learner record, and the imported original it came from.
 *
 * The typed LRN is re-checked here, not just in the browser: a server action is a public
 * endpoint, and this destroys a permanent academic record with no undo.
 *
 * ## The file goes too
 *
 * A Form 137 carries the learner's parents' names, occupation and home address. Leaving that
 * document in the bucket after the registrar has deleted the record means the deletion did not
 * happen — the most sensitive part of it simply moved out of sight.
 *
 * Order matters, and this order is the safe one. The database row goes first; the object
 * second. A failure between them orphans a file nothing refers to, which costs storage and can
 * be swept up later. The reverse order destroys the file belonging to a record that then
 * survives, and there is no sweeping that up.
 */
export async function deleteRecord(studentId: number, confirmLrn: string): Promise<void> {
  await requireUnlocked();

  const student = await getStudent(studentId);
  if (!student) throw new Error("That learner record no longer exists.");

  if (confirmLrn.trim() !== student.lrn) {
    throw new Error("The LRN you typed does not match this learner's LRN.");
  }

  // Read before deleting: `deleteStudent` clears stored_path and removes the document rows,
  // so afterwards there is nothing left to say which objects belonged to this learner.
  const original = await getOriginalFile(studentId);
  const documents = await listDocuments(studentId);

  await deleteStudent(studentId);
  if (original) await deleteOriginal(original.stored_path);
  // The report cards filed against the learner go with them. Failing to remove these would
  // leave a child's documents on disk after their record was deleted.
  for (const doc of documents) await deleteOriginal(doc.stored_path);

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
  await requireUnlocked();

  if (value != null && (!Number.isFinite(value) || value < 0 || value > 100)) {
    throw new Error(`Grade ${value} is outside 0–100.`);
  }

  /*
   * Refuse a grade in a quarter this term is not graded over.
   *
   * The editor already hides the column, so reaching this needs a tab left open across the
   * change, or a direct call. Either way the grade would be stored and then never printed —
   * the form has no fourth-quarter column to put it in — which is a mark that exists in the
   * system and not on the record. Better to refuse it and say so.
   */
  if (value != null && field !== "final_rating") {
    const term = await getTermForSubject(subjectId);
    if (term && !quarterFieldsFor(term).includes(field)) {
      throw new Error(
        `This term is graded over ${gradingPeriods(term)} quarters, so ${field.toUpperCase()} ` +
          `cannot be encoded. Reload the page if it is still showing.`,
      );
    }
  }

  const { studentId } = await updateSubjectField(subjectId, field, value, NO_USER);
  if (studentId) revalidatePath(`/students/${studentId}`);
}

/** Save the learner-identity fields. Called on blur, not per keystroke — see the editor. */
export async function saveLearnerInfo(
  studentId: number,
  fields: RecordEdit["student"],
): Promise<void> {
  await requireUnlocked();

  const before = await getStudent(studentId);
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

  await updateStudentWithHistory(studentId, next, before, NO_USER);

  revalidatePath(`/students/${studentId}`);
  revalidatePath("/");
}

/** Append a subject to a term, taking the next ordinal. */
export async function addSubject(
  termId: number,
  name: string,
  category: string | null,
): Promise<number> {
  await requireUnlocked();

  const trimmed = name.trim();
  if (!trimmed) throw new Error("A subject needs a name.");

  const id = await appendSubject(termId, trimmed, category, NO_USER);
  revalidatePath("/");
  return id;
}

export async function removeSubject(subjectId: number): Promise<void> {
  await requireUnlocked();
  await deleteSubject(subjectId, NO_USER);
  revalidatePath("/");
}

/**
 * Move a subject one place up or down within its term.
 *
 * Position is not presentation: it decides which row of the printed SF10 a subject occupies, and
 * whether it falls inside the first eight rows that make up the general average. See
 * `swapSubjectOrder` for the mechanics.
 */
export async function moveSubject(subjectId: number, direction: "up" | "down"): Promise<void> {
  await requireUnlocked();

  // A server action is a public endpoint, so the argument is checked rather than trusted.
  if (direction !== "up" && direction !== "down") {
    throw new Error("A subject moves up or down.");
  }

  const { studentId } = await swapSubjectOrder(subjectId, direction, NO_USER);
  if (studentId) revalidatePath(`/students/${studentId}`);
  revalidatePath("/");
}

export async function markIssueResolved(issueId: number): Promise<void> {
  await requireUnlocked();
  await resolveIssue(issueId);
  revalidatePath("/import/review");
  revalidatePath("/import");
}

/**
 * Change how many quarters a term is graded over.
 *
 * The school is moving from four periods to three, and every record imported before the change
 * carries four. Without this there is no way to move one across: the count could be chosen when
 * a record was created and never afterwards, so an imported Grade 9 was stuck on the old scheme
 * for good - and the three-column report card could never be printed for it.
 *
 * **No grades are deleted.** See `updateTermPeriods()`; the fourth-quarter marks stay put and
 * come back if the term is switched back.
 */
export async function setTermPeriods(termId: number, periods: number): Promise<void> {
  await requireUnlocked();

  // A server action is a public endpoint, so the argument is checked rather than trusted.
  if (periods !== 3 && periods !== 4) {
    throw new Error("A term is graded over three or four quarters.");
  }

  const term = await getTerm(termId);
  if (!term) throw new Error("That term is no longer on this record.");

  /*
   * Junior High only. An SHS semester has two quarters and always did - what changed there is
   * the number of semester blocks in the programme, which lives on the learner as
   * `shs_semesters`. Setting this on an SHS term would write a value `gradingPeriods()` ignores,
   * which is worse than refusing: the screen would claim a change that did nothing.
   */
  if (term.level > 10) {
    throw new Error(
      "Only a Junior High term is graded in quarters. Senior High counts semesters, which are " +
        "set on the learner.",
    );
  }

  await updateTermPeriods(termId, periods, term.grading_periods, NO_USER);

  revalidatePath(`/students/${term.student_id}`);
  revalidatePath(`/students/${term.student_id}/edit`);
  revalidatePath("/");
}

/**
 * Confirm what a learner is: enrolled, graduated, gone.
 *
 * Accepts null, which clears the status back to unconfirmed - a registrar who set the wrong
 * value needs a way back that is not "pick a different wrong value".
 *
 * The status gates diploma printing, so the value is validated here rather than trusted: this
 * is a public endpoint, and the CHECK constraint behind it produces a database error rather
 * than something a person could act on.
 */
export async function setStudentStatus(
  studentId: number,
  status: StudentStatus | null,
): Promise<void> {
  await requireUnlocked();

  if (status !== null && !isStudentStatus(status)) {
    throw new Error(`Not a status this system recognises: ${String(status)}`);
  }

  const student = await getStudent(studentId);
  if (!student) throw new Error("That learner is not in the database.");

  await updateStudentStatus(studentId, status, student.status, NO_USER);
  revalidatePath(`/students/${studentId}`);
  revalidatePath("/");
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
  /**
   * "3" or "4". For a JHS level it is quarter columns on the term; for SHS it is semesters in
   * the programme, which is stored on the learner. One control, because to a registrar it is
   * one question — does this record run to three or to four?
   */
  periods: string;
}

/**
 * Creates a learner plus their first enrolment term.
 *
 * The term starts with **no subjects**. They are added one at a time in the editor, because
 * the school's real records contain subject sets that differ from the standard catalogue, and
 * a pre-filled grid invites encoding a grade against the wrong row.
 */
export async function createRecord(input: NewStudentInput): Promise<void> {
  await requireUnlocked();

  const level = Number(input.level);
  const isJhs = level <= 10;
  const semester = isJhs ? null : Number(input.semester || "1");

  /*
   * The one control lands in two different places, because it means two different things.
   *
   * On a JHS level it is the number of quarter columns, which belongs to the term — a learner
   * straddles the cutover, with Grade 7 on four and Grade 9 on three. On SHS it is the number
   * of semesters in the programme, which belongs to the learner, because the semester that
   * does not exist has no row of its own to be recorded on.
   */
  const periods = input.periods === "4" ? 4 : 3;

  const studentId = await createStudent({
    lrn: input.lrn.trim(),
    last_name: input.lastName.trim().toUpperCase(),
    first_name: input.firstName.trim().toUpperCase(),
    middle_name: input.middleName.trim().toUpperCase() || null,
    name_ext: input.nameExt.trim().toUpperCase() || null,
    sex: input.sex || null,
    birthdate: input.birthdate || null,
    shs_semesters: isJhs ? null : periods,
  });

  await createTerm(
    studentId,
    {
      level,
      semester,
      school_year: input.schoolYear.trim() || null,
      section: input.section.trim().toUpperCase() || null,
      adviser: input.adviser.trim() || null,
      track_strand: isJhs ? null : input.trackStrand || null,
      // An SHS semester has two quarters and always did; only JHS carries a period count.
      grading_periods: isJhs ? periods : null,
    },
    await getSchoolSettings(),
  );

  revalidatePath("/");
  redirect(`/students/${studentId}/edit`);
}
