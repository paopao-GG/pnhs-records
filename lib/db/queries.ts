/**
 * Typed data access. Plain SQL against libSQL - six tables does not justify an ORM, and this
 * keeps the project free of a codegen step.
 *
 * Everything here is async. The driver talks to a local file in development and over HTTP in
 * production, and the second one is the reason to care about round trips: a query that was
 * microseconds in-process is now a network hop. Where a caller needs every subject or every
 * attendance row for a learner, use the `...ForStudent` helpers rather than looping per term.
 */

import { getDb } from "./index.ts";
import type { Client, Row, Transaction } from "@libsql/client";
import type { ShsCategory } from "../sf10/shs-map.ts";

/** Either the shared connection or an open transaction. Writes take one explicitly. */
export type Runner = Pick<Client | Transaction, "execute">;

/**
 * Rows arrive as libSQL `Row` objects, which are array-like as well as keyed by column name.
 * React refuses to serialise those across the server/client boundary ("Only plain objects ...
 * can be passed to Client Components"), so every row leaves this module as a plain object.
 */
function plain<T>(row: Row): T {
  return { ...(row as unknown as object) } as T;
}

function plainAll<T>(rows: Row[]): T[] {
  return rows.map((r) => plain<T>(r));
}

/** Group rows by a numeric key, preserving the order they came back in. */
function groupBy<T>(rows: T[], key: (row: T) => number): Map<number, T[]> {
  const out = new Map<number, T[]>();
  for (const row of rows) {
    const k = key(row);
    const bucket = out.get(k);
    if (bucket) bucket.push(row);
    else out.set(k, [row]);
  }
  return out;
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
  /** 1 when `lrn` is a generated marker (Form 137 predates the LRN system). */
  lrn_placeholder: number | null;
  birthplace_province: string | null;
  birthplace_town: string | null;
  birthplace_barrio: string | null;
  guardian_name: string | null;
  guardian_occupation: string | null;
  guardian_address: string | null;
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
  /** As the source form carried it; null for records encoded in the app. */
  general_average: number | null;
  /** 'k12' or 'old' (Form 137's First-Fourth Year). */
  curriculum: string | null;
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
  /** Form 137 only. */
  units_earned: number | null;
  extra_curricular: string | null;
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

export async function listStudents(): Promise<StudentSummary[]> {
  const db = await getDb();
  const result = await db.execute(
    `SELECT s.id, s.lrn, s.last_name, s.first_name, s.middle_name, s.name_ext,
            COALESCE(GROUP_CONCAT(DISTINCT t.level), '') AS levels
       FROM students s
       LEFT JOIN enrollment_terms t ON t.student_id = s.id
      GROUP BY s.id
      ORDER BY s.last_name, s.first_name`,
  );
  return plainAll<StudentSummary>(result.rows);
}

export async function getStudent(id: number): Promise<StudentRow | null> {
  const db = await getDb();
  const result = await db.execute({ sql: `SELECT * FROM students WHERE id = ?`, args: [id] });
  return result.rows[0] ? plain<StudentRow>(result.rows[0]) : null;
}

export async function getTerms(studentId: number): Promise<TermRow[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM enrollment_terms
           WHERE student_id = ?
           ORDER BY level, COALESCE(semester, 0)`,
    args: [studentId],
  });
  return plainAll<TermRow>(result.rows);
}

export interface AttendanceRow {
  month: string;
  days_of_school: number | null;
  days_present: number | null;
}

/** Form 137 only; SF10 records no attendance. */
export async function getAttendance(termId: number): Promise<AttendanceRow[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT month, days_of_school, days_present
            FROM term_attendance WHERE term_id = ? ORDER BY ordinal`,
    args: [termId],
  });
  return plainAll<AttendanceRow>(result.rows);
}

export async function getSubjects(termId: number): Promise<SubjectRow[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM term_subjects WHERE term_id = ? ORDER BY ordinal`,
    args: [termId],
  });
  return plainAll<SubjectRow>(result.rows);
}

/**
 * Every subject for every one of a learner's terms, keyed by term id.
 *
 * The per-term `getSubjects()` above is fine for a single term, but a record page renders four
 * to eight of them. In-process SQLite made that loop free; over the network it is one round trip
 * per term on the critical path of the page. One query, grouped here, is the same data.
 */
export async function getSubjectsForStudent(studentId: number): Promise<Map<number, SubjectRow[]>> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT s.* FROM term_subjects s
            JOIN enrollment_terms t ON t.id = s.term_id
           WHERE t.student_id = ?
           ORDER BY s.term_id, s.ordinal`,
    args: [studentId],
  });
  return groupBy(plainAll<SubjectRow>(result.rows), (r) => r.term_id);
}

