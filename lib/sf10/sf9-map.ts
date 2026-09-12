/**
 * Where every value goes on the SF9 (Form 138) report card.
 *
 * The JHS equivalent of [jhs-map.ts](./jhs-map.ts), addressing paragraphs by `w14:paraId`
 * instead of cells by `r="G7"`. See [lib/docx/writer.ts](../docx/writer.ts) for why the anchor
 * is an id and never the visible text.
 *
 * ## The form prints twice on one sheet
 *
 * A landscape A4 page carries **two identical copies side by side**, to be cut apart and sent
 * home. They are duplicated content, not duplicated bytes: the same field is split across three
 * runs in one copy and sits in a single run in the other. So every field appears here twice,
 * under `COPY_A` and `COPY_B`, and `fillSf9` writes both.
 *
 * A field missing from one copy is the failure mode worth designing against - a card that reads
 * correctly on the half somebody happened to check.
 *
 * ## What the template already says
 *
 * Subject names, month headings and the class-day counts are **pre-printed**. This map names
 * only the cells that take a learner's values, which is why the "Values Education" row simply
 * reads its grades from the stored `Edukasyon sa Pagpapakatao (EsP)` subject - the relabelling
 * is the template's, not ours, and nothing renames a stored subject.
 */

/** The value cells on one subject row: three terms, a final rating, a remark. */
export interface Sf9Row {
  terms: [string, string, string];
  final: string;
  remarks: string;
}

/** Every printed row, in the order the form lists them. */
export interface Sf9Copy {
  schoolYear: string;
  /** `Name: ___ Age:___ Sex: ___` - one paragraph carrying three fields. */
  nameLine: string;
  /** `LRN: ___ Grade: ___ Section: ___`. */
  lrnLine: string;
  subjects: Record<Sf9SubjectKey, Sf9Row>;
  /** The General Average row spans its label, so it has no term cells. */
  generalAverage: { final: string; remarks: string };
  /** `No. of Day's Present`: Jun..Apr then Total. */
  daysPresent: string[];
}

export const SF9_SUBJECT_KEYS = [
  "filipino",
  "english",
  "mathematics",
  "science",
  "ap",
  "values",
  "tle",
  "mapeh",
  "musicArts",
  "peHealth",
] as const;

export type Sf9SubjectKey = (typeof SF9_SUBJECT_KEYS)[number];

/**
 * Which stored subject feeds each printed row.
 *
 * Matched by name rather than by position: `swapSubjectOrder()` lets a registrar reorder
 * `term_subjects`, so an ordinal would put Science's marks on the Filipino line.
 *
 * `musicArts` and `peHealth` have no entry because they are not stored - the form asks for two
 * combined figures where the SF10 records four components. See `combineMapeh()` in
 * lib/db/to-sf9-record.ts.
 */
export const SF9_SUBJECT_SOURCE: Record<Sf9SubjectKey, string | null> = {
  filipino: "Filipino",
  english: "English",
  mathematics: "Mathematics",
  science: "Science",
  ap: "Araling Panlipunan (AP)",
  // The template prints "Values Education"; the SF10 and the database call it EsP.
  values: "Edukasyon sa Pagpapakatao (EsP)",
  tle: "Technology and Livelihood Education (TLE)",
  mapeh: "MAPEH",
  musicArts: null,
  peHealth: null,
};

/** The four component subjects the two combined rows are derived from. */
export const MAPEH_COMPONENTS = {
  musicArts: ["Music", "Arts"],
  peHealth: ["Physical Education", "Health"],
} as const;

