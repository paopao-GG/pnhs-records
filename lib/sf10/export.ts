/**
 * Fills a copy of the school's own SF10 template from a stored record.
 *
 * The guiding rule: write INPUTS ONLY. Final ratings, general averages and PASSED/FAILED
 * are shared formulas inside the template. Rewriting a shared-formula cell breaks its
 * siblings, so we leave every one of them alone and let Excel recalculate on open
 * (see Workbook.forceFullRecalcOnLoad). That also means the printed form's arithmetic is
 * computed independently of ours - a free cross-check on every print.
 */

import { Workbook } from "../xlsx/workbook.ts";
import { setCell, setCells, type CellValue } from "../xlsx/cells.ts";
import type { Sf10Record, TermRecord } from "./types.ts";
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
  jhsFinalRatingIsComputed,
} from "./jhs-map.ts";
import {
  SHS_BLOCKS,
  SHS_ELIGIBILITY,
  SHS_HEADER_COL,
  SHS_LEARNER,
  SHS_SUBJECT_COL,
  SHS_SUBJECT_ROW_COUNT,
  SHS_TRACK_COL,
  shsSemesterLabel,
} from "./shs-map.ts";

type Writes = Record<string, CellValue | undefined>;

/** Accumulates writes per sheet so each sheet's XML is only rewritten once. */
class SheetWriter {
  private pending = new Map<string, Writes>();
  private clears = new Map<string, Set<string>>();
  private wb: Workbook;

  constructor(wb: Workbook) {
    this.wb = wb;
  }

  set(sheet: string, writes: Writes): void {
    const existing = this.pending.get(sheet) ?? {};
    this.pending.set(sheet, { ...existing, ...writes });
  }

  /**
   * Blank cells outright.
   *
   * `setCells` deliberately skips empty values so a half-filled record cannot wipe data,
   * which means clearing needs its own path.
   */
  clear(sheet: string, addrs: string[]): void {
    const set = this.clears.get(sheet) ?? new Set<string>();
    for (const a of addrs) set.add(a);
    this.clears.set(sheet, set);
  }

  flush(): void {
    for (const sheet of new Set([...this.pending.keys(), ...this.clears.keys()])) {
      let xml = this.wb.sheetXml(sheet);
      for (const addr of this.clears.get(sheet) ?? []) xml = setCell(xml, addr, null);
      xml = setCells(xml, this.pending.get(sheet) ?? {});
      this.wb.setSheetXml(sheet, xml);
    }
    this.pending.clear();
    this.clears.clear();
  }
}

