/**
 * Reads a Form 137 — the pre-K-12 *Secondary Student's Permanent Record* — into an
 * `Sf10Record`.
 *
 * These are Word documents, not spreadsheets, and they come in two shapes across the school's
 * 20 files:
 *
 *   - **17 files** keep grades in native Word tables.
 *   - **3 files** (1995-1998) keep them in embedded Excel workbooks that Word renders as
 *     pictures. Each embedding is a complete .xlsx, so the existing SF10 reader handles them.
 *
 * Both are 8 units: 4 years x (grades table, monthly attendance table). Everything after
 * extraction is shared.
 *
 * ## Rules worth knowing before changing this
 *
 * **Never recompute a final rating.** The old curriculum's arithmetic is not documented
 * anywhere available and the files disagree with any single formula: `QUINDAY` carries 83.20
 * for quarters 75/80/85/87 (mean 81.75), while `VILLARAZA` carries 80.75 for 76/80/83/84
 * (which *is* the mean). Store what the document says.
 *
 * **Year comes from document order, not headings.** Heading text is unreliable — on
 * `VILLARAZA` the SECOND and THIRD YEAR headings parse cleanly while FIRST and FOURTH do not.
 * Table pairs 0/1, 2/3, 4/5, 6/7 are First-Fourth Year.
 *
 * **One record per file.** `PALIZA` contains the same learner's form twice (16 tables, two
 * headers, identical name and birthdate). Take the first and raise an issue about the rest.
 */

import { createHash } from "node:crypto";
import { readDocxBytes, type DocxDocument, type DocxTable } from "../docx/reader.ts";
import { Workbook } from "../xlsx/workbook.ts";
import { getCell } from "../xlsx/cells.ts";
import type { Sf10Record, SubjectRecord, TermRecord } from "./types.ts";
import { cleanText, normaliseSex, parseGrade, type Issue } from "./normalise.ts";

/** First-Fourth Year map onto 7-10 so existing queries work; `curriculum` carries the truth. */
export const F137_LEVELS = [7, 8, 9, 10] as const;
export const F137_YEAR_LABELS = ["First Year", "Second Year", "Third Year", "Fourth Year"];

const TABLES_PER_YEAR = 2; // grades, then attendance

export interface AttendanceRecord {
  month: string;
  daysOfSchool?: number;
  daysPresent?: number;
}

export interface ParsedF137 {
  record: Sf10Record;
  issues: Issue[];
  termCount: number;
  subjectCount: number;
  /** Per term index, matching `record.terms`. */
  attendance: AttendanceRecord[][];
}

export class NotAForm137Error extends Error {
  constructor(reason: string) {
    super(`This does not look like a Form 137: ${reason}`);
    this.name = "NotAForm137Error";
  }
}

// ---------------------------------------------------------------------------
// Label extraction from the loose body text
// ---------------------------------------------------------------------------

/**
 * Underscores are the printed fill-in line, not data, and punctuation after a label varies
 * between files (`Province: ALBAY` vs `Province _ALBAY_`).
 */
