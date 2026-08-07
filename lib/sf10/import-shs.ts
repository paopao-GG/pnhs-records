/**
 * Reads a filled SF10-SHS workbook into an `Sf10Record`.
 *
 * Uses the same cell map as the exporter (`shs-map.ts`), which was verified against all 13
 * of the school's real files: identical sheet names, identical defined names, every mapped
 * address resolving to the expected value. Import and export therefore cannot drift apart -
 * a round trip proves both directions at once.
 *
 * Formula cells (semester final grade, action taken, general average) are READ here. The
 * exporter still refuses to write them; the template owns them. On import we take whatever
 * the cell holds, because in the real files most were pasted in as literal values.
 */

import { Workbook } from "../xlsx/workbook.ts";
import { getCell, type CellValue } from "../xlsx/cells.ts";
import {
  SHS_BLOCKS,
  SHS_ELIGIBILITY,
  SHS_HEADER_COL,
  SHS_LEARNER,
  SHS_SUBJECT_COL,
  SHS_SUBJECT_ROW_COUNT,
  SHS_TRACK_COL,
  SHS_CATEGORIES,
  SHS_GENERAL_AVERAGE_COL,
  type ShsCategory,
} from "./shs-map.ts";
import type { Sf10Record, SubjectRecord, TermRecord } from "./types.ts";
import {
  cleanText,
  normaliseSex,
  parseFormDate,
  parseGrade,
  validateLrn,
  type Issue,
} from "./normalise.ts";

export interface ParsedShs {
  record: Sf10Record;
  issues: Issue[];
  /** Terms that carried at least one subject, for reporting. */
  termCount: number;
  subjectCount: number;
}

export class NotAnShsFormError extends Error {
  constructor(sheets: string[]) {
    super(
      `This does not look like an SF10-SHS workbook. Expected sheets FRONT and BACK, found: ${sheets.join(", ")}`,
    );
    this.name = "NotAnShsFormError";
  }
}

/** Reader bound to one sheet, so call sites read as `front("F8")`. */
function sheetReader(wb: Workbook, sheet: string) {
  const xml = wb.sheetXml(sheet);
  const shared = wb.sharedStrings();
  return (addr: string): CellValue => getCell(xml, addr, shared);
}