export function fillJhs(templatePath: string, record: Sf10Record): Workbook {
  const wb = Workbook.open(templatePath);
  const w = new SheetWriter(wb);
  const { student } = record;

  w.set("Front", {
    [JHS_LEARNER.lastName]: student.lastName,
    [JHS_LEARNER.firstName]: student.firstName,
    [JHS_LEARNER.middleName]: student.middleName,
    [JHS_LEARNER.nameExt]: student.nameExt,
    [JHS_LEARNER.lrn]: student.lrn,
    [JHS_LEARNER.birthdate]: student.birthdate,
    [JHS_LEARNER.sex]: student.sex,
  });

  const el = record.jhsEligibility;
  if (el) {
    w.set("Front", {
      [JHS_ELIGIBILITY.elemGeneralAverage]: el.elemGeneralAverage,
      [JHS_ELIGIBILITY.citation]: el.citation,
      [JHS_ELIGIBILITY.elemSchoolName]: el.elemSchoolName,
      [JHS_ELIGIBILITY.elemSchoolId]: el.elemSchoolId,
      [JHS_ELIGIBILITY.elemSchoolAddress]: el.elemSchoolAddress,
      [JHS_ELIGIBILITY.peptRating]: el.peptRating,
      [JHS_ELIGIBILITY.alsRating]: el.alsRating,
      [JHS_ELIGIBILITY.otherCredential]: el.otherCredential,
      [JHS_ELIGIBILITY.examDate]: el.examDate,
      [JHS_ELIGIBILITY.testingCenter]: el.testingCenter,
    });
  }

  for (const block of JHS_BLOCKS) {
    const term = record.terms.find((t) => t.level === block.level);

    /*
     * A grade level the learner never attended must print empty.
     *
     * The blank template pre-prints the standard learning-area names in all four blocks, so
     * skipping an unused block would leave "Filipino, English, Mathematics…" under Grade 9 for
     * a learner who left after Grade 8 — a form that implies enrolment that never happened.
     * The school's own files clear these blocks, and a round trip against them caught it.
     *
     * Within a block the learner DID attend, unused rows keep their printed names: that is how
     * the real forms look, with the label present and the grades blank.
     */
    if (!term) {
      const blanks: string[] = [];
      for (let i = 0; i < JHS_SUBJECT_ROW_COUNT; i++) {
        const row = block.headerRow + JHS_OFFSET.firstSubject + i;
        blanks.push(`${JHS_SUBJECT_COL.name}${row}`);
      }
      w.clear(block.sheet, blanks);
      continue;
    }

    const schoolRow = block.headerRow + JHS_OFFSET.school;
    const classRow = block.headerRow + JHS_OFFSET.classInfo;
    const genRow = block.headerRow + JHS_OFFSET.generalAverage;

    const writes: Writes = {
      [`${JHS_SCHOOL_COL.schoolName}${schoolRow}`]: term.schoolName,
      [`${JHS_SCHOOL_COL.schoolId}${schoolRow}`]: term.schoolId,
      [`${JHS_SCHOOL_COL.district}${schoolRow}`]: term.district,
      [`${JHS_SCHOOL_COL.division}${schoolRow}`]: term.division,
      [`${JHS_SCHOOL_COL.region}${schoolRow}`]: term.region,
      [`${JHS_CLASS_COL.gradeLevel}${classRow}`]: term.level,
      [`${JHS_CLASS_COL.section}${classRow}`]: term.section,
      [`${JHS_CLASS_COL.schoolYear}${classRow}`]: term.schoolYear,
      [`${JHS_CLASS_COL.adviser}${classRow}`]: term.adviser,
      // General average itself is a formula; only its remark is a literal.
      [`${JHS_GENERAL_COL.remark}${genRow}`]: term.promotionRemark,
    };

    assertFits(term, JHS_SUBJECT_ROW_COUNT, `Grade ${block.level}`);
    term.subjects.forEach((subject, i) => {
      const row = block.headerRow + JHS_OFFSET.firstSubject + i;
      writes[`${JHS_SUBJECT_COL.name}${row}`] = subject.name;
      writes[`${JHS_SUBJECT_COL.q1}${row}`] = subject.q1;
      writes[`${JHS_SUBJECT_COL.q2}${row}`] = subject.q2;
      writes[`${JHS_SUBJECT_COL.q3}${row}`] = subject.q3;
      writes[`${JHS_SUBJECT_COL.q4}${row}`] = subject.q4;
      writes[`${JHS_SUBJECT_COL.remarks}${row}`] = subject.remarks;
      // Homeroom Guidance and CAT have no AVERAGE formula, so their final rating is ours
      // to write. Every other row's final rating belongs to the template.
      if (!jhsFinalRatingIsComputed(i)) {
        writes[`${JHS_SUBJECT_COL.finalRating}${row}`] = subject.finalRating;
      }
    });

    w.set(block.sheet, writes);
  }

  w.flush();
  wb.forceFullRecalcOnLoad();
  return wb;
}