/** Attendance for every one of a learner's terms, keyed by term id. See above for why. */
export async function getAttendanceForStudent(
  studentId: number,
): Promise<Map<number, AttendanceRow[]>> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT a.term_id, a.month, a.days_of_school, a.days_present
            FROM term_attendance a
            JOIN enrollment_terms t ON t.id = a.term_id
           WHERE t.student_id = ?
           ORDER BY a.term_id, a.ordinal`,
    args: [studentId],
  });
  const rows = plainAll<AttendanceRow & { term_id: number }>(result.rows);
  const grouped = groupBy(rows, (r) => r.term_id);

  // Drop the grouping key so callers get the same shape getAttendance() returns.
  return new Map(
    [...grouped].map(([termId, list]) => [
      termId,
      list.map(({ month, days_of_school, days_present }) => ({
        month,
        days_of_school,
        days_present,
      })),
    ]),
  );
}

/** The stored copy of the file a learner's record was imported from, if there is one. */
export async function getOriginalFile(
  studentId: number,
): Promise<{ filename: string; stored_path: string } | null> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT filename, stored_path
            FROM import_files
           WHERE student_id = ? AND stored_path IS NOT NULL
           ORDER BY id DESC LIMIT 1`,
    args: [studentId],
  });
  return result.rows[0] ? plain<{ filename: string; stored_path: string }>(result.rows[0]) : null;
}

export async function getEligibility(
  studentId: number,
  form: "jhs" | "shs",
): Promise<Record<string, unknown> | null> {
  const table = form === "jhs" ? "jhs_eligibility" : "shs_eligibility";
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT * FROM ${table} WHERE student_id = ?`,
    args: [studentId],
  });
  return result.rows[0] ? plain<Record<string, unknown>>(result.rows[0]) : null;
}

export async function getSchoolSettings(): Promise<Record<string, string>> {
  const db = await getDb();
  const result = await db.execute(`SELECT key, value FROM school_settings`);
  return Object.fromEntries(result.rows.map((r) => [String(r.key), String(r.value)]));
}

/**
 * Which SF10 forms this learner can be printed on.
 *
 * Grade levels 7-10 print on the JHS form, 11-12 on the SHS form — **but only for the K-12
 * curriculum.** Form 137 records reuse levels 7-10 for First-Fourth Year, so without the
 * `curriculum` check a 1995 record would be offered a 2017 DepEd form, asserting a curriculum
 * the learner never studied. Those learners get the original document instead.
 *
 * Takes rows rather than an id, so it stays synchronous and testable.
 */
export function availableForms(terms: TermRow[]): ("jhs" | "shs")[] {
  const modern = terms.filter((t) => (t.curriculum ?? "k12") !== "old");
  const forms: ("jhs" | "shs")[] = [];
  if (modern.some((t) => t.level <= 10)) forms.push("jhs");
  if (modern.some((t) => t.level >= 11)) forms.push("shs");
  return forms;
}

/** True when any of the learner's terms come from the pre-K-12 Form 137. */
export function hasOldCurriculum(terms: TermRow[]): boolean {
  return terms.some((t) => t.curriculum === "old");
}

// ---------------------------------------------------------------------------
// Change history
// ---------------------------------------------------------------------------

/**
 * Record one field change.
 *
 * The runner is passed in rather than taken from the module, so this can join the caller's
 * transaction. A libSQL transaction is an object, not connection state — writing through the
 * shared client while a transaction is open would land outside it, and the history would
 * survive a change that got rolled back.
 *
 * Unchanged values are skipped, so autosave firing on a field the user only tabbed through does
 * not fill the log with noise.
 */
export async function recordChange(
  db: Runner,
  userId: number | null,
  studentId: number | null,
  table: string,
  rowId: number,
  field: string,
  oldValue: unknown,
  newValue: unknown,
): Promise<void> {
  const before = oldValue == null ? null : String(oldValue);
  const after = newValue == null ? null : String(newValue);
  if (before === after) return;

  await db.execute({
    sql: `INSERT INTO record_history
            (student_id, table_name, row_id, field, old_value, new_value, user_id)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [studentId, table, rowId, field, before, after, userId],
  });
}

export interface HistoryRow {
  id: number;
  field: string;
  old_value: string | null;
  new_value: string | null;
  changed_at: string;
  table_name: string;
  row_id: number;
}

