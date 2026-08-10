/**
 * Schema migrations.
 *
 * `db/schema.sql` is all `CREATE TABLE IF NOT EXISTS`, applied on setup. That is idempotent and
 * self-repairing for *new* tables, and it is why adding one needs nothing here.
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
 * failure leaves `user_version` untouched and the database consistent. That holds against the
 * hosted database too: `ALTER TABLE` and `PRAGMA user_version` both roll back inside a libSQL
 * transaction.
 *
 * Back up before running against real data.
 */

import type { Client, Transaction } from "@libsql/client";

/** Either a plain connection or an open transaction - migrations run inside one. */
type Runner = Pick<Client | Transaction, "execute">;

export interface Migration {
  version: number;
  name: string;
  up: (db: Runner) => Promise<void>;
}

/** Ordered and append-only. */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "enrollment_terms.general_average",
    up: async (db) => {
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
      await addColumnIfMissing(db, "enrollment_terms", "general_average", "REAL");
    },
  },
  {
    version: 2,
    name: "form137 fields",
    up: async (db) => {
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
      await addColumnIfMissing(db, "students", "lrn_placeholder", "INTEGER NOT NULL DEFAULT 0");
      await addColumnIfMissing(db, "students", "birthplace_province", "TEXT");
      await addColumnIfMissing(db, "students", "birthplace_town", "TEXT");
      await addColumnIfMissing(db, "students", "birthplace_barrio", "TEXT");
      await addColumnIfMissing(db, "students", "guardian_name", "TEXT");
      await addColumnIfMissing(db, "students", "guardian_occupation", "TEXT");
      await addColumnIfMissing(db, "students", "guardian_address", "TEXT");

      await addColumnIfMissing(db, "enrollment_terms", "curriculum", "TEXT NOT NULL DEFAULT 'k12'");

      await addColumnIfMissing(db, "term_subjects", "units_earned", "REAL");
      await addColumnIfMissing(db, "term_subjects", "extra_curricular", "TEXT");

      await addColumnIfMissing(db, "import_files", "stored_path", "TEXT");
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
export async function addColumnIfMissing(
  db: Runner,
  table: string,
  column: string,
  definition: string,
): Promise<void> {
  const cols = await db.execute(`PRAGMA table_info(${table})`);
  if (cols.rows.length === 0) return; // table not created yet
  if (cols.rows.some((c) => c.name === column)) return;
  await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export async function currentVersion(db: Runner): Promise<number> {
  const result = await db.execute(`PRAGMA user_version`);
  return Number(result.rows[0]?.user_version ?? 0);
}

export interface MigrationResult {
  from: number;
  to: number;
  applied: string[];
}

/**
 * Apply every migration newer than the database's recorded version.
 *
 * Called from applySchema() after the schema pass. Running it twice is a no-op the second time.
 */
export async function runMigrations(db: Client): Promise<MigrationResult> {
  const from = await currentVersion(db);
  const applied: string[] = [];

  for (const migration of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
    if (migration.version <= from) continue;

    const tx = await db.transaction("write");
    try {
      await migration.up(tx);
      // PRAGMA does not accept a bound parameter, and version is a number we control.
      await tx.execute(`PRAGMA user_version = ${migration.version}`);
      await tx.commit();
      applied.push(`${migration.version}: ${migration.name}`);
    } catch (err) {
      await tx.rollback().catch(() => {}); // a failed commit may already have closed it
      throw new Error(
        `migration ${migration.version} (${migration.name}) failed, database left at version ` +
          `${await currentVersion(db)}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return { from, to: await currentVersion(db), applied };
}
