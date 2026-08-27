/**
 * Proves the migration runner behaves, against a throwaway in-memory database.
 *
 * The properties that matter: each migration runs exactly once, a failure rolls back and does
 * not advance the version, and a column added to an already-populated table keeps its rows.
 * That last one is the whole reason this mechanism exists.
 *
 * Runs against the same libSQL driver production uses. The rollback checks in particular are
 * only worth anything if they exercise the real transaction implementation.
 *
 * Run: npm run test:migrations
 */

import { strict as assert } from "node:assert";
import { createClient, type Client } from "@libsql/client";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  addColumnIfMissing,
  currentVersion,
  runMigrations,
  setVersion,
  type Migration,
} from "../lib/db/migrations.ts";

let passed = 0;
const checks: { name: string; fn: () => Promise<void> }[] = [];
const check = (name: string, fn: () => Promise<void>) => checks.push({ name, fn });

/*
 * A scratch file rather than `:memory:`.
 *
 * The local driver pools connections, and an in-memory database is private to the connection
 * that opened it - so `db.transaction()` runs against a *different*, empty database and every
 * migration test fails with "no such table". These tests exist to exercise real transactions,
 * so they need a real file.
 */
const scratchDir = mkdtempSync(join(tmpdir(), "pnhs-migrations-"));

/*
 * Keep everything this file touches inside that scratch directory.
 *
 * These tests call the real `runMigrations`, which can now write a pre-upgrade snapshot. The
 * destination is a parameter precisely so a throwaway database cannot file backups in the
 * school's records folder - but `dataDir()` still resolves to the repository's ./data when
 * nothing is set, and a check below deliberately asks for a snapshot. Setting this makes the
 * isolation belong to the test rather than to the argument being passed correctly.
 */
process.env.PNHS_DATA_DIR = scratchDir;

let scratchCount = 0;
const scratch = (): Client =>
  createClient({ url: pathToFileURL(join(scratchDir, `t${scratchCount++}.db`)).href });

/** Stands in for the real list so these tests never depend on production migrations. */
async function withMigrations(db: Client, list: Migration[]) {
  const sorted = [...list].sort((a, b) => a.version - b.version);
  const from = await currentVersion(db);
  const applied: string[] = [];
  for (const m of sorted) {
    if (m.version <= (await currentVersion(db))) continue;
    const tx = await db.transaction("write");
    try {
      await m.up(tx);
      await setVersion(tx, m.version);
      await tx.commit();
      applied.push(m.name);
    } catch (err) {
      await tx.rollback().catch(() => {});
      throw err;
    }
  }
  return { from, to: await currentVersion(db), applied };
}

check("a fresh database starts at version 0", async () => {
  const db = scratch();
  assert.equal(await currentVersion(db), 0);
  db.close();
});

check("the real migration list is safe to run twice", async () => {
  const db = scratch();
  const first = await runMigrations(db);
  const second = await runMigrations(db);
  assert.equal(second.applied.length, 0, "second run should apply nothing");
  assert.equal(second.from, first.to);
  db.close();
});

check("each migration runs exactly once", async () => {
  const db = scratch();
  let runs = 0;
  const list: Migration[] = [
    { version: 1, name: "one", up: async () => { runs++; } },
    { version: 2, name: "two", up: async () => { runs++; } },
  ];

  await withMigrations(db, list);
  assert.equal(runs, 2);
  assert.equal(await currentVersion(db), 2);

  await withMigrations(db, list);
  assert.equal(runs, 2, "re-running must not apply them again");
  db.close();
});

check("a new migration appended later applies on its own", async () => {
  const db = scratch();
  const list: Migration[] = [{ version: 1, name: "one", up: async () => {} }];
  await withMigrations(db, list);
  assert.equal(await currentVersion(db), 1);

  let ranTwo = false;
  list.push({ version: 2, name: "two", up: async () => { ranTwo = true; } });
  await withMigrations(db, list);
  assert.equal(ranTwo, true);
  assert.equal(await currentVersion(db), 2);
  db.close();
});

