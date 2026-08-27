/**
 * Applies the schema and any pending migrations, then reports what happened.
 *
 * The app applies the schema itself on first use, so this is not something an installed copy
 * ever needs - it exists for the repository, where it is useful to migrate a database without
 * starting a server, and to see what a migration actually did before trusting it with real
 * records.
 *
 * It targets the real local database, so it asks for a pre-upgrade snapshot the same way the
 * app does. A migration that fails already leaves the version untouched, but that is a
 * guarantee about consistency, not about the data being recoverable from a migration that
 * succeeded and was wrong.
 *
 * Run: npm run db:migrate
 */

import { join } from "node:path";
import { applySchema } from "../lib/db/index.ts";
import { createDbClient, LOCAL_DB_PATH } from "../lib/db/client.ts";
import { dataDir } from "../lib/paths.ts";

console.log(`\n  database : ${LOCAL_DB_PATH}`);

const db = createDbClient();
const result = await applySchema(db, { snapshotDir: join(dataDir(), "backups") });

console.log(`  version  : ${result.from} -> ${result.to}`);
if (result.applied.length === 0) {
  console.log("  applied  : nothing, already up to date");
} else {
  for (const name of result.applied) console.log(`  applied  : ${name}`);
}

const counts = await db.execute(
  `SELECT (SELECT COUNT(*) FROM students)         AS students,
          (SELECT COUNT(*) FROM enrollment_terms) AS terms,
          (SELECT COUNT(*) FROM term_subjects)    AS subjects`,
);
const { students, terms, subjects } = counts.rows[0];
console.log(`  contents : ${students} learners, ${terms} terms, ${subjects} subjects\n`);

db.close();