export async function getHistoryForStudent(studentId: number, limit = 50): Promise<HistoryRow[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT id, field, old_value, new_value, changed_at, table_name, row_id
            FROM record_history
           WHERE student_id = ?
           ORDER BY id DESC
           LIMIT ?`,
    args: [studentId, limit],
  });
  return plainAll<HistoryRow>(result.rows);
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Update one quarter (or the stored final) on a subject, logging the change.
 *
 * Autosave calls this per field rather than saving the whole record, so two people editing
 * different subjects do not overwrite each other, and the history shows exactly what moved.
 */
export async function updateSubjectField(
  subjectId: number,
  field: "q1" | "q2" | "q3" | "q4" | "final_rating",
  value: number | null,
  userId: number | null,
): Promise<{ studentId: number | null; termId: number | null }> {
  const db = await getDb();

  const found = await db.execute({
    sql: `SELECT s.${field} AS current, s.term_id, t.student_id
            FROM term_subjects s
            JOIN enrollment_terms t ON t.id = s.term_id
           WHERE s.id = ?`,
    args: [subjectId],
  });

  const before = found.rows[0]
    ? plain<{ current: number | null; term_id: number; student_id: number }>(found.rows[0])
    : undefined;
  if (!before) throw new Error(`subject ${subjectId} not found`);

  const tx = await db.transaction("write");
  try {
    await tx.execute({
      sql: `UPDATE term_subjects SET ${field} = ? WHERE id = ?`,
      args: [value, subjectId],
    });
    await recordChange(
      tx, userId, before.student_id, "term_subjects", subjectId, field, before.current, value,
    );

    // Editing a quarter invalidates a general average that came from an imported form: the
    // stored figure described the old grades. Clearing it makes the app compute from what is
    // now on screen rather than keep showing a stale number from the paper record.
    if (field !== "final_rating") {
      await tx.execute({
        sql: `UPDATE enrollment_terms SET general_average = NULL
               WHERE id = ? AND general_average IS NOT NULL`,
        args: [before.term_id],
      });
    }

    await tx.commit();
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }

  return { studentId: before.student_id, termId: before.term_id };
}

const UPDATE_SUBJECT_GRADES = `UPDATE term_subjects
     SET q1 = ?, q2 = ?, q3 = ?, q4 = ?, final_rating = ?, remarks = ?
   WHERE id = ?`;

export interface SubjectGradeUpdate {
  subjectId: number;
  grades: { q1: number | null; q2: number | null; q3: number | null; q4: number | null };
  finalRating: number | null;
  remarks: string | null;
}

export async function updateSubjectGrades(
  subjectId: number,
  grades: { q1: number | null; q2: number | null; q3: number | null; q4: number | null },
  finalRating: number | null,
  remarks: string | null,
): Promise<void> {
  await updateSubjectGradesMany([{ subjectId, grades, finalRating, remarks }]);
}

/**
 * Save several subjects' grades at once.
 *
 * Saving a whole record touches every subject in a term - up to forty rows. One statement each
 * would be forty round trips against the hosted database, and a failure halfway would leave the
 * term half-saved. A batch is one trip and all-or-nothing.
 */
export async function updateSubjectGradesMany(updates: SubjectGradeUpdate[]): Promise<void> {
  if (updates.length === 0) return;
  const db = await getDb();
  await db.batch(
    updates.map((u) => ({
      sql: UPDATE_SUBJECT_GRADES,
      args: [
        u.grades.q1,
        u.grades.q2,
        u.grades.q3,
        u.grades.q4,
        u.finalRating,
        u.remarks,
        u.subjectId,
      ],
    })),
    "write",
  );
}

export async function updateTerm(
  termId: number,
  fields: {
    section: string | null;
    adviser: string | null;
    school_year: string | null;
    promotion_remark: string | null;
  },
): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: `UPDATE enrollment_terms
             SET section = ?, adviser = ?, school_year = ?, promotion_remark = ?
           WHERE id = ?`,
    args: [fields.section, fields.adviser, fields.school_year, fields.promotion_remark, termId],
  });
}

export async function updateStudent(
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
): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: `UPDATE students
             SET lrn = ?, last_name = ?, first_name = ?, middle_name = ?, name_ext = ?,
                 sex = ?, birthdate = ?, updated_at = datetime('now')
           WHERE id = ?`,
    args: [
      fields.lrn,
      fields.last_name,
      fields.first_name,
      fields.middle_name,
      fields.name_ext,
      fields.sex,
      fields.birthdate,
      id,
    ],
  });
}

export type StudentFields = Parameters<typeof updateStudent>[1];

/**
 * Update the learner-identity fields and log every one that moved, atomically.
 *
 * The two halves belong in one transaction. A history row describing a change that got rolled
 * back is worse than no history at all - it is a record of something that never happened.
 */
export async function updateStudentWithHistory(
  id: number,
  next: StudentFields,
  before: StudentRow,
  userId: number | null,
): Promise<void> {
  const db = await getDb();
  const tx = await db.transaction("write");
  try {
    await tx.execute({
      sql: `UPDATE students
               SET lrn = ?, last_name = ?, first_name = ?, middle_name = ?, name_ext = ?,
                   sex = ?, birthdate = ?, updated_at = datetime('now')
             WHERE id = ?`,
      args: [
        next.lrn,
        next.last_name,
        next.first_name,
        next.middle_name,
        next.name_ext,
        next.sex,
        next.birthdate,
        id,
      ],
    });

    for (const [field, value] of Object.entries(next)) {
      await recordChange(tx, userId, id, "students", id, field, (before as never)[field], value);
    }

    await tx.commit();
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

export async function createStudent(fields: {
  lrn: string;
  last_name: string;
  first_name: string;
  middle_name: string | null;
  name_ext: string | null;
  sex: string | null;
  birthdate: string | null;
}): Promise<number> {
  const db = await getDb();
  // RETURNING rather than last_insert_rowid(): that function reports the last write on the
  // connection, which is not a safe assumption once connections are pooled and shared.
  const result = await db.execute({
    sql: `INSERT INTO students (lrn, last_name, first_name, middle_name, name_ext, sex, birthdate)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          RETURNING id`,
    args: [
      fields.lrn,
      fields.last_name,
      fields.first_name,
      fields.middle_name,
      fields.name_ext,
      fields.sex,
      fields.birthdate,
    ],
  });
  return Number(result.rows[0].id);
}

export async function createTerm(
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
): Promise<number> {
  const db = await getDb();
  const result = await db.execute({
    sql: `INSERT INTO enrollment_terms
            (student_id, level, semester, school_year, section, adviser, track_strand,
             school_name, school_id, district, division, region)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING id`,
    args: [
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
    ],
  });
  return Number(result.rows[0].id);
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

export async function getImportHistory(limit = 20): Promise<ImportHistoryRow[]> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT f.id, f.filename, f.status, f.notes, f.imported_at, f.student_id,
                 s.last_name, s.first_name
            FROM import_files f
            LEFT JOIN students s ON s.id = f.student_id
           ORDER BY f.id DESC
           LIMIT ?`,
    args: [limit],
  });
  return plainAll<ImportHistoryRow>(result.rows);
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

