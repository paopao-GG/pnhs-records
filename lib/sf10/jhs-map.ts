/**
 * Cell geometry for `templates/SF10-JHS.xlsx` (Learner Permanent Record for Junior High
 * School, SFRT Revised 2017).
 *
 * Derived by unpacking the template and reading its mergeCells map: every value lands on
 * the top-left anchor of a merged range. Both the importer and the exporter consume this
 * one map, so a round trip proves it correct in both directions.
 *
 * Cells NOT listed here on purpose: final ratings (column AJ) and general averages are
 * live formulas owned by the template. We supply quarter ratings; Excel computes the rest.
 */

export const JHS_SHEET = { front: "Front", back: "Back" } as const;
export type JhsSheet = (typeof JHS_SHEET)[keyof typeof JHS_SHEET];

/** Learner information block, all on `Front`. */
export const JHS_LEARNER = {
  lastName: "G7",
  firstName: "W7",
  nameExt: "AN7",
  middleName: "AX7",
  lrn: "M8",
  birthdate: "AH8",
  sex: "AV8",
} as const;

/** Eligibility for JHS enrolment, all on `Front`. */
export const JHS_ELIGIBILITY = {
  elemGeneralAverage: "AC12",
  citation: "AP12",
  elemSchoolName: "M13",
  elemSchoolId: "AH13",
  elemSchoolAddress: "AR13",
  peptRating: "L16",
  alsRating: "AI16",
  otherCredential: "AX16",
  examDate: "T17",
  testingCenter: "AO17",
} as const;

export interface JhsBlock {
  level: 7 | 8 | 9 | 10;
  sheet: JhsSheet;
  /** Row holding School / School ID / District / Division / Region. */
  headerRow: number;
}

/**
 * The four grade-level blocks. Unlike the SHS template these are perfectly regular -
 * every offset below applies unchanged to all four (verified against each).
 *
 * `Back` also carries a fifth, unused block at row 59 for transferees, and the
 * certification section at rows 86-95.
 */
export const JHS_BLOCKS: readonly JhsBlock[] = [
  { level: 7, sheet: "Front", headerRow: 21 },
  { level: 8, sheet: "Front", headerRow: 49 },
  { level: 9, sheet: "Back", headerRow: 3 },
  { level: 10, sheet: "Back", headerRow: 31 },
] as const;

/** Row offsets from a block's `headerRow`. */
export const JHS_OFFSET = {
  school: 0,
  classInfo: 1,
  /**
   * The row numbering the quarters: literal `1 2 3 4` in the four quarter columns.
   *
   * It is per block, which is what makes a mixed record possible — Grade 7 can keep its four
   * quarters while Grade 9 shows three, on the same sheet. It is also the discriminator the
   * importer uses: a form issued under the three-period scheme has no `4` here, and that is a
   * property of the blank form rather than of how far someone got encoding it.
   */
  quarterHeader: 4,
  firstSubject: 5,
  generalAverage: 19,
  remedialHeader: 21,
} as const;

/** Columns for the school row (`headerRow + JHS_OFFSET.school`). */
export const JHS_SCHOOL_COL = {
  schoolName: "E",
  schoolId: "U",
  district: "AD",
  division: "AP",
  region: "BB",
} as const;

/** Columns for the class row (`headerRow + JHS_OFFSET.classInfo`). */
export const JHS_CLASS_COL = {
  gradeLevel: "I",
  section: "N",
  schoolYear: "V",
  adviser: "AI",
  signature: "AW",
} as const;

/**
 * Columns for a subject row. `finalRating` is listed for the importer to READ; it is a
 * formula cell and must never be written.
 */
export const JHS_SUBJECT_COL = {
  name: "B",
  q1: "U",
  q2: "Y",
  q3: "AC",
  q4: "AG",
  finalRating: "AJ",
  remarks: "AP",
} as const;

/** Columns on the general-average row. `value` is a formula; `remark` is a literal string. */
export const JHS_GENERAL_COL = {
  value: "AJ",
  remark: "AP",
} as const;

/**
 * Every block reserves 14 subject rows. Grades 7-9 fill 13 and leave the last blank;
 * grade 10 uses all 14, the extra being CAT.
 */
export const JHS_SUBJECT_ROW_COUNT = 14;

/**
 * Only the first 12 subject rows (Filipino through Health) carry an AVERAGE formula in the
 * final-rating column. Homeroom Guidance and CAT deliberately have none - the template
 * expects those marks to be entered directly, so the app must supply `finalRating` for them.
 */
export const JHS_COMPUTED_SUBJECT_ROWS = 12;

/** True when the template computes this subject row's final rating for us. */
export function jhsFinalRatingIsComputed(subjectIndex: number): boolean {
  return subjectIndex < JHS_COMPUTED_SUBJECT_ROWS;
}

/**
 * Only the first EIGHT subject rows count toward the general average.
 *
 * The template's formula is `AVERAGE(AJ26:AO33)` — rows 26-33, i.e. Filipino, English,
 * Mathematics, Science, Araling Panlipunan, EsP, TLE and MAPEH.
 *
 * Music, Arts, Physical Education and Health are *components* of MAPEH and are printed as
 * their own rows, so including them would count MAPEH five times over. Homeroom Guidance and
 * CAT are excluded too.
 *
 * Averaging all thirteen rows instead disagreed with the form on 37 of 85 grade blocks across
 * the school's real files — differences of one to two marks on the figure that decides
 * promotion and honours.
 */
export const JHS_GENERAL_AVERAGE_SUBJECT_ROWS = 8;

export const JHS_LEARNING_AREAS = [
  "Filipino",
  "English",
  "Mathematics",
  "Science",
  "Araling Panlipunan (AP)",
  "Edukasyon sa Pagpapakatao (EsP)",
  "Technology and Livelihood Education (TLE)",
  "MAPEH",
  "Music",
  "Arts",
  "Physical Education",
  "Health",
  "Homeroom Guidance",
] as const;

/** Grade 10 only - appears as the 14th learning area. */
export const JHS_GRADE_10_EXTRA = "CAT (Citizenship Advancement Training)";

export function jhsLearningAreas(level: JhsBlock["level"]): string[] {
  return level === 10
    ? [...JHS_LEARNING_AREAS, JHS_GRADE_10_EXTRA]
    : [...JHS_LEARNING_AREAS];
}

/** Certification section (transfer-out / JHS completer), on `Back`. */
export const JHS_CERTIFICATION = {
  studentName: "O89",
  lrn: "AF89",
  eligibleForGrade: "BB89",
  schoolName: "H90",
  schoolId: "AC90",
  lastSchoolYearAttended: "AS90",
  principalName: "S91",
} as const;
