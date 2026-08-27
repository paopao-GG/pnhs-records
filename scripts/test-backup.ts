/**
 * The backup, which is now the only copy of the records that will ever exist off this disk.
 *
 * The hosted deployment had a provider replicating the database behind it. It does not any
 * more: one machine holds thousands of children's permanent records, and this is the whole
 * mitigation. A backup path that silently produces an unopenable file would not be discovered
 * until the day it was needed, which is the worst possible day to discover it.
 *
 * So this asserts the thing that actually matters — **the backup opens, and the learner is in
 * it** — rather than that a file of some size appeared.
 *
 * Runs against a scratch data directory, not the school's.
 *
 * Run: npm run test:backup
 */

import { strict as assert } from "node:assert";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/*
 * Point the shared connection at a scratch file BEFORE importing anything that touches it.
 * `client.ts` resolves the path once, at module load; the dynamic imports below are what make
 * that ordering guaranteed rather than incidental. See test-unlock.ts for the same guard.
 */
const dataDir = mkdtempSync(join(tmpdir(), "pnhs-backup-data-"));
const destDir = mkdtempSync(join(tmpdir(), "pnhs-backup-dest-"));
process.env.PNHS_DATA_DIR = dataDir;
process.env.PNHS_DB_PATH = join(dataDir, "pnhs.db");

const { applySchema } = await import("../lib/db/index.ts");
const { createDbClient, getClient, LOCAL_DB_PATH } = await import("../lib/db/client.ts");
const q = await import("../lib/db/queries.ts");
const { backupTo, defaultBackupRoot } = await import("../lib/backup.ts");

if (!LOCAL_DB_PATH.startsWith(dataDir)) {
  console.error(`\n  refusing to run: the database is ${LOCAL_DB_PATH}, not a scratch file\n`);
  process.exit(1);
}

const db = getClient();
await applySchema(db);

let passed = 0;
const checks: { name: string; fn: () => Promise<void> }[] = [];
const check = (name: string, fn: () => Promise<void>) => checks.push({ name, fn });

/** One learner and one archived original, which is the minimum that proves both halves. */
async function seed(): Promise<void> {
  await q.createStudent({
    lrn: "123456789012",
    last_name: "BACKUPCHECK",
    first_name: "Fixture",
    middle_name: null,
    name_ext: null,
    sex: "F",
    birthdate: "2010-01-01",
  });

  mkdirSync(join(dataDir, "originals"), { recursive: true });
  writeFileSync(join(dataDir, "originals", `${"a".repeat(64)}.docx`), "pretend Form 137");
}

check("the backup opens, and the learner is in it", async () => {
  const result = await backupTo(destDir);
  assert.ok(existsSync(join(result.folder, "pnhs.db")), "no database in the backup folder");

  /*
   * The assertion the whole file exists for. `VACUUM INTO` writes a consistent snapshot through
   * the open connection; a plain file copy can catch SQLite mid-write and produce bytes that
   * are not a database. Opening it is the only way to tell the difference.
   */
  const restored = createDbClient(join(result.folder, "pnhs.db"));
  const rows = await restored.execute(`SELECT last_name FROM students`);
  assert.equal(rows.rows.length, 1, "the learner is not in the backup");
  assert.equal(String(rows.rows[0].last_name), "BACKUPCHECK");
  restored.close();
});

check("the archived originals come with it", async () => {
  // For a Form 137 the stored original IS the reissuable record - a backup of the database
  // alone would lose the only copy of every pre-K-12 learner's document.
  //
  // This is also the second backup of the run, which is the point: VACUUM INTO refuses to
  // overwrite, so a second backup landing in the same folder fails with SQLITE_ERROR. It did.
  const result = await backupTo(destDir);
  assert.equal(result.originals, 1, `reported ${result.originals} originals`);
  const copied = readdirSync(join(result.folder, "originals"));
  assert.equal(copied.length, 1, "originals/ was not copied");
});

check("a destination inside the data directory is refused", async () => {
  /*
   * A copy on the same disk as the original protects against a mistaken deletion and nothing
   * else - not the drive failing, not the machine being stolen, not the office flooding. A
   * backup that looks like protection without being it is worse than none, because it stops
   * anyone looking for a real one.
   */
  await assert.rejects(() => backupTo(join(dataDir, "not-really-a-backup")));
});

check("the default staging folder is allowed", async () => {
  // The one exception, and it is deliberate: somewhere to write before copying to a drive.
  const result = await backupTo(defaultBackupRoot());
  assert.ok(existsSync(join(result.folder, "pnhs.db")));
});

await seed();

for (const { name, fn } of checks) {
  try {
    await fn();
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}

db.close();
for (const dir of [dataDir, destDir]) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    /* Windows may still hold a file; the OS will clear it */
  }
}

console.log(process.exitCode ? "\nbackup: FAILURES above\n" : `\nbackup: ${passed} checks passed\n`);
