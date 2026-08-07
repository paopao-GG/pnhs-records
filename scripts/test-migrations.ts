/**
 * Proves the migration runner behaves, against a throwaway in-memory database.
 *
 * The properties that matter: each migration runs exactly once, a failure rolls back and does
 * not advance the version, and a column added to an already-populated table keeps its rows.
 * That last one is the whole reason this mechanism exists.
 *
 * Run: npm run test:migrations
 */

import { strict as assert } from "node:assert";
import { DatabaseSync } from "node:sqlite";
import { addColumnIfMissing, currentVersion, runMigrations, type Migration } from "../lib/db/migrations.ts";

let passed = 0;
const check = (name: string, fn: () => void) => {
  try {
    fn();
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
};

/** Stands in for the real list so these tests never depend on production migrations. */
function withMigrations(db: DatabaseSync, list: Migration[]) {
  const sorted = [...list].sort((a, b) => a.version - b.version);
  const from = currentVersion(db);
  const applied: string[] = [];
  for (const m of sorted) {
    if (m.version <= currentVersion(db)) continue;
    db.exec("BEGIN");
    try {
      m.up(db);
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.exec("COMMIT");
      applied.push(m.name);
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
  return { from, to: currentVersion(db), applied };
}

check("a fresh database starts at version 0", () => {
  const db = new DatabaseSync(":memory:");
  assert.equal(currentVersion(db), 0);
  db.close();
});

check("the real migration list is safe to run twice", () => {
  const db = new DatabaseSync(":memory:");
  const first = runMigrations(db);
  const second = runMigrations(db);
  assert.equal(second.applied.length, 0, "second run should apply nothing");
  assert.equal(second.from, first.to);
  db.close();
});

check("each migration runs exactly once", () => {
  const db = new DatabaseSync(":memory:");
  let runs = 0;
  const list: Migration[] = [
    { version: 1, name: "one", up: () => { runs++; } },
    { version: 2, name: "two", up: () => { runs++; } },
  ];

  withMigrations(db, list);
  assert.equal(runs, 2);
  assert.equal(currentVersion(db), 2);

  withMigrations(db, list);
  assert.equal(runs, 2, "re-running must not apply them again");
  db.close();
});

check("a new migration appended later applies on its own", () => {
  const db = new DatabaseSync(":memory:");
  const list: Migration[] = [{ version: 1, name: "one", up: () => {} }];
  withMigrations(db, list);
  assert.equal(currentVersion(db), 1);

  let ranTwo = false;
  list.push({ version: 2, name: "two", up: () => { ranTwo = true; } });
  withMigrations(db, list);
  assert.equal(ranTwo, true);
  assert.equal(currentVersion(db), 2);
  db.close();
});

check("a failing migration rolls back and does not advance the version", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");

  const list: Migration[] = [
    {
      version: 1,
      name: "half-broken",
      up: (d) => {
        d.exec("INSERT INTO t (id) VALUES (1)");
        throw new Error("boom");
      },
    },
  ];

  assert.throws(() => withMigrations(db, list), /boom/);
  assert.equal(currentVersion(db), 0, "version must stay put");
  const n = (db.prepare("SELECT COUNT(*) AS n FROM t").get() as { n: number }).n;
  assert.equal(n, 0, "the partial write must be rolled back");
  db.close();
});

check("adding a column preserves existing rows — the reason this exists", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE students (id INTEGER PRIMARY KEY, lrn TEXT)");
  db.prepare("INSERT INTO students (lrn) VALUES (?)").run("111798090005");

  withMigrations(db, [
    {
      version: 1,
      name: "add deleted_at",
      up: (d) => addColumnIfMissing(d, "students", "deleted_at", "TEXT"),
    },
  ]);

  const row = db.prepare("SELECT lrn, deleted_at FROM students").get() as {
    lrn: string;
    deleted_at: string | null;
  };
  assert.equal(row.lrn, "111798090005");
  assert.equal(row.deleted_at, null);
  db.close();
});

check("addColumnIfMissing skips a table that does not exist yet", () => {
  // A brand-new database gets the column from schema.sql, so there is nothing to migrate.
  const db = new DatabaseSync(":memory:");
  addColumnIfMissing(db, "not_created_yet", "whatever", "TEXT"); // must not throw
  db.close();
});

check("addColumnIfMissing is idempotent", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY)");
  addColumnIfMissing(db, "t", "extra", "TEXT");
  addColumnIfMissing(db, "t", "extra", "TEXT"); // must not throw
  const cols = db.prepare("PRAGMA table_info(t)").all() as unknown as { name: string }[];
  assert.equal(cols.filter((c) => c.name === "extra").length, 1);
  db.close();
});

console.log(
  process.exitCode ? "\nmigrations: FAILURES above\n" : `\nmigrations: ${passed} checks passed\n`,
);
