/**
 * Where imported original files live.
 *
 * One interface, two backings, chosen by environment - the same shape as
 * [lib/db/client.ts](../db/client.ts):
 *
 *     R2_BUCKET set    ->  Cloudflare R2
 *     R2_BUCKET unset  ->  data/originals/ on this machine
 *
 * The disk fallback is not a courtesy. `npm run import:dry`, `npm run roundtrip` and the test
 * suite have to run with no network and no Cloudflare account, and they have to exercise the
 * same code path the deployed app does.
 *
 * ## Why this exists at all
 *
 * A Form 137 cannot be reprinted onto a modern SF10 - the record is pre-K-12 and the form would
 * assert a curriculum the learner never studied. The stored original **is** the reissuable
 * document. Losing it loses the ability to reissue that learner's record at all, which is why
 * a serverless host's disposable filesystem is not somewhere it can live.
 *
 * ## The bucket is private
 *
 * Objects are served back through `/api/students/[id]/original`, which checks the session.
 * Nothing here ever produces a public URL, and the bucket has no public access enabled: a
 * shareable link to a child's record would undo the whole of the accounts work by a side door.
 * Presigned URLs are used only for *upload*, are scoped to one key, and expire in minutes.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** Everything we store sits under this prefix, so a stray key cannot address anything else. */
const PREFIX = "originals/";

/** Content hash plus the original extension. Both backings use the same key. */
const KEY_PATTERN = /^originals\/[0-9a-f]{64}\.[a-z0-9]{1,8}$/;

const MIME: Record<string, string> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

declare global {
  // eslint-disable-next-line no-var
  var __pnhsS3: S3Client | undefined;
}

export function isRemoteStore(): boolean {
  return Boolean(process.env.R2_BUCKET);
}

function bucket(): string {
  const name = process.env.R2_BUCKET;
  if (!name) throw new Error("R2_BUCKET is not set");
  return name;
}

function client(): S3Client {
  if (globalThis.__pnhsS3) return globalThis.__pnhsS3;

  const account = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!account || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2_BUCKET is set but R2_ACCOUNT_ID, R2_ACCESS_KEY_ID or R2_SECRET_ACCESS_KEY is missing.",
    );
  }

  globalThis.__pnhsS3 = new S3Client({
    // R2 has no regions; the SDK still requires the field.
    region: "auto",
    endpoint: `https://${account}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return globalThis.__pnhsS3;
}

/**
 * The canonical key for a file, from the SHA-256 the importer already computes.
 *
 * The extension is rebuilt from the trailing alphanumeric run rather than filtered, so that
 * whatever comes in, the result always satisfies `isBlobKey()`. Stripping the offending
 * characters instead looked equivalent and was not: `"../../evil"` filtered down to `"....evil"`,
 * which the guard then refused — meaning the file would have been stored under a key nothing
 * could ever read back, losing the archive copy silently.
 */
export function blobKey(sha256: string, ext: string): string {
  if (!/^[0-9a-f]{64}$/.test(sha256)) {
    throw new Error(`blobKey needs a SHA-256 hex digest, got ${JSON.stringify(sha256)}`);
  }
  const match = /\.?([a-z0-9]{1,8})$/.exec(ext.toLowerCase());
  return `${PREFIX}${sha256}.${match ? match[1] : "bin"}`;
}

/**
 * Accept the `data/originals/...` paths written before files moved to object storage.
 *
 * `import_files.stored_path` used to hold a filesystem path and now holds a key. Tolerating the
 * old form means the two can coexist while the existing rows are migrated, rather than every
 * pre-existing original 404ing the moment this ships.
 */
export function normaliseKey(stored: string): string {
  return stored.replace(/\\/g, "/").replace(/^\.?\/*data\//, "");
}

/**
 * Is this a key we wrote?
 *
 * Replaces the filesystem path-traversal guard that used to protect the download route. The
 * mechanism changed; the concern did not. A value read back out of the database must never be
 * able to address storage we did not put there.
 */
export function isBlobKey(stored: string): boolean {
  return KEY_PATTERN.test(normaliseKey(stored));
}

/** Where a key lives on this machine, when there is no bucket. */
function diskPath(key: string): string {
  return join(process.cwd(), "data", normaliseKey(key));
}

/**
 * Store a file and return its key, or null if storing failed.
 *
 * Null rather than throwing, deliberately and unchanged from the previous behaviour: the learner
 * record itself imported fine, and losing the archival copy should not fail the import that
 * produced it. Re-importing the file stores it again.
 */
export async function putOriginal(
  sha256: string,
  ext: string,
  bytes: Uint8Array,
): Promise<string | null> {
  const contentType = MIME[ext.toLowerCase()] ?? "application/octet-stream";

  try {
    // Inside the try: blobKey rejects a malformed hash, and that must surface as "not stored"
    // rather than failing the import of a record that is otherwise fine.
    const key = blobKey(sha256, ext);

    if (isRemoteStore()) {
      await client().send(
        new PutObjectCommand({
          Bucket: bucket(),
          Key: key,
          Body: bytes,
          ContentType: contentType,
        }),
      );
    } else {
      const path = diskPath(key);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, bytes);
    }
    return key;
  } catch {
    return null;
  }
}

/** Fetch a stored file, or null if it is not there. */
export async function getOriginal(stored: string): Promise<Uint8Array | null> {
  if (!isBlobKey(stored)) return null;
  const key = normaliseKey(stored);

  try {
    if (isRemoteStore()) {
      const result = await client().send(
        new GetObjectCommand({ Bucket: bucket(), Key: key }),
      );
      if (!result.Body) return null;
      return await result.Body.transformToByteArray();
    }
    return new Uint8Array(readFileSync(diskPath(key)));
  } catch {
    // A missing object and an unreachable bucket both mean "cannot serve this file". The route
    // distinguishes them for the reader by saying the copy is missing, not by guessing why.
    return null;
  }
}

export async function deleteOriginal(stored: string): Promise<void> {
  if (!isRemoteStore() || !isBlobKey(stored)) return;
  await client()
    .send(new DeleteObjectCommand({ Bucket: bucket(), Key: normaliseKey(stored) }))
    .catch(() => {});
}

/**
 * A short-lived, single-key upload credential for the browser.
 *
 * The browser uploads straight to R2 because a Vercel function caps request bodies at 4.5 MB,
 * which at ~220 KB per SF10 tops a single request out at about twenty files.
 *
 * Scoped to one key and minutes of validity: a broader or longer-lived credential in a browser
 * is a bucket anyone who reads the network tab can write to.
 */
export async function presignUpload(
  sha256: string,
  ext: string,
  expiresInSeconds = 300,
): Promise<{ key: string; url: string; contentType: string }> {
  const key = blobKey(sha256, ext);
  const contentType = MIME[ext.toLowerCase()] ?? "application/octet-stream";

  if (!isRemoteStore()) {
    throw new Error("No object store is configured, so uploads cannot be presigned.");
  }

  const url = await getSignedUrl(
    client(),
    new PutObjectCommand({ Bucket: bucket(), Key: key, ContentType: contentType }),
    { expiresIn: expiresInSeconds },
  );

  return { key, url, contentType };
}
