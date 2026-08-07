/**
 * Phase 0 fidelity spike.
 *
 * 1. VALIDATE  - every address in the cell maps must exist in the template and must not be
 *                a formula cell. This catches a bad map before it can produce a wrong record.
 * 2. SENTINEL  - fill each mapped field with its own name, so opening the file in Excel shows
 *                at a glance whether every value landed beside the right printed label.
 * 3. REALISTIC - fill with plausible student data to check the form prints correctly and the
 *                template's own formulas compute the finals from our quarter ratings.
 * 4. ROUNDTRIP - read the written values back out and confirm they survived.
 *
 * Run: npm run spike
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Workbook } from "../lib/xlsx/workbook.ts";
import { getCell, parseSharedStrings } from "../lib/xlsx/cells.ts";
import { fillJhs, fillShs } from "../lib/sf10/export.ts";
import type { Sf10Record, SubjectRecord } from "../lib/sf10/types.ts";
import {
  JHS_BLOCKS,
  JHS_CLASS_COL,
  JHS_ELIGIBILITY,
  JHS_LEARNER,
  JHS_OFFSET,
  JHS_SCHOOL_COL,
  JHS_SUBJECT_COL,
  JHS_SUBJECT_ROW_COUNT,
  jhsFinalRatingIsComputed,
  jhsLearningAreas,
} from "../lib/sf10/jhs-map.ts";
import {
  SHS_BLOCKS,
  SHS_ELIGIBILITY,
  SHS_HEADER_COL,
  SHS_LEARNER,
  SHS_SUBJECT_COL,
  SHS_SUBJECT_ROW_COUNT,
  SHS_TRACK_COL,
} from "../lib/sf10/shs-map.ts";

const ROOT = join(import.meta.dirname, "..");
const TEMPLATES = join(ROOT, "templates");
const OUT = join(ROOT, "spike-output");

const JHS_TEMPLATE = join(TEMPLATES, "SF10-JHS.xlsx");
const SHS_TEMPLATE = join(TEMPLATES, "SF10-SHS.xlsx");

const SCHOOL = {
  schoolName: "PANTAO NATIONAL HIGH SCHOOL",
  schoolId: "301860",
  district: "3rd Dist.-LIBON WEST",
  division: "ALBAY",
  region: "V",
} as const;

// ---------------------------------------------------------------------------
// 1. Validate the cell maps against the real templates
// ---------------------------------------------------------------------------

interface MapEntry {
  sheet: string;
  addr: string;
  label: string;
  /** Formula cells are expected here - we only check that they exist. */
  readOnly?: boolean;
}

function jhsMapEntries(): MapEntry[] {
  const entries: MapEntry[] = [];

  for (const [label, addr] of Object.entries(JHS_LEARNER)) {
    entries.push({ sheet: "Front", addr, label: `learner.${label}` });
  }
  for (const [label, addr] of Object.entries(JHS_ELIGIBILITY)) {
    entries.push({ sheet: "Front", addr, label: `eligibility.${label}` });
  }

  for (const block of JHS_BLOCKS) {
    const p = `G${block.level}`;
    const schoolRow = block.headerRow + JHS_OFFSET.school;
    const classRow = block.headerRow + JHS_OFFSET.classInfo;

    for (const [label, col] of Object.entries(JHS_SCHOOL_COL)) {
      entries.push({ sheet: block.sheet, addr: `${col}${schoolRow}`, label: `${p}.${label}` });
    }
    for (const [label, col] of Object.entries(JHS_CLASS_COL)) {
      entries.push({ sheet: block.sheet, addr: `${col}${classRow}`, label: `${p}.${label}` });
    }
    for (let i = 0; i < JHS_SUBJECT_ROW_COUNT; i++) {
      const row = block.headerRow + JHS_OFFSET.firstSubject + i;
      for (const [label, col] of Object.entries(JHS_SUBJECT_COL)) {
        entries.push({
          sheet: block.sheet,
          addr: `${col}${row}`,
          label: `${p}.subject[${i}].${label}`,
          // Homeroom Guidance and CAT carry no AVERAGE formula - we write those ourselves.
          readOnly: label === "finalRating" && jhsFinalRatingIsComputed(i),
        });
      }
    }
  }
  return entries;
}

