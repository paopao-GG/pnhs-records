/**
 * Clears the Form 137 records and imports them again.
 *
 * Needed after a parser change: files are deduped by content hash, so re-importing an
 * unchanged file is otherwise a no-op. Deleting the learners first releases their hash (see
 * the dedup rule in import-sf10.ts), which is exactly the behaviour that makes this safe.
 *
 * Only touches learners whose terms are old-curriculum, so SF10 records are untouched.
 *
 * Run: npm run reimport:f137
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "../lib/db/index.ts";
import { deleteStudent } from "../lib/db/queries.ts";
import { importBytes } from "../lib/import/import-sf10.ts";
import { listImportableFiles } from "./_local-files.ts";

const db = await getDb();
const n = async (sql: string) => Number((await db.execute(sql)).rows[0].n);

const old = await db.execute(
  `SELECT DISTINCT student_id AS id FROM enrollment_terms WHERE curriculum = 'old'`,
);

console.log(`\n  clearing ${old.rows.length} Form 137 learners`);
for (const r of old.rows) await deleteStudent(Number(r.id));

const FOLDER = "sf10-files/form137";
const tally = { imported: 0, updated: 0, duplicate: 0, failed: 0 };
for (const file of listImportableFiles(FOLDER)) {
  const result = await importBytes(readFileSync(join(FOLDER, file)), file);
  tally[result.status]++;
}
console.log(
  `  imported=${tally.imported} updated=${tally.updated} ` +
    `duplicate=${tally.duplicate} failed=${tally.failed}`,
);

console.log(`\n  students total                 : ${await n("SELECT COUNT(*) n FROM students")}`);
console.log(
  // Scoped to old-curriculum terms. Unscoped it also counts a JHS learner whose SF10 really
  // does carry a row named "Quartetrly General Average", which is not what this is checking.
  `  summary rows left as subjects  : ${await n(
    `SELECT COUNT(*) n FROM term_subjects s
       JOIN enrollment_terms t ON t.id = s.term_id
      WHERE t.curriculum = 'old'
        AND (s.subject_name LIKE '%General%Average%' OR s.subject_name LIKE '%GWA%')`,
  )}`,
);
console.log(
  `  old terms with general_average : ${await n(
    "SELECT COUNT(*) n FROM enrollment_terms WHERE curriculum='old' AND general_average IS NOT NULL",
  )} of ${await n("SELECT COUNT(*) n FROM enrollment_terms WHERE curriculum='old'")}`,
);
console.log(
  `  old terms with promotion remark: ${await n(
    "SELECT COUNT(*) n FROM enrollment_terms WHERE curriculum='old' AND promotion_remark IS NOT NULL",
  )}`,
);
console.log("");
