/**
 * Copy the records somewhere safe, from the command line.
 *
 * The Settings page does the same thing through `lib/backup.ts`; this exists so the copy can be
 * scheduled with Task Scheduler without anyone having to open the app.
 *
 *   npm run backup                       -> data/backups/pnhs-backup-<date>
 *   npm run backup -- "E:\PNHS backups"  -> a removable drive, which is the point
 *
 * ## What used to be here
 *
 * This script used to pull the *hosted* database down into a local file, and refused to run
 * when the target was already local — "the local database is already a file you can copy."
 * That is true again, and it is the one thing the school got back by leaving the cloud.
 *
 * What it lost is the provider's redundancy. One machine now holds the only copy of thousands
 * of children's permanent records, so:
 *
 *  - **a copy has to leave the building.** An encrypted external drive taken home covers the
 *    fire, the flood and the theft, which a second copy on the same desk does not.
 *  - **an untested backup is a hypothesis.** Restore one occasionally and open a record:
 *    `$env:PNHS_DATA_DIR = '<the backup folder>'; npm run dev`.
 *
 * Run: npm run backup
 */

import { backupTo, defaultBackupRoot } from "../lib/backup.ts";
import { dataDir } from "../lib/paths.ts";

const target = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? defaultBackupRoot();

console.log(`\n  from : ${dataDir()}`);
console.log(`  to   : ${target}`);

try {
  const result = await backupTo(target);
  console.log(`\n  wrote  : ${result.folder}`);
  console.log(`  files  : pnhs.db + ${result.originals} original${result.originals === 1 ? "" : "s"}`);
  console.log(
    "\n  Keep one copy off-site, and restore one occasionally to prove it works:\n" +
      `    $env:PNHS_DATA_DIR = '${result.folder}'; npm run dev\n`,
  );
} catch (err) {
  console.error(`\n  backup failed: ${err instanceof Error ? err.message : err}\n`);
  process.exitCode = 1;
}
