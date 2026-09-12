/**
 * The SF9 report card, filled from stored grades and read back.
 *
 * Read back with the app's own docx reader rather than asserted against markup, so the checks
 * describe what a parent would see rather than what the writer happened to emit.
 *
 * What matters here:
 *
 *  - **Both copies are filled.** The form prints twice on one sheet to be cut apart, and the
 *    two halves are built from different XML. A card correct on the half somebody checked is
 *    the failure this whole design is arranged around.
 *  - **MAPEH's four components become the form's two rows**, while the separately encoded
 *    MAPEH row prints unchanged.
 *  - **The stored EsP subject prints on the pre-printed "Values Education" line**, with nothing
 *    renamed in the database.
 *  - **Only three-period terms qualify.** A four-quarter term has no layout on this form.
 *  - **The general average matches the SF10's**, counting eight subjects rather than the ten
 *    rows the card prints.
 *
 * Runs against a scratch database, not the school's.
 *
 * Run: npm run test:sf9
 */

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scratchDir = mkdtempSync(join(tmpdir(), "pnhs-sf9-"));
process.env.PNHS_DB_PATH = join(scratchDir, "sf9-test.db");
process.env.PNHS_DATA_DIR = scratchDir;

const { applySchema } = await import("../lib/db/index.ts");
const { getClient, LOCAL_DB_PATH } = await import("../lib/db/client.ts");
const q = await import("../lib/db/queries.ts");
const { buildSf9Record, sf9Terms } = await import("../lib/db/to-sf9-record.ts");
const { fillSf9 } = await import("../lib/sf10/export-sf9.ts");
const { readDocxBytes } = await import("../lib/docx/reader.ts");
const { appPath } = await import("../lib/paths.ts");
const { fileGeneratedCard } = await import("../lib/sf9-archive.ts");
const { getOriginal } = await import("../lib/blob/store.ts");
const { quarterFieldsFor, finalRating } = await import("../lib/grading.ts");

if (!LOCAL_DB_PATH.startsWith(scratchDir)) {
  console.error(`\n  refusing to run: the database is ${LOCAL_DB_PATH}, not a scratch file\n`);
  process.exit(1);
}

const db = getClient();
await applySchema(db);

let passed = 0;
const checks: { name: string; fn: () => Promise<void> }[] = [];
const check = (name: string, fn: () => Promise<void>) => checks.push({ name, fn });

const TEMPLATE = appPath("templates", "SF9-JHS.docx");

/**
 * A Grade 9 learner with every JHS subject, MAPEH components deliberately distinct.
 *
 * Music 90 / Arts 80 and PE 70 / Health 60 average to 85 and 65 - values that cannot be
 * confused with any component, so a wrong pairing shows up as a wrong number rather than a
 * plausible one.
 */
let seq = 0;
async function seedLearner(periods: number | null): Promise<number> {
  const studentId = await q.createStudent({
    lrn: String(400000000000 + seq++),
    last_name: "REPORTCARD",
    first_name: "Fixture",
    middle_name: null,
    name_ext: null,
    sex: "F",
    birthdate: "2011-03-01",
  });

  const termId = await q.createTerm(
    studentId,
    {
      level: 9,
      semester: null,
      school_year: "2026-2027",
      section: "Sampaguita",
      adviser: null,
      track_strand: null,
      grading_periods: periods,
    },
    {},
  );

  const marks: Record<string, [number, number, number]> = {
    Filipino: [88, 90, 92],
    English: [85, 87, 89],
    Mathematics: [78, 80, 82],
    Science: [91, 93, 95],
    "Araling Panlipunan (AP)": [84, 86, 88],
    "Edukasyon sa Pagpapakatao (EsP)": [93, 94, 95],
    "Technology and Livelihood Education (TLE)": [87, 88, 89],
    MAPEH: [86, 87, 88],
    Music: [90, 90, 90],
    Arts: [80, 80, 80],
    "Physical Education": [70, 70, 70],
    Health: [60, 60, 60],
    "Homeroom Guidance": [95, 95, 95],
  };

  await q.createSubjects(
    termId,
    Object.keys(marks).map((name) => ({ name })),
  );

  const subjects = (await q.getSubjectsForStudent(studentId)).get(termId) ?? [];
  for (const s of subjects) {
    const row = marks[s.subject_name];
    if (!row) continue;
    await q.updateSubjectField(s.id, "q1", row[0], null);
    await q.updateSubjectField(s.id, "q2", row[1], null);
    await q.updateSubjectField(s.id, "q3", row[2], null);
  }

  return studentId;
}

