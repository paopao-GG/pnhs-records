/**
 * What a learner is, and how carefully the app is allowed to guess it.
 *
 * `suggestStudentStatus()` decides what the record page proposes to the registrar, and that
 * proposal is one Accept click away from gating whether a diploma prints. So the properties
 * worth pinning down are less about the happy path than about restraint:
 *
 *  - it never proposes "Transferred Out" or "Left School", because nothing in the data can
 *    distinguish those from an unfinished encoding;
 *  - it returns null rather than guessing when the last term's outcome cannot be read;
 *  - a learner who went on to SHS is not a "JHS Graduate" today, even though they did finish
 *    Grade 10 on the way past.
 *
 * Plus the persistence half: setting a status writes a `record_history` row, because "who
 * decided this learner graduated, and when" has to stay answerable.
 *
 * Runs against a scratch database file, not the school's.
 *
 * Run: npm run test:status
 */

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the shared connection at a scratch file BEFORE importing anything that opens it.
// See test-subject-order.ts for why the dynamic imports below are what make that ordering real.
const scratchDir = mkdtempSync(join(tmpdir(), "pnhs-status-"));
process.env.PNHS_DB_PATH = join(scratchDir, "status-test.db");
process.env.PNHS_DATA_DIR = scratchDir;

const { applySchema } = await import("../lib/db/index.ts");
const { getClient, LOCAL_DB_PATH } = await import("../lib/db/client.ts");
const q = await import("../lib/db/queries.ts");
const { suggestStudentStatus, isStudentStatus, statusLabel, STUDENT_STATUSES } = await import(
  "../lib/status.ts"
);

if (!LOCAL_DB_PATH.startsWith(scratchDir)) {
  console.error(`\n  refusing to run: the database is ${LOCAL_DB_PATH}, not a scratch file\n`);
  process.exit(1);
}

const db = getClient();
await applySchema(db);

let passed = 0;
const checks: { name: string; fn: () => Promise<void> }[] = [];
const check = (name: string, fn: () => Promise<void>) => checks.push({ name, fn });

/** A term as `suggestStudentStatus` reads one. Defaults to a passing k12 term. */
function term(over: Partial<Parameters<typeof suggestStudentStatus>[0][number]> = {}) {
  return {
    level: 7,
    semester: null,
    curriculum: "k12",
    promotion_remark: "Promoted",
    general_average: 88,
    ...over,
  };
}

const NOBODY = { shs_semesters: null };

// --------------------------------------------------------------- suggestion

check("no terms means nothing to suggest", async () => {
  assert.equal(suggestStudentStatus([], NOBODY), null);
});

check("an old-curriculum record is archive-only", async () => {
  const terms = [term({ level: 9, curriculum: "old" })];
  assert.equal(suggestStudentStatus(terms, NOBODY), "old_curriculum");
});

check("a promoted Grade 10 with nothing after it suggests JHS Graduate", async () => {
  const terms = [term({ level: 9 }), term({ level: 10 })];
  assert.equal(suggestStudentStatus(terms, NOBODY), "jhs_graduate");
});

check("a learner who went on to SHS is not a JHS Graduate", async () => {
  /*
   * They did finish Grade 10, but they are not what a registrar means by "JHS Graduate" -
   * that phrase describes someone whose schooling here ended there.
   */
  const terms = [term({ level: 10 }), term({ level: 11, semester: 1 })];
  assert.equal(suggestStudentStatus(terms, NOBODY), "enrolled");
});

check("a promoted Grade 12 second semester suggests SHS Graduate", async () => {
  const terms = [term({ level: 12, semester: 1 }), term({ level: 12, semester: 2 })];
  assert.equal(suggestStudentStatus(terms, NOBODY), "shs_graduate");
});

check("Grade 12 first semester is still enrolled", async () => {
  const terms = [term({ level: 12, semester: 1 })];
  assert.equal(suggestStudentStatus(terms, NOBODY), "enrolled");
});

check("a retained final term is enrolled, not graduated", async () => {
  const terms = [term({ level: 10, promotion_remark: "RETAINED", general_average: 70 })];
  assert.equal(suggestStudentStatus(terms, NOBODY), "enrolled");
});

check("conditionally promoted counts as promoted", async () => {
  // The learner did advance. Whatever the condition was is not this system's business.
  const terms = [term({ level: 10, promotion_remark: "CONDITIONALLY PROMOTED" })];
  assert.equal(suggestStudentStatus(terms, NOBODY), "jhs_graduate");
});

check("an unreadable final term suggests nothing at all", async () => {
  /*
   * No remark and no general average: the term exists but its outcome does not. Guessing
   * "enrolled" here would be as much an invention as guessing "graduate".
   */
  const terms = [term({ level: 10, promotion_remark: null, general_average: null })];
  assert.equal(suggestStudentStatus(terms, NOBODY), null);
});