function shsMapEntries(): MapEntry[] {
  const entries: MapEntry[] = [];

  for (const [label, addr] of Object.entries(SHS_LEARNER)) {
    entries.push({ sheet: "FRONT", addr, label: `learner.${label}` });
  }
  for (const [label, addr] of Object.entries(SHS_ELIGIBILITY)) {
    entries.push({ sheet: "FRONT", addr, label: `eligibility.${label}` });
  }

  for (const block of SHS_BLOCKS) {
    const p = `G${block.level}S${block.semester}`;
    for (const [label, col] of Object.entries(SHS_HEADER_COL)) {
      entries.push({ sheet: block.sheet, addr: `${col}${block.headerRow}`, label: `${p}.${label}` });
    }
    for (const [label, col] of Object.entries(SHS_TRACK_COL)) {
      entries.push({ sheet: block.sheet, addr: `${col}${block.trackRow}`, label: `${p}.${label}` });
    }
    entries.push({
      sheet: block.sheet,
      addr: `${block.remarksCol}${block.remarksRow}`,
      label: `${p}.remarks`,
    });
    for (let i = 0; i < SHS_SUBJECT_ROW_COUNT; i++) {
      const row = block.firstSubjectRow + i;
      for (const [label, col] of Object.entries(SHS_SUBJECT_COL)) {
        entries.push({
          sheet: block.sheet,
          addr: `${col}${row}`,
          label: `${p}.subject[${i}].${label}`,
          readOnly: label === "finalGrade" || label === "actionTaken",
        });
      }
    }
  }
  return entries;
}

function validate(templatePath: string, entries: MapEntry[], form: string): boolean {
  const wb = Workbook.open(templatePath);
  const xmlBySheet = new Map<string, string>();
  const problems: string[] = [];

  for (const e of entries) {
    let xml = xmlBySheet.get(e.sheet);
    if (!xml) {
      xml = wb.sheetXml(e.sheet);
      xmlBySheet.set(e.sheet, xml);
    }

    const m = new RegExp(
      `<c r="${e.addr}"((?:\\s+[\\w:]+="[^"]*")*)\\s*(?:/>|>([\\s\\S]*?)</c>)`,
    ).exec(xml);

    if (!m) {
      problems.push(`  MISSING  ${e.label.padEnd(34)} ${e.sheet}!${e.addr}`);
      continue;
    }
    const hasFormula = !!m[2] && /<f[\s/>]/.test(m[2]);
    if (hasFormula && !e.readOnly) {
      problems.push(`  FORMULA  ${e.label.padEnd(34)} ${e.sheet}!${e.addr} (would be clobbered)`);
    }
    if (!hasFormula && e.readOnly) {
      problems.push(`  NOT-FML  ${e.label.padEnd(34)} ${e.sheet}!${e.addr} (expected a formula)`);
    }
  }

  if (problems.length === 0) {
    console.log(`  ${form}: all ${entries.length} mapped cells exist and are safe to write`);
    return true;
  }
  console.log(`  ${form}: ${problems.length} of ${entries.length} mapped cells have problems`);
  for (const p of problems) console.log(p);
  return false;
}

// ---------------------------------------------------------------------------
// 2 & 3. Build sentinel and realistic records
// ---------------------------------------------------------------------------