check("a failing migration rolls back and does not advance the version", async () => {
  const db = scratch();
  await db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)");

  const list: Migration[] = [
    {
      version: 1,
      name: "half-broken",
      up: async (d) => {
        await d.execute("INSERT INTO t (id) VALUES (1)");
        throw new Error("boom");
      },
    },
  ];

  await assert.rejects(() => withMigrations(db, list), /boom/);
  assert.equal(await currentVersion(db), 0, "version must stay put");
  const result = await db.execute("SELECT COUNT(*) AS n FROM t");
  assert.equal(Number(result.rows[0].n), 0, "the partial write must be rolled back");
  db.close();
});

// --------------------------------------------------- the pre-upgrade snapshot

/*
 * These four are about the promise made to the registrar: updating the app cannot lose the
 * records, even when nobody thought to back them up first.
 *
 * A migration that *fails* was already safe - it rolls back and leaves the version untouched,
 * which the check above proves. The snapshot exists for the migration that succeeds and is
 * wrong, which no rollback catches and no test here can rule out.
 */

/** A database that looks like one already in service: migrated before, and holding a learner. */
async function populated(version: number): Promise<Client> {
  const db = scratch();
  await db.execute("CREATE TABLE students (id INTEGER PRIMARY KEY, lrn TEXT)");
  await db.execute({ sql: "INSERT INTO students (lrn) VALUES (?)", args: ["111798090005"] });
  // currentVersion() is what creates schema_version; setVersion() assumes it is already there.
  await currentVersion(db);
  await setVersion(db, version);
  return db;
}

/** The snapshot folders `runMigrations` has written under `dir`, newest name last. */
function snapshots(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.startsWith("pre-upgrade-"))
    .sort();
}

check("an existing database is copied aside before it is migrated", async () => {
  const dir = join(scratchDir, "snap-taken");
  const db = await populated(1);

  await runMigrations(db, dir);

  const written = snapshots(dir);
  assert.equal(written.length, 1, `expected one snapshot, saw ${written.length}`);
  // The name has to say what it is a snapshot of, or a folder of them is unreadable.
  assert.match(written[0], /^pre-upgrade-v1-to-v\d+-/);
  db.close();
});

check("the snapshot opens, and the learner is in it", async () => {
  /*
   * The assertion the whole feature rests on. A snapshot that cannot be opened is not a backup,
   * and `VACUUM INTO` failing halfway would leave a file of plausible size behind.
   */
  const dir = join(scratchDir, "snap-readable");
  const db = await populated(1);

  await runMigrations(db, dir);

  const file = join(dir, snapshots(dir)[0], "pnhs.db");
  const restored = createClient({ url: pathToFileURL(file).href });
  const rows = await restored.execute("SELECT lrn FROM students");
  assert.equal(rows.rows.length, 1, "the learner is not in the snapshot");
  assert.equal(rows.rows[0].lrn, "111798090005");
  restored.close();
  db.close();
});

check("a fresh database is not snapshotted, and neither is an up-to-date one", async () => {
  // Version 0 with everything pending is a new install: an empty file is not worth copying.
  const fresh = join(scratchDir, "snap-fresh");
  const db = scratch();
  await runMigrations(db, fresh);
  assert.equal(snapshots(fresh).length, 0, "a new database should not be snapshotted");

  // And an ordinary launch with no pending work must not copy the database every time.
  const again = join(scratchDir, "snap-again");
  await runMigrations(db, again);
  assert.equal(snapshots(again).length, 0, "no pending migrations should mean no snapshot");
  db.close();
});

