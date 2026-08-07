/**
 * Typed data access. Plain SQL against node:sqlite - six tables does not justify an ORM,
 * and this keeps the demo free of a codegen step.
 */

import { getDb } from "./index.ts";
import type { ShsCategory } from "../sf10/shs-map.ts";

/**
 * node:sqlite returns rows with a null prototype. React refuses to serialise those across
 * the server/client boundary ("Only plain objects ... can be passed to Client Components"),
 * so every row leaves this module as a plain object.
 */
function plain<T>(row: unknown): T {
  return { ...(row as object) } as T;
}

function plainAll<T>(rows: unknown[]): T[] {
  return rows.map((r) => plain<T>(r));
}

export interface StudentRow {
  id: number;
  lrn: string;
  last_name: string;
  first_name: string;
  middle_name: string | null;
  name_ext: string | null;
  sex: "M" | "F" | null;
  birthdate: string | null;
}

export interface TermRow {
  id: number;
  student_id: number;
  level: number;
  semester: number | null;
  school_year: string | null;
  section: string | null;
  adviser: string | null;
  track_strand: string | null;
  school_name: string | null;
  school_id: string | null;
  district: string | null;
  division: string | null;
  region: string | null;
  promotion_remark: string | null;
}

export interface SubjectRow {
  id: number;
  term_id: number;
  ordinal: number;
  subject_name: string;
  category: ShsCategory | null;
  q1: number | null;
  q2: number | null;
  q3: number | null;
  q4: number | null;
  final_rating: number | null;
  remarks: string | null;
}

/** One row per student for the search index - small enough to ship to the browser whole. */
export interface StudentSummary {
  id: number;
  lrn: string;
  last_name: string;
  first_name: string;
  middle_name: string | null;
  name_ext: string | null;
  levels: string;
}

export function listStudents(): StudentSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT s.id, s.lrn, s.last_name, s.first_name, s.middle_name, s.name_ext,
              COALESCE(GROUP_CONCAT(DISTINCT t.level), '') AS levels
         FROM students s
         LEFT JOIN enrollment_terms t ON t.student_id = s.id
        GROUP BY s.id
        ORDER BY s.last_name, s.first_name`,
    )
    .all();
  return plainAll<StudentSummary>(rows);
}

export function getStudent(id: number): StudentRow | null {
  const row = getDb().prepare(`SELECT * FROM students WHERE id = ?`).get(id);
  return row ? plain<StudentRow>(row) : null;
}

export function getTerms(studentId: number): TermRow[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM enrollment_terms
        WHERE student_id = ?
        ORDER BY level, COALESCE(semester, 0)`,
    )
    .all(studentId);
  return plainAll<TermRow>(rows);
}

export function getSubjects(termId: number): SubjectRow[] {
  const rows = getDb()
    .prepare(`SELECT * FROM term_subjects WHERE term_id = ? ORDER BY ordinal`)
    .all(termId);
  return plainAll<SubjectRow>(rows);
}

export function getEligibility(studentId: number, form: "jhs" | "shs") {
  const table = form === "jhs" ? "jhs_eligibility" : "shs_eligibility";
  return (
    (getDb().prepare(`SELECT * FROM ${table} WHERE student_id = ?`).get(studentId) as
      | Record<string, unknown>
      | undefined) ?? null
  );
}