/** Every cell of the two grades tables, by subject label. */
function gradeRows(bytes: Uint8Array): { copyA: Map<string, string[]>; copyB: Map<string, string[]> } {
  const doc = readDocxBytes(bytes);
  const toMap = (rows: string[][]) => new Map(rows.map((r) => [r[0], r.slice(1)]));
  return { copyA: toMap(doc.tables[0].rows), copyB: toMap(doc.tables[1].rows) };
}

// ------------------------------------------------------------------ eligibility

check("only three-period JHS terms can be printed", async () => {
  const threePeriod = await seedLearner(3);
  const fourQuarter = await seedLearner(4);
  const historical = await seedLearner(null); // null means the historical four

  assert.equal(sf9Terms(await q.getTerms(threePeriod)).length, 1);
  assert.equal(sf9Terms(await q.getTerms(fourQuarter)).length, 0, "four quarters has no layout");
  assert.equal(sf9Terms(await q.getTerms(historical)).length, 0, "null means four quarters");

  assert.equal(await buildSf9Record(fourQuarter), null, "and produces no record to print");
});

check("an old-curriculum term is not offered a modern report card", async () => {
  const studentId = await seedLearner(3);
  await db.execute({
    sql: `UPDATE enrollment_terms SET curriculum = 'old' WHERE student_id = ?`,
    args: [studentId],
  });
  assert.equal(sf9Terms(await q.getTerms(studentId)).length, 0);
});

// ---------------------------------------------------------------------- values

check("MAPEH's four components become the form's two rows", async () => {
  const record = await buildSf9Record(await seedLearner(3));
  assert.ok(record);

  // Music 90 + Arts 80, PE 70 + Health 60.
  assert.deepEqual(record!.subjects.musicArts.terms, [85, 85, 85]);
  assert.deepEqual(record!.subjects.peHealth.terms, [65, 65, 65]);

  // The separately encoded MAPEH row is untouched by that combining.
  assert.deepEqual(record!.subjects.mapeh.terms, [86, 87, 88]);
});

check("a half-encoded MAPEH pair averages what it has", async () => {
  // A missing component contributes nothing rather than counting as a zero.
  const studentId = await seedLearner(3);
  const termId = (await q.getTerms(studentId))[0].id;
  const subjects = (await q.getSubjectsForStudent(studentId)).get(termId) ?? [];
  const arts = subjects.find((s) => s.subject_name === "Arts")!;
  await q.updateSubjectField(arts.id, "q1", null, null);

  const record = await buildSf9Record(studentId);
  assert.equal(record!.subjects.musicArts.terms[0], 90, "Music alone, not averaged with zero");
  assert.equal(record!.subjects.musicArts.terms[1], 85, "the other terms still average both");
});

check("the general average counts eight subjects, not the ten printed rows", async () => {
  /*
   * Averaging the printed rows would count MAPEH three times - the parent plus its two combined
   * children - and disagree with the SF10 for the very same term.
   */
  const record = await buildSf9Record(await seedLearner(3));
  const eight = [90, 87, 80, 93, 86, 94, 88, 87]; // rounded finals of the first eight
  const expected = Math.round(eight.reduce((a, b) => a + b, 0) / eight.length);
  assert.equal(record!.generalAverage, expected);
});

check("a Form 137 learner's generated marker is never printed as an LRN", async () => {
  const studentId = await seedLearner(3);
  await db.execute({
    sql: `UPDATE students SET lrn_placeholder = 1 WHERE id = ?`,
    args: [studentId],
  });
  const record = await buildSf9Record(studentId);
  assert.equal(record!.learner.lrn, null);
});

