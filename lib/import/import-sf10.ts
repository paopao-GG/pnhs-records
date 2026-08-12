/**
 * Takes SF10 files into the database.
 *
 * Three properties this is built around:
 *
 *  1. **Re-running is safe.** Files are identified by SHA-256, so importing the same folder
 *     twice imports nothing the second time, and the school's byte-identical duplicate pair
 *     collapses to one learner.
 *  2. **Nothing is silently dropped.** A record with a suspect LRN or an unreadable date
 *     still goes in; the problem is recorded in `import_issues` for review.
 *  3. **A file is authoritative for its own form.** Re-importing a corrected file replaces
 *     that learner's SHS terms rather than appending a second copy - but never touches their
 *     JHS terms, which come from a different form.
 */

import { createHash } from "node:crypto";
import { extname } from "node:path";
import { getDb } from "../db/index.ts";
import { putOriginal } from "../blob/store.ts";
import { Workbook } from "../xlsx/workbook.ts";
import { parseShsWorkbook, NotAnShsFormError } from "../sf10/import-shs.ts";
import { parseJhsWorkbook, NotAJhsFormError } from "../sf10/import-jhs.ts";
import {
  parseF137Bytes,
  NotAForm137Error,
  type AttendanceRecord,
} from "../sf10/import-f137.ts";
import { NotADocxError } from "../docx/reader.ts";
import {
  detectByBytes,
  levelsOwnedBy,
  UnknownFormError,
  type Sf10Form,
} from "../sf10/detect-form.ts";
import type { Issue } from "../sf10/normalise.ts";
import type { Sf10Record } from "../sf10/types.ts";

export type ImportStatus = "imported" | "updated" | "duplicate" | "failed";

export interface FileResult {
  filename: string;
  status: ImportStatus;
  studentId?: number;
  learner?: string;
  lrn?: string;
  terms?: number;
  subjects?: number;
  issues: Issue[];
  error?: string;
}

export interface ImportSummary {
  folder: string;
  results: FileResult[];
  imported: number;
  updated: number;
  duplicates: number;
  failed: number;
  issueCount: number;
}

export async function importBytes(bytes: Uint8Array, filename: string): Promise<FileResult> {
  const db = await getDb();
  const sha256 = createHash("sha256").update(bytes).digest("hex");

  /*
   * A file counts as already-imported only if it produced a learner who STILL EXISTS.
   *
   * Matching on the hash alone was a data-loss bug: deleting a learner left this row behind,
   * so their file was branded "already imported" forever and the record could never be
   * restored by re-importing. The join is the fix.
   *
   * Restricting to successful statuses also lets a file that previously failed to parse be
   * retried once the reason it failed is fixed.
   */
  const found = await db.execute({
    sql: `SELECT f.id, f.filename, f.student_id
            FROM import_files f
            JOIN students s ON s.id = f.student_id
           WHERE f.sha256 = ?
             AND f.status IN ('imported', 'updated')`,
    args: [sha256],
  });

  if (found.rows[0]) {
    const already = found.rows[0];
    return {
      filename,
      status: "duplicate",
      studentId: already.student_id == null ? undefined : Number(already.student_id),
      issues: [],
      error: `Identical to a file already imported (${String(already.filename)}).`,
    };
  }

  // Which form this is decides the parser, the grade levels it owns, and what a re-import
  // replaces. Detected from the workbook itself rather than the filename, which is unreliable.
  let form: Sf10Form;
  let parsed: { record: Sf10Record; issues: Issue[]; termCount: number; subjectCount: number };
  let attendance: AttendanceRecord[][] = [];
  try {
    form = detectByBytes(bytes);
    if (form === "f137") {
      const f = parseF137Bytes(bytes);
      parsed = f;
      attendance = f.attendance;
    } else {
      const wb = Workbook.fromBuffer(bytes);
      parsed = form === "jhs" ? parseJhsWorkbook(wb) : parseShsWorkbook(wb);
    }
  } catch (err) {
    const message =
      err instanceof UnknownFormError ||
      err instanceof NotAnShsFormError ||
      err instanceof NotAJhsFormError ||
      err instanceof NotAForm137Error ||
      err instanceof NotADocxError
        ? err.message
        : `Could not read this file: ${err instanceof Error ? err.message : String(err)}`;
    await recordFile(sha256, filename, "unknown", null, "failed", message);
    return { filename, status: "failed", issues: [], error: message };
  }

  const { record, issues, termCount, subjectCount } = parsed;

  const fatal = issues.filter((i) => i.severity === "error");
  if (!record.student.lrn || fatal.length > 0) {
    const message = fatal[0]?.message ?? "No LRN on the form.";
    const fileId = await recordFile(sha256, filename, form, null, "failed", message);
    await saveIssues(fileId, null, issues);
    return { filename, status: "failed", issues, error: message };
  }

  const match = await db.execute({
    sql: `SELECT id FROM students WHERE lrn = ?`,
    args: [record.student.lrn],
  });
  const existingId = match.rows[0] ? Number(match.rows[0].id) : undefined;

  const studentId = await writeRecord(record, form, attendance, existingId);
  const status: ImportStatus = existingId ? "updated" : "imported";

  // Keep the original. For Form 137 it is the only reissuable artefact — the record cannot be
  // reprinted onto a modern SF10 — and for SF10 it makes a future re-parse possible without
  // asking the registrar for files again.
  const storedPath = await putOriginal(sha256, extname(filename).toLowerCase() || ".bin", bytes);
  const fileId = await recordFile(sha256, filename, form, studentId, status, null, storedPath);
  await saveIssues(fileId, studentId, issues);

  return {
    filename,
    status,
    studentId,
    learner: `${record.student.lastName}, ${record.student.firstName}`,
    lrn: record.student.lrn,
    terms: termCount,
    subjects: subjectCount,
    issues,
  };
}

