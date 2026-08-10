/**
 * Form 137 parsing checks, run against the school's real files.
 *
 * These pin the things that actually went wrong while building it, so they cannot regress:
 * a label matching inside a surname, bracketed unit values, empty years being imported as
 * attended, and the two storage variants disagreeing.
 *
 * Run: npm run test:f137
 */

import { strict as assert } from "node:assert";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { parseF137Bytes, placeholderLrn } from "../lib/sf10/import-f137.ts";
import { parseGrade } from "../lib/sf10/normalise.ts";
import { detectByBytes } from "../lib/sf10/detect-form.ts";
import { availableForms, hasOldCurriculum, type TermRow } from "../lib/db/queries.ts";
import { getDb } from "../lib/db/index.ts";
import { buildSf10Record } from "../lib/db/to-sf10-record.ts";

const DIR = "sf10-files/form137";
const TABLE_VARIANT = "F-137 VILLARAZA, MARVY A.- 2007-2008.docx";
const EMBEDDED_VARIANT = "F-137 QUINDAY, JUDITH A.. 1995-1996.docx";
const DUPLICATED = "F-137- PALIZA, JHON JACOB.docx";

let passed = 0;
// Collected then run at the end, because some checks query the database and are therefore
// async. Running them as they are declared would let a later check observe an earlier one's
// half-finished writes.
const checks: { name: string; fn: () => void | Promise<void> }[] = [];
const check = (name: string, fn: () => void | Promise<void>) => checks.push({ name, fn });

const parse = (file: string) => parseF137Bytes(readFileSync(join(DIR, file)));

if (!existsSync(join(DIR, TABLE_VARIANT))) {
  console.log("\nform137: sample files not present, skipping\n");
  process.exit(0);
}

check("a .docx is recognised as Form 137", () => {
  assert.equal(detectByBytes(readFileSync(join(DIR, TABLE_VARIANT))), "f137");
  assert.equal(detectByBytes(readFileSync(join(DIR, EMBEDDED_VARIANT))), "f137");
});

check("both storage variants produce the same shape", () => {
  // 17 files keep grades in Word tables; 3 keep them in embedded Excel workbooks.
  for (const file of [TABLE_VARIANT, EMBEDDED_VARIANT]) {
    const { record, termCount } = parse(file);
    assert.ok(termCount > 0, `${file}: no terms`);
    assert.ok(record.student.lastName.length > 0, `${file}: no surname`);
    assert.ok(record.terms[0].subjects.length > 0, `${file}: no subjects`);
    assert.equal(record.terms[0].curriculum, "old");
    assert.equal(record.terms[0].level, 7);
  }
});

check("a label does not match inside a surname", () => {
  // "Day" appears inside QUINDAY. Without a word boundary the parser read the whole line as
  // the day of birth and produced a birthdate of "1982 JANUARY , JUDITH A. Date of Birth...".
  const { record } = parse(EMBEDDED_VARIANT);
  assert.equal(record.student.lastName, "QUINDAY");
  assert.equal(record.student.birthdate, "01/09/1982");
});

check("learner details come off the form intact", () => {
  const { record } = parse(TABLE_VARIANT);
  const s = record.student;
  assert.equal(s.lastName, "VILLARAZA");
  assert.equal(s.firstName, "MARVY");
  assert.equal(s.sex, "F");
  assert.equal(s.birthdate, "11/21/1991");
  assert.equal(s.birthplaceProvince, "ALBAY");
  assert.equal(s.birthplaceTown, "LIBON");
  assert.equal(s.guardianName, "MR. EDUARDO VILLARAZA");
  assert.equal(s.guardianOccupation, "FISHERMAN");
});

check("a year with no marks is not imported as attended", () => {
  // VILLARAZA dropped out in January 2009, during Second Year. The blank form still prints
  // subject names for Third and Fourth Year; importing those would assert enrolment.
  const { record, termCount } = parse(TABLE_VARIANT);
  assert.equal(termCount, 2, "expected only the years actually attended");
  assert.deepEqual(record.terms.map((t) => t.level), [7, 8]);
});