// ----------------------------------------------------------------- the document

check("both copies of the card are filled", async () => {
  /*
   * The check this whole design exists for. The two halves are built from different XML - the
   * name is three runs in one and a single run in the other - so a text-based filler would
   * complete one and silently leave the other blank.
   */
  const record = await buildSf9Record(await seedLearner(3));
  const { copyA, copyB } = gradeRows(fillSf9(TEMPLATE, record!));

  assert.deepEqual(copyA.get("Filipino")?.slice(0, 3), ["88", "90", "92"]);
  assert.deepEqual(copyB.get("Filipino")?.slice(0, 3), ["88", "90", "92"], "copy B was not filled");
  assert.deepEqual(copyA.get("Filipino"), copyB.get("Filipino"), "the halves must agree");
});

check("the learner's details reach both halves of the sheet", async () => {
  const record = await buildSf9Record(await seedLearner(3));
  const doc = readDocxBytes(fillSf9(TEMPLATE, record!));

  const named = doc.paragraphs.filter((p) => p.includes("REPORTCARD, Fixture"));
  assert.equal(named.length, 2, `the name should appear on both copies, saw ${named.length}`);

  const graded = doc.paragraphs.filter((p) => p.includes("Grade: 9"));
  assert.equal(graded.length, 2, "the grade level should appear on both copies");

  const sectioned = doc.paragraphs.filter((p) => p.includes("Section: Sampaguita"));
  assert.equal(sectioned.length, 2, "the section should appear on both copies");

  // No blank should survive where a value was written.
  assert.equal(
    doc.paragraphs.filter((p) => p.includes("Name: ____")).length,
    0,
    "an unfilled name blank remains",
  );
});

check("EsP prints on the pre-printed Values Education line", async () => {
  const record = await buildSf9Record(await seedLearner(3));
  const { copyA } = gradeRows(fillSf9(TEMPLATE, record!));

  assert.deepEqual(copyA.get("Values Education")?.slice(0, 3), ["93", "94", "95"]);
  // And the database still calls it EsP.
  assert.equal(record!.subjects.values.terms[0], 93);
});

check("the combined MAPEH rows print where the form asks for them", async () => {
  const record = await buildSf9Record(await seedLearner(3));
  const { copyA, copyB } = gradeRows(fillSf9(TEMPLATE, record!));

  assert.deepEqual(copyA.get("Music and Arts")?.slice(0, 3), ["85", "85", "85"]);
  assert.deepEqual(copyA.get("Physical Education and Health")?.slice(0, 3), ["65", "65", "65"]);
  assert.deepEqual(copyB.get("Music and Arts")?.slice(0, 3), ["85", "85", "85"]);
});

check("Homeroom Guidance and CAT never appear", async () => {
  // The form has no row for them; the fixture encodes Homeroom Guidance to prove it is ignored.
  const record = await buildSf9Record(await seedLearner(3));
  const doc = readDocxBytes(fillSf9(TEMPLATE, record!));
  const labels = doc.tables[0].rows.map((r) => r[0]);
  // \bCAT\b, not /cat/i — "Technology and Livelihood Education" contains "cat".
  assert.ok(!labels.some((l) => /Homeroom|\bCAT\b/.test(l)), `saw ${labels.join(", ")}`);
});

check("attendance is left for the adviser, not filled with zeros", async () => {
  /*
   * K-12 terms have no term_attendance rows - that table is Form 137's. Writing zeros would
   * state the learner attended nothing.
   */
  const record = await buildSf9Record(await seedLearner(3));
  const doc = readDocxBytes(fillSf9(TEMPLATE, record!));
  const present = doc.tables[2].rows.find((r) => r[0].startsWith("No. of Day"));
  assert.ok(present, "the attendance row should still be there");
  assert.deepEqual(present!.slice(1), Array(12).fill(""), "days present must stay blank");

  // The school's own pre-printed class days survive untouched.
  const classDays = doc.tables[2].rows.find((r) => r[0].includes("Class Days"));
  assert.equal(classDays?.[12], "201");
});

