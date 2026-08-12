/**
 * Cell geometry for `templates/SF10-SHS.xlsx` (Senior High School Student Permanent Record).
 *
 * Unlike the JHS template, the four semester blocks are NOT uniformly offset - the row gap
 * between the header row and the track/strand row differs between FRONT and BACK, and the
 * remarks value sits in column E in the first block but column F in the other three. Every
 * block therefore carries its own explicit row numbers rather than sharing one offset table.
 *
 * Subject rows are variable here: which subjects a student takes depends on their strand
 * (the template drives this from dropdowns on a hidden Helper sheet), so subjects are stored
 * as rows in the database rather than as fixed columns.
 *
 * Cells NOT listed as writable on purpose: semester final grade (BD), action taken (BI) and
 * the general average are live formulas owned by the template.
 */

export const SHS_SHEET = { front: "FRONT", back: "BACK", annex: "ANNEX" } as const;
export type ShsSheet = (typeof SHS_SHEET)[keyof typeof SHS_SHEET];

/** Learner information block, all on `FRONT`. */
export const SHS_LEARNER = {
  lastName: "F8",
  firstName: "Y8",
  middleName: "AZ8",
  lrn: "C9",
  birthdate: "AA9",
  sex: "AN9",
  shsAdmissionDate: "BH9",
} as const;

/** Eligibility for SHS enrolment, all on `FRONT`. */
export const SHS_ELIGIBILITY = {
  hsCompleterGenAve: "N13",
  jhsCompleterGenAve: "AH13",
  graduationDate: "P14",
  prevSchoolName: "Z14",
  prevSchoolAddress: "AW14",
  peptRating: "K16",
  alsRating: "AC16",
  otherCredential: "AP16",
  examDate: "P17",
  clcNameAddress: "AN17",
} as const;

export interface ShsBlock {
  level: 11 | 12;
  semester: 1 | 2;
  sheet: ShsSheet;
  /** Row holding SCHOOL / SCHOOL ID / GRADE LEVEL / SY / SEM. */
  headerRow: number;
  /** Row holding TRACK/STRAND and SECTION - +2 from the header on three blocks, +1 on one. */
  trackRow: number;
  /**
   * Row holding SUBJECTS / Quarter / SEM FINAL GRADE / ACTION TAKEN.
   *
   * `firstSubjectRow - 4` on all four blocks, but written out per block like every other row
   * here: this map exists because the blocks are NOT uniformly offset, and one derived value
   * among explicit ones is how the next irregularity gets missed.
   */
  columnHeaderRow: number;
  /** First of the 12 subject rows. */
  firstSubjectRow: number;
  /** Formula row; read-only. */
  generalAverageRow: number;
  remarksRow: number;
  /** Column of the remarks value. Column E in the first block, F in the other three. */
  remarksCol: string;
}

export const SHS_BLOCKS: readonly ShsBlock[] = [
  {
    level: 11,
    semester: 1,
    sheet: "FRONT",
    headerRow: 23,
    trackRow: 25,
    columnHeaderRow: 27,
    firstSubjectRow: 31,
    generalAverageRow: 43,
    remarksRow: 45,
    remarksCol: "E",
  },
  {
    level: 11,
    semester: 2,
    sheet: "FRONT",
    headerRow: 66,
    trackRow: 68,
    columnHeaderRow: 70,
    firstSubjectRow: 74,
    generalAverageRow: 86,
    remarksRow: 88,
    remarksCol: "F",
  },
  {
    level: 12,
    semester: 1,
    sheet: "BACK",
    headerRow: 4,
    trackRow: 5,
    columnHeaderRow: 7,
    firstSubjectRow: 11,
    generalAverageRow: 23,
    remarksRow: 25,
    remarksCol: "F",
  },
  {
    level: 12,
    semester: 2,
    sheet: "BACK",
    headerRow: 46,
    trackRow: 48,
    columnHeaderRow: 50,
    firstSubjectRow: 54,
    generalAverageRow: 66,
    remarksRow: 68,
    remarksCol: "F",
  },
] as const;

/** Every block reserves exactly 12 subject rows. */
export const SHS_SUBJECT_ROW_COUNT = 12;

/** Columns on a block's header row. */
export const SHS_HEADER_COL = {
  schoolName: "E",
  schoolId: "AF",
  gradeLevel: "AS",
  schoolYear: "BA",
  semester: "BK",
} as const;

/** Columns on a block's track/strand row. */
export const SHS_TRACK_COL = {
  trackStrand: "G",
  section: "AS",
} as const;

/**
 * Columns for a subject row. `finalGrade` and `actionTaken` are listed for the importer to
 * READ; both are formula cells and must never be written.
 */
export const SHS_SUBJECT_COL = {
  category: "A",
  name: "I",
  q1: "AT",
  q2: "AY",
  finalGrade: "BD",
  actionTaken: "BI",
} as const;

/** Formula cell - read only. */
export const SHS_GENERAL_AVERAGE_COL = "BD";

/**
 * The block's own printed furniture - the words SCHOOL:, TRACK/STRAND:, SUBJECTS and so on.
 *
 * Only cleared for a semester the learner will never have, i.e. the fourth block of a
 * three-semester programme. A block that is merely not reached yet keeps its labels: that
 * section is empty, not absent, and a form with an unlabelled gap in it looks like a printing
 * fault rather than a record.
 *
 * Verified against all four blocks; the columns are the same in each, only the rows differ.
 */
export const SHS_BLOCK_LABEL_COL = {
  header: ["A", "AB", "AM", "AY", "BH"],
  track: ["A", "AN"],
  columnHeader: ["A", "I", "AT", "BD", "BI"],
  generalAverage: ["A"],
  remarks: ["A"],
} as const;

/** Values accepted by the template's category dropdown (defined names on the Helper sheet). */
export const SHS_CATEGORIES = ["Core", "Applied", "Specialized", "Other_Subjects"] as const;
export type ShsCategory = (typeof SHS_CATEGORIES)[number];

/** Semester label as written on the form. */
export function shsSemesterLabel(semester: 1 | 2): string {
  return semester === 1 ? "1ST" : "2ND";
}

/** SHS completion summary at the foot of `BACK`. */
export const SHS_COMPLETION = {
  trackStrandAccomplished: "S90",
  shsGeneralAverage: "BJ90",
  awardsReceived: "S91",
  graduationDate: "BJ91",
  schoolHeadName: "A94",
} as const;