/**
 * Write one parsed record. All-or-nothing: a failure part-way through must not leave a
 * learner with half their semesters.
 *
 * `form` decides which grade levels this file owns. A JHS form replaces grades 7-10 and leaves
 * 11-12 alone; an SHS form does the reverse. That is what lets a learner who attended both
 * exist as one record built from two files, in either import order.
 */
async function writeRecord(
  record: Sf10Record,
  form: Sf10Form,
  attendance: AttendanceRecord[][],
  existingId?: number,
): Promise<number> {
  const db = await getDb();
  const s = record.student;
  const levelClause = levelsOwnedBy(form);

  const tx = await db.transaction("write");
  try {
    let studentId: number;

    if (existingId) {
      studentId = existingId;
      await tx.execute({
        sql: `UPDATE students
                 SET last_name = ?, first_name = ?, middle_name = ?, name_ext = ?,
                     sex = ?, birthdate = ?, lrn_placeholder = ?,
                     birthplace_province = ?, birthplace_town = ?, birthplace_barrio = ?,
                     guardian_name = ?, guardian_occupation = ?, guardian_address = ?,
                     updated_at = datetime('now')
               WHERE id = ?`,
        args: [
          s.lastName,
          s.firstName,
          s.middleName ?? null,
          s.nameExt ?? null,
          s.sex ?? null,
          s.birthdate ?? null,
          s.lrnPlaceholder ? 1 : 0,
          s.birthplaceProvince ?? null,
          s.birthplaceTown ?? null,
          s.birthplaceBarrio ?? null,
          s.guardianName ?? null,
          s.guardianOccupation ?? null,
          s.guardianAddress ?? null,
          studentId,
        ],
      });
    } else {
      const created = await tx.execute({
        sql: `INSERT INTO students
                (lrn, last_name, first_name, middle_name, name_ext, sex, birthdate, lrn_placeholder,
                 birthplace_province, birthplace_town, birthplace_barrio,
                 guardian_name, guardian_occupation, guardian_address)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              RETURNING id`,
        args: [
          s.lrn,
          s.lastName,
          s.firstName,
          s.middleName ?? null,
          s.nameExt ?? null,
          s.sex ?? null,
          s.birthdate ?? null,
          s.lrnPlaceholder ? 1 : 0,
          s.birthplaceProvince ?? null,
          s.birthplaceTown ?? null,
          s.birthplaceBarrio ?? null,
          s.guardianName ?? null,
          s.guardianOccupation ?? null,
          s.guardianAddress ?? null,
        ],
      });
      studentId = Number(created.rows[0].id);
    }

    // This form owns its own grade levels, so replace them wholesale. The other form's levels
    // are deliberately left alone - re-importing a learner's SHS record must not erase the JHS
    // years imported from a different file.
    //
    // Attendance goes with the terms it belongs to. It is not covered by the term_subjects
    // delete, and leaving it would attach a 1996 attendance row to the term that replaced it.
    await tx.batch(
      [
        {
          sql: `DELETE FROM term_subjects
                 WHERE term_id IN (SELECT id FROM enrollment_terms
                                    WHERE student_id = ? AND ${levelClause})`,
          args: [studentId],
        },
        {
          sql: `DELETE FROM term_attendance
                 WHERE term_id IN (SELECT id FROM enrollment_terms
                                    WHERE student_id = ? AND ${levelClause})`,
          args: [studentId],
        },
        {
          sql: `DELETE FROM enrollment_terms WHERE student_id = ? AND ${levelClause}`,
          args: [studentId],
        },
      ],
    );

    const INSERT_TERM = `INSERT INTO enrollment_terms
        (student_id, level, semester, school_year, section, adviser, track_strand,
         school_name, school_id, district, division, region, promotion_remark, general_average,
         curriculum, grading_periods)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      RETURNING id`;
    // All four quarters: SHS uses only q1/q2 and leaves the rest null, JHS uses all four.
    // `final_rating` is stored only where the template has no formula for it - JHS Homeroom
    // Guidance and CAT - and the parser supplies it for exactly those rows.
    const INSERT_SUBJECT = `INSERT INTO term_subjects
        (term_id, ordinal, subject_name, category, q1, q2, q3, q4, final_rating, remarks,
         units_earned, extra_curricular)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const INSERT_ATTENDANCE = `INSERT INTO term_attendance
        (term_id, ordinal, month, days_of_school, days_present)
      VALUES (?, ?, ?, ?, ?)`;

    for (const [termIndex, term] of record.terms.entries()) {
      const createdTerm = await tx.execute({
        sql: INSERT_TERM,
        args: [
          studentId,
          term.level,
          term.semester ?? null,
          term.schoolYear ?? null,
          term.section ?? null,
          term.adviser ?? null,
          term.trackStrand ?? null,
          term.schoolName ?? null,
          term.schoolId ?? null,
          term.district ?? null,
          term.division ?? null,
          term.region ?? null,
          term.promotionRemark ?? null,
          term.generalAverage ?? null,
          term.curriculum ?? "k12",
          // Null when the parser could not tell, which leaves the term on the historical
          // default rather than asserting a period count the form did not state.
          term.gradingPeriods ?? null,
        ],
      });
      const termId = Number(createdTerm.rows[0].id);

      // One batch per term rather than a statement at a time. A Form 137 carries four years of
      // thirteen subjects and ten attendance months each; sent individually that is ninety-odd
      // network round trips inside a single import.
      const children = [
        ...term.subjects.map((sub, i) => ({
          sql: INSERT_SUBJECT,
          args: [
            termId,
            i,
            sub.name,
            sub.category ?? null,
            sub.q1 ?? null,
            sub.q2 ?? null,
            sub.q3 ?? null,
            sub.q4 ?? null,
            sub.finalRating ?? null,
            sub.remarks ?? null,
            sub.unitsEarned ?? null,
            sub.extraCurricular ?? null,
          ],
        })),
        // Form 137 only; SF10 does not record attendance.
        ...(attendance[termIndex] ?? []).map((a, i) => ({
          sql: INSERT_ATTENDANCE,
          args: [termId, i, a.month, a.daysOfSchool ?? null, a.daysPresent ?? null],
        })),
      ];
      if (children.length > 0) await tx.batch(children);
    }

    const el = record.shsEligibility;
    if (el) {
      await tx.batch([
        { sql: `DELETE FROM shs_eligibility WHERE student_id = ?`, args: [studentId] },
        {
          sql: `INSERT INTO shs_eligibility
                  (student_id, shs_admission_date, jhs_completer_gen_ave, hs_completer_gen_ave,
                   graduation_date, prev_school_name, prev_school_address, pept_rating, als_rating,
                   other_credential, exam_date, clc_name_address)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            studentId,
            el.shsAdmissionDate ?? null,
            toNumber(el.jhsCompleterGenAve),
            toNumber(el.hsCompleterGenAve),
            el.graduationDate ?? null,
            el.prevSchoolName ?? null,
            el.prevSchoolAddress ?? null,
            el.peptRating ?? null,
            el.alsRating ?? null,
            el.otherCredential ?? null,
            el.examDate ?? null,
            el.clcNameAddress ?? null,
          ],
        },
      ]);
    }

    const jel = record.jhsEligibility;
    if (jel) {
      await tx.batch([
        { sql: `DELETE FROM jhs_eligibility WHERE student_id = ?`, args: [studentId] },
        {
          sql: `INSERT INTO jhs_eligibility
                  (student_id, elem_school_name, elem_school_id, elem_school_address,
                   elem_general_average, citation, pept_rating, als_rating, other_credential,
                   exam_date, testing_center)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            studentId,
            jel.elemSchoolName ?? null,
            jel.elemSchoolId ?? null,
            jel.elemSchoolAddress ?? null,
            toNumber(jel.elemGeneralAverage),
            jel.citation ?? null,
            jel.peptRating ?? null,
            jel.alsRating ?? null,
            jel.otherCredential ?? null,
            jel.examDate ?? null,
            jel.testingCenter ?? null,
          ],
        },
      ]);
    }

    await tx.commit();
    return studentId;
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

function toNumber(v: number | string | undefined): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

async function recordFile(
  sha256: string,
  filename: string,
  form: string,
  studentId: number | null,
  status: string,
  notes: string | null,
  storedPath: string | null = null,
): Promise<number> {
  const db = await getDb();

  // Upsert, because the row for a hash now outlives the learner it produced: re-importing a
  // file whose record was deleted must update that row rather than collide with UNIQUE(sha256).
  //
  // RETURNING gives the row's id whichever branch ran - last_insert_rowid() would be meaningless
  // after DO UPDATE, and a follow-up SELECT would be a second round trip.
  const result = await db.execute({
    sql: `INSERT INTO import_files (filename, sha256, form, student_id, status, notes, stored_path)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(sha256) DO UPDATE SET
            filename    = excluded.filename,
            form        = excluded.form,
            student_id  = excluded.student_id,
            status      = excluded.status,
            notes       = excluded.notes,
            stored_path = COALESCE(excluded.stored_path, import_files.stored_path),
            imported_at = datetime('now')
          RETURNING id`,
    args: [filename, sha256, form, studentId, status, notes, storedPath],
  });
  return Number(result.rows[0].id);
}

async function saveIssues(
  fileId: number,
  studentId: number | null,
  issues: Issue[],
): Promise<void> {
  const db = await getDb();

  // A re-imported file re-raises its own issues, so clear the previous set first rather than
  // stacking a second copy onto the review list.
  await db.batch(
    [
      { sql: `DELETE FROM import_issues WHERE import_file_id = ?`, args: [fileId] },
      ...issues.map((i) => ({
        sql: `INSERT INTO import_issues
                (import_file_id, student_id, severity, field, cell, raw_value, message)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          fileId,
          studentId,
          i.severity,
          i.field ?? null,
          i.cell ?? null,
          i.rawValue ?? null,
          i.message,
        ],
      })),
    ],
    "write",
  );
}