check("the school year on the card is the term's, not the template's", async () => {
  const record = await buildSf9Record(await seedLearner(3));
  const doc = readDocxBytes(fillSf9(TEMPLATE, record!));
  assert.equal(doc.paragraphs.filter((p) => p.includes("School Year: 2026-2027")).length, 2);
});

check("the filled card is still a readable Word document", async () => {
  const record = await buildSf9Record(await seedLearner(3));
  const doc = readDocxBytes(fillSf9(TEMPLATE, record!));
  assert.equal(doc.tables.length, 6, "every table should survive");
  assert.equal(doc.tables[0].rows.length, 13, "the grades table keeps its shape");
});

// ------------------------------------------------------------------- filing

/*
 * A card is filed against the learner as it is generated, because the grades behind it move
 * afterwards. Without this, "what was this parent actually given in April" has no answer.
 */

check("generating a card files it against the learner", async () => {
  const studentId = await seedLearner(3);
  const record = await buildSf9Record(studentId);
  const bytes = fillSf9(TEMPLATE, record!);

  const id = await fileGeneratedCard(studentId, "SF9_REPORTCARD_Grade9.docx", bytes);
  assert.ok(id, "the card should have been filed");

  const docs = await q.listDocuments(studentId);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].document_type, "sf9");
  assert.equal(docs[0].filename, "SF9_REPORTCARD_Grade9.docx");
});

check("the filed copy is the exact document that was downloaded", async () => {
  /*
   * The point of filing at all. A copy regenerated later would reflect whatever the grades say
   * then, which is precisely the thing being disputed when somebody asks.
   */
  const studentId = await seedLearner(3);
  const bytes = fillSf9(TEMPLATE, (await buildSf9Record(studentId))!);
  await fileGeneratedCard(studentId, "card.docx", bytes);

  const [doc] = await q.listDocuments(studentId);
  const stored = await getOriginal(doc.stored_path);
  assert.ok(stored);
  assert.deepEqual(Array.from(stored!), Array.from(bytes), "the filed bytes must match exactly");
});

check("reprinting the same card does not file a second copy", async () => {
  // Printing a spare for a parent who lost theirs is not a second issuance.
  const studentId = await seedLearner(3);
  const bytes = fillSf9(TEMPLATE, (await buildSf9Record(studentId))!);

  assert.ok(await fileGeneratedCard(studentId, "card.docx", bytes));
  assert.equal(await fileGeneratedCard(studentId, "card.docx", bytes), null, "filed twice");
  assert.equal((await q.listDocuments(studentId)).length, 1);
});

check("a card reprinted after a grade changed files as its own issuance", async () => {
  const studentId = await seedLearner(3);
  const first = fillSf9(TEMPLATE, (await buildSf9Record(studentId))!);
  await fileGeneratedCard(studentId, "card.docx", first);

  // Correct a mark, and the card a parent gets is genuinely a different document.
  const termId = (await q.getTerms(studentId))[0].id;
  const subjects = (await q.getSubjectsForStudent(studentId)).get(termId) ?? [];
  const filipino = subjects.find((x) => x.subject_name === "Filipino")!;
  await q.updateSubjectField(filipino.id, "q1", 61, null);

  const second = fillSf9(TEMPLATE, (await buildSf9Record(studentId))!);
  assert.ok(await fileGeneratedCard(studentId, "card.docx", second), "should file a new row");

  const docs = await q.listDocuments(studentId);
  assert.equal(docs.length, 2, "both issuances should be on record");
  assert.notEqual(docs[0].sha256, docs[1].sha256);
});

check("a learner's cards do not land on another learner's record", async () => {
  const a = await seedLearner(3);
  const b = await seedLearner(3);
  await fileGeneratedCard(a, "card.docx", fillSf9(TEMPLATE, (await buildSf9Record(a))!));
  assert.equal((await q.listDocuments(b)).length, 0);
});

// ------------------------------------------------------- changing the periods

/*
 * Every record the school imported is four-quarter, and the count could previously be chosen
 * only when a record was created. Without a way to change it, no imported term could move to
 * the three-period scheme and the report card was unreachable on real data.
 *
 * The rule these checks defend: **changing the count never destroys a mark.**
 */

