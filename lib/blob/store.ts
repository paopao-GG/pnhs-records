/**
 * Where imported original files live: `originals/` inside the app's data directory.
 *
 * ## Why this exists at all
 *
 * A Form 137 cannot be reprinted onto a modern SF10 - the record is pre-K-12 and the form
 * would assert a curriculum the learner never studied. The stored original **is** the
 * reissuable document. Losing it loses the ability to reissue that learner's record at all.
 *
 * ## What used to be here
 *
 * This module had two backings, chosen by `R2_BUCKET`: a Cloudflare R2 bucket for the hosted
 * deployment, and this disk path for development and the test suite. The bucket existed
 * because a serverless host has no durable filesystem. The installed app has one, so the
 * remote half and the two AWS SDK dependencies that served it are gone.
 *
 * Three things from that design are kept, and none of them were about R2:
 *
 *  - **The key format.** `import_files.stored_path` holds keys in this shape already, on every
 *    database in existence. Changing it now would strand every archived original.
 *  - **The guards.** `isBlobKey()` and the extension rebuild in `suffix()` protect against a
 *    value read back out of the database addressing a file we never wrote. That was a
 *    path-traversal concern before it was a key concern, and it is one again.
 *  - **`putOriginal` returning null rather than throwing.** A failure to archive must not fail
 *    an import that otherwise produced a good record.
 *
 * ## Two namespaces, and why
 *
 *     originals/<sha256>.<ext>   the archive. Written by the server, from bytes it has read.
 *     uploads/<random>.<ext>     retained for keys written before uploads became direct.
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { dataDir } from "../paths.ts";

/** The archive: content hash plus the original extension. */
const PREFIX = "originals/";

/** Inbound uploads awaiting import. Random, so nothing can be aimed at. */
const UPLOAD_PREFIX = "uploads/";

/** Everything we write matches this, so a stray key cannot address anything else. */
const KEY_PATTERN = /^(?:originals\/[0-9a-f]{64}|uploads\/[0-9a-f]{32})\.[a-z0-9]{1,8}$/;

/**
 * The extension part of a key.
 *
 * Rebuilt from the trailing alphanumeric run rather than filtered, so that whatever comes in,
 * the result always satisfies `isBlobKey()`. Stripping the offending characters instead looked
 * equivalent and was not: `"../../evil"` filtered down to `"....evil"`, which the guard then
 * refused - meaning the file would have been stored under a key nothing could ever read back,
 * losing the archive copy silently.
 */
function suffix(ext: string): string {
  const match = /\.?([a-z0-9]{1,8})$/.exec(ext.toLowerCase());
  return match ? match[1] : "bin";
}

/** The canonical archive key for a file, from the SHA-256 the importer already computes. */
export function blobKey(sha256: string, ext: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error(`blobKey needs a SHA-256 hex digest, got ${JSON.stringify(sha256)}`);
  }
  return `${PREFIX}${sha256}.${suffix(ext)}`;
}

/** A key for one inbound upload. 128 bits of randomness, so it names nothing that exists. */
export function uploadKey(ext: string): string {
  return `${UPLOAD_PREFIX}${randomBytes(16).toString("hex")}.${suffix(ext)}`;
}

/** Is this the temporary copy of an upload, rather than an archived original? */
export function isUploadKey(stored: string): boolean {
  return isBlobKey(stored) && normaliseKey(stored).startsWith(UPLOAD_PREFIX);
}

/**
 * Accept the `data/originals/...` paths written before files were keyed.
 *
 * `import_files.stored_path` used to hold a filesystem path and now holds a key. Tolerating
 * the old form means rows written by earlier versions still resolve rather than 404ing.
 */
export function normaliseKey(stored: string): string {
  return stored.replace(/\\/g, "/").replace(/^\.?\/*data\//, "");
}

/**
 * Is this a key we wrote?
 *
 * A value read back out of the database must never be able to address a file we did not put
 * there. `stored_path` is data, and data that names a file is data that can name the wrong one.
 */
export function isBlobKey(stored: string): boolean {
  return KEY_PATTERN.test(normaliseKey(stored));
}

/** Where a key lives on this machine. */
function diskPath(key: string): string {
  return join(dataDir(), normaliseKey(key));
}

/**
 * Store a file and return its key, or null if storing failed.
 *
 * Null rather than throwing, deliberately: the learner record itself imported fine, and losing
 * the archival copy should not fail the import that produced it. Re-importing stores it again.
 */
export async function putOriginal(
  sha256: string,
  ext: string,
  bytes: Uint8Array,
): Promise<string | null> {
  try {
    // Inside the try: blobKey rejects a malformed hash, and that must surface as "not stored"
    // rather than failing the import of a record that is otherwise fine.
    const key = blobKey(sha256, ext);
    const path = diskPath(key);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, bytes);
    return key;
  } catch {
    return null;
  }
}

/** Fetch a stored file, or null if it is not there. */
export async function getOriginal(stored: string): Promise<Uint8Array | null> {
  if (!isBlobKey(stored)) return null;
  try {
    return new Uint8Array(readFileSync(diskPath(stored)));
  } catch {
    // The route says the copy is missing rather than guessing why it is missing.
    return null;
  }
}

/**
 * Remove a stored file, because "delete this learner" has to mean it.
 *
 * Never throws: a filesystem error must not roll back a deletion that already happened in the
 * database. The failure mode is an orphaned file, which is recoverable; the alternative is a
 * record the registrar believes is gone and is not.
 */
export async function deleteOriginal(stored: string): Promise<void> {
  if (!isBlobKey(stored)) return;
  try {
    rmSync(diskPath(stored), { force: true });
  } catch {
    /* already gone, or never written */
  }
}