check("final ratings are taken from the document, never recomputed", () => {
  const { record } = parse(TABLE_VARIANT);
  const filipino = record.terms[0].subjects[0];
  assert.equal(filipino.name, "FILIPINO I");
  assert.deepEqual([filipino.q1, filipino.q2, filipino.q3, filipino.q4], [76, 80, 83, 84]);
  assert.equal(filipino.finalRating, 80.75);

  // QUINDAY is the case that proves the rule: 83.20 is NOT the mean of its quarters.
  const q = parse(EMBEDDED_VARIANT).record.terms[0].subjects;
  const mismatched = q.find((s) => {
    const marks = [s.q1, s.q2, s.q3, s.q4].filter((n): n is number => n != null);
    if (marks.length < 4 || s.finalRating == null) return false;
    return Math.abs(marks.reduce((a, b) => a + b, 0) / marks.length - s.finalRating) > 0.01;
  });
  assert.ok(mismatched, "expected at least one final that is not the mean of its quarters");
});

check("bracketed unit values are read as numbers", () => {
  // `[1.2]` and `(1.2)` are a footnote convention in the Units Earned column, not accounting
  // negatives: 143 of the 144 bracketed values across the real files sit against "Passed".
  assert.equal(parseGrade("[1.2]", "units").value, 1.2);
  assert.equal(parseGrade("(0.6)", "units").value, 0.6);
  assert.equal(parseGrade("[1.2]", "units").issues.length, 0);
});

check("a file holding the form twice imports one learner and says so", () => {
  const { record, issues } = parse(DUPLICATED);
  assert.equal(record.student.lastName, "PALIZA");
  assert.ok(
    issues.some((i) => /contains the form 2 times/.test(i.message)),
    "expected an issue noting the duplicate copy",
  );
});

check("the placeholder LRN is stable and obviously not an LRN", () => {
  const a = placeholderLrn({ lastName: "QUINDAY", firstName: "JUDITH", birthdate: "01/09/1982" });
  const b = placeholderLrn({ lastName: "quinday", firstName: "judith", birthdate: "01/09/1982" });
  const c = placeholderLrn({ lastName: "QUINDAY", firstName: "JUDITH", birthdate: "01/09/1983" });

  assert.equal(a, b, "same learner must map to the same key regardless of casing");
  assert.notEqual(a, c, "a different birthdate must be a different learner");
  assert.ok(a.startsWith("F137-"), "must be visibly not a real LRN");
  assert.ok(!/^\d{12}$/.test(a), "must not look like a 12-digit LRN");
});

check("buildSf10Record drops old-curriculum terms", async () => {
  // Hiding the print button is not the same as refusing the action: the print endpoint is
  // reachable by URL. Before this guard existed it returned 200 and put a 1995 record on a
  // 2017 form. Only run when a Form 137 learner is actually in the database.
  const db = await getDb();
  const found = await db.execute(
    `SELECT student_id FROM enrollment_terms WHERE curriculum = 'old' LIMIT 1`,
  );
  const old = found.rows[0];

  if (!old) return; // nothing imported yet; the browser pass covers this too

  for (const form of ["jhs", "shs"] as const) {
    const record = await buildSf10Record(Number(old.student_id), form);
    assert.equal(
      record?.terms.length ?? 0,
      0,
      `${form}: an old-curriculum learner must yield no printable terms`,
    );
  }
});

check("an old-curriculum learner is never offered an SF10 print", () => {
  // The review blocker: levels 7-10 are reused for First-Fourth Year, so without the
  // curriculum check a 1995 record would be offered a 2017 DepEd form.
  const old = [{ level: 7, curriculum: "old" }, { level: 8, curriculum: "old" }] as TermRow[];
  const modern = [{ level: 7, curriculum: "k12" }] as TermRow[];

  assert.deepEqual(availableForms(old), [], "old records must offer no SF10 form");
  assert.deepEqual(availableForms(modern), ["jhs"]);
  assert.equal(hasOldCurriculum(old), true);
  assert.equal(hasOldCurriculum(modern), false);
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

console.log(
  process.exitCode ? "\nform137: FAILURES above\n" : `\nform137: ${passed} checks passed\n`,
);
