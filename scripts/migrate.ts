/**
 * Applies the schema and any pending migrations, then reports what happened.
 *
 * This is the deliberate setup step. The app used to do it on every boot, which was free when
 * the database was a local file owned by one long-lived process. It is not free against a
 * hosted database reached over the network from a host that cold-starts.
 *
 * Runs against whatever `TURSO_DATABASE_URL` points at, or the local file when it is unset -
 * so this is also the command that migrates production.
 *
 *   npm run db:migrate
 *
 * **Back up first when running against real data.** A migration that fails leaves the version
 * untouched, but that is a guarantee about consistency, not about the data being recoverable.
 *
 * Run: npm run db:migrate
 */

import { applySchema } from "../lib/db/index.ts";
import { createDbClient, isRemote, LOCAL_DB_PATH } from "../lib/db/client.ts";

const target = isRemote() ? process.env.TURSO_DATABASE_URL : LOCAL_DB_PATH;
console.log(`\n  database : ${target}`);

const db = createDbClient();
const result = await applySchema(db);

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
