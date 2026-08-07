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

import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { Workbook } from "../lib/xlsx/workbook.ts";
import { parseShsFile, parseShsWorkbook } from "../lib/sf10/import-shs.ts";
import { fillShs } from "../lib/sf10/export.ts";
import { fullName, type Sf10Record } from "../lib/sf10/types.ts";

const ROOT = resolve(import.meta.dirname, "..");
const FOLDER = resolve(process.argv[2] ?? join(ROOT, "sf10-copy"));
const TEMPLATE = join(ROOT, "templates", "SF10-SHS.xlsx");

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
    const where = `${label}: G${t1.level}S${t1.semester}`;

    for (const key of ["schoolYear", "section", "trackStrand", "schoolName", "schoolId"] as const) {
      if ((t1[key] ?? "") !== (t2[key] ?? "")) {
        note(`${where}.${key}  "${t1[key] ?? ""}" -> "${t2[key] ?? ""}"`);
      }
    }

    if (t1.subjects.length !== t2.subjects.length) {
      note(`${where}: subject count ${t1.subjects.length} -> ${t2.subjects.length}`);
      return;
    }

    t1.subjects.forEach((sub1, j) => {
      const sub2 = t2.subjects[j];
      if (sub1.name !== sub2.name) note(`${where} row ${j}: name "${sub1.name}" -> "${sub2.name}"`);
      if ((sub1.category ?? "") !== (sub2.category ?? "")) {
        note(`${where} row ${j} (${sub1.name}): category "${sub1.category ?? ""}" -> "${sub2.category ?? ""}"`);
      }
      for (const q of ["q1", "q2"] as const) {
        if ((sub1[q] ?? null) !== (sub2[q] ?? null)) {
          note(`${where} row ${j} (${sub1.name}): ${q} ${sub1[q] ?? "-"} -> ${sub2[q] ?? "-"}`);
        }
      }
    });
  });
}

const files = readdirSync(FOLDER)
  .filter((f) => f.toLowerCase().endsWith(".xlsx") && !f.startsWith("~$"))
  .sort();

console.log(`\nRound-tripping ${files.length} files through fill + re-read\n`);

let checked = 0;
for (const file of files) {
  const original = parseShsFile(join(FOLDER, file));
  if (original.termCount === 0) continue;

  // Fill a fresh template copy from the parsed record, then read that back.
  const filled = fillShs(TEMPLATE, original.record);
  const reparsed = parseShsWorkbook(Workbook.fromBuffer(filled.toBuffer()));

  const before = diffs.length;
  compare(original.record, reparsed.record, fullName(original.record.student));
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
