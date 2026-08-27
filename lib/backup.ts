/**
 * Copying the records somewhere safe.
 *
 * ## Why this is more important than it used to be
 *
 * The hosted deployment kept the database on a provider that replicated it, and `npm run
 * backup` pulled a copy down. That safety net is gone with the hosting. One machine now holds
 * the only copy of the school's permanent records, and the disk in it will eventually fail.
 *
 * The compensation is that backing up is a file copy again — which is exactly how the
 * registrar used to do it, and the thing the move to hosting took away.
 *
 * ## VACUUM INTO, not a file copy
 *
 * The database is copied with `snapshotInto()` from [./db/snapshot.ts](./db/snapshot.ts) rather
 * than by copying the file — see that module for why, and for why it lives apart from both
 * callers.
 *
 * The originals need no such care. They are content-addressed and never rewritten, so a plain
 * copy of `originals/` is always internally consistent.
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { getDb } from "./db/index.ts";
import { snapshotInto } from "./db/snapshot.ts";
import { dataDir } from "./paths.ts";

export interface BackupResult {
  folder: string;
  originals: number;
}

/** Where the folder picker starts, and what an empty destination field means. */
export function defaultBackupRoot(): string {
  return join(dataDir(), "backups");
}

function stamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(
    d.getMinutes(),
  )}${pad(d.getSeconds())}`;
}

/**
 * A folder that does not exist yet.
 *
 * **`VACUUM INTO` refuses to overwrite**, and answers `SQLITE_ERROR: output file already exists`
 * — which tells the registrar nothing and looks like a corrupted database rather than a
 * duplicate name. Two backups inside the same second is implausible; two inside the same minute
 * is not, and that is exactly what happens when somebody picks the wrong drive and immediately
 * tries again.
 *
 * So the stamp carries seconds and this still checks, because the cost of being wrong is an
 * error message on the one workflow that must never look broken.
 */
function freeFolder(target: string): string {
  const base = join(target, `pnhs-backup-${stamp()}`);
  if (!existsSync(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!existsSync(candidate)) return candidate;
  }
}

/**
 * Write a dated backup folder under `root`.
 *
 * Refuses a destination inside the data directory. A copy on the same disk as the original
 * protects against a mistaken deletion and against nothing else — not the drive failing, not
 * the machine being stolen, not the office flooding — and a backup that looks like protection
 * without being it is worse than none, because it stops anyone looking for a real one. The
 * default destination is the one exception, and it is a staging area rather than the backup.
 */
export async function backupTo(root: string): Promise<BackupResult> {
  const target = resolve(root);
  const data = resolve(dataDir());

  if (target !== resolve(defaultBackupRoot()) && target.startsWith(data)) {
    throw new Error(
      "That folder is inside the app's own data directory. Choose a removable drive or " +
        "another disk — a copy beside the original is not a backup.",
    );
  }

  mkdirSync(target, { recursive: true });
  const folder = freeFolder(target);
  mkdirSync(folder, { recursive: true });

  const db = await getDb();
  await snapshotInto(db, join(folder, "pnhs.db"));

  let originals = 0;
  const source = join(dataDir(), "originals");
  if (existsSync(source)) {
    const dest = join(folder, "originals");
    mkdirSync(dest, { recursive: true });
    for (const name of readdirSync(source)) {
      const from = join(source, name);
      if (!statSync(from).isFile()) continue;
      copyFileSync(from, join(dest, name));
      originals += 1;
    }
  }

  return { folder, originals };
}