export async function getOpenIssues(): Promise<IssueRow[]> {
  const db = await getDb();
  const result = await db.execute(
    `SELECT i.id, i.student_id, i.severity, i.field, i.cell, i.raw_value, i.message,
            f.filename, s.last_name, s.first_name, s.lrn
       FROM import_issues i
       JOIN import_files f ON f.id = i.import_file_id
       LEFT JOIN students s ON s.id = i.student_id
      WHERE i.resolved = 0
      ORDER BY CASE i.severity WHEN 'error' THEN 0 ELSE 1 END, s.last_name, i.id`,
  );
  return plainAll<IssueRow>(result.rows);
}

export async function countOpenIssues(): Promise<number> {
  const db = await getDb();
  const result = await db.execute(`SELECT COUNT(*) AS n FROM import_issues WHERE resolved = 0`);
  return Number(result.rows[0].n);
}

/** Open issues for one learner, so their record page can show a review flag. */
export async function countIssuesForStudent(studentId: number): Promise<number> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM import_issues WHERE student_id = ? AND resolved = 0`,
    args: [studentId],
  });
  return Number(result.rows[0].n);
}

export async function resolveIssue(issueId: number): Promise<void> {
  const db = await getDb();
  await db.execute({ sql: `UPDATE import_issues SET resolved = 1 WHERE id = ?`, args: [issueId] });
}

/** What a delete would destroy. Shown on the confirmation step so the choice is informed. */
export interface DeletionSummary {
  terms: number;
  subjects: number;
}

export async function getDeletionSummary(studentId: number): Promise<DeletionSummary> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT (SELECT COUNT(*) FROM enrollment_terms WHERE student_id = ?)  AS terms,
                 (SELECT COUNT(*) FROM term_subjects
                    WHERE term_id IN (SELECT id FROM enrollment_terms WHERE student_id = ?)) AS subjects`,
    args: [studentId, studentId],
  });
  return plain<DeletionSummary>(result.rows[0]);
}

