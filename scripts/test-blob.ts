/**
 * Where imported originals are stored: keys, guards, and the round trip.
 *
 * The key format and the guards outlived the object store they were written for. They are not
 * about buckets - `isBlobKey()` stops a value read back out of the database naming a file we
 * never wrote, and `suffix()` rebuilds an extension rather than filtering one because
 * filtering turned `"../../evil"` into a key that passed nothing and lost the archive copy.
 *
 * Run: npm run test:blob
 */

import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/*
 * Point the store at a scratch folder. Without this these tests would write into - and then
 * delete out of - the school's own originals directory.
 */
const scratchDir = mkdtempSync(join(tmpdir(), "pnhs-blob-"));
process.env.PNHS_DATA_DIR = scratchDir;

const {
  blobKey,
  deleteOriginal,
  getOriginal,
  isBlobKey,
  isUploadKey,
  normaliseKey,
  putOriginal,
  uploadKey,
} = await import("../lib/blob/store.ts");

let passed = 0;
const checks: { name: string; fn: () => Promise<void> }[] = [];
const check = (name: string, fn: () => Promise<void>) => checks.push({ name, fn });

const written: string[] = [];
const bytesOf = (s: string) => new TextEncoder().encode(s);
const hashOf = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

const store = async (content: string, ext = ".docx") => {
  const bytes = bytesOf(content);
  const key = await putOriginal(hashOf(bytes), ext, bytes);
  if (key) written.push(key);
  return { key, bytes };
};

console.log(`
  storing under: ${scratchDir}`);

check("a stored file reads back byte-identical", async () => {
  const { key, bytes } = await store("a Form 137 stands in for the learner's whole record");
  assert.ok(key, "put returned no key");
  const back = await getOriginal(key!);
  assert.ok(back, "nothing read back");
  assert.deepEqual(Buffer.from(back!), Buffer.from(bytes));
});

check("the same bytes twice produce the same key", async () => {
  // Keys are content hashes, so re-importing a file overwrites rather than accumulating a
  // second copy. At 5,000 learners the difference is real money.
  const a = await store("identical content");
  const b = await store("identical content");
  assert.equal(a.key, b.key);
});

check("different bytes produce different keys", async () => {
  const a = await store("one learner");
  const b = await store("another learner");
  assert.notEqual(a.key, b.key);
});

check("a missing key returns null rather than throwing", async () => {
  // The download route turns this into a 410 explaining the copy is gone. If it threw, that
  // would be a 500 and the registrar would learn nothing.
  const absent = blobKey("f".repeat(64), ".docx");
  assert.equal(await getOriginal(absent), null);
});

check("keys outside our prefix are refused", async () => {
  // This replaces the filesystem path-traversal guard. A value read back out of the database
  // must not be able to address storage we did not write.
  for (const bad of [
    "",
    "secrets/passwords.txt",
    "../../../etc/passwd",
    "originals/../../escape.docx",
    "originals/not-a-hash.docx",
    "originals/" + "f".repeat(63) + ".docx",
    "originals/" + "g".repeat(64) + ".docx",
  ]) {
    assert.equal(isBlobKey(bad), false, `should refuse: ${bad}`);
    assert.equal(await getOriginal(bad), null, `should not read: ${bad}`);
  }
});

check("well-formed keys are accepted", async () => {
  assert.equal(isBlobKey(blobKey("a".repeat(64), ".docx")), true);
  assert.equal(isBlobKey(blobKey("0123456789abcdef".repeat(4), ".xlsx")), true);
});

check("the pre-object-storage path form still resolves", async () => {
  // `import_files.stored_path` used to hold `data/originals/...`. Tolerating the old form is
  // what lets existing rows keep working while they are migrated, instead of every original
  // 404ing the moment object storage ships.
  const sha = "b".repeat(64);
  const legacy = `data/originals/${sha}.docx`;
  assert.equal(normaliseKey(legacy), `originals/${sha}.docx`);
  assert.equal(isBlobKey(legacy), true);
  assert.equal(normaliseKey(`data\\originals\\${sha}.docx`), `originals/${sha}.docx`, "windows separators");
});