export function getSchoolSettings(): Record<string, string> {
  const rows = getDb().prepare(`SELECT key, value FROM school_settings`).all() as unknown as {
    key: string;
    value: string;
  }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** Grade levels 7-10 print on the JHS form, 11-12 on the SHS form. */
export function availableForms(terms: TermRow[]): ("jhs" | "shs")[] {
  const forms: ("jhs" | "shs")[] = [];
  if (terms.some((t) => t.level <= 10)) forms.push("jhs");
  if (terms.some((t) => t.level >= 11)) forms.push("shs");
  return forms;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export function updateSubjectGrades(
  subjectId: number,
  grades: { q1: number | null; q2: number | null; q3: number | null; q4: number | null },
  finalRating: number | null,
  remarks: string | null,
): void {
  getDb()
    .prepare(
      `UPDATE term_subjects
          SET q1 = ?, q2 = ?, q3 = ?, q4 = ?, final_rating = ?, remarks = ?
        WHERE id = ?`,
    )
    .run(grades.q1, grades.q2, grades.q3, grades.q4, finalRating, remarks, subjectId);
}

export function updateTerm(
  termId: number,
  fields: { section: string | null; adviser: string | null; school_year: string | null; promotion_remark: string | null },
): void {
  getDb()
    .prepare(
      `UPDATE enrollment_terms
          SET section = ?, adviser = ?, school_year = ?, promotion_remark = ?
        WHERE id = ?`,
    )
    .run(fields.section, fields.adviser, fields.school_year, fields.promotion_remark, termId);
}

export function updateStudent(
  id: number,
  fields: {
    lrn: string;
    last_name: string;
    first_name: string;
    middle_name: string | null;
    name_ext: string | null;
    sex: string | null;
    birthdate: string | null;
  },
): void {
  getDb()
    .prepare(
      `UPDATE students
          SET lrn = ?, last_name = ?, first_name = ?, middle_name = ?, name_ext = ?,
              sex = ?, birthdate = ?, updated_at = datetime('now')
        WHERE id = ?`,
    )
    .run(
      fields.lrn,
      fields.last_name,
      fields.first_name,
      fields.middle_name,
      fields.name_ext,
      fields.sex,
      fields.birthdate,
      id,
    );
}

export function createStudent(fields: {
  lrn: string;
  last_name: string;
  first_name: string;
  middle_name: string | null;
  name_ext: string | null;
  sex: string | null;
  birthdate: string | null;
}): number {
  const db = getDb();
  db.prepare(
    `INSERT INTO students (lrn, last_name, first_name, middle_name, name_ext, sex, birthdate)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    fields.lrn,
    fields.last_name,
    fields.first_name,
    fields.middle_name,
    fields.name_ext,
    fields.sex,
    fields.birthdate,
  );
  const row = db.prepare(`SELECT last_insert_rowid() AS id`).get() as unknown as { id: number };
  return row.id;
}

export function createTerm(
  studentId: number,
  term: {
    level: number;
    semester: number | null;
    school_year: string | null;
    section: string | null;
    adviser: string | null;
    track_strand: string | null;
  },
  school: Record<string, string>,
): number {
  const db = getDb();
  db.prepare(
    `INSERT INTO enrollment_terms
       (student_id, level, semester, school_year, section, adviser, track_strand,
        school_name, school_id, district, division, region)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    studentId,
    term.level,
    term.semester,
    term.school_year,
    term.section,
    term.adviser,
    term.track_strand,
    school.school_name ?? null,
    school.school_id ?? null,
    school.district ?? null,
    school.division ?? null,
    school.region ?? null,
  );
  const row = db.prepare(`SELECT last_insert_rowid() AS id`).get() as unknown as { id: number };
  return row.id;
}

// ---------------------------------------------------------------------------
// Import history and review
// ---------------------------------------------------------------------------

export interface ImportHistoryRow {
  id: number;
  filename: string;
  status: string;
  notes: string | null;
  imported_at: string;
  student_id: number | null;
  last_name: string | null;
  first_name: string | null;
}

export function getImportHistory(limit = 20): ImportHistoryRow[] {
  const rows = getDb()
    .prepare(
      `SELECT f.id, f.filename, f.status, f.notes, f.imported_at, f.student_id,
              s.last_name, s.first_name
         FROM import_files f
         LEFT JOIN students s ON s.id = f.student_id
        ORDER BY f.id DESC
        LIMIT ?`,
    )
    .all(limit);
  return plainAll<ImportHistoryRow>(rows);
}

export interface IssueRow {
  id: number;
  student_id: number | null;
  severity: string;
  field: string | null;
  cell: string | null;
  raw_value: string | null;
  message: string;
  filename: string;
  last_name: string | null;
  first_name: string | null;
  lrn: string | null;
}

export function getOpenIssues(): IssueRow[] {
  const rows = getDb()
    .prepare(
      `SELECT i.id, i.student_id, i.severity, i.field, i.cell, i.raw_value, i.message,
              f.filename, s.last_name, s.first_name, s.lrn
         FROM import_issues i
         JOIN import_files f ON f.id = i.import_file_id
         LEFT JOIN students s ON s.id = i.student_id
        WHERE i.resolved = 0
        ORDER BY CASE i.severity WHEN 'error' THEN 0 ELSE 1 END, s.last_name, i.id`,
    )
    .all();
  return plainAll<IssueRow>(rows);
}

export function countOpenIssues(): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM import_issues WHERE resolved = 0`)
    .get() as { n: number };
  return row.n;
}

/** Open issues for one learner, so their record page can show a review flag. */
export function countIssuesForStudent(studentId: number): number {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS n FROM import_issues WHERE student_id = ? AND resolved = 0`)
    .get(studentId) as { n: number };
  return row.n;
}

