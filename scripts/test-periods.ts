/**
 * Three grading periods instead of four.
 *
 * From SY 2026-2027 a JHS grade level is graded over three quarters and an SHS programme runs
 * three semesters. The count is stored per term (JHS) and per learner (SHS) rather than
 * globally, because a learner straddles the cutover — Grade 7 on four quarters and Grade 9 on
 * three, on one permanent record.
 *
 * The checks that earn their place:
 *
 *  - **A mixed record round-trips.** Fill a form with a four-quarter Grade 7 and a
 *    three-quarter Grade 9, read it back, and get the same two counts. Both blocks are on the
 *    same sheet, so this is what proves the quarter heading is genuinely per block.
 *  - **The count is read from the form, not from the grades.** A four-quarter record encoded in
 *    November has no Q4 either. If detection ever moves to "no Q4 anywhere", the November case
 *    below starts failing, which is the point of it.
 *  - **An unused SHS block does not print the template's sample data.** The DepEd template
 *    ships with a school year, a section and a PROMOTED remark left in the Grade 11 blocks.
 *
 * Nothing here touches the database.
 *
 * Run: npm run test:periods
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fillJhs, fillShs } from "../lib/sf10/export.ts";
import { parseJhsWorkbook } from "../lib/sf10/import-jhs.ts";
import { Workbook } from "../lib/xlsx/workbook.ts";
import { getCell } from "../lib/xlsx/cells.ts";
import { gradingPeriods, quarterFieldsFor, shsSemesters } from "../lib/grading.ts";
import { JHS_BLOCKS, JHS_OFFSET, JHS_SUBJECT_COL } from "../lib/sf10/jhs-map.ts";
import { SHS_BLOCKS, SHS_HEADER_COL, SHS_TRACK_COL } from "../lib/sf10/shs-map.ts";
import type { Sf10Record, SubjectRecord } from "../lib/sf10/types.ts";

const JHS_TEMPLATE = join(process.cwd(), "templates", "SF10-JHS.xlsx");
const SHS_TEMPLATE = join(process.cwd(), "templates", "SF10-SHS.xlsx");

let passed = 0;
let failures = 0;

function ok(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed++;
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
  }
}

/** Read a cell out of a filled workbook. */
function cell(wb: Workbook, sheet: string, addr: string) {
  return getCell(wb.sheetXml(sheet), addr, wb.sharedStrings());
}

const student = {
  lrn: "999900001111",
  lastName: "TESTLEARNER",
  firstName: "Fixture",
};