check("a blank remark falls through to the general average", async () => {
  const terms = [term({ level: 10, promotion_remark: "   ", general_average: 91 })];
  assert.equal(suggestStudentStatus(terms, NOBODY), "jhs_graduate");
});

check("terms out of order still resolve to the furthest one", async () => {
  const terms = [term({ level: 10 }), term({ level: 8 }), term({ level: 7 })];
  assert.equal(suggestStudentStatus(terms, NOBODY), "jhs_graduate");
});

check("it can never suggest transferred_out or left_school", async () => {
  /*
   * The load-bearing check. Nothing in enrollment_terms records WHY a learner stopped
   * appearing - a transfer, a dropout and a half-finished encoding are the same absent row.
   * If a future change makes this pass a leave reason through, it should fail here first.
   */
  const shapes = [
    [] as ReturnType<typeof term>[],
    [term({ level: 7 })],
    [term({ level: 10 })],
    [term({ level: 10, promotion_remark: "RETAINED" })],
    [term({ level: 12, semester: 2 })],
    [term({ level: 9, curriculum: "old" })],
    [term({ level: 10, promotion_remark: null, general_average: null })],
  ];
  for (const shape of shapes) {
    const got = suggestStudentStatus(shape, NOBODY);
    assert.ok(
      got !== "transferred_out" && got !== "left_school",
      `suggested ${got} for ${JSON.stringify(shape.map((t) => t.level))}`,
    );
  }
});

// ------------------------------------------------------------------- labels

check("an unrecognised stored value has no label and is not a status", async () => {
  // The column is TEXT. A value written by a future build, or by hand, must not crash a page.
  assert.equal(isStudentStatus("graduated"), false);
  assert.equal(statusLabel("graduated"), null);
  assert.equal(statusLabel(null), null);
  assert.equal(statusLabel("shs_graduate"), "SHS Graduate");
});

// -------------------------------------------------------------- persistence

let seq = 0;
async function makeLearner(): Promise<number> {
  return q.createStudent({
    lrn: String(200000000000 + seq++),
    last_name: "STATUS",
    first_name: `Case ${seq}`,
    middle_name: null,
    name_ext: null,
    sex: "F",
    birthdate: "2008-01-01",
  });
}

check("a new learner starts unconfirmed", async () => {
  const id = await makeLearner();
  const student = await q.getStudent(id);
  assert.equal(student?.status, null, "status must not be guessed at creation");
});

check("setting a status stores it and logs the move", async () => {
  const id = await makeLearner();
  await q.updateStudentStatus(id, "shs_graduate", null, null);

  const student = await q.getStudent(id);
  assert.equal(student?.status, "shs_graduate");

  const history = await db.execute({
    sql: `SELECT old_value, new_value FROM record_history
           WHERE student_id = ? AND field = 'status'`,
    args: [id],
  });
  assert.equal(history.rows.length, 1, "the change must be in record_history");
  assert.equal(history.rows[0].old_value, null);
  assert.equal(history.rows[0].new_value, "shs_graduate");
});

check("a status can be cleared back to unconfirmed", async () => {
  // A registrar who picked the wrong value needs a way back that is not a second wrong value.
  const id = await makeLearner();
  await q.updateStudentStatus(id, "left_school", null, null);
  await q.updateStudentStatus(id, null, "left_school", null);

  const student = await q.getStudent(id);
  assert.equal(student?.status, null);

  const history = await db.execute({
    sql: `SELECT new_value FROM record_history
           WHERE student_id = ? AND field = 'status' ORDER BY id`,
    args: [id],
  });
  assert.equal(history.rows.length, 2);
  assert.equal(history.rows[1].new_value, null);
});

check("every status the type allows is accepted by the database", async () => {
  /*
   * The CHECK constraint in schema.sql and the union in lib/status.ts are written out
   * separately, so they can drift. This is what notices.
   */
  for (const status of STUDENT_STATUSES) {
    const id = await makeLearner();
    await q.updateStudentStatus(id, status, null, null);
    const student = await q.getStudent(id);
    assert.equal(student?.status, status, `${status} did not survive a round trip`);
  }
});

check("a status outside the list is refused by the database", async () => {
  const id = await makeLearner();
  await assert.rejects(
    () =>
      db.execute({
        sql: `UPDATE students SET status = ? WHERE id = ?`,
        args: ["graduated", id],
      }),
    "the CHECK constraint should refuse an unknown status",
  );
});

for (const { name, fn } of checks) {
  try {
    await fn();
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}

db.close();
try {
  rmSync(scratchDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
} catch {
  /* the OS will clear it */
}

console.log(
  process.exitCode ? "\nstatus: FAILURES above\n" : `\nstatus: ${passed} checks passed\n`,
);