check("switching to three periods keeps every fourth-quarter mark", async () => {
  const studentId = await seedLearner(4);
  const termId = (await q.getTerms(studentId))[0].id;

  // Give the fourth quarter marks, as a four-quarter term would have.
  for (const s of (await q.getSubjectsForStudent(studentId)).get(termId) ?? []) {
    await q.updateSubjectField(s.id, "q4", 77, null);
  }

  await q.updateTermPeriods(termId, 3, 4, null);

  const after = (await q.getSubjectsForStudent(studentId)).get(termId) ?? [];
  assert.ok(after.length > 0);
  assert.ok(
    after.every((s) => s.q4 === 77),
    "the marks must still be there, just no longer counted",
  );
});

check("and the term then averages three columns instead of four", async () => {
  const studentId = await seedLearner(4);
  const termId = (await q.getTerms(studentId))[0].id;
  const subject = ((await q.getSubjectsForStudent(studentId)).get(termId) ?? [])[0];
  // 88, 90, 92 from the fixture; a fourth that would drag the average down.
  await q.updateSubjectField(subject.id, "q4", 50, null);

  const asFour = (await q.getTerms(studentId))[0];
  assert.equal(quarterFieldsFor(asFour).length, 4);
  const fourAvg = finalRating({ q1: 88, q2: 90, q3: 92, q4: 50 }, "jhs");

  await q.updateTermPeriods(termId, 3, 4, null);
  const asThree = (await q.getTerms(studentId))[0];
  assert.equal(quarterFieldsFor(asThree).length, 3);

  const record = await buildSf9Record(studentId);
  assert.notEqual(record!.subjects.filipino.final, fourAvg, "the fourth quarter still counted");
  assert.equal(record!.subjects.filipino.final, 90, "should be the mean of 88, 90 and 92");
});

check("switching back restores exactly what was there", async () => {
  const studentId = await seedLearner(4);
  const termId = (await q.getTerms(studentId))[0].id;
  const subject = ((await q.getSubjectsForStudent(studentId)).get(termId) ?? [])[0];
  await q.updateSubjectField(subject.id, "q4", 50, null);

  const before = finalRating(
    ((await q.getSubjectsForStudent(studentId)).get(termId) ?? [])[0],
    "jhs",
  );

  await q.updateTermPeriods(termId, 3, 4, null);
  await q.updateTermPeriods(termId, 4, 3, null);

  const restored = ((await q.getSubjectsForStudent(studentId)).get(termId) ?? [])[0];
  assert.equal(restored.q4, 50);
  assert.equal(finalRating(restored, "jhs"), before, "the original final rating should be back");
});

check("the change is written to the audit trail", async () => {
  // It changes what a permanent record prints, so it belongs in the history.
  const studentId = await seedLearner(4);
  const termId = (await q.getTerms(studentId))[0].id;
  await q.updateTermPeriods(termId, 3, 4, null);

  const history = await db.execute({
    sql: `SELECT old_value, new_value FROM record_history
           WHERE student_id = ? AND field = 'grading_periods'`,
    args: [studentId],
  });
  assert.equal(history.rows.length, 1);
  assert.equal(history.rows[0].old_value, "4");
  assert.equal(history.rows[0].new_value, "3");
});

check("a four-quarter term becomes printable once switched - the gap this closes", async () => {
  /*
   * The whole point. Before this existed, an imported Grade 9 could never be offered a report
   * card, because the count was fixed at creation and every imported term carried four.
   */
  const studentId = await seedLearner(4);
  assert.equal(sf9Terms(await q.getTerms(studentId)).length, 0, "starts unprintable");

  const termId = (await q.getTerms(studentId))[0].id;
  await q.updateTermPeriods(termId, 3, 4, null);

  assert.equal(sf9Terms(await q.getTerms(studentId)).length, 1, "should now be printable");
  assert.ok(await buildSf9Record(studentId), "and should produce a record");
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

console.log(process.exitCode ? "\nsf9: FAILURES above\n" : `\nsf9: ${passed} checks passed\n`);