function subjects(names: string[], q4: number | undefined): SubjectRecord[] {
  return names.map((name) => ({ name, q1: 80, q2: 82, q3: 84, q4 }));
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

ok("a JHS term with no stored count is four quarters", gradingPeriods({ level: 7 }) === 4);
ok("an SHS term with no stored count is two quarters", gradingPeriods({ level: 11 }) === 2);
ok(
  "a stored count wins over the default",
  gradingPeriods({ level: 9, grading_periods: 3 }) === 3,
);
ok(
  "a three-period term offers q1 to q3",
  quarterFieldsFor({ level: 9, grading_periods: 3 }).join(",") === "q1,q2,q3",
);
ok("a learner with no stored SHS count runs four semesters", shsSemesters({}) === 4);
ok("a stored SHS count wins", shsSemesters({ shs_semesters: 3 }) === 3);

// ---------------------------------------------------------------------------
// JHS: a mixed record, filled and read back
// ---------------------------------------------------------------------------

const mixed: Sf10Record = {
  student,
  terms: [
    {
      level: 7,
      gradingPeriods: 4,
      schoolYear: "2025-2026",
      subjects: subjects(["Filipino", "English"], 86),
    },
    {
      level: 9,
      gradingPeriods: 3,
      schoolYear: "2026-2027",
      subjects: subjects(["Filipino", "English"], undefined),
    },
  ],
};

const jhs = fillJhs(JHS_TEMPLATE, mixed);

const g7 = JHS_BLOCKS.find((b) => b.level === 7)!;
const g9 = JHS_BLOCKS.find((b) => b.level === 9)!;
const headerAddr = (b: typeof g7) =>
  `${JHS_SUBJECT_COL.q4}${b.headerRow + JHS_OFFSET.quarterHeader}`;

ok(
  "the three-period block loses its 4th quarter heading",
  cell(jhs, g9.sheet, headerAddr(g9)) === null,
  `saw ${JSON.stringify(cell(jhs, g9.sheet, headerAddr(g9)))}`,
);
ok(
  "the four-period block on the same form keeps its 4th quarter heading",
  Number(cell(jhs, g7.sheet, headerAddr(g7))) === 4,
  `saw ${JSON.stringify(cell(jhs, g7.sheet, headerAddr(g7)))}`,
);
ok(
  "the four-period block still carries its Q4 mark",
  cell(jhs, g7.sheet, `${JHS_SUBJECT_COL.q4}${g7.headerRow + JHS_OFFSET.firstSubject}`) === 86,
);
ok(
  "the three-period block's Q3 mark survives",
  cell(jhs, g9.sheet, `AC${g9.headerRow + JHS_OFFSET.firstSubject}`) === 84,
);

// Round trip: the same workbook back through the parser.
const reparsed = parseJhsWorkbook(jhs);
const back7 = reparsed.record.terms.find((t) => t.level === 7);
const back9 = reparsed.record.terms.find((t) => t.level === 9);

ok("Grade 7 reads back as four periods", back7?.gradingPeriods === 4, `saw ${back7?.gradingPeriods}`);
ok("Grade 9 reads back as three periods", back9?.gradingPeriods === 3, `saw ${back9?.gradingPeriods}`);

/*
 * The case that rules out detecting the count from the grades.
 *
 * This is a four-quarter term with the fourth quarter not yet encoded — an ordinary record in
 * November. It must still read back as four, because the heading says four. If detection ever
 * changes to "no Q4 anywhere means three periods", this check fails, which is exactly what it
 * is here to do.
 */
const november: Sf10Record = {
  student,
  terms: [
    { level: 7, gradingPeriods: 4, subjects: subjects(["Filipino"], undefined) },
  ],
};
const midYear = parseJhsWorkbook(fillJhs(JHS_TEMPLATE, november));
ok(
  "a four-period term with no Q4 encoded yet is not mistaken for a three-period one",
  midYear.record.terms.find((t) => t.level === 7)?.gradingPeriods === 4,
);

// ---------------------------------------------------------------------------
// SHS: unused blocks
// ---------------------------------------------------------------------------

const shsTerm = (level: 11 | 12, semester: 1 | 2) => ({
  level,
  semester,
  schoolYear: "2026-2027",
  section: "SAMPAGUITA",
  trackStrand: "ACADEMIC TRACK/ STEM",
  subjects: [{ name: "General Mathematics", q1: 80, q2: 82 }],
});

const threeSem: Sf10Record = {
  student,
  shsSemesters: 3,
  terms: [shsTerm(11, 1), shsTerm(11, 2), shsTerm(12, 1)],
};

const shs3 = fillShs(SHS_TEMPLATE, threeSem);
const last = SHS_BLOCKS[3];

ok(
  "a three-semester programme clears the fourth block's SCHOOL label",
  cell(shs3, last.sheet, `A${last.headerRow}`) === null,
  `saw ${JSON.stringify(cell(shs3, last.sheet, `A${last.headerRow}`))}`,
);
ok(
  "and its SUBJECTS column heading",
  cell(shs3, last.sheet, `I${last.columnHeaderRow}`) === null,
);
ok(
  "and its REMARKS label",
  cell(shs3, last.sheet, `A${last.remarksRow}`) === null,
);
ok(
  "but leaves the page's own signature block alone",
  cell(shs3, last.sheet, "A70") !== null,
  "row 70 is the form footer, not part of the semester block",
);

/*
 * A learner who has not reached Grade 12 yet, on a four-semester programme. The empty blocks
 * keep their labels — that section is not yet, rather than never — but must not print the
 * sample data the DepEd template ships with in the Grade 11 blocks.
 */
const grade12Only: Sf10Record = {
  student,
  terms: [shsTerm(12, 1), shsTerm(12, 2)],
};
const shs4 = fillShs(SHS_TEMPLATE, grade12Only);
const g11s1 = SHS_BLOCKS[0];

ok(
  "an unreached block keeps its SCHOOL label",
  cell(shs4, g11s1.sheet, `A${g11s1.headerRow}`) !== null,
);
ok(
  "an unreached block does not print the template's sample school year",
  cell(shs4, g11s1.sheet, `${SHS_HEADER_COL.schoolYear}${g11s1.headerRow}`) === null,
  `saw ${JSON.stringify(cell(shs4, g11s1.sheet, `${SHS_HEADER_COL.schoolYear}${g11s1.headerRow}`))}`,
);
ok(
  "nor its sample section",
  cell(shs4, g11s1.sheet, `${SHS_TRACK_COL.section}${g11s1.trackRow}`) === null,
  `saw ${JSON.stringify(cell(shs4, g11s1.sheet, `${SHS_TRACK_COL.section}${g11s1.trackRow}`))}`,
);
ok(
  "nor its sample PROMOTED remark",
  cell(shs4, g11s1.sheet, `${g11s1.remarksCol}${g11s1.remarksRow}`) === null,
);

// Writing the workbooks out proves they still zip, which a cleared cell could break.
const scratch = mkdtempSync(join(tmpdir(), "pnhs-periods-"));
try {
  jhs.save(join(scratch, "jhs.xlsx"));
  shs3.save(join(scratch, "shs.xlsx"));
  ok("both filled workbooks still write out", true);
} catch (e) {
  ok("both filled workbooks still write out", false, e instanceof Error ? e.message : String(e));
} finally {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

if (failures) process.exitCode = 1;
console.log(failures ? `\nperiods: FAILURES above\n` : `\nperiods: ${passed} checks passed\n`);
