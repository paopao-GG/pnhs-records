/**
 * Reads a filled SF10-JHS workbook into an `Sf10Record`.
 *
 * Mirrors import-shs.ts and uses the same map the exporter writes through
 * ([jhs-map.ts](./jhs-map.ts)), so import and export cannot drift apart.
 *
 * Verified against the school's 30 real JHS files: all four grade blocks resolve — learner
 * identity, school, section, school year, adviser, and 13 subjects (14 at Grade 10, the extra
 * being CAT).
 */

import { Workbook } from "../xlsx/workbook.ts";
import { getCell, type CellValue } from "../xlsx/cells.ts";
import {
  JHS_BLOCKS,
  JHS_CLASS_COL,
  JHS_ELIGIBILITY,
  JHS_GENERAL_COL,
  JHS_LEARNER,
  JHS_OFFSET,
  JHS_SCHOOL_COL,
  JHS_SUBJECT_COL,
  JHS_SUBJECT_ROW_COUNT,
} from "./jhs-map.ts";
import type { Sf10Record, SubjectRecord, TermRecord } from "./types.ts";
import {
  cleanText,
  normaliseSex,
  parseFormDate,
  parseGrade,
  validateLrn,
  type Issue,
} from "./normalise.ts";

export interface ParsedJhs {
  record: Sf10Record;
  issues: Issue[];
  termCount: number;
  subjectCount: number;
}

export class NotAJhsFormError extends Error {
  constructor(sheets: string[]) {
    super(
      `This does not look like an SF10-JHS workbook. Expected sheets Front and Back, found: ${sheets.join(", ")}`,
    );
    this.name = "NotAJhsFormError";
  }
}

function sheetReader(wb: Workbook, sheet: string) {
  const xml = wb.sheetXml(sheet);
  const shared = wb.sharedStrings();
  return (addr: string): CellValue => getCell(xml, addr, shared);
}

