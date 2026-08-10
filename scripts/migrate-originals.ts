/**
 * Moves the stored original files into object storage.
 *
 * One-off, and safe to re-run: every file is keyed by its own SHA-256, so uploading twice
 * writes the same object twice rather than accumulating copies.
 *
 * Two things happen per row:
 *   1. the bytes are uploaded to R2 (skipped if the object is already there)
 *   2. `import_files.stored_path` is rewritten from the old `data/originals/...` path to the
 *      canonical `originals/...` key
 *
 * The local files are left alone. Delete them by hand once you are satisfied the uploads are
 * good - a one-off migration should not also be the thing that destroys the only other copy.
 *
 * Needs the R2 settings, which live in .env.local rather than the shell:
 *
 *   node --env-file=.env.local scripts/migrate-originals.ts
 *   node --env-file=.env.local scripts/migrate-originals.ts --dry-run
 *
 * Run: npm run migrate:originals
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "../lib/db/index.ts";
import { getOriginal, isRemoteStore, normaliseKey, putOriginal } from "../lib/blob/store.ts";

const dryRun = process.argv.includes("--dry-run");

if (!isRemoteStore()) {
  console.error(
    "\n  R2_BUCKET is not set, so there is nowhere to migrate to." +
      "\n  Run with:  node --env-file=.env.local scripts/migrate-originals.ts\n",
  );
  process.exit(1);
}

const db = await getDb();
const rows = (
  await db.execute(
    `SELECT id, filename, stored_path FROM import_files
      WHERE stored_path IS NOT NULL ORDER BY id`,
  )
).rows;

console.log(`\n  ${rows.length} stored originals${dryRun ? "  (dry run)" : ""}\n`);

let uploaded = 0;
let alreadyThere = 0;
let rewritten = 0;
let failed = 0;

for (const row of rows) {
  const stored = String(row.stored_path);
  const key = normaliseKey(stored);
  const ext = key.slice(key.lastIndexOf("."));
  const sha256 = key.slice(key.indexOf("/") + 1, key.lastIndexOf("."));
  const label = String(row.filename).slice(0, 46).padEnd(46);

  // Read from the local copy, not through the store - the store would already be pointed at R2.
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(readFileSync(join(process.cwd(), "data", key)));
  } catch {
    console.log(`  MISSING  ${label} no local copy at data/${key}`);
    failed++;
    continue;
  }

  const existing = await getOriginal(key);
  if (existing && existing.length === bytes.length) {
    alreadyThere++;
  } else if (dryRun) {
    console.log(`  would upload  ${label} ${(bytes.length / 1024).toFixed(0)} KB`);
    uploaded++;
  } else {
    const written = await putOriginal(sha256, ext, bytes);
    if (!written) {
      console.log(`  FAILED   ${label} upload rejected`);
      failed++;
      continue;
    }
    uploaded++;
  }

  if (stored !== key) {
    if (!dryRun) {
      await db.execute({
        sql: `UPDATE import_files SET stored_path = ? WHERE id = ?`,
        args: [key, Number(row.id)],
      });
    }
    rewritten++;
  }
}

console.log(`\n  uploaded        : ${uploaded}`);
console.log(`  already in R2   : ${alreadyThere}`);
console.log(`  paths rewritten : ${rewritten}`);
console.log(`  failed          : ${failed}`);

if (!dryRun && failed === 0) {
  // Prove it end to end rather than trusting the counters: read every row back through the
  // store, which is now pointed at R2, exactly as the download route will.
  let unreadable = 0;
  const after = (
    await db.execute(
      `SELECT stored_path FROM import_files WHERE stored_path IS NOT NULL`,
    )
  ).rows;
  for (const r of after) {
    if (!(await getOriginal(String(r.stored_path)))) unreadable++;
  }
  console.log(`\n  verified        : ${after.length - unreadable} of ${after.length} readable from R2`);
  if (unreadable) process.exitCode = 1;
}

console.log("");
