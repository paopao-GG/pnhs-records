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
 * failure leaves the recorded version untouched and the database consistent. That holds against
 * the hosted database too: `ALTER TABLE` and the version write both roll back inside a libSQL
 * transaction.
 *
 * Real data is backed up before any of this runs - see `snapshotBeforeMigrating()` below.
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Client, Transaction } from "@libsql/client";
import { snapshotInto } from "./snapshot.ts";

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
  {
    version: 3,
    name: "three grading periods",
    up: async (db) => {
      /*
       * From SY 2026-2027 the school grades over three periods rather than four, and the two
       * forms are affected in different places: a JHS grade level loses its fourth quarter
       * column, and the SHS programme runs three semester blocks instead of four.
       *
       * Both columns are NULLABLE WITH NO BACKFILL, and that is the whole point. Every row
       * already in this database was graded under the old scheme, so NULL has to keep meaning
       * exactly what those rows already mean. `gradingPeriods()` in lib/grading.ts resolves it,
       * and nothing reads the raw column.
       *
       * `grading_periods` is per TERM because a learner straddles the cutover - Grade 7 and 8
       * under four quarters, Grade 9 under three, on one permanent record. A global setting
       * would rewrite history for every earlier year the moment it was flipped.
       *
       * `shs_semesters` is per STUDENT because it describes the programme rather than a term: a
       * three-semester learner has no Grade 12 2nd Semester at all, so there is no row to hang
       * it on. It also cannot be inferred on import - an empty fourth block is indistinguishable
       * from a Grade 11 learner who has not reached Grade 12 yet.
       */
      await addColumnIfMissing(db, "enrollment_terms", "grading_periods", "INTEGER");
      await addColumnIfMissing(db, "students", "shs_semesters", "INTEGER");
    },
  },
  {
    version: 4,
    name: "accounts removed",
    up: async (db) => {
      /*
       * The app became a local Windows application opened with one password, so the two-role
       * account system went with the hosted deployment it was built for.
       *
       * `sessions` and `login_attempts` are dropped because both are transient state with a
       * replacement that needs no table: sessions now live in the server process, so closing
       * the app ends them, and the lockout counter is a module-level array. The DB-backed
       * versions existed specifically because a serverless host may run more than one
       * instance and an in-process counter would count a fraction of the attempts. One local
       * process inverts that reasoning exactly.
       *
       * `users` is deliberately KEPT, and it is the interesting half of this migration.
       *
       * Nothing reads it after this change. But `record_history.user_id` names real people on
       * every row written while accounts existed, and those rows are the audit trail for
       * every grade encoded in the last round. Dropping the table would turn each of them
       * into an integer pointing at nothing - the history would survive and stop meaning
       * anything. The column has no foreign key, so keeping the table costs one dormant table
       * and buys the ability to still answer who changed a grade in August 2026.
       *
       * New rows are written with a null user_id. See recordChange() in lib/db/queries.ts.
       */
      await db.execute(`DROP TABLE IF EXISTS sessions`);
      await db.execute(`DROP TABLE IF EXISTS login_attempts`);
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
  // `pragma_table_info(...)` rather than `PRAGMA table_info ...`: the table-valued form is an
  // ordinary SELECT, and a hosted database allows those where it refuses bare pragma statements.
  const cols = await db.execute({
    sql: `SELECT name FROM pragma_table_info(?)`,
    args: [table],
  });
  if (cols.rows.length === 0) return; // table not created yet
  if (cols.rows.some((c) => c.name === column)) return;
  await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/**
 * The schema version lives in a table, not in `PRAGMA user_version`.
 *
 * The pragma was the obvious choice for a local file and does not survive being hosted: Turso
 * refuses to execute `PRAGMA user_version = 1` at all - *"SQL not allowed statement"* - so the
 * runner could apply a migration and then fail to record that it had. A one-row table works
 * identically everywhere, and has one property the pragma lacks: it is ordinary data, so it is
 * covered by the surrounding transaction and by backups.
 */
async function ensureVersionTable(db: Runner): Promise<void> {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS schema_version (
       id       INTEGER PRIMARY KEY CHECK (id = 1),
       version  INTEGER NOT NULL
     )`,
  );
}

export async function currentVersion(db: Runner): Promise<number> {
  await ensureVersionTable(db);

  const stored = await db.execute(`SELECT version FROM schema_version WHERE id = 1`);
  if (stored.rows[0]) return Number(stored.rows[0].version);

  /*
   * No row yet. Adopt whatever `PRAGMA user_version` says before assuming zero: databases
   * created before this table exist and are already migrated, and starting them from scratch
   * would re-run every migration. They happen to be idempotent, but relying on that is luck.
   *
   * A hosted database rejects the read as well, which correctly yields 0 - it can only be a
   * database this mechanism created.
   */
  let adopted = 0;
  try {
    const pragma = await db.execute(`PRAGMA user_version`);
    adopted = Number(pragma.rows[0]?.user_version ?? 0);
  } catch {
    adopted = 0;
  }

  await setVersion(db, adopted);
  return adopted;
}

async function setVersion(db: Runner, version: number): Promise<void> {
  await db.execute({
    sql: `INSERT INTO schema_version (id, version) VALUES (1, ?)
          ON CONFLICT(id) DO UPDATE SET version = excluded.version`,
    args: [version],
  });
}

export { setVersion };

export interface MigrationResult {
  from: number;
  to: number;
  applied: string[];
}

/**
 * Copy the database aside before anything alters it.
 *
 * Returns the file written, or null when there was nothing worth copying.
 *
 * ## Why this exists
 *
 * This project's own rule is *"back up before running migrations against real data"*, and
 * until now that depended on somebody remembering it at the one moment it matters — the first
 * launch after an update, which happens on the registrar's machine and not on ours. A
 * migration that fails is already safe: it rolls back and leaves the version untouched. The
 * one this guards against is a migration that **succeeds and is wrong**, which no rollback
 * catches and no test on our side can rule out.
 *
 * ## Why the destination is passed in rather than worked out here
 *
 * `runMigrations` is handed a `Client`, which does not say which file it is connected to. The
 * test suite migrates scratch databases in a temp folder, and `openDb()` opens whatever path a
 * script asks for. Resolving `dataDir()` in here would file backups of throwaway databases in
 * the school's own records folder — so only callers that know they are working on real data
 * ask for a snapshot.
 */
async function snapshotBeforeMigrating(
  db: Client,
  dir: string,
  from: number,
  to: number,
): Promise<string | null> {
  /*
   * Nothing to protect on a new database.
   *
   * A fresh install reports version 0 with every migration pending, and an empty file is not
   * worth a copy. Version > 0 means a database that has been migrated before, which means one
   * that may hold records.
   */
  if (from === 0) return null;

  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const folder = join(dir, `pre-upgrade-v${from}-to-v${to}-${stamp}`);
  const file = join(folder, "pnhs.db");

  try {
    mkdirSync(folder, { recursive: true });
    await snapshotInto(db, file);
  } catch (err) {
    /*
     * Refuse to migrate. Altering data that could not be copied first is precisely what this
     * function exists to prevent, and a full or read-only disk is the realistic cause.
     */
    throw new Error(
      `Could not back the database up before upgrading it, so no migration was applied.\n` +
        `Tried to write: ${file}\n` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return file;
}

/**
 * Apply every migration newer than the database's recorded version.
 *
 * Called from applySchema() after the schema pass. Running it twice is a no-op the second time.
 *
 * `snapshotDir` opts this database in to a pre-upgrade backup; see above for why it is a
 * parameter. Omit it and the behaviour is exactly as it was.
 */
export async function runMigrations(db: Client, snapshotDir?: string): Promise<MigrationResult> {
  const from = await currentVersion(db);
  const applied: string[] = [];

  const pending = [...MIGRATIONS].filter((m) => m.version > from);
  if (snapshotDir && pending.length > 0) {
    const to = Math.max(...pending.map((m) => m.version));
    await snapshotBeforeMigrating(db, snapshotDir, from, to);
  }

  for (const migration of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
    if (migration.version <= from) continue;

    const tx = await db.transaction("write");
    try {
      await migration.up(tx);
      await setVersion(tx, migration.version);
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
