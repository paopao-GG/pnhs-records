/**
 * Takes a local backup of the hosted database.
 *
 * ## Why this exists
 *
 * While the records lived in `data/pnhs.db`, backing up was copying one file, and the registrar
 * could do it without being told. Once the database is hosted, that ability is gone — and
 * nothing replaced it automatically. A managed database is not a backup: it protects against
 * disk failure, not against a bad migration, a mistaken bulk delete, or an account lapsing.
 *
 * This writes a plain SQLite file. It opens in any SQLite tool, and pointing this project at it
 * is one environment variable, so a restore is not a procedure anyone has to remember.
 *
 *   node --env-file=.env.production.local scripts/backup.ts
 *   node --env-file=.env.production.local scripts/backup.ts --out D:/pnhs-backups
 *
 * ## What this does not do
 *
 * It does not copy the original files out of R2 — those are already a second copy of documents
 * the school holds on paper, and at ~900 MB a nightly pull is the wrong trade. It does not send
 * anything off-site either. **One copy must leave the building**, encrypted; that is a decision
 * about where, not something a script should assume.
 *
 * An untested backup is a hypothesis. Restore one and open a learner record:
 *
 *   $env:PNHS_DB_PATH = 'backups/pnhs-<date>.db'; npm run dev
 *
 * Run: npm run backup
 */

import { mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { pathToFileURL } from "node:url";
import { createDbClient, isRemote } from "../lib/db/client.ts";
import { applySchema } from "../lib/db/index.ts";

const outIndex = process.argv.indexOf("--out");
const outDir = outIndex === -1 ? "backups" : (process.argv[outIndex + 1] ?? "backups");

if (!isRemote()) {
  console.error(
    "\n  TURSO_DATABASE_URL is not set, so there is no hosted database to back up." +
      "\n  The local database is already a file you can copy.\n",
  );
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
mkdirSync(outDir, { recursive: true });
const target = join(outDir, `pnhs-${stamp}.db`);

console.log(`\n  from : ${process.env.TURSO_DATABASE_URL}`);
console.log(`  to   : ${target}\n`);

const source = createDbClient();
const backup = createClient({ url: pathToFileURL(target).href });

// Create the tables in the copy, then move the rows. Going through the schema rather than a raw
// dump means the backup is a database this app can open directly, indexes and all.
await applySchema(backup);

const tables = (
  await source.execute(
    `SELECT name FROM sqlite_master
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      ORDER BY name`,
  )
).rows.map((r) => String(r.name));

let total = 0;
for (const table of tables) {
  const rows = (await source.execute(`SELECT * FROM ${table}`)).rows;
  if (rows.length === 0) {
    console.log(`  ${table.padEnd(18)} 0`);
    continue;
  }

  const columns = Object.keys({ ...(rows[0] as unknown as object) });
  const placeholders = columns.map(() => "?").join(", ");
  const sql = `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`;

  // In chunks: one batch of two hundred thousand subject rows is a memory problem, and this has
  // to keep working as the school grows.
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    await backup.batch(
      rows.slice(i, i + CHUNK).map((row) => ({
        sql,
        args: columns.map((c) => (row as Record<string, unknown>)[c] as never),
      })),
      "write",
    );
  }

  console.log(`  ${table.padEnd(18)} ${rows.length}`);
  total += rows.length;
}

// Prove the copy is readable before claiming success.
const learners = Number((await backup.execute(`SELECT COUNT(*) n FROM students`)).rows[0].n);
const live = Number((await source.execute(`SELECT COUNT(*) n FROM students`)).rows[0].n);

backup.close();
source.close();

const size = statSync(target).size;
console.log(`\n  ${total} rows, ${(size / 1024 / 1024).toFixed(1)} MB`);
console.log(`  learners: ${live} live -> ${learners} in the backup`);

if (learners !== live) {
  console.error("\n  MISMATCH - the backup does not hold every learner. Do not rely on it.\n");
  process.exit(1);
}

console.log("\n  Backup complete. Keep one copy off-site, encrypted.\n");