export function parseShsWorkbook(wb: Workbook): ParsedShs {
  const names = wb.sheetNames;
  if (!names.includes("FRONT") || !names.includes("BACK")) {
    throw new NotAnShsFormError(names);
  }

  const front = sheetReader(wb, "FRONT");
  const back = sheetReader(wb, "BACK");
  const issues: Issue[] = [];
  const take = <T>(n: { value: T; issues: Issue[] }): T => {
    issues.push(...n.issues);
    return n.value;
  };

  // ---- learner ----------------------------------------------------------
  const lrn = take(validateLrn(front(SHS_LEARNER.lrn), SHS_LEARNER.lrn));
  const student = {
    lrn: lrn ?? "",
    lastName: cleanText(front(SHS_LEARNER.lastName)) ?? "",
    firstName: cleanText(front(SHS_LEARNER.firstName)) ?? "",
    middleName: cleanText(front(SHS_LEARNER.middleName)),
    sex: take(normaliseSex(front(SHS_LEARNER.sex), SHS_LEARNER.sex)),
    birthdate: take(parseFormDate(front(SHS_LEARNER.birthdate), "birthdate", SHS_LEARNER.birthdate)),
  };

  if (!student.lastName || !student.firstName) {
    issues.push({
      severity: "error",
      field: "name",
      message: "Learner name is missing from the form.",
    });
  }

  // ---- eligibility ------------------------------------------------------
  const shsEligibility = {
    shsAdmissionDate: take(
      parseFormDate(front(SHS_LEARNER.shsAdmissionDate), "shsAdmissionDate", SHS_LEARNER.shsAdmissionDate),
    ),
    hsCompleterGenAve: numberOrText(front(SHS_ELIGIBILITY.hsCompleterGenAve)),
    jhsCompleterGenAve: numberOrText(front(SHS_ELIGIBILITY.jhsCompleterGenAve)),
    graduationDate: take(
      parseFormDate(front(SHS_ELIGIBILITY.graduationDate), "graduationDate", SHS_ELIGIBILITY.graduationDate),
    ),
    prevSchoolName: cleanText(front(SHS_ELIGIBILITY.prevSchoolName)),
    prevSchoolAddress: cleanText(front(SHS_ELIGIBILITY.prevSchoolAddress)),
    peptRating: cleanText(front(SHS_ELIGIBILITY.peptRating)),
    alsRating: cleanText(front(SHS_ELIGIBILITY.alsRating)),
    otherCredential: cleanText(front(SHS_ELIGIBILITY.otherCredential)),
    examDate: take(parseFormDate(front(SHS_ELIGIBILITY.examDate), "examDate", SHS_ELIGIBILITY.examDate)),
    clcNameAddress: cleanText(front(SHS_ELIGIBILITY.clcNameAddress)),
  };

  // ---- semester blocks --------------------------------------------------
  const terms: TermRecord[] = [];
  let subjectCount = 0;

  for (const block of SHS_BLOCKS) {
    const read = block.sheet === "FRONT" ? front : back;
    const h = block.headerRow;
    const t = block.trackRow;

    const subjects: SubjectRecord[] = [];
    for (let i = 0; i < SHS_SUBJECT_ROW_COUNT; i++) {
      const row = block.firstSubjectRow + i;
      const name = cleanText(read(`${SHS_SUBJECT_COL.name}${row}`));
      if (!name) continue; // unused row in the block's 12-row budget

      const rawCategory = cleanText(read(`${SHS_SUBJECT_COL.category}${row}`));
      const category = SHS_CATEGORIES.includes(rawCategory as ShsCategory)
        ? (rawCategory as ShsCategory)
        : undefined;
      if (rawCategory && !category) {
        issues.push({
          severity: "warning",
          field: "subjectCategory",
          cell: `${SHS_SUBJECT_COL.category}${row}`,
          rawValue: rawCategory,
          message: `Unknown subject category "${rawCategory}" for ${name}.`,
        });
      }

      subjects.push({
        name,
        category,
        q1: take(parseGrade(read(`${SHS_SUBJECT_COL.q1}${row}`), `${name} Q1`, `${SHS_SUBJECT_COL.q1}${row}`)),
        q2: take(parseGrade(read(`${SHS_SUBJECT_COL.q2}${row}`), `${name} Q2`, `${SHS_SUBJECT_COL.q2}${row}`)),
      });
    }

    if (subjects.length === 0) continue; // semester the learner did not attend

    subjectCount += subjects.length;
    terms.push({
      level: block.level,
      semester: block.semester,
      schoolYear: cleanText(read(`${SHS_HEADER_COL.schoolYear}${h}`)),
      section: cleanText(read(`${SHS_TRACK_COL.section}${t}`)),
      trackStrand: cleanText(read(`${SHS_TRACK_COL.trackStrand}${t}`)),
      schoolName: cleanText(read(`${SHS_HEADER_COL.schoolName}${h}`)),
      schoolId: cleanText(read(`${SHS_HEADER_COL.schoolId}${h}`)),
      promotionRemark: cleanText(read(`${block.remarksCol}${block.remarksRow}`)),
      // As the source form carries it — see TermRecord.generalAverage.
      generalAverage: numberOnly(read(`${SHS_GENERAL_AVERAGE_COL}${block.generalAverageRow}`)),
      subjects,
    });
  }

  if (terms.length === 0) {
    issues.push({
      severity: "error",
      field: "terms",
      message: "No semester on this form has any subjects — nothing to import.",
    });
  }

  return {
    record: { student, shsEligibility, terms },
    issues,
    termCount: terms.length,
    subjectCount,
  };
}

export function parseShsFile(path: string): ParsedShs {
  return parseShsWorkbook(Workbook.open(path));
}

/** General averages print as numbers but are occasionally typed as text; keep either. */
function numberOrText(raw: CellValue): number | string | undefined {
  if (raw === null || raw === undefined || raw === "") return undefined;
  return typeof raw === "number" ? raw : (cleanText(raw) ?? undefined);
}

/** Cached formula errors arrive as null from getCell; anything non-numeric is dropped. */
function numberOnly(raw: CellValue): number | undefined {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}