function tidy(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const text = value
    .replace(/_+/g, " ")
    .replace(/^[\s:.\-]+/, "")
    .replace(/[\s:.\-]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
  return text === "" ? undefined : text;
}

/**
 * Pull the text between one label and the next.
 *
 * Labels are matched loosely because the documents are hand-made: optional colons, stray
 * spaces, and `Mo.:NOVEMBER` running straight into its value all occur.
 */
function between(text: string, label: RegExp, stops: RegExp[]): string | undefined {
  const start = label.exec(text);
  if (!start) return undefined;

  const rest = text.slice(start.index + start[0].length);
  let end = rest.length;
  for (const stop of stops) {
    const m = stop.exec(rest);
    if (m && m.index < end) end = m.index;
  }
  return tidy(rest.slice(0, end));
}

const MONTHS: Record<string, number> = {
  JANUARY: 1, FEBRUARY: 2, MARCH: 3, APRIL: 4, MAY: 5, JUNE: 6,
  JULY: 7, AUGUST: 8, SEPTEMBER: 9, OCTOBER: 10, NOVEMBER: 11, DECEMBER: 12,
};

/** The form splits the birthdate into Year / Mo. / Day rather than one field. */
function birthdateFrom(text: string, issues: Issue[]): string | undefined {
  // Word boundaries are essential: without them `Day` matches inside the surname QUINDAY and
  // the parser reads the whole line as the day of birth.
  const year = between(text, /\bYear\s*:?\s*/i, [/\bMo\b/i, /\bDay\b/i, /\bSex\b/i]);
  const month = between(text, /\bMo\.?\s*:?\s*/i, [/\bDay\b/i, /\bSex\b/i]);
  const day = between(text, /\bDay\b\s*:?\s*/i, [/\bSex\b/i, /\bPlace\b/i]);
  if (!year && !month && !day) return undefined;

  const y = Number((year ?? "").replace(/\D/g, ""));
  const d = Number((day ?? "").replace(/\D/g, ""));
  const m = MONTHS[(month ?? "").toUpperCase().replace(/[^A-Z]/g, "")];

  if (!y || !m || !d || y < 1900 || d > 31) {
    const raw = [year, month, day].filter(Boolean).join(" ");
    issues.push({
      severity: "warning",
      field: "birthdate",
      rawValue: raw,
      message: `Could not read the date of birth from "${raw}" — kept as written.`,
    });
    return raw || undefined;
  }
  return `${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/${y}`;
}

interface LearnerText {
  lastName: string;
  firstName: string;
  middleName?: string;
  sex?: "M" | "F";
  birthdate?: string;
  birthplaceProvince?: string;
  birthplaceTown?: string;
  birthplaceBarrio?: string;
  guardianName?: string;
  guardianOccupation?: string;
  guardianAddress?: string;
  elemSchoolName?: string;
  elemYearCompleted?: string;
  elemGeneralAverage?: string;
}

function parseLearner(paragraphs: string[], issues: Issue[]): LearnerText {
  const find = (re: RegExp) => paragraphs.find((p) => re.test(p)) ?? "";

  const nameLine = find(/Name\s*:/i);
  const rawName =
    between(nameLine, /Name\s*:?\s*/i, [/Date of Birth/i, /Sex\b/i]) ?? "";

  // "SURNAME, GIVEN M." — the comma is the only reliable separator.
  const [surname, given] = rawName.includes(",")
    ? [rawName.slice(0, rawName.indexOf(",")), rawName.slice(rawName.indexOf(",") + 1)]
    : ["", rawName];

  const givenParts = tidy(given)?.split(/\s+/) ?? [];
  // A trailing single letter (with or without a dot) is the middle initial.
  const hasInitial = givenParts.length > 1 && /^[A-Z]\.?$/i.test(givenParts[givenParts.length - 1]);

  const placeLine = find(/Place of Birth/i);
  const guardianLine = find(/Parent or Guardian/i);
  const addressLine = find(/Address of Parent/i);
  const elemLine = find(/Intermediate Course/i);

  const learner: LearnerText = {
    lastName: tidy(surname)?.toUpperCase() ?? "",
    firstName: (hasInitial ? givenParts.slice(0, -1) : givenParts).join(" ").toUpperCase(),
    middleName: hasInitial ? givenParts[givenParts.length - 1].replace(/\.$/, "") : undefined,
    sex: undefined,
    birthdate: birthdateFrom(nameLine, issues),
    birthplaceProvince: between(placeLine, /\bProvince\s*:?\s*/i, [/\bTown\s*\/?\s*City/i, /\bBarrio/i]),
    birthplaceTown: between(placeLine, /\bTown\s*\/?\s*City\s*:?\s*/i, [/\bBarrio/i]),
    birthplaceBarrio: between(placeLine, /\bBarrio\s*:?\s*/i, []),
    guardianName: between(guardianLine, /\bParent or Guardian\s*:?\s*/i, [/\bOccupation/i]),
    guardianOccupation: between(guardianLine, /\bOccupation\s*:?\s*/i, []),
    guardianAddress: between(addressLine, /\bAddress of Parent or Guardian\s*:?\s*/i, []),
    elemSchoolName: between(elemLine, /\bIntermediate Course Completed\s*\(School\)\s*:?\s*/i, [
      /\bYear Completed/i,
    ]),
    elemYearCompleted: between(elemLine, /\bYear Completed\s*:?\s*/i, [/\bGen\.?\s*Ave/i, /\bAge\b/i]),
    elemGeneralAverage: between(elemLine, /\bGen\.?\s*Ave\.?\s*:?\s*/i, [/\bAge\b/i]),
  };

  const sexRaw = between(nameLine, /\bSex\s*:?\s*/i, [/\bPlace of Birth/i]);
  const sex = normaliseSex(sexRaw);
  issues.push(...sex.issues);
  learner.sex = sex.value;

  if (!learner.lastName || !learner.firstName) {
    issues.push({
      severity: "error",
      field: "name",
      rawValue: rawName,
      message: `Could not read the learner's name from "${rawName}".`,
    });
  }

  return learner;
}

// ---------------------------------------------------------------------------
// Grades and attendance
// ---------------------------------------------------------------------------

/** Column layout of the grades table, after the two header rows. */
const GRADE_COL = { name: 0, q1: 1, q2: 2, q3: 3, q4: 4, final: 5, action: 6, units: 7, extra: 8 };

const HEADERISH = /^(subjects?|periodic ratings?|final|rating|action|taken|units?|earned|extra|curricular|activities|\d)$/i;

/**
 * The last row of a grades table is usually a year summary, not a subject.
 *
 * It appears as "General Weighted Average (GWA)" or "GA (General Average)" and carries the
 * year's average in the Final column, total units in Units Earned, and Promoted/Retained in
 * Action Taken. Left alone it becomes a fake subject on the record — 45 such rows across the
 * school's 20 files.
 */
const SUMMARY_ROW = /general\s*(weighted\s*)?average|^\s*GA\s*\(|^\s*GWA\b/i;

export interface TermSummary {
  generalAverage?: number;
  totalUnits?: number;
  promotionRemark?: string;
}

function subjectsFrom(
  table: DocxTable,
  issues: Issue[],
): { subjects: SubjectRecord[]; summary: TermSummary } {
  const subjects: SubjectRecord[] = [];
  const summary: TermSummary = {};

  for (const row of table.rows) {
    const name = cleanText(row[GRADE_COL.name]);
    if (!name || HEADERISH.test(name)) continue;

    if (SUMMARY_ROW.test(name)) {
      const num = (i: number) => {
        const parsed = parseGrade(cleanText(row[i]), name);
        return parsed.value; // issues suppressed: a blank summary row is normal
      };
      summary.generalAverage = num(GRADE_COL.final);
      summary.totalUnits = num(GRADE_COL.units);
      summary.promotionRemark = cleanText(row[GRADE_COL.action]);
      continue;
    }

    const at = (i: number) => cleanText(row[i]);
    const grade = (i: number, what: string) => {
      const n = parseGrade(at(i), `${name} ${what}`);
      issues.push(...n.issues);
      return n.value;
    };

    subjects.push({
      name,
      q1: grade(GRADE_COL.q1, "1st rating"),
      q2: grade(GRADE_COL.q2, "2nd rating"),
      q3: grade(GRADE_COL.q3, "3rd rating"),
      q4: grade(GRADE_COL.q4, "4th rating"),
      // Stored, never derived — see the note at the top of this file.
      finalRating: grade(GRADE_COL.final, "final rating"),
      remarks: at(GRADE_COL.action),
      unitsEarned: grade(GRADE_COL.units, "units earned"),
      extraCurricular: at(GRADE_COL.extra),
    });
  }

  return { subjects, summary };
}

function attendanceFrom(table: DocxTable): AttendanceRecord[] {
  const [header, school, present] = table.rows;
  if (!header) return [];

  const out: AttendanceRecord[] = [];
  for (let i = 1; i < header.length; i++) {
    const month = cleanText(header[i]);
    if (!month) continue;
    const num = (v: string | undefined) => {
      const n = Number((v ?? "").trim());
      return Number.isFinite(n) && v?.trim() !== "" ? n : undefined;
    };
    out.push({
      month,
      daysOfSchool: num(school?.[i]),
      daysPresent: num(present?.[i]),
    });
  }
  return out;
}

/** Turn an embedded worksheet into the same row shape the Word tables produce. */
function tableFromWorksheet(bytes: Uint8Array, index: number): DocxTable {
  const wb = Workbook.fromBuffer(bytes);
  const sheet = wb.sheetNames[0];
  const xml = wb.sheetXml(sheet);
  const shared = wb.sharedStrings();

  const rows: string[][] = [];
  for (let r = 1; r <= 20; r++) {
    const row: string[] = [];
    let any = false;
    for (let c = 0; c < 10; c++) {
      const addr = `${String.fromCharCode(65 + c)}${r}`;
      const v = getCell(xml, addr, shared);
      const text = v === null || v === undefined ? "" : String(v);
      if (text !== "") any = true;
      row.push(text);
    }
    if (any) rows.push(row);
  }
  return { rows, index };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function parseF137Bytes(bytes: Uint8Array): ParsedF137 {
  const doc = readDocxBytes(bytes);
  return parseF137Document(doc);
}

export function parseF137Document(doc: DocxDocument): ParsedF137 {
  const issues: Issue[] = [];

  const isForm137 = doc.paragraphs.some((p) => /PERMANENT RECORD/i.test(p));
  if (!isForm137) {
    throw new NotAForm137Error("no 'SECONDARY STUDENT'S PERMANENT RECORD' heading");
  }

  // A file holding the form twice is one learner's record duplicated, not two learners.
  const headers = doc.paragraphs.filter((p) => /PERMANENT RECORD/i.test(p)).length;
  if (headers > 1) {
    issues.push({
      severity: "warning",
      field: "document",
      message: `This file contains the form ${headers} times. Only the first copy was imported — check the others match.`,
    });
  }

  const learner = parseLearner(doc.paragraphs, issues);

  // Word tables when present, embedded worksheets otherwise.
  const tables: DocxTable[] =
    doc.tables.length > 0
      ? doc.tables
      : doc.embeddings.map((e, i) => tableFromWorksheet(e.bytes, i));

  if (tables.length === 0) {
    issues.push({
      severity: "error",
      field: "tables",
      message: "No grade tables found in this document.",
    });
  }

  const terms: TermRecord[] = [];
  const attendance: AttendanceRecord[][] = [];
  let subjectCount = 0;

  for (let year = 0; year < F137_LEVELS.length; year++) {
    const gradeTable = tables[year * TABLES_PER_YEAR];
    const attendanceTable = tables[year * TABLES_PER_YEAR + 1];
    if (!gradeTable) break;

    const { subjects, summary } = subjectsFrom(gradeTable, issues);
    if (subjects.length === 0) continue;

    /*
     * The blank form pre-prints subject names for all four years, so a name alone proves
     * nothing. A year is only real if something was actually recorded against it.
     *
     * VILLARAZA is the case that matters: "Dropped as of January 6, 2009 due to poverty" part
     * way through Second Year, leaving Third and Fourth Year printed but empty. Importing
     * those as attended years would assert an enrolment that never happened.
     */
    const hasAnyMark = subjects.some(
      (s) =>
        s.q1 != null || s.q2 != null || s.q3 != null || s.q4 != null ||
        s.finalRating != null || (s.remarks ?? "") !== "",
    );
    if (!hasAnyMark) continue;

    subjectCount += subjects.length;
    terms.push({
      level: F137_LEVELS[year],
      curriculum: "old",
      yearLabel: F137_YEAR_LABELS[year],
      // Lifted off the summary row rather than computed — the same rule as everywhere else
      // here: the document is the authority on its own arithmetic.
      generalAverage: summary.generalAverage,
      promotionRemark: summary.promotionRemark,
      subjects,
    });
    attendance.push(attendanceTable ? attendanceFrom(attendanceTable) : []);
  }

  if (terms.length === 0) {
    issues.push({
      severity: "error",
      field: "terms",
      message: "No year on this form has any subjects — nothing to import.",
    });
  }

  const record: Sf10Record = {
    student: {
      lrn: placeholderLrn(learner),
      lrnPlaceholder: true,
      lastName: learner.lastName,
      firstName: learner.firstName,
      middleName: learner.middleName,
      sex: learner.sex,
      birthdate: learner.birthdate,
      birthplaceProvince: learner.birthplaceProvince,
      birthplaceTown: learner.birthplaceTown,
      birthplaceBarrio: learner.birthplaceBarrio,
      guardianName: learner.guardianName,
      guardianOccupation: learner.guardianOccupation,
      guardianAddress: learner.guardianAddress,
    },
    jhsEligibility: {
      elemSchoolName: learner.elemSchoolName,
      elemGeneralAverage: learner.elemGeneralAverage,
    },
    terms,
  };

  return { record, issues, termCount: terms.length, subjectCount, attendance };
}

/**
 * A stand-in identifier for a learner who has none.
 *
 * Form 137 predates the LRN system, but `students.lrn` is NOT NULL UNIQUE and every dedup path
 * runs through it. The value is derived from name and birthdate so that re-importing a
 * corrected copy of the same learner's file lands on the same record rather than creating a
 * second one.
 *
 * The `F137-` prefix makes it impossible to mistake for a 12-digit LRN, and
 * `student.lrnPlaceholder` tells the UI to show "No LRN" instead of this value.
 */
export function placeholderLrn(learner: {
  lastName: string;
  firstName: string;
  birthdate?: string;
}): string {
  const key = [learner.lastName, learner.firstName, learner.birthdate ?? ""]
    .join("|")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
  return `F137-${createHash("sha256").update(key).digest("hex").slice(0, 10).toUpperCase()}`;
}
