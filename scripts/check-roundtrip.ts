/**
 * Round-trip proof: original file -> database -> printed SF10 -> parsed again.
 *
 * Both ends are read with the SAME parser, so representation differences (Excel date serials
 * vs the text dates we write) normalise away and only genuine data loss shows up. This
 * exercises the cell map in both directions at once - if an address were wrong, the value
 * would land somewhere the reader does not look, and the comparison would fail.
 *
 * Run: npm run roundtrip
 */

import { join, resolve } from "node:path";
import { Workbook } from "../lib/xlsx/workbook.ts";
import { parseShsWorkbook } from "../lib/sf10/import-shs.ts";
import { parseJhsWorkbook } from "../lib/sf10/import-jhs.ts";
import { detectForm, type Sf10Form } from "../lib/sf10/detect-form.ts";
import { listImportableFiles } from "./_local-files.ts";
import { fillJhs, fillShs } from "../lib/sf10/export.ts";
import { fullName, type Sf10Record } from "../lib/sf10/types.ts";

const ROOT = resolve(import.meta.dirname, "..");
const FOLDER = resolve(process.argv[2] ?? join(ROOT, "sf10-files"));
/**
 * Only the two printable forms. Form 137 has no template on purpose - an old-curriculum record
 * is never reissued on a modern SF10 - so there is no round trip to measure for it.
 */
const TEMPLATES: Record<"jhs" | "shs", string> = {
  jhs: join(ROOT, "templates", "SF10-JHS.xlsx"),
  shs: join(ROOT, "templates", "SF10-SHS.xlsx"),
};

const diffs: string[] = [];
const note = (m: string) => diffs.push(m);

function compare(a: Sf10Record, b: Sf10Record, label: string): void {
  const s1 = a.student;
  const s2 = b.student;

  for (const key of ["lrn", "lastName", "firstName", "middleName", "sex", "birthdate"] as const) {
    if ((s1[key] ?? "") !== (s2[key] ?? "")) {
      note(`${label}: student.${key}  "${s1[key] ?? ""}" -> "${s2[key] ?? ""}"`);
    }
  }

  if (a.terms.length !== b.terms.length) {
    note(`${label}: term count ${a.terms.length} -> ${b.terms.length}`);
    return;
  }

  a.terms.forEach((t1, i) => {
    const t2 = b.terms[i];
    const where = `${label}: G${t1.level}${t1.semester ? `S${t1.semester}` : ""}`;

    /*
     * The test is NO DATA LOSS, not byte equality.
     *
     * The blank templates pre-print things a given real file may leave empty — the school name
     * on a JHS grade block, the standard learning-area names. A refilled form therefore
     * legitimately carries more than a sparse original. Only a value the original HAD and the
     * round trip changed or dropped is a defect.
     */
    for (const key of ["schoolYear", "section", "trackStrand", "schoolName", "schoolId"] as const) {
      const had = t1[key];
      if (had && had !== t2[key]) {
        note(`${where}.${key}  "${had}" -> "${t2[key] ?? ""}"`);
      }
    }

    if (t2.subjects.length < t1.subjects.length) {
      note(`${where}: lost subjects, ${t1.subjects.length} -> ${t2.subjects.length}`);
      return;
    }

    t1.subjects.forEach((sub1, j) => {
      const sub2 = t2.subjects[j];
      if (sub1.name !== sub2.name) note(`${where} row ${j}: name "${sub1.name}" -> "${sub2.name}"`);
      if ((sub1.category ?? "") !== (sub2.category ?? "")) {
        note(`${where} row ${j} (${sub1.name}): category "${sub1.category ?? ""}" -> "${sub2.category ?? ""}"`);
      }
      for (const q of ["q1", "q2", "q3", "q4"] as const) {
        if ((sub1[q] ?? null) !== (sub2[q] ?? null)) {
          note(`${where} row ${j} (${sub1.name}): ${q} ${sub1[q] ?? "-"} -> ${sub2[q] ?? "-"}`);
        }
      }
      /*
       * `finalRating` is deliberately NOT compared.
       *
       * On JHS the final-rating cells are formulas in the blank template, so the exporter
       * cannot write them. Where the school pasted a rounded literal over the formula, a
       * reprint necessarily shows the recomputed value instead. That is a known and accepted
       * property of reprinting, not data loss on import — the stored value is kept in the
       * database and is what the app displays.
       */
    });
  });
}

const files = listImportableFiles(FOLDER);

console.log(`\nRound-tripping ${files.length} files through fill + re-read\n`);

let checked = 0;
for (const file of files) {
  let wb: Workbook;
  let form: Sf10Form;
  try {
    wb = Workbook.open(join(FOLDER, file));
    form = detectForm(wb);
  } catch {
    continue; // import:dry reports unreadable files; this script only measures data loss
  }
  if (form !== "jhs" && form !== "shs") continue; // Form 137 is archive-only, never reprinted

  const original = form === "jhs" ? parseJhsWorkbook(wb) : parseShsWorkbook(wb);
  if (original.termCount === 0) continue;

  // Fill a fresh template copy from the parsed record, then read that back.
  const filled =
    form === "jhs"
      ? fillJhs(TEMPLATES.jhs, original.record)
      : fillShs(TEMPLATES.shs, original.record);
  const bytes = filled.toBuffer();
  const reparsed =
    form === "jhs"
      ? parseJhsWorkbook(Workbook.fromBuffer(bytes))
      : parseShsWorkbook(Workbook.fromBuffer(bytes));

  const before = diffs.length;
  compare(original.record, reparsed.record, `[${form.toUpperCase()}] ${fullName(original.record.student)}`);
  checked++;

  const delta = diffs.length - before;
  console.log(
    `  ${delta === 0 ? "ok  " : "DIFF"}  ${fullName(original.record.student).padEnd(34)} ` +
      `${original.termCount} terms, ${original.subjectCount} subjects` +
      (delta ? `  (${delta} differences)` : ""),
  );
}

console.log("\n" + "-".repeat(72));
if (diffs.length === 0) {
  console.log(`  ${checked} records survived the round trip with no data loss.`);
} else {
  console.log(`  ${diffs.length} differences across ${checked} records:\n`);
  for (const d of diffs.slice(0, 40)) console.log(`   ${d}`);
  if (diffs.length > 40) console.log(`   ... and ${diffs.length - 40} more`);
}
console.log("-".repeat(72) + "\n");

process.exit(diffs.length ? 1 : 0);