export function parseJhsWorkbook(wb: Workbook): ParsedJhs {
  const names = wb.sheetNames;
  if (!names.includes("Front") || !names.includes("Back")) {
    throw new NotAJhsFormError(names);
  }

  const front = sheetReader(wb, "Front");
  const back = sheetReader(wb, "Back");
  const issues: Issue[] = [];
  const take = <T>(n: { value: T; issues: Issue[] }): T => {
    issues.push(...n.issues);
    return n.value;
  };

  // ---- learner ----------------------------------------------------------
  const lrn = take(validateLrn(front(JHS_LEARNER.lrn), JHS_LEARNER.lrn));
  const student = {
    lrn: lrn ?? "",
    lastName: cleanText(front(JHS_LEARNER.lastName)) ?? "",
    firstName: cleanText(front(JHS_LEARNER.firstName)) ?? "",
    middleName: cleanText(front(JHS_LEARNER.middleName)),
    nameExt: cleanText(front(JHS_LEARNER.nameExt)),
    sex: take(normaliseSex(front(JHS_LEARNER.sex), JHS_LEARNER.sex)),
    birthdate: take(parseFormDate(front(JHS_LEARNER.birthdate), "birthdate", JHS_LEARNER.birthdate)),
  };

  if (!student.lastName || !student.firstName) {
    issues.push({
      severity: "error",
      field: "name",
      message: "Learner name is missing from the form.",
    });
  }

  // ---- eligibility ------------------------------------------------------
  const jhsEligibility = {
    elemSchoolName: cleanText(front(JHS_ELIGIBILITY.elemSchoolName)),
    elemSchoolId: cleanText(front(JHS_ELIGIBILITY.elemSchoolId)),
    elemSchoolAddress: cleanText(front(JHS_ELIGIBILITY.elemSchoolAddress)),
    elemGeneralAverage: numberOrText(front(JHS_ELIGIBILITY.elemGeneralAverage)),
    citation: cleanText(front(JHS_ELIGIBILITY.citation)),
    peptRating: cleanText(front(JHS_ELIGIBILITY.peptRating)),
    alsRating: cleanText(front(JHS_ELIGIBILITY.alsRating)),
    otherCredential: cleanText(front(JHS_ELIGIBILITY.otherCredential)),
    examDate: take(parseFormDate(front(JHS_ELIGIBILITY.examDate), "examDate", JHS_ELIGIBILITY.examDate)),
    testingCenter: cleanText(front(JHS_ELIGIBILITY.testingCenter)),
  };

  // ---- grade blocks -----------------------------------------------------
  const terms: TermRecord[] = [];
  let subjectCount = 0;

  for (const block of JHS_BLOCKS) {
    const read = block.sheet === "Front" ? front : back;
    const schoolRow = block.headerRow + JHS_OFFSET.school;
    const classRow = block.headerRow + JHS_OFFSET.classInfo;
    const firstSubject = block.headerRow + JHS_OFFSET.firstSubject;

    const subjects: SubjectRecord[] = [];
    for (let i = 0; i < JHS_SUBJECT_ROW_COUNT; i++) {
      const row = firstSubject + i;
      const name = cleanText(read(`${JHS_SUBJECT_COL.name}${row}`));
      if (!name) continue;

      const subject: SubjectRecord = {
        name,
        q1: take(parseGrade(read(`${JHS_SUBJECT_COL.q1}${row}`), `${name} Q1`, `${JHS_SUBJECT_COL.q1}${row}`)),
        q2: take(parseGrade(read(`${JHS_SUBJECT_COL.q2}${row}`), `${name} Q2`, `${JHS_SUBJECT_COL.q2}${row}`)),
        q3: take(parseGrade(read(`${JHS_SUBJECT_COL.q3}${row}`), `${name} Q3`, `${JHS_SUBJECT_COL.q3}${row}`)),
        q4: take(parseGrade(read(`${JHS_SUBJECT_COL.q4}${row}`), `${name} Q4`, `${JHS_SUBJECT_COL.q4}${row}`)),
        remarks: cleanText(read(`${JHS_SUBJECT_COL.remarks}${row}`)),
      };

      /*
       * Take the final rating the form actually carries, for every row.
       *
       * It is tempting to recompute it from the quarters and ignore this cell, but the
       * school's real files show why that is wrong: in many of them the registrar rounded
       * each final and pasted it in as a literal, replacing the formula. The form's own
       * general average then averages those rounded values.
       *
       * Recomputing instead produced a general average one mark lower than the document on 12
       * of 85 real grade blocks. The document is the authority, so we store what it says -
       * the same rule already applied to Form 137.
       *
       * Rows with no stored value fall back to the quarters at display time.
       */
      subject.finalRating = take(
        parseGrade(
          read(`${JHS_SUBJECT_COL.finalRating}${row}`),
          `${name} final rating`,
          `${JHS_SUBJECT_COL.finalRating}${row}`,
        ),
      );

      subjects.push(subject);
    }

    if (subjects.length === 0) continue; // a grade level this learner did not attend here

    subjectCount += subjects.length;
    terms.push({
      level: block.level,
      schoolYear: cleanText(read(`${JHS_CLASS_COL.schoolYear}${classRow}`)),
      section: cleanText(read(`${JHS_CLASS_COL.section}${classRow}`)),
      adviser: cleanText(read(`${JHS_CLASS_COL.adviser}${classRow}`)),
      schoolName: cleanText(read(`${JHS_SCHOOL_COL.schoolName}${schoolRow}`)),
      schoolId: cleanText(read(`${JHS_SCHOOL_COL.schoolId}${schoolRow}`)),
      district: cleanText(read(`${JHS_SCHOOL_COL.district}${schoolRow}`)),
      division: cleanText(read(`${JHS_SCHOOL_COL.division}${schoolRow}`)),
      region: cleanText(read(`${JHS_SCHOOL_COL.region}${schoolRow}`)),
      promotionRemark: cleanText(
        read(`${JHS_GENERAL_COL.remark}${block.headerRow + JHS_OFFSET.generalAverage}`),
      ),
      generalAverage: numberOnly(
        read(`${JHS_GENERAL_COL.value}${block.headerRow + JHS_OFFSET.generalAverage}`),
      ),
      subjects,
    });
  }

  if (terms.length === 0) {
    issues.push({
      severity: "error",
      field: "terms",
      message: "No grade level on this form has any subjects — nothing to import.",
    });
  }

  return {
    record: { student, jhsEligibility, terms },
    issues,
    termCount: terms.length,
    subjectCount,
  };
}

export function parseJhsFile(path: string): ParsedJhs {
  return parseJhsWorkbook(Workbook.open(path));
}

function numberOrText(raw: CellValue): number | string | undefined {
  if (raw === null || raw === undefined || raw === "") return undefined;
  return typeof raw === "number" ? raw : (cleanText(raw) ?? undefined);
}

/** Cached formula errors like #DIV/0! arrive as null from getCell; anything non-numeric is dropped. */
function numberOnly(raw: CellValue): number | undefined {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : undefined;
}