function jhsSentinel(): Sf10Record {
  return {
    student: {
      lastName: "<LAST_NAME>",
      firstName: "<FIRST_NAME>",
      middleName: "<MIDDLE_NAME>",
      nameExt: "<EXT>",
      lrn: "<LRN>",
      birthdate: "<BIRTHDATE>",
      sex: "<SEX>" as never,
    },
    jhsEligibility: {
      elemGeneralAverage: "<G.AVE>",
      citation: "<CITATION>",
      elemSchoolName: "<ELEM_SCHOOL>",
      elemSchoolId: "<ELEM_ID>",
      elemSchoolAddress: "<ELEM_ADDRESS>",
      peptRating: "<PEPT>",
      alsRating: "<ALS>",
      otherCredential: "<OTHER>",
      examDate: "<EXAM_DATE>",
      testingCenter: "<TESTING_CENTER>",
    },
    terms: JHS_BLOCKS.map((b) => ({
      level: b.level,
      schoolYear: `<SY-${b.level}>`,
      section: `<SECTION-${b.level}>`,
      adviser: `<ADVISER-${b.level}>`,
      ...SCHOOL,
      promotionRemark: "<PROMOTION>",
      subjects: jhsLearningAreas(b.level).map((name, i) => ({
        name,
        q1: 11,
        q2: 22,
        q3: 33,
        q4: 44,
        remarks: "<REMARK>",
        ...(jhsFinalRatingIsComputed(i) ? {} : { finalRating: 99 }),
      })),
    })),
  };
}

function jhsRealistic(): Sf10Record {
  const grades: Record<number, number[]> = {
    7: [88, 90, 85, 87, 91, 93, 89, 90, 92, 91, 94, 90, 95],
    8: [89, 91, 86, 88, 92, 94, 90, 91, 93, 92, 95, 91, 96],
    9: [90, 92, 88, 89, 93, 95, 91, 92, 94, 93, 96, 92, 97],
    10: [91, 93, 89, 90, 94, 96, 92, 93, 95, 94, 97, 93, 98, 90],
  };

  return {
    student: {
      lastName: "DELA CRUZ",
      firstName: "JUAN MIGUEL",
      middleName: "SANTOS",
      lrn: "301860110001",
      birthdate: "05/14/2008",
      sex: "M",
    },
    jhsEligibility: {
      elemGeneralAverage: 91,
      elemSchoolName: "PANTAO  ELEMENTARY SCHOOL",
      elemSchoolId: "111798",
      elemSchoolAddress: "PANTAO, LIBON, ALBAY",
    },
    terms: JHS_BLOCKS.map((b, idx) => ({
      level: b.level,
      schoolYear: `${2020 + idx}-${2021 + idx}`,
      section: ["MASIPAG", "MATULUNGIN", "MAPAGKUMBABA", "MAGALANG"][idx],
      adviser: ["G. REYES", "M. SANTOS", "R. BAUTISTA", "L. VILLANUEVA"][idx],
      ...SCHOOL,
      promotionRemark: "Promoted",
      subjects: jhsLearningAreas(b.level).map((name, i): SubjectRecord => {
        const base = grades[b.level][i];
        return {
          name,
          q1: base - 1,
          q2: base,
          q3: base + 1,
          q4: base,
          remarks: "Passed",
          // Homeroom Guidance / CAT are not averaged by the template.
          ...(jhsFinalRatingIsComputed(i) ? {} : { finalRating: base }),
        };
      }),
    })),
  };
}

function shsSentinel(): Sf10Record {
  return {
    student: {
      lastName: "<LAST_NAME>",
      firstName: "<FIRST_NAME>",
      middleName: "<MIDDLE_NAME>",
      lrn: "<LRN>",
      birthdate: "<BIRTHDATE>",
      sex: "<SEX>" as never,
    },
    shsEligibility: {
      shsAdmissionDate: "<ADMISSION>",
      hsCompleterGenAve: "<HS>",
      jhsCompleterGenAve: "<JHS>",
      graduationDate: "<GRAD_DATE>",
      prevSchoolName: "<PREV_SCHOOL>",
      prevSchoolAddress: "<PREV_ADDRESS>",
      peptRating: "<PEPT>",
      alsRating: "<ALS>",
      otherCredential: "<OTHER>",
      examDate: "<EXAM_DATE>",
      clcNameAddress: "<CLC>",
    },
    terms: SHS_BLOCKS.map((b) => ({
      level: b.level,
      semester: b.semester,
      schoolYear: `<SY-${b.level}-${b.semester}>`,
      section: `<SECTION-${b.level}${b.semester}>`,
      trackStrand: `<TRACK-${b.level}${b.semester}>`,
      ...SCHOOL,
      promotionRemark: "<REMARKS>",
      subjects: Array.from({ length: SHS_SUBJECT_ROW_COUNT }, (_, i) => ({
        name: `<SUBJECT-${i + 1}>`,
        category: "Core" as const,
        q1: 11,
        q2: 22,
      })),
    })),
  };
}

