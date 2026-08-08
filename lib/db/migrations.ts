/**
 * Schema migrations.
 *
 * `db/schema.sql` is all `CREATE TABLE IF NOT EXISTS`, re-run on every boot. That is
 * idempotent and self-repairing for *new* tables, and it is why adding one needs nothing here.
 *
 * What it cannot do is change a table that already exists:
 *
 *     CREATE TABLE IF NOT EXISTS students (... , deleted_at TEXT)
 *
 * On a database where `students` already exists, that statement is skipped entirely and the
 * new column silently never appears. The failure surfaces later, as a query reading a column
 * that isn't there — long after the deploy that caused it.
 *
 * So anything that ALTERs an existing table goes in the list below.
 *
 * ## Adding one
 *
 * Append to `MIGRATIONS` with the next number. Never edit or renumber an entry that has run
 * anywhere — fix a bad migration with a new one. Each runs in its own transaction, so a
 * failure leaves `user_version` untouched and the database consistent.
 *
 * Back up before running against real data.
 */

import type { DatabaseSync } from "node:sqlite";

export interface Migration {
  version: number;
  name: string;
  up: (db: DatabaseSync) => void;
}

/** Ordered and append-only. */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "enrollment_terms.general_average",
    up: (db) => {
      /*
       * The general average as the SOURCE DOCUMENT carries it, when a record was imported.
       *
       * It cannot be recomputed reliably. Across the school's real JHS files the value was
       * produced three different ways: a live AVERAGE formula over the first eight subjects
       * (unrounded), a literal pasted after rounding each final first, and literals that match
       * neither. Recomputing disagreed with the paper record on 12 of 85 grade blocks.
       *
       * So we keep what the form says and only compute when there is nothing stored — which
       * is the case for records encoded in the app, where our own arithmetic is the authority.
       */
      addColumnIfMissing(db, "enrollment_terms", "general_average", "REAL");
    },
  },
  {
    version: 2,
    name: "form137 fields",
    up: (db) => {
      /*
       * Form 137 — the pre-K-12 Secondary Student's Permanent Record — carries data the SF10
       * schema has no home for.
       *
       * `lrn_placeholder` marks a generated identifier. These records predate the LRN system
       * entirely, so the value in `lrn` is ours, not the learner's, and the UI must never
       * present it as a real one.
       *
       * `curriculum` distinguishes First-Fourth Year from Grade 7-10. It is load-bearing:
       * availableForms() decides print buttons from grade level alone, so without it a 1995
       * record would be offered a modern SF10 print.
       */
      addColumnIfMissing(db, "students", "lrn_placeholder", "INTEGER NOT NULL DEFAULT 0");
      addColumnIfMissing(db, "students", "birthplace_province", "TEXT");
      addColumnIfMissing(db, "students", "birthplace_town", "TEXT");
      addColumnIfMissing(db, "students", "birthplace_barrio", "TEXT");
      addColumnIfMissing(db, "students", "guardian_name", "TEXT");
      addColumnIfMissing(db, "students", "guardian_occupation", "TEXT");
      addColumnIfMissing(db, "students", "guardian_address", "TEXT");

      addColumnIfMissing(db, "enrollment_terms", "curriculum", "TEXT NOT NULL DEFAULT 'k12'");

      addColumnIfMissing(db, "term_subjects", "units_earned", "REAL");
      addColumnIfMissing(db, "term_subjects", "extra_curricular", "TEXT");

      addColumnIfMissing(db, "import_files", "stored_path", "TEXT");
    },
  },
];

/**
 * Add a column if the table exists and lacks it.
 *
 * Two no-op cases, both deliberate:
 *  - the column is already there, so a half-applied state can be re-run safely;
 *  - the table does not exist yet, which means this is a brand-new database where `schema.sql`
 *    creates it with the column already included. Nothing to migrate.
 */
export function addColumnIfMissing(
  db: DatabaseSync,
  table: string,
  column: string,
  definition: string,
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[];
  if (cols.length === 0) return; // table not created yet
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function currentVersion(db: DatabaseSync): number {
  const row = db.prepare(`PRAGMA user_version`).get() as unknown as { user_version: number };
  return row.user_version;
}

export interface MigrationResult {
  from: number;
  to: number;
  applied: string[];
}

/**
 * Apply every migration newer than the database's recorded version.
 *
 * Called from getDb() after the schema pass. Running it twice is a no-op the second time.
 */
export function runMigrations(db: DatabaseSync): MigrationResult {
  const from = currentVersion(db);
  const applied: string[] = [];

  for (const migration of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
    if (migration.version <= from) continue;

    db.exec("BEGIN");
    try {
      migration.up(db);
      // PRAGMA does not accept a bound parameter, and version is a number we control.
      db.exec(`PRAGMA user_version = ${migration.version}`);
      db.exec("COMMIT");
      applied.push(`${migration.version}: ${migration.name}`);
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(
        `migration ${migration.version} (${migration.name}) failed, database left at version ` +
          `${currentVersion(db)}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { from, to: currentVersion(db), applied };
}