const COPY_A: Sf9Copy = {
  schoolYear: "1E667EF2",
  nameLine: "2AB47069",
  lrnLine: "49942061",
  subjects: {
    filipino: { terms: ["0969265E", "21F1A869", "4ED689D4"], final: "17726103", remarks: "1A005F26" },
    english: { terms: ["3FE4F978", "4E434C4E", "06D332C4"], final: "6F4F484A", remarks: "4F953CD6" },
    mathematics: { terms: ["0FD7AAD7", "5FC1BCCA", "2674848D"], final: "5F0DCFAA", remarks: "2FE4A0AC" },
    science: { terms: ["66A36B39", "265564F7", "350F29DA"], final: "21C56D09", remarks: "2DF4A7C5" },
    ap: { terms: ["46EB25CE", "46162F98", "5C2CB94D"], final: "3ACDAC12", remarks: "7F4EF3FE" },
    values: { terms: ["0427B616", "02812C4F", "308D7CA9"], final: "3EF42E72", remarks: "38A6AE18" },
    tle: { terms: ["684935DE", "5BA4852D", "5195EF08"], final: "7FFFDE05", remarks: "15F55709" },
    mapeh: { terms: ["2872E30A", "5A7CB7D2", "7DA4CE2C"], final: "36867ADA", remarks: "6023C340" },
    musicArts: { terms: ["7897C13E", "70DD62A1", "781DA51C"], final: "24540F4C", remarks: "47DB8E48" },
    peHealth: { terms: ["522BA962", "700E0152", "64559621"], final: "426D6D32", remarks: "7B02DEA4" },
  },
  generalAverage: { final: "7F6FAE68", remarks: "7A82CF21" },
  daysPresent: [
    "220381B7", "7B9404F8", "788FA6D6", "3A004C9D", "3887FA07", "538FB3F6",
    "4AF7C0E7", "1DB04446", "0E37E98E", "1207A1F0", "49DC3440", "1FCD60B5",
  ],
};

const COPY_B: Sf9Copy = {
  schoolYear: "229975B0",
  nameLine: "0AA58D0E",
  lrnLine: "69F915D1",
  subjects: {
    filipino: { terms: ["0EF4B0ED", "5C343F8D", "5B76DAB0"], final: "79B0834D", remarks: "03AA1A5C" },
    english: { terms: ["1A618708", "2A85F0DC", "6F75EF2D"], final: "1A658796", remarks: "440F513F" },
    mathematics: { terms: ["4FF89A24", "0F3E2CB9", "5F468049"], final: "2EB44A83", remarks: "559B3CD6" },
    science: { terms: ["7231B68B", "7834E1FC", "1FCE8B8B"], final: "51CC04E0", remarks: "1AE3D3C1" },
    ap: { terms: ["78BCA0A6", "776BF424", "03820264"], final: "2DA26CCD", remarks: "4B34D056" },
    values: { terms: ["346038A3", "6A69A50C", "71EDA369"], final: "44A2DC1E", remarks: "36E3572C" },
    tle: { terms: ["256D4D2D", "6D366CC5", "5BF7AEF6"], final: "47FFF4B3", remarks: "415B4EFE" },
    mapeh: { terms: ["30A96ADE", "6E759DCA", "313331BD"], final: "1407F41B", remarks: "102C7E7D" },
    musicArts: { terms: ["42FCEDA1", "7C351F3D", "1CFC5AA1"], final: "182D8285", remarks: "24F4EC5A" },
    peHealth: { terms: ["5FDE5B60", "706458F9", "54B64643"], final: "6FB25147", remarks: "26E501F0"},
  },
  generalAverage: { final: "49BCA39B", remarks: "64DD4F1E" },
  daysPresent: [
    "2F2F7E32", "4C09001B", "1055F1A4", "4C23CE49", "14AD98B8", "62C88848",
    "42213043", "0E4548B8", "13036E2C", "05A651B9", "5899E179", "226BD2CC",
  ],
};

/** Both halves of the sheet. `fillSf9` writes every field into each. */
export const SF9_COPIES: Sf9Copy[] = [COPY_A, COPY_B];

/**
 * The blanks on the identity lines, as they appear in the template.
 *
 * Matched with their labels rather than as bare underscore runs: `Age:____` and `Sex: ____` are
 * both four underscores, so a bare search would fill whichever came first and the two would
 * swap depending on the order the fields were written.
 */
export const SF9_BLANKS = {
  name: "______________________________",
  age: "Age:____",
  sex: "Sex: ____",
  lrn: "______________________________",
  grade: "Grade: ____",
  section: "Section: _____",
  schoolYear: "2026-2027",
} as const;
