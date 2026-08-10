/**
 * Bulk-loads a folder of SF10 and Form 137 files into the deployed system.
 *
 * The browser import is the right tool for a handful of files. It is the wrong tool for the
 * school's archive: a thousand files is a thousand presigned uploads and two hundred batches,
 * and any interruption means working out where it stopped. This runs the same importer directly
 * against the hosted database and bucket, from a machine that already has the files.
 *
 * It writes through **exactly the same code path** as the app — `importBytes()`, the same
 * parsers, the same dedup rule, the same R2 store. There is no second implementation to drift.
 *
 *   node --env-file=.env.production.local scripts/push-to-turso.ts sf10-files
 *   node --env-file=.env.production.local scripts/push-to-turso.ts sf10-files --dry-run
 *
 * Put the *production* Turso and R2 settings in that env file. Being explicit matters here:
 * the difference between loading the school's archive and overwriting it is which database this
 * points at, so it prints the target and refuses to guess.
 *
 * Safe to re-run. A file already imported is reported as a duplicate and skipped, so an
 * interrupted run is resumed by starting it again.
 *
 * Run: npm run push:archive -- <folder>
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { importBytes } from "../lib/import/import-sf10.ts";
import { listImportableFiles, folderExists } from "./_local-files.ts";
import { isRemote } from "../lib/db/client.ts";
import { isRemoteStore } from "../lib/blob/store.ts";
import { getDb } from "../lib/db/index.ts";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const dryRun = process.argv.includes("--dry-run");
const folder = args[0] ?? "sf10-files";

if (!folderExists(folder)) {
  console.error(`\n  No folder at ${folder}\n`);
  process.exit(1);
}

console.log(`\n  folder   : ${folder}`);
console.log(`  database : ${isRemote() ? process.env.TURSO_DATABASE_URL : "LOCAL data/pnhs.db"}`);
console.log(`  files    : ${isRemoteStore() ? `R2 (${process.env.R2_BUCKET})` : "LOCAL data/originals"}`);

if (!isRemote() || !isRemoteStore()) {
  // Loading the archive into the local database by accident is recoverable; discovering weeks
  // later that production was never loaded is not. Make the operator say so.
  console.log(
    "\n  This is not pointed at the hosted database and bucket." +
      "\n  If that is deliberate, re-run with --local. Otherwise use:" +
      "\n    node --env-file=.env.production.local scripts/push-to-turso.ts " +
      folder +
      "\n",
  );
  if (!process.argv.includes("--local")) process.exit(1);
}

const files = listImportableFiles(folder);
console.log(`\n  ${files.length} importable files${dryRun ? "  (dry run)" : ""}\n`);

if (dryRun) {
  for (const f of files.slice(0, 10)) console.log(`    ${f}`);
  if (files.length > 10) console.log(`    ... and ${files.length - 10} more`);
  console.log("");
  process.exit(0);
}

const tally = { imported: 0, updated: 0, duplicate: 0, failed: 0 };
const failures: string[] = [];
const started = Date.now();

for (const [i, file] of files.entries()) {
  let result;
  try {
    result = await importBytes(readFileSync(join(folder, file)), file);
  } catch (err) {
    tally.failed++;
    failures.push(`${file}: ${err instanceof Error ? err.message : String(err)}`);
    continue;
  }

  tally[result.status]++;
  if (result.status === "failed") failures.push(`${file}: ${result.error ?? "unknown"}`);

  // Progress on one line: a thousand files over a network takes a while, and a silent terminal
  // is indistinguishable from a hung one.
  const done = i + 1;
  const rate = done / ((Date.now() - started) / 1000);
  const remaining = Math.round((files.length - done) / Math.max(rate, 0.01));
  process.stdout.write(
    `\r  ${String(done).padStart(5)}/${files.length}  ` +
      `imported ${tally.imported}  updated ${tally.updated}  ` +
      `duplicate ${tally.duplicate}  failed ${tally.failed}  ` +
      `~${remaining}s left   `,
  );
}

process.stdout.write("\n");

console.log(`\n  imported  : ${tally.imported}`);
console.log(`  updated   : ${tally.updated}`);
console.log(`  duplicate : ${tally.duplicate}`);
console.log(`  failed    : ${tally.failed}`);

if (failures.length) {
  console.log("\n  failures:");
  for (const f of failures.slice(0, 25)) console.log(`    ${f}`);
  if (failures.length > 25) console.log(`    ... and ${failures.length - 25} more`);
}

const db = await getDb();
const count = async (sql: string) => Number((await db.execute(sql)).rows[0].n);
console.log(`\n  learners in the database : ${await count("SELECT COUNT(*) n FROM students")}`);
console.log(`  originals stored         : ${await count(
  "SELECT COUNT(*) n FROM import_files WHERE stored_path IS NOT NULL",
)}`);
console.log(`  needing review           : ${await count(
  "SELECT COUNT(*) n FROM import_issues WHERE resolved = 0",
)}\n`);

process.exit(failures.length ? 1 : 0);