export function fillShs(templatePath: string, record: Sf10Record): Workbook {
  const wb = Workbook.open(templatePath);
  const w = new SheetWriter(wb);
  const { student } = record;

  w.set("FRONT", {
    [SHS_LEARNER.lastName]: student.lastName,
    [SHS_LEARNER.firstName]: student.firstName,
    [SHS_LEARNER.middleName]: student.middleName,
    [SHS_LEARNER.lrn]: student.lrn,
    [SHS_LEARNER.birthdate]: student.birthdate,
    [SHS_LEARNER.sex]: student.sex,
  });

  const el = record.shsEligibility;
  if (el) {
    w.set("FRONT", {
      [SHS_LEARNER.shsAdmissionDate]: el.shsAdmissionDate,
      [SHS_ELIGIBILITY.hsCompleterGenAve]: el.hsCompleterGenAve,
      [SHS_ELIGIBILITY.jhsCompleterGenAve]: el.jhsCompleterGenAve,
      [SHS_ELIGIBILITY.graduationDate]: el.graduationDate,
      [SHS_ELIGIBILITY.prevSchoolName]: el.prevSchoolName,
      [SHS_ELIGIBILITY.prevSchoolAddress]: el.prevSchoolAddress,
      [SHS_ELIGIBILITY.peptRating]: el.peptRating,
      [SHS_ELIGIBILITY.alsRating]: el.alsRating,
      [SHS_ELIGIBILITY.otherCredential]: el.otherCredential,
      [SHS_ELIGIBILITY.examDate]: el.examDate,
      [SHS_ELIGIBILITY.clcNameAddress]: el.clcNameAddress,
    });
  }

  for (const block of SHS_BLOCKS) {
    const term = record.terms.find(
      (t) => t.level === block.level && t.semester === block.semester,
    );
    if (!term) continue;

    const writes: Writes = {
      [`${SHS_HEADER_COL.schoolName}${block.headerRow}`]: term.schoolName,
      [`${SHS_HEADER_COL.schoolId}${block.headerRow}`]: term.schoolId,
      [`${SHS_HEADER_COL.gradeLevel}${block.headerRow}`]: term.level,
      [`${SHS_HEADER_COL.schoolYear}${block.headerRow}`]: term.schoolYear,
      [`${SHS_HEADER_COL.semester}${block.headerRow}`]: shsSemesterLabel(block.semester),
      [`${SHS_TRACK_COL.trackStrand}${block.trackRow}`]: term.trackStrand,
      [`${SHS_TRACK_COL.section}${block.trackRow}`]: term.section,
      [`${block.remarksCol}${block.remarksRow}`]: term.promotionRemark,
    };

    assertFits(term, SHS_SUBJECT_ROW_COUNT, `Grade ${block.level} Sem ${block.semester}`);
    term.subjects.forEach((subject, i) => {
      const row = block.firstSubjectRow + i;
      writes[`${SHS_SUBJECT_COL.category}${row}`] = subject.category;
      writes[`${SHS_SUBJECT_COL.name}${row}`] = subject.name;
      writes[`${SHS_SUBJECT_COL.q1}${row}`] = subject.q1;
      writes[`${SHS_SUBJECT_COL.q2}${row}`] = subject.q2;
    });

    /*
     * The blank template pre-prints the standard Core subject names down the first ten rows
     * of each block. A learner who took fewer subjects than that would otherwise print a form
     * listing subjects they never sat - so every unused row is blanked.
     *
     * Safe to do: the final-grade and action-taken formulas on these rows already evaluate to
     * an empty string when their quarters are blank (t="str" with an empty cached value), so
     * clearing cannot leave #DIV/0! on the printed page. This is exactly how the school's own
     * filled files look.
     *
     * JHS is deliberately NOT treated this way: there the learning-area names are fixed parts
     * of the form rather than per-learner data, and the exporter always writes the full list.
     */
    const unused: string[] = [];
    for (let i = term.subjects.length; i < SHS_SUBJECT_ROW_COUNT; i++) {
      const row = block.firstSubjectRow + i;
      unused.push(
        `${SHS_SUBJECT_COL.category}${row}`,
        `${SHS_SUBJECT_COL.name}${row}`,
        `${SHS_SUBJECT_COL.q1}${row}`,
        `${SHS_SUBJECT_COL.q2}${row}`,
      );
    }
    w.clear(block.sheet, unused);

    w.set(block.sheet, writes);
  }

  w.flush();
  wb.forceFullRecalcOnLoad();
  return wb;
}

/**
 * The template has a fixed number of printed subject rows. Silently dropping the overflow
 * would produce an incomplete permanent record, so refuse instead.
 */
function assertFits(term: TermRecord, capacity: number, label: string): void {
  if (term.subjects.length > capacity) {
    throw new Error(
      `${label}: ${term.subjects.length} subjects but the template prints only ${capacity} rows. ` +
        `Excess subjects belong on the annex sheet.`,
    );
  }
}
