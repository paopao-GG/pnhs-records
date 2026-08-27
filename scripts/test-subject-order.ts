/**
 * Moving a subject within its term.
 *
 * Order is not presentation here. `fillJhs` writes subject *i* into template row
 * `firstSubject + i`, only the first 12 rows carry the template's own final-rating formula, and
 * only the first EIGHT count toward the general average. So a swap changes which line of a
 * learner's printed permanent record a subject occupies, and whether it counts toward the figure
 * that decides promotion.
 *
 * The two things most likely to be got wrong, and the reason this file exists:
 *
 *  - `deleteSubject` leaves gaps in `ordinal`, so the neighbour has to be found by ordering
 *    rather than by `ordinal ± 1`.
 *  - `term_subjects` is `UNIQUE (term_id, ordinal)` and SQLite checks it per statement, so a
 *    two-statement swap collides on the first write.
 *
 * Runs against a scratch database file, not the school's.
 *
 * Run: npm run test:subject-order
 */

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/*
 * Point the shared connection at a scratch file BEFORE importing anything that touches it.
 * `client.ts` resolves the path once, at module load; the dynamic imports below are what make
 * that ordering guaranteed rather than incidental. See test-unlock.ts for the same guard.
 */
const scratchDir = mkdtempSync(join(tmpdir(), "pnhs-order-"));
process.env.PNHS_DB_PATH = join(scratchDir, "order-test.db");
process.env.PNHS_DATA_DIR = scratchDir;

const { applySchema } = await import("../lib/db/index.ts");
const { getClient, LOCAL_DB_PATH } = await import("../lib/db/client.ts");
const q = await import("../lib/db/queries.ts");
const { generalAverage } = await import("../lib/grading.ts");

if (!LOCAL_DB_PATH.startsWith(scratchDir)) {
  console.error(`\n  refusing to run: the database is ${LOCAL_DB_PATH}, not a scratch file\n`);
  process.exit(1);
}

const db = getClient();
await applySchema(db);

let passed = 0;
const checks: { name: string; fn: () => Promise<void> }[] = [];
const check = (name: string, fn: () => Promise<void>) => checks.push({ name, fn });

const USER = 1;
let studentSeq = 0;

/** A learner with one Grade 7 term carrying the named subjects, in order. */
async function makeTerm(names: string[]): Promise<{ termId: number; studentId: number }> {
  const lrn = String(100000000000 + studentSeq++);
  const studentId = await q.createStudent({
    lrn,
    last_name: "TEST",
    first_name: lrn,
    middle_name: null,
    name_ext: null,
    sex: null,
    birthdate: null,
  });
  const termId = await q.createTerm(
    studentId,
    {
      level: 7,
      semester: null,
      school_year: null,
      section: null,
      adviser: null,
      track_strand: null,
    },
    {},
  );
  await q.createSubjects(termId, names.map((name) => ({ name })));
  return { termId, studentId };
}

const order = async (termId: number): Promise<string[]> =>
  (await q.getSubjects(termId)).map((s) => s.subject_name);

const ordinals = async (termId: number): Promise<number[]> =>
  (await q.getSubjects(termId)).map((s) => s.ordinal);

check("moving up swaps with the subject above", async () => {
  const { termId } = await makeTerm(["Filipino", "English", "Mathematics"]);
  const [, english] = await q.getSubjects(termId);

  await q.swapSubjectOrder(english!.id, "up", USER);
  assert.deepEqual(await order(termId), ["English", "Filipino", "Mathematics"]);
});

check("moving down swaps with the subject below", async () => {
  const { termId } = await makeTerm(["Filipino", "English", "Mathematics"]);
  const [filipino] = await q.getSubjects(termId);

  await q.swapSubjectOrder(filipino!.id, "down", USER);
  assert.deepEqual(await order(termId), ["English", "Filipino", "Mathematics"]);
});

check("the first row cannot move up and the last cannot move down", async () => {
  // A no-op rather than an error: the buttons are disabled there, but a stale page must not
  // produce a failure the registrar has to interpret.
  const { termId } = await makeTerm(["Filipino", "English"]);
  const [first, last] = await q.getSubjects(termId);

  await q.swapSubjectOrder(first!.id, "up", USER);
  await q.swapSubjectOrder(last!.id, "down", USER);
  assert.deepEqual(await order(termId), ["Filipino", "English"]);
});

check("a gap in the ordinals does not confuse the neighbour", async () => {
  /*
   * The case `ordinal ± 1` gets wrong. Deleting a middle subject leaves its ordinal unused, and
   * `appendSubject` never reuses it - which is why the neighbour is found by ordering.
   */
  const { termId } = await makeTerm(["Filipino", "English", "Mathematics", "Science"]);
  const before = await q.getSubjects(termId);

  await q.deleteSubject(before[1]!.id, USER); // remove English, leaving ordinal 1 unused
  assert.deepEqual(await ordinals(termId), [0, 2, 3], "the gap is the premise of this test");

  const [, maths] = await q.getSubjects(termId);
  await q.swapSubjectOrder(maths!.id, "up", USER);
  assert.deepEqual(await order(termId), ["Mathematics", "Filipino", "Science"]);
});

