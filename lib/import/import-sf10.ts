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
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "../db/index.ts";
import { Workbook } from "../xlsx/workbook.ts";
import { parseShsWorkbook, NotAnShsFormError } from "../sf10/import-shs.ts";
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

export function listSf10Files(folder: string): string[] {
  return readdirSync(folder)
    .filter((f) => f.toLowerCase().endsWith(".xlsx") && !f.startsWith("~$"))
    .sort();
}

export function folderExists(folder: string): boolean {
  try {
    return statSync(folder).isDirectory();
  } catch {
    return false;
  }
}

/** Import every SF10 in a folder. Safe to call repeatedly on the same folder. */
export function importFolder(folder: string): ImportSummary {
  const results = listSf10Files(folder).map((filename) =>
    importOneFile(join(folder, filename), filename),
  );

  return {
    folder,
    results,
    imported: results.filter((r) => r.status === "imported").length,
    updated: results.filter((r) => r.status === "updated").length,
    duplicates: results.filter((r) => r.status === "duplicate").length,
    failed: results.filter((r) => r.status === "failed").length,
    issueCount: results.reduce((n, r) => n + r.issues.length, 0),
  };
}

export function importOneFile(path: string, filename: string): FileResult {
  const bytes = readFileSync(path);
  return importBytes(bytes, filename);
}

export function importBytes(bytes: Uint8Array, filename: string): FileResult {
  const db = getDb();
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
  const already = db
    .prepare(
      `SELECT f.id, f.filename, f.student_id
         FROM import_files f
         JOIN students s ON s.id = f.student_id
        WHERE f.sha256 = ?
          AND f.status IN ('imported', 'updated')`,
    )
    .get(sha256) as { id: number; filename: string; student_id: number | null } | undefined;

  if (already) {
    return {
      filename,
      status: "duplicate",
      studentId: already.student_id ?? undefined,
      issues: [],
      error: `Identical to a file already imported (${already.filename}).`,
    };
  }

  let parsed;
  try {
    parsed = parseShsWorkbook(Workbook.fromBuffer(bytes));
  } catch (err) {
    const message =
      err instanceof NotAnShsFormError
        ? err.message
        : `Could not read this workbook: ${err instanceof Error ? err.message : String(err)}`;
    recordFile(sha256, filename, "shs", null, "failed", message);
    return { filename, status: "failed", issues: [], error: message };
  }

  const { record, issues, termCount, subjectCount } = parsed;

  const fatal = issues.filter((i) => i.severity === "error");
  if (!record.student.lrn || fatal.length > 0) {
    const message = fatal[0]?.message ?? "No LRN on the form.";
    const fileId = recordFile(sha256, filename, "shs", null, "failed", message);
    saveIssues(fileId, null, issues);
    return { filename, status: "failed", issues, error: message };
  }

  const existing = db
    .prepare(`SELECT id FROM students WHERE lrn = ?`)
    .get(record.student.lrn) as { id: number } | undefined;

  const studentId = writeRecord(record, existing?.id);
  const status: ImportStatus = existing ? "updated" : "imported";

  const fileId = recordFile(sha256, filename, "shs", studentId, status, null);
  saveIssues(fileId, studentId, issues);

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
 */
function writeRecord(record: Sf10Record, existingId?: number): number {
  const db = getDb();
  const s = record.student;

  db.exec("BEGIN");
  try {
    let studentId: number;

    if (existingId) {
      studentId = existingId;
      db.prepare(
        `UPDATE students
            SET last_name = ?, first_name = ?, middle_name = ?, name_ext = ?,
                sex = ?, birthdate = ?, updated_at = datetime('now')
          WHERE id = ?`,
      ).run(
        s.lastName,
        s.firstName,
        s.middleName ?? null,
        s.nameExt ?? null,
        s.sex ?? null,
        s.birthdate ?? null,
        studentId,
      );
    } else {
      db.prepare(
        `INSERT INTO students (lrn, last_name, first_name, middle_name, name_ext, sex, birthdate)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        s.lrn,
        s.lastName,
        s.firstName,
        s.middleName ?? null,
        s.nameExt ?? null,
        s.sex ?? null,
        s.birthdate ?? null,
      );
      studentId = (db.prepare(`SELECT last_insert_rowid() AS id`).get() as { id: number }).id;
    }

    // This form owns the learner's SHS terms, so replace them wholesale. Grade levels 7-10
    // come from the JHS form and are deliberately left alone.
    db.prepare(
      `DELETE FROM term_subjects
        WHERE term_id IN (SELECT id FROM enrollment_terms WHERE student_id = ? AND level >= 11)`,
    ).run(studentId);
    db.prepare(`DELETE FROM enrollment_terms WHERE student_id = ? AND level >= 11`).run(studentId);

    const insTerm = db.prepare(
      `INSERT INTO enrollment_terms
         (student_id, level, semester, school_year, section, adviser, track_strand,
          school_name, school_id, district, division, region, promotion_remark)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const insSubject = db.prepare(
      `INSERT INTO term_subjects (term_id, ordinal, subject_name, category, q1, q2)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );

    for (const term of record.terms) {
      insTerm.run(
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
      );
      const termId = (db.prepare(`SELECT last_insert_rowid() AS id`).get() as { id: number }).id;
      term.subjects.forEach((sub, i) =>
        insSubject.run(termId, i, sub.name, sub.category ?? null, sub.q1 ?? null, sub.q2 ?? null),
      );
    }

    const el = record.shsEligibility;
    if (el) {
      db.prepare(`DELETE FROM shs_eligibility WHERE student_id = ?`).run(studentId);
      db.prepare(
        `INSERT INTO shs_eligibility
           (student_id, shs_admission_date, jhs_completer_gen_ave, hs_completer_gen_ave,
            graduation_date, prev_school_name, prev_school_address, pept_rating, als_rating,
            other_credential, exam_date, clc_name_address)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
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
      );
    }

    db.exec("COMMIT");
    return studentId;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function toNumber(v: number | string | undefined): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function recordFile(
  sha256: string,
  filename: string,
  form: string,
  studentId: number | null,
  status: string,
  notes: string | null,
): number {
  const db = getDb();

  // Upsert, because the row for a hash now outlives the learner it produced: re-importing a
  // file whose record was deleted must update that row rather than collide with UNIQUE(sha256).
  db.prepare(
    `INSERT INTO import_files (filename, sha256, form, student_id, status, notes)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(sha256) DO UPDATE SET
       filename    = excluded.filename,
       form        = excluded.form,
       student_id  = excluded.student_id,
       status      = excluded.status,
       notes       = excluded.notes,
       imported_at = datetime('now')`,
  ).run(filename, sha256, form, studentId, status, notes);

  // last_insert_rowid() is meaningless after DO UPDATE, so look the row up by its hash.
  return (db.prepare(`SELECT id FROM import_files WHERE sha256 = ?`).get(sha256) as { id: number })
    .id;
}

function saveIssues(fileId: number, studentId: number | null, issues: Issue[]): void {
  const db = getDb();

  // A re-imported file re-raises its own issues, so clear the previous set first rather than
  // stacking a second copy onto the review list.
  db.prepare(`DELETE FROM import_issues WHERE import_file_id = ?`).run(fileId);

  if (issues.length === 0) return;

  const stmt = db.prepare(
    `INSERT INTO import_issues
       (import_file_id, student_id, severity, field, cell, raw_value, message)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const i of issues) {
    stmt.run(fileId, studentId, i.severity, i.field ?? null, i.cell ?? null, i.rawValue ?? null, i.message);
  }
}