check("a migration does not run when the database could not be copied", async () => {
  /*
   * The check that decides whether this is a backup feature or the appearance of one. If the
   * snapshot fails and the migration proceeds anyway, every other check here is decoration.
   *
   * The destination is made unwritable by putting a *file* where the folder needs to go, which
   * fails the same way a full or read-only disk does and needs no special permissions to set up.
   */
  const blocker = join(scratchDir, "snap-blocked");
  writeFileSync(blocker, "not a directory");

  const db = await populated(1);
  const before = await currentVersion(db);

  await assert.rejects(
    () => runMigrations(db, blocker),
    /Could not back the database up/,
    "it must refuse rather than migrate unbacked-up data",
  );
  assert.equal(await currentVersion(db), before, "the version must not have advanced");
  db.close();
});

check("adding a column preserves existing rows — the reason this exists", async () => {
  const db = scratch();
  await db.execute("CREATE TABLE students (id INTEGER PRIMARY KEY, lrn TEXT)");
  await db.execute({ sql: "INSERT INTO students (lrn) VALUES (?)", args: ["111798090005"] });

  await withMigrations(db, [
    {
      version: 1,
      name: "add deleted_at",
      up: (d) => addColumnIfMissing(d, "students", "deleted_at", "TEXT"),
    },
  ]);

  const result = await db.execute("SELECT lrn, deleted_at FROM students");
  assert.equal(result.rows[0].lrn, "111798090005");
  assert.equal(result.rows[0].deleted_at, null);
  db.close();
});

check("the period columns arrive and leave existing rows meaning what they meant", async () => {
  /*
   * Migration 3 against a database that predates it.
   *
   * The assertion that matters is the NULL: every term already in the school's database was
   * graded over four quarters, and nothing backfills them. If `grading_periods` came in with a
   * default of 3 instead, every record encoded before the change would silently lose its fourth
   * quarter from the printed form.
   */
  const db = scratch();
  await db.execute(
    "CREATE TABLE enrollment_terms (id INTEGER PRIMARY KEY, level INTEGER, curriculum TEXT)",
  );
  await db.execute("CREATE TABLE students (id INTEGER PRIMARY KEY, lrn TEXT)");
  await db.execute("INSERT INTO enrollment_terms (level, curriculum) VALUES (7, 'k12')");
  await db.execute({ sql: "INSERT INTO students (lrn) VALUES (?)", args: ["111798090005"] });

  await withMigrations(db, [
    {
      version: 1,
      name: "three grading periods",
      up: async (d) => {
        await addColumnIfMissing(d, "enrollment_terms", "grading_periods", "INTEGER");
        await addColumnIfMissing(d, "students", "shs_semesters", "INTEGER");
      },
    },
  ]);

  const term = await db.execute("SELECT level, grading_periods FROM enrollment_terms");
  assert.equal(Number(term.rows[0].level), 7, "the existing term survives");
  assert.equal(term.rows[0].grading_periods, null, "and is left on the historical default");

  const student = await db.execute("SELECT lrn, shs_semesters FROM students");
  assert.equal(student.rows[0].lrn, "111798090005");
  assert.equal(student.rows[0].shs_semesters, null);
  db.close();
});

check("addColumnIfMissing skips a table that does not exist yet", async () => {
  // A brand-new database gets the column from schema.sql, so there is nothing to migrate.
  const db = scratch();
  await addColumnIfMissing(db, "not_created_yet", "whatever", "TEXT"); // must not throw
  db.close();
});

check("addColumnIfMissing is idempotent", async () => {
  const db = scratch();
  await db.execute("CREATE TABLE t (id INTEGER PRIMARY KEY)");
  await addColumnIfMissing(db, "t", "extra", "TEXT");
  await addColumnIfMissing(db, "t", "extra", "TEXT"); // must not throw
  const cols = await db.execute("PRAGMA table_info(t)");
  assert.equal(cols.rows.filter((c) => c.name === "extra").length, 1);
  db.close();
});

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

// Windows holds a handle on a just-closed database file for a moment, so this can fail with
// EPERM. A leftover file in the temp folder must not turn a passing suite red.
try {
  rmSync(scratchDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
} catch {
  /* the OS will clear it */
}

console.log(
  process.exitCode ? "\nmigrations: FAILURES above\n" : `\nmigrations: ${passed} checks passed\n`,
);