check("a long run of moves never violates UNIQUE (term_id, ordinal)", async () => {
  // The reason the swap takes three statements. Two would collide on the first write.
  const { termId } = await makeTerm(["A", "B", "C", "D", "E"]);

  for (let i = 0; i < 40; i++) {
    const subjects = await q.getSubjects(termId);
    const at = i % (subjects.length - 1);
    await q.swapSubjectOrder(subjects[at]!.id, "down", USER);
    await q.swapSubjectOrder(subjects[at]!.id, "up", USER);

    const seen = await ordinals(termId);
    assert.equal(new Set(seen).size, seen.length, `duplicate ordinal after move ${i}: ${seen}`);
  }

  assert.deepEqual(await order(termId), ["A", "B", "C", "D", "E"], "down then up returns it");
});

check("both moved rows are written to the history", async () => {
  // A history naming only one of them would describe a state the table was never in.
  const { termId, studentId } = await makeTerm(["Filipino", "English"]);
  const [filipino, english] = await q.getSubjects(termId);

  await q.swapSubjectOrder(english!.id, "up", USER);

  const history = await db.execute({
    sql: `SELECT row_id, old_value, new_value, user_id FROM record_history
           WHERE student_id = ? AND field = 'ordinal' ORDER BY row_id`,
    args: [studentId],
  });

  assert.equal(history.rows.length, 2, "one entry per moved row");
  const byRow = new Map(history.rows.map((r) => [Number(r.row_id), r]));
  assert.deepEqual(
    [byRow.get(filipino!.id)!.old_value, byRow.get(filipino!.id)!.new_value],
    ["0", "1"],
  );
  assert.deepEqual(
    [byRow.get(english!.id)!.old_value, byRow.get(english!.id)!.new_value],
    ["1", "0"],
  );
  assert.equal(Number(history.rows[0].user_id), USER, "attributable to whoever moved it");
});

check("moving a subject into the top eight changes the general average", async () => {
  /*
   * The whole point of the feature. Only the first eight rows count, so a subject sitting ninth
   * contributes nothing until it is moved up - and a registrar who cannot move it has no way to
   * make the app agree with the paper form.
   */
  const { termId } = await makeTerm([
    "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Ninth",
  ]);
  const subjects = await q.getSubjects(termId);

  // Eight 90s, then a 60 sitting outside the averaged rows.
  for (const s of subjects.slice(0, 8)) {
    for (const field of ["q1", "q2", "q3", "q4"] as const) {
      await q.updateSubjectField(s.id, field, 90, USER);
    }
  }
  for (const field of ["q1", "q2", "q3", "q4"] as const) {
    await q.updateSubjectField(subjects[8]!.id, field, 60, USER);
  }

  const averageNow = async () =>
    generalAverage(
      (await q.getSubjects(termId)).map((s) => (s.q1! + s.q2! + s.q3! + s.q4!) / 4),
      "jhs",
    );

  assert.equal(await averageNow(), 90, "the ninth row is outside the average");

  const ninth = (await q.getSubjects(termId))[8]!;
  await q.swapSubjectOrder(ninth.id, "up", USER);

  assert.equal(await averageNow(), 86, "moving it in pulls the average down");
});

check("a move clears the general average imported from the form", async () => {
  /*
   * Without this the app keeps showing the figure the paper carried while the printed SF10 -
   * whose general average is a live formula over the first eight rows - recomputes from the new
   * order. Two different numbers for the same term, and nothing saying which is right.
   */
  const { termId } = await makeTerm(["Filipino", "English", "Mathematics"]);
  await db.execute({
    sql: `UPDATE enrollment_terms SET general_average = 87.03125 WHERE id = ?`,
    args: [termId],
  });

  const [, english] = await q.getSubjects(termId);
  await q.swapSubjectOrder(english!.id, "up", USER);

  const after = await db.execute({
    sql: `SELECT general_average FROM enrollment_terms WHERE id = ?`,
    args: [termId],
  });
  assert.equal(after.rows[0].general_average, null, "the imported figure must not survive a move");
});

check("a move that goes nowhere leaves the general average alone", async () => {
  // The first row cannot move up. Nothing changed, so nothing about the term should change.
  const { termId } = await makeTerm(["Filipino", "English"]);
  await db.execute({
    sql: `UPDATE enrollment_terms SET general_average = 91.5 WHERE id = ?`,
    args: [termId],
  });

  const [first] = await q.getSubjects(termId);
  await q.swapSubjectOrder(first!.id, "up", USER);

  const after = await db.execute({
    sql: `SELECT general_average FROM enrollment_terms WHERE id = ?`,
    args: [termId],
  });
  assert.equal(Number(after.rows[0].general_average), 91.5);
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
  process.exitCode
    ? "\nsubject order: FAILURES above\n"
    : `\nsubject order: ${passed} checks passed\n`,
);
