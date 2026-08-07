/**
 * End-to-end check of the stored-record -> SF10 path, without going through the web app.
 *
 * Picks a stored learner of each kind, builds the record, fills the template and writes it to
 * spike-output/ so the result can be opened in Excel. Needs at least one record in the
 * database - add one via the app, or import.
 *
 * Run: npm run check
 */

import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { getDb } from "../lib/db/index.ts";
import { buildSf10Record } from "../lib/db/to-sf10-record.ts";
import { fillJhs, fillShs } from "../lib/sf10/export.ts";
import { fullName } from "../lib/sf10/types.ts";

const ROOT = join(import.meta.dirname, "..");
const OUT = join(ROOT, "spike-output");

function firstStudentWith(predicate: string): { id: number; label: string } | null {
  const row = getDb()
    .prepare(
      `SELECT s.id, s.last_name, s.first_name
         FROM students s
        WHERE EXISTS (SELECT 1 FROM enrollment_terms t
                       WHERE t.student_id = s.id AND ${predicate})
        ORDER BY s.id LIMIT 1`,
    )
    .get() as { id: number; last_name: string; first_name: string } | undefined;
  return row ? { id: row.id, label: `${row.last_name}, ${row.first_name}` } : null;
}

function run(form: "jhs" | "shs", predicate: string): boolean {
  const found = firstStudentWith(predicate);
  if (!found) {
    console.log(`  ${form.toUpperCase()}: no learner in the database has ${form.toUpperCase()} terms`);
    return false;
  }

  const record = buildSf10Record(found.id, form);
  if (!record) {
    console.log(`  ${form.toUpperCase()}: buildSf10Record returned null`);
    return false;
  }

  const template = join(ROOT, "templates", form === "jhs" ? "SF10-JHS.xlsx" : "SF10-SHS.xlsx");
  const wb = form === "jhs" ? fillJhs(template, record) : fillShs(template, record);
  const outPath = join(OUT, `from-db-${form}.xlsx`);
  wb.save(outPath);

  const subjectCount = record.terms.reduce((n, t) => n + t.subjects.length, 0);
  console.log(
    `  ${form.toUpperCase()}: ${fullName(record.student)} (LRN ${record.student.lrn}) - ` +
      `${record.terms.length} terms, ${subjectCount} subjects -> ${outPath.replace(ROOT + "\\", "")}`,
  );
  return true;
}

mkdirSync(OUT, { recursive: true });
console.log("\nBuilding SF10 files straight from the database\n");
const ok = [run("jhs", "t.level <= 10"), run("shs", "t.level >= 11")].every(Boolean);
console.log(ok ? "\nBoth forms generated from stored records.\n" : "\nFAILED\n");
process.exit(ok ? 0 : 1);