check("any extension still yields a key that can be read back", async () => {
  // Not hypothetical: the first version filtered characters out instead of rebuilding the
  // extension, turning "../../evil" into "....evil" - a key the guard then refused, so the file
  // would have been written somewhere nothing could ever read it.
  for (const ext of ["../../evil", "", ".", "..", ".DOCX", "xlsx", ".tar.gz", ".a/b", "?><"]) {
    const key = blobKey("c".repeat(64), ext);
    assert.equal(isBlobKey(key), true, `key must be valid for ext ${JSON.stringify(ext)}: ${key}`);
    assert.ok(!key.includes(".."), key);
    assert.ok(key.startsWith("originals/"), key);
  }
});

check("a malformed hash is rejected rather than stored unreadably", async () => {
  assert.throws(() => blobKey("not-a-hash", ".docx"));
  // putOriginal turns that into "not stored" - never into a failed import.
  assert.equal(await putOriginal("not-a-hash", ".docx", bytesOf("x")), null);
});

check("an upload key is unguessable and never lands in the archive", async () => {
  /*
   * The property that matters, and the one whose absence was the bug: nothing the caller says
   * decides where their bytes go. When the key was the content hash the browser claimed, a
   * signed-in caller could name an archived original and R2 would overwrite it - replacing the
   * only reissuable copy of a learner's Form 137.
   */
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const key = uploadKey(".docx");
    assert.ok(key.startsWith("uploads/"), key);
    assert.ok(isBlobKey(key), key);
    assert.ok(isUploadKey(key), key);
    assert.equal(seen.has(key), false, "upload keys must not repeat");
    seen.add(key);
  }
});

check("an upload key survives any extension, like an archive key", async () => {
  for (const ext of ["../../evil", "", ".", "..", ".DOCX", "xlsx", ".tar.gz", ".a/b", "?><"]) {
    const key = uploadKey(ext);
    assert.equal(isBlobKey(key), true, `must be valid for ext ${JSON.stringify(ext)}: ${key}`);
    assert.ok(!key.includes(".."), key);
  }
});

check("archive keys are not mistaken for uploads", async () => {
  // The import route deletes the inbound copy after reading it. If this told it that an
  // `originals/` key was an upload, that call would delete the archive instead.
  assert.equal(isUploadKey(blobKey("a".repeat(64), ".docx")), false);
  assert.equal(isUploadKey("uploads/" + "f".repeat(31) + ".docx"), false, "wrong length");
  assert.equal(isUploadKey("uploads/../originals/x.docx"), false);
});

check("deleting removes the file from either backing", async () => {
  // `deleteOriginal` used to return early unless a bucket was configured, so deleting a learner
  // on a local install left their Form 137 - parents' names, home address - on disk.
  const { key } = await store("a record the registrar deleted");
  assert.ok(await getOriginal(key!), "should be there first");
  await deleteOriginal(key!);
  assert.equal(await getOriginal(key!), null, "the file must be gone after deleting it");
});

check("deleting something that is not ours does nothing", async () => {
  await deleteOriginal("../../etc/passwd"); // must not throw, must not reach outside
  await deleteOriginal(""); // must not throw
});

check("a stored file survives a second identical import", async () => {
  const first = await store("re-imported file");
  const again = await store("re-imported file");
  assert.equal(first.key, again.key);
  const back = await getOriginal(again.key!);
  assert.deepEqual(Buffer.from(back!), Buffer.from(again.bytes));
});

for (const { name, fn } of checks) {
  try {
    await fn();
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}

try {
  rmSync(scratchDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
} catch {
  /* the OS will clear it */
}

console.log(process.exitCode ? "\nblob: FAILURES above\n" : `\nblob: ${passed} checks passed\n`);
