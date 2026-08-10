/**
 * Compares the app's general average against the one the school's own forms carry.
 *
 * This exists because the two disagreed on 37 of 85 real JHS grade blocks: the template
 * averages only the first eight subject rows (Filipino..MAPEH), using unrounded finals, while
 * the app averaged every row after rounding each one. Differences were one to two marks on the
 * figure that decides promotion and honours.
 *
 * The form's own cached value is the authority here. Any disagreement is a bug in
 * lib/grading.ts, not in the file.
 *
 * Run: npm run check:ga [folder]
 */

import { resolve, join } from "node:path";
import { Workbook } from "../lib/xlsx/workbook.ts";
import { getCell } from "../lib/xlsx/cells.ts";
import { detectForm } from "../lib/sf10/detect-form.ts";
import { listImportableFiles } from "./_local-files.ts";
import { parseJhsWorkbook } from "../lib/sf10/import-jhs.ts";
import { parseShsWorkbook } from "../lib/sf10/import-shs.ts";
import { JHS_BLOCKS, JHS_GENERAL_COL, JHS_OFFSET } from "../lib/sf10/jhs-map.ts";
import { exactFinalRating, generalAverage } from "../lib/grading.ts";
import { fullName } from "../lib/sf10/types.ts";

const folder = resolve(process.argv[2] ?? "sf10-files");

/** Excel's display rounding for number format "0". */
const show = (n: number) => Math.sign(n) * Math.round(Math.abs(n));

let compared = 0;
let agree = 0;
const mismatches: string[] = [];

for (const rel of listImportableFiles(folder)) {
  const path = join(folder, rel);
  let wb: Workbook;
  try {
    wb = Workbook.open(path);
    if (detectForm(wb) !== "jhs") continue;
  } catch {
    continue; // not a form we can read; import:dry reports those
  }

  const parsed = parseJhsWorkbook(wb);
  const shared = wb.sharedStrings();
  const sheets = { Front: wb.sheetXml("Front"), Back: wb.sheetXml("Back") };

  for (const block of JHS_BLOCKS) {
    const term = parsed.record.terms.find((t) => t.level === block.level);
    if (!term) continue;

    // What the form itself holds, from its own AVERAGE formula.
    const cell = `${JHS_GENERAL_COL.value}${block.headerRow + JHS_OFFSET.generalAverage}`;
    const raw = getCell(sheets[block.sheet], cell, shared);
    if (typeof raw !== "number") continue; // #DIV/0! on an unused block

    // What the app shows: the form's own value when it carried one, else our computation.
    const mine =
      term.generalAverage != null
        ? show(term.generalAverage)
        : generalAverage(
            term.subjects.map((s) =>
              s.finalRating != null
                ? s.finalRating
                : exactFinalRating({ q1: s.q1, q2: s.q2, q3: s.q3, q4: s.q4 }, "jhs"),
            ),
            "jhs",
          );

    compared++;
    if (mine === show(raw)) agree++;
    else {
      mismatches.push(
        `   ${fullName(parsed.record.student).padEnd(34).slice(0, 34)} G${block.level}  ` +
          `form=${show(raw)} (${raw})  app=${mine}`,
      );
    }
  }
}

console.log(`\nJHS general average vs the school's own forms\n`);
console.log(`  blocks compared : ${compared}`);
console.log(`  agree           : ${agree}`);
console.log(`  DISAGREE        : ${mismatches.length}`);
if (mismatches.length) {
  console.log("");
  for (const m of mismatches.slice(0, 20)) console.log(m);
  if (mismatches.length > 20) console.log(`   ... and ${mismatches.length - 20} more`);
}
console.log("");

process.exit(mismatches.length ? 1 : 0);