export function resolveIssue(issueId: number): void {
  getDb().prepare(`UPDATE import_issues SET resolved = 1 WHERE id = ?`).run(issueId);
}

/** What a delete would destroy. Shown on the confirmation step so the choice is informed. */
export interface DeletionSummary {
  terms: number;
  subjects: number;
}

export function getDeletionSummary(studentId: number): DeletionSummary {
  const row = getDb()
    .prepare(
      `SELECT (SELECT COUNT(*) FROM enrollment_terms WHERE student_id = ?)  AS terms,
              (SELECT COUNT(*) FROM term_subjects
                 WHERE term_id IN (SELECT id FROM enrollment_terms WHERE student_id = ?)) AS subjects`,
    )
    .get(studentId, studentId);
  return plain<DeletionSummary>(row);
}

/**
 * Permanently removes a learner and everything hanging off them.
 *
 * Children are deleted explicitly inside a transaction rather than relying on ON DELETE
 * CASCADE: foreign_keys is a per-connection PRAGMA, so a cascade that works today would fail
 * silently and orphan rows if that pragma were ever missed. This is a permanent academic
 * record - it should not depend on connection state being right.
 */
export function deleteStudent(studentId: number): void {
  const db = getDb();
  db.exec("BEGIN");
  try {
    db.prepare(
      `DELETE FROM term_subjects
        WHERE term_id IN (SELECT id FROM enrollment_terms WHERE student_id = ?)`,
    ).run(studentId);
    db.prepare(`DELETE FROM enrollment_terms WHERE student_id = ?`).run(studentId);
    db.prepare(`DELETE FROM jhs_eligibility WHERE student_id = ?`).run(studentId);
    db.prepare(`DELETE FROM shs_eligibility WHERE student_id = ?`).run(studentId);

    // Review flags die with the learner; leaving them would list issues against a record
    // that no longer exists.
    db.prepare(`DELETE FROM import_issues WHERE student_id = ?`).run(studentId);

    // The import history row is KEPT - it is the record of when that file came in - but it
    // must stop claiming to own a learner. `importBytes` treats a row with no live student as
    // not-yet-imported, which is what lets the file be imported again to restore the record.
    db.prepare(
      `UPDATE import_files SET student_id = NULL, status = 'deleted' WHERE student_id = ?`,
    ).run(studentId);

    db.prepare(`DELETE FROM students WHERE id = ?`).run(studentId);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function createSubjects(
  termId: number,
  subjects: { name: string; category?: string | null }[],
): void {
  const stmt = getDb().prepare(
    `INSERT INTO term_subjects (term_id, ordinal, subject_name, category)
     VALUES (?, ?, ?, ?)`,
  );
  subjects.forEach((s, i) => stmt.run(termId, i, s.name, s.category ?? null));
}