/**
 * Permanently removes a learner and everything hanging off them.
 *
 * Children are deleted explicitly inside a transaction rather than relying on ON DELETE
 * CASCADE: foreign_keys is a per-connection PRAGMA, so a cascade that works today would fail
 * silently and orphan rows if that pragma were ever missed. This is a permanent academic
 * record - it should not depend on connection state being right.
 */
export async function deleteStudent(studentId: number): Promise<void> {
  const db = await getDb();
  const tx = await db.transaction("write");
  try {
    await tx.execute({
      sql: `DELETE FROM term_subjects
             WHERE term_id IN (SELECT id FROM enrollment_terms WHERE student_id = ?)`,
      args: [studentId],
    });
    await tx.execute({
      sql: `DELETE FROM term_attendance
             WHERE term_id IN (SELECT id FROM enrollment_terms WHERE student_id = ?)`,
      args: [studentId],
    });
    await tx.execute({
      sql: `DELETE FROM enrollment_terms WHERE student_id = ?`,
      args: [studentId],
    });
    await tx.execute({ sql: `DELETE FROM jhs_eligibility WHERE student_id = ?`, args: [studentId] });
    await tx.execute({ sql: `DELETE FROM shs_eligibility WHERE student_id = ?`, args: [studentId] });

    // Review flags die with the learner; leaving them would list issues against a record
    // that no longer exists.
    await tx.execute({ sql: `DELETE FROM import_issues WHERE student_id = ?`, args: [studentId] });

    // The import history row is KEPT - it is the record of when that file came in - but it
    // must stop claiming to own a learner. `importBytes` treats a row with no live student as
    // not-yet-imported, which is what lets the file be imported again to restore the record.
    await tx.execute({
      sql: `UPDATE import_files SET student_id = NULL, status = 'deleted' WHERE student_id = ?`,
      args: [studentId],
    });

    await tx.execute({ sql: `DELETE FROM students WHERE id = ?`, args: [studentId] });
    await tx.commit();
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

/**
 * Add one subject to the end of a term.
 *
 * `term_subjects` is UNIQUE(term_id, ordinal), so the ordinal comes from MAX+1 rather than a
 * row count — deleting a middle subject leaves a gap, and counting would collide with it.
 */
export async function appendSubject(
  termId: number,
  name: string,
  category: string | null,
  userId: number | null,
): Promise<number> {
  const db = await getDb();
  const tx = await db.transaction("write");
  try {
    const next = await tx.execute({
      sql: `SELECT COALESCE(MAX(ordinal), -1) + 1 AS next FROM term_subjects WHERE term_id = ?`,
      args: [termId],
    });

    const created = await tx.execute({
      sql: `INSERT INTO term_subjects (term_id, ordinal, subject_name, category)
            VALUES (?, ?, ?, ?)
            RETURNING id`,
      args: [termId, Number(next.rows[0].next), name, category],
    });
    const subjectId = Number(created.rows[0].id);

    const owner = await tx.execute({
      sql: `SELECT student_id FROM enrollment_terms WHERE id = ?`,
      args: [termId],
    });
    const studentId = owner.rows[0] ? Number(owner.rows[0].student_id) : null;

    await recordChange(
      tx, userId, studentId, "term_subjects", subjectId, "subject_name", null, name,
    );
    await tx.commit();
    return subjectId;
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

export async function deleteSubject(subjectId: number, userId: number | null): Promise<void> {
  const db = await getDb();
  const found = await db.execute({
    sql: `SELECT s.subject_name, t.student_id
            FROM term_subjects s
            JOIN enrollment_terms t ON t.id = s.term_id
           WHERE s.id = ?`,
    args: [subjectId],
  });
  const before = found.rows[0]
    ? plain<{ subject_name: string; student_id: number }>(found.rows[0])
    : undefined;
  if (!before) return;

  const tx = await db.transaction("write");
  try {
    await tx.execute({ sql: `DELETE FROM term_subjects WHERE id = ?`, args: [subjectId] });
    await recordChange(
      tx,
      userId,
      before.student_id,
      "term_subjects",
      subjectId,
      "subject_name",
      before.subject_name,
      null,
    );
    await tx.commit();
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

export async function createSubjects(
  termId: number,
  subjects: { name: string; category?: string | null }[],
): Promise<void> {
  if (subjects.length === 0) return;
  const db = await getDb();
  // One batch rather than a loop of executes: a new SHS term seeds a dozen subjects, and each
  // one would otherwise be its own round trip.
  await db.batch(
    subjects.map((s, i) => ({
      sql: `INSERT INTO term_subjects (term_id, ordinal, subject_name, category)
            VALUES (?, ?, ?, ?)`,
      args: [termId, i, s.name, s.category ?? null],
    })),
    "write",
  );
}