function shsRealistic(): Sf10Record {
  const sem1G11: SubjectRecord[] = [
    { name: "Oral Communication", category: "Core" },
    { name: "Komunikasyon at Pananaliksik sa Wika at Kulturang Pilipino", category: "Core" },
    { name: "Media and Information Literacy", category: "Core" },
    { name: "General Mathematics", category: "Core" },
    { name: "Earth Science", category: "Core" },
    { name: "Personal Development/Pansariling Kaunlaran", category: "Core" },
    { name: "Understanding Culture, Society and Politics", category: "Core" },
    { name: "Physical Education and Health", category: "Core" },
    { name: "Organization and Management", category: "Specialized" },
    { name: "Homeroom Guidance", category: "Other_Subjects" },
  ];
  const sem2G11: SubjectRecord[] = [
    { name: "Reading and Writing", category: "Core" },
    { name: "Pagbasa at Pagsusuri ng Iba't Ibang Teksto Tungo sa Pananaliksik", category: "Core" },
    { name: "21st Century Literature from the Philippines and the World", category: "Core" },
    { name: "Contemporary Philippine Arts from the Regions", category: "Core" },
    { name: "Statistics and Probability", category: "Core" },
    { name: "Physical Science", category: "Core" },
    {
      name: "Introduction to the Philosophy of the Human Person/Pambungad sa Pilosopiya ng Tao",
      category: "Core",
    },
    { name: "Physical Education and Health", category: "Core" },
    { name: "Trend, Networks, and Critical Thinking in the 21st Century", category: "Specialized" },
    { name: "Homeroom Guidance", category: "Other_Subjects" },
  ];
  const g12: SubjectRecord[] = [
    { name: "English for Academic and Professional Purposes", category: "Applied" },
    { name: "Practical Research 1", category: "Applied" },
    { name: "Filipino sa Piling Larang", category: "Applied" },
    { name: "Empowerment Technologies", category: "Applied" },
    { name: "Entrepreneurship", category: "Applied" },
    { name: "Physical Education and Health", category: "Core" },
    { name: "Food and Beverage Services NC II", category: "Specialized" },
    { name: "Homeroom Guidance", category: "Other_Subjects" },
  ];

  const withGrades = (subjects: SubjectRecord[], base: number): SubjectRecord[] =>
    subjects.map((s, i) => ({ ...s, q1: base + (i % 5), q2: base + 1 + (i % 4) }));

  const bySlot = [
    withGrades(sem1G11, 86),
    withGrades(sem2G11, 88),
    withGrades(g12, 89),
    withGrades(g12, 90),
  ];

  return {
    student: {
      lastName: "DELA CRUZ",
      firstName: "MARIA CLARA",
      middleName: "REYES",
      lrn: "301860110002",
      birthdate: "09/22/2006",
      sex: "F",
    },
    shsEligibility: {
      shsAdmissionDate: "06/03/2022",
      jhsCompleterGenAve: 92,
      graduationDate: "04/12/2022",
      prevSchoolName: "PANTAO NATIONAL HIGH SCHOOL",
      prevSchoolAddress: "PANTAO, LIBON, ALBAY",
    },
    terms: SHS_BLOCKS.map((b, idx) => ({
      level: b.level,
      semester: b.semester,
      schoolYear: b.level === 11 ? "2022-2023" : "2023-2024",
      section: "MODESTY",
      trackStrand: "ACADEMIC TRACK/ ACCOUNTANCY, BUSINESS AND MANAGEMENT STRAND",
      ...SCHOOL,
      promotionRemark: "PROMOTED",
      subjects: bySlot[idx],
    })),
  };
}

