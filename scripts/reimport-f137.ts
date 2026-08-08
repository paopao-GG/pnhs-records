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

import { getDb } from "../lib/db/index.ts";
import { deleteStudent } from "../lib/db/queries.ts";
import { importFolder } from "../lib/import/import-sf10.ts";

const db = getDb();
const n = (sql: string) => (db.prepare(sql).get() as { n: number }).n;

const old = db
  .prepare(`SELECT DISTINCT student_id AS id FROM enrollment_terms WHERE curriculum = 'old'`)
  .all() as { id: number }[];

console.log(`\n  clearing ${old.length} Form 137 learners`);
for (const r of old) deleteStudent(r.id);

const summary = importFolder("sf10-files/form137");
console.log(
  `  imported=${summary.imported} updated=${summary.updated} ` +
    `duplicate=${summary.duplicates} failed=${summary.failed}`,
);

console.log(`\n  students total                 : ${n("SELECT COUNT(*) n FROM students")}`);
console.log(
  `  summary rows left as subjects  : ${n(
    "SELECT COUNT(*) n FROM term_subjects WHERE subject_name LIKE '%General%Average%' OR subject_name LIKE '%GWA%'",
  )}`,
);
console.log(
  `  old terms with general_average : ${n(
    "SELECT COUNT(*) n FROM enrollment_terms WHERE curriculum='old' AND general_average IS NOT NULL",
  )} of ${n("SELECT COUNT(*) n FROM enrollment_terms WHERE curriculum='old'")}`,
);
console.log(
  `  old terms with promotion remark: ${n(
    "SELECT COUNT(*) n FROM enrollment_terms WHERE curriculum='old' AND promotion_remark IS NOT NULL",
  )}`,
);
console.log("");
