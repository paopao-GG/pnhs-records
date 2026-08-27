/**
 * Writing a consistent copy of the database to another file.
 *
 * ## `VACUUM INTO`, not a file copy
 *
 * Copying a live SQLite file with `cp` is the corruption mode this project warns about
 * everywhere else: the copy can catch the file mid-write and produce something that is not a
 * database. `VACUUM INTO` is SQLite's own answer — it writes a consistent snapshot through the
 * open connection, compacted, while other statements carry on. The result is one self-contained
 * file with no write-ahead log beside it.
 *
 * ## Why this is its own module
 *
 * Two callers need it and they cannot import each other. [lib/backup.ts](../backup.ts) is the
 * registrar's backup button, and it imports `getDb()` from [./index.ts](./index.ts).
 * [./migrations.ts](./migrations.ts) needs the same thing to snapshot before it migrates —
 * and `index.ts` imports `migrations.ts`, so `migrations.ts` importing `backup.ts` closes a
 * cycle.
 *
 * So the one statement that matters lives here, in a module that imports nothing but a type.
 * That is worth a file on its own: the quote-escaping below is exactly the kind of detail that
 * gets fixed in one copy and not the other.
 */

import type { Client, Transaction } from "@libsql/client";

/** Either a plain connection or an open transaction. */
type Runner = Pick<Client | Transaction, "execute">;

/**
 * Write the database `db` is connected to into `filePath`.
 *
 * **The destination must not already exist.** `VACUUM INTO` refuses to overwrite and answers
 * `SQLITE_ERROR: output file already exists`, which reads like a corrupted database rather
 * than a name collision. Callers pick a free path; see `freeFolder()` in lib/backup.ts.
 */
export async function snapshotInto(db: Runner, filePath: string): Promise<void> {
  // Parameters are not allowed in VACUUM INTO, so the path is inlined. SQLite string literals
  // escape a single quote by doubling it — and Windows paths under a user's own folder can
  // contain one, because Windows account names can.
  await db.execute(`VACUUM INTO '${filePath.replace(/'/g, "''")}'`);
}
