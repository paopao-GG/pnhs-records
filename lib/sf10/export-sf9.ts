/**
 * Fills the school's SF9 (Form 138) report card.
 *
 * The Word counterpart of `fillJhs` in [export.ts](./export.ts), and it follows the same rule:
 * **write values, never structure.** Subject names, month headings, the class-day counts and
 * the grading descriptors are the school's own pre-printed text and are left exactly as they
 * are. Nothing here adds a row, removes one, or touches the floating-table anchors that put
 * the two copies side by side.
 *
 * Every field is written into **both copies**. See sf9-map.ts.
 */

import { DocxFile } from "../docx/writer.ts";
import { SF9_BLANKS, SF9_COPIES, SF9_SUBJECT_KEYS, type Sf9Copy } from "./sf9-map.ts";
import type { Sf9Record } from "../db/to-sf9-record.ts";

/** Grades print as whole numbers; a missing mark prints as nothing, never as a zero. */
function mark(value: number | null): string {
  return value === null ? "" : String(value);
}

/**
 * Fill one copy.
 *
 * The identity blanks are replaced with their labels attached - `Age:____` rather than four
 * bare underscores - because `Age:` and `Sex:` are both followed by four, and a bare search
 * would fill whichever came first.
 */
function fillCopy(doc: DocxFile, copy: Sf9Copy, record: Sf9Record): void {
  const { learner } = record;

  if (learner.schoolYear) {
    doc.replaceInParagraph(copy.schoolYear, SF9_BLANKS.schoolYear, learner.schoolYear);
  }

  doc.replaceInParagraph(copy.nameLine, SF9_BLANKS.name, learner.name);
  if (learner.age !== null) {
    doc.replaceInParagraph(copy.nameLine, SF9_BLANKS.age, `Age: ${learner.age}`);
  }
  if (learner.sex) {
    doc.replaceInParagraph(copy.nameLine, SF9_BLANKS.sex, `Sex: ${learner.sex}`);
  }

  // A Form 137 learner has no real LRN, so the blank is left blank rather than filled with a
  // generated marker the reader would take for a number.
  if (learner.lrn) doc.replaceInParagraph(copy.lrnLine, SF9_BLANKS.lrn, learner.lrn);
  doc.replaceInParagraph(copy.lrnLine, SF9_BLANKS.grade, `Grade: ${learner.grade}`);
  if (learner.section) {
    doc.replaceInParagraph(copy.lrnLine, SF9_BLANKS.section, `Section: ${learner.section}`);
  }

  for (const key of SF9_SUBJECT_KEYS) {
    const row = record.subjects[key];
    const cells = copy.subjects[key];

    row.terms.forEach((value, i) => {
      if (value !== null) doc.appendRun(cells.terms[i], mark(value));
    });
    if (row.final !== null) doc.appendRun(cells.final, mark(row.final));
    if (row.remarks) doc.appendRun(cells.remarks, row.remarks);
  }

  if (record.generalAverage !== null) {
    doc.appendRun(copy.generalAverage.final, mark(record.generalAverage));
    const remark = record.generalAverage >= 75 ? "Passed" : "Failed";
    doc.appendRun(copy.generalAverage.remarks, remark);
  }

  /*
   * Attendance is deliberately left blank.
   *
   * The template pre-prints the class days per month, and `term_attendance` holds nothing for a
   * K-12 term - that table is populated only by Form 137 imports. Writing zeros would state
   * that the learner attended nothing; leaving the row empty is the truthful result and matches
   * what the adviser fills in by hand today.
   */
}

/** Fill the template at `templatePath` and return the finished document. */
export function fillSf9(templatePath: string, record: Sf9Record): Uint8Array {
  const doc = DocxFile.open(templatePath);
  for (const copy of SF9_COPIES) fillCopy(doc, copy, record);
  return doc.toBuffer();
}