// ---------------------------------------------------------------------------
// 4. Round-trip check
// ---------------------------------------------------------------------------

function roundTrip(path: string, checks: { sheet: string; addr: string; expect: string | number }[]) {
  const wb = Workbook.open(path);
  let shared: string[] = [];
  try {
    shared = parseSharedStrings(wb.sheetXml("__none__"));
  } catch {
    /* shared strings not needed - we write inline strings */
  }

  const failures: string[] = [];
  for (const c of checks) {
    const actual = getCell(wb.sheetXml(c.sheet), c.addr, shared);
    if (String(actual) !== String(c.expect)) {
      failures.push(`    ${c.sheet}!${c.addr}: expected "${c.expect}", got "${actual}"`);
    }
  }
  if (failures.length) {
    console.log(`  round trip FAILED (${failures.length}):`);
    failures.forEach((f) => console.log(f));
    return false;
  }
  console.log(`  round trip OK (${checks.length} cells verified)`);
  return true;
}

// ---------------------------------------------------------------------------

function main(): void {
  mkdirSync(OUT, { recursive: true });
  let ok = true;

  console.log("\n[1/4] Validating cell maps against the templates");
  ok = validate(JHS_TEMPLATE, jhsMapEntries(), "JHS") && ok;
  ok = validate(SHS_TEMPLATE, shsMapEntries(), "SHS") && ok;

  if (!ok) {
    console.log("\nMap validation failed - fix the maps before generating files.\n");
    process.exit(1);
  }

  console.log("\n[2/4] Writing sentinel files (field names as values)");
  fillJhs(JHS_TEMPLATE, jhsSentinel()).save(join(OUT, "JHS-sentinel.xlsx"));
  fillShs(SHS_TEMPLATE, shsSentinel()).save(join(OUT, "SHS-sentinel.xlsx"));
  console.log("  spike-output/JHS-sentinel.xlsx");
  console.log("  spike-output/SHS-sentinel.xlsx");

  console.log("\n[3/4] Writing realistic files");
  fillJhs(JHS_TEMPLATE, jhsRealistic()).save(join(OUT, "JHS-realistic.xlsx"));
  fillShs(SHS_TEMPLATE, shsRealistic()).save(join(OUT, "SHS-realistic.xlsx"));
  console.log("  spike-output/JHS-realistic.xlsx");
  console.log("  spike-output/SHS-realistic.xlsx");

  console.log("\n[4/4] Verifying round trip");
  ok =
    roundTrip(join(OUT, "JHS-realistic.xlsx"), [
      { sheet: "Front", addr: JHS_LEARNER.lastName, expect: "DELA CRUZ" },
      { sheet: "Front", addr: JHS_LEARNER.lrn, expect: "301860110001" },
      { sheet: "Front", addr: "U26", expect: 87 },
      { sheet: "Front", addr: "B26", expect: "Filipino" },
      { sheet: "Back", addr: "B49", expect: "CAT (Citizenship Advancement Training)" },
      { sheet: "Back", addr: "I32", expect: 10 },
    ]) && ok;
  ok =
    roundTrip(join(OUT, "SHS-realistic.xlsx"), [
      { sheet: "FRONT", addr: SHS_LEARNER.lastName, expect: "DELA CRUZ" },
      { sheet: "FRONT", addr: SHS_LEARNER.lrn, expect: "301860110002" },
      { sheet: "FRONT", addr: "I31", expect: "Oral Communication" },
      { sheet: "FRONT", addr: "AT31", expect: 86 },
      { sheet: "BACK", addr: "I11", expect: "English for Academic and Professional Purposes" },
    ]) && ok;

  console.log(
    ok
      ? "\nSpike generated. Open the four files in Excel and compare against templates/.\n"
      : "\nSpike completed WITH FAILURES - see above.\n",
  );
  process.exit(ok ? 0 : 1);
}

main();
