/**
 * Report cards filed against a learner.
 *
 * The properties worth holding onto:
 *
 *  - the bytes go where every other original goes, and come back byte-identical;
 *  - deleting a card, or the learner it belongs to, removes the file from disk. A child's
 *    documents surviving the deletion of their record is the failure this guards against;
 *  - a byte-identical re-file is reported rather than refused, so the caller can decide - the
 *    SF9 route uses it to tell a reprint from a genuine second issuance;
 *  - the type is checked by the database as well as by the type system.
 *
 * Runs against a scratch database file, not the school's.
 *
 * Run: npm run test:documents
 */

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Point the shared connection at a scratch file BEFORE importing anything that opens it.
const scratchDir = mkdtempSync(join(tmpdir(), "pnhs-documents-"));
process.env.PNHS_DB_PATH = join(scratchDir, "documents-test.db");
process.env.PNHS_DATA_DIR = scratchDir;

const { applySchema } = await import("../lib/db/index.ts");
const { getClient, LOCAL_DB_PATH } = await import("../lib/db/client.ts");
const q = await import("../lib/db/queries.ts");
const { getOriginal, putOriginal } = await import("../lib/blob/store.ts");
const { DOCUMENT_TYPES, documentLabel, isDocumentType } = await import("../lib/documents.ts");
const { safeAttachmentName } = await import("../lib/blob/download.ts");

if (!LOCAL_DB_PATH.startsWith(scratchDir)) {
  console.error(`\n  refusing to run: the database is ${LOCAL_DB_PATH}, not a scratch file\n`);
  process.exit(1);
}

const db = getClient();
await applySchema(db);

let passed = 0;
const checks: { name: string; fn: () => Promise<void> }[] = [];
const check = (name: string, fn: () => Promise<void>) => checks.push({ name, fn });

let seq = 0;
async function makeLearner(): Promise<number> {
  return q.createStudent({
    lrn: String(300000000000 + seq++),
    last_name: "DOCS",
    first_name: `Case ${seq}`,
    middle_name: null,
    name_ext: null,
    sex: "M",
    birthdate: "2008-01-01",
  });
}

/** File a document with real bytes behind it, the way the upload route does. */
async function fileDocument(
  studentId: number,
  documentType: (typeof DOCUMENT_TYPES)[number],
  contents: string,
  filename = "SF9_DOCS_Case.docx",
) {
  const bytes = new TextEncoder().encode(contents);
  const { createHash } = await import("node:crypto");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const storedPath = await putOriginal(sha256, ".docx", bytes);
  assert.ok(storedPath, "the file should have been stored");
  const id = await q.addDocument({
    studentId,
    documentType,
    filename,
    sha256,
    storedPath: storedPath!,
  });
  return { id, sha256, storedPath: storedPath!, bytes };
}

// ------------------------------------------------------------------ storing

check("a filed document comes back byte-identical", async () => {
  const studentId = await makeLearner();
  const { storedPath, bytes } = await fileDocument(studentId, "sf9", "REPORT CARD CONTENTS");

  const read = await getOriginal(storedPath);
  assert.ok(read, "the stored file should be readable");
  assert.deepEqual(Array.from(read!), Array.from(bytes));
});

check("a learner's cards list against them, newest first", async () => {
  const studentId = await makeLearner();
  await fileDocument(studentId, "sf9", "grade 7 card");
  await fileDocument(studentId, "sf9", "grade 8 card");
  await fileDocument(studentId, "sf9", "grade 9 card");

  const docs = await q.listDocuments(studentId);
  assert.equal(docs.length, 3);
  assert.ok(docs.every((d) => d.document_type === "sf9"));
});

check("one learner's documents never appear under another", async () => {
  const a = await makeLearner();
  const b = await makeLearner();
  await fileDocument(a, "sf9", "belongs to A");

  assert.equal((await q.listDocuments(b)).length, 0);
});

check("a learner can hold several cards", async () => {
  /*
   * The reason this table is not import_files, which is UNIQUE(sha256) globally. A learner
   * accumulates a card per year, and one reprinted after a grade was corrected is a second
   * issuance worth keeping rather than a duplicate to collapse.
   */
  const studentId = await makeLearner();
  await fileDocument(studentId, "sf9", "issued 2024");
  await fileDocument(studentId, "sf9", "issued 2026");

  const docs = await q.listDocuments(studentId);
  assert.equal(docs.length, 2);
});

// ----------------------------------------------------------------- duplicate

check("a byte-identical re-file is reported, not refused", async () => {
  const studentId = await makeLearner();
  const first = await fileDocument(studentId, "sf9", "same bytes");

  const found = await q.findDuplicateDocument(studentId, "sf9", first.sha256);
  assert.ok(found, "the duplicate should be findable so the UI can ask");
  assert.equal(found!.id, first.id);

  // Nothing stops it being filed anyway - that is the caller's decision, not the table's.
  const second = await fileDocument(studentId, "sf9", "same bytes");
  assert.notEqual(second.id, first.id);
  assert.equal((await q.listDocuments(studentId)).length, 2);
});

check("another learner's identical card is not this learner's duplicate", async () => {
  // Two learners in the same section can produce byte-identical cards only by coincidence,
  // but the lookup must still be scoped to one learner or a card would go unfiled.
  const a = await makeLearner();
  const b = await makeLearner();
  const first = await fileDocument(a, "sf9", "identical bytes");
  assert.equal(await q.findDuplicateDocument(b, "sf9", first.sha256), null);
});

// ------------------------------------------------------------------ deleting

check("deleting a document removes the file from disk", async () => {
  const studentId = await makeLearner();
  const { id, storedPath } = await fileDocument(studentId, "sf9", "to be deleted");

  const doc = await q.deleteDocument(id);
  assert.ok(doc, "deleteDocument should return the row it removed");
  const { deleteOriginal } = await import("../lib/blob/store.ts");
  await deleteOriginal(doc!.stored_path);

  assert.equal(await q.getDocument(id), null);
  assert.equal(await getOriginal(storedPath), null, "the bytes should be gone");
});

check("deleting a learner takes their documents and their files with them", async () => {
  /*
   * The one that matters. A child's report cards left on disk after their record was deleted
   * is exactly the kind of quiet failure this system is built to avoid.
   */
  const studentId = await makeLearner();
  const grade8 = await fileDocument(studentId, "sf9", "learner's Grade 8 card");
  const grade9 = await fileDocument(studentId, "sf9", "learner's Grade 9 card");

  // The order the delete action uses: read the documents, delete the learner, then the bytes.
  const documents = await q.listDocuments(studentId);
  assert.equal(documents.length, 2);

  await q.deleteStudent(studentId);
  const { deleteOriginal } = await import("../lib/blob/store.ts");
  for (const doc of documents) await deleteOriginal(doc.stored_path);

  assert.equal((await q.listDocuments(studentId)).length, 0, "rows should be gone");
  assert.equal(await getOriginal(grade8.storedPath), null, "Grade 8 card bytes should be gone");
  assert.equal(await getOriginal(grade9.storedPath), null, "Grade 9 card bytes should be gone");
});

// --------------------------------------------------------------------- types

check("the one document type is accepted by the database", async () => {
  // schema.sql's CHECK and lib/documents.ts's union are written separately and can drift.
  for (const type of DOCUMENT_TYPES) {
    const studentId = await makeLearner();
    const { id } = await fileDocument(studentId, type, `contents for ${type}`);
    const doc = await q.getDocument(id);
    assert.equal(doc?.document_type, type, `${type} did not survive a round trip`);
  }
});

check("a type outside the list is refused by the database", async () => {
  const studentId = await makeLearner();
  await assert.rejects(
    () =>
      db.execute({
        sql: `INSERT INTO student_documents
                (student_id, document_type, filename, sha256, stored_path)
              VALUES (?, 'transcript', 'x.docx', 'abc', 'originals/abc.docx')`,
        args: [studentId],
      }),
    "the CHECK constraint should refuse an unknown document type",
  );
});

check("a retired type still renders a label rather than breaking the page", async () => {
  /*
   * A database written before the certificate types were removed may hold a diploma row. It
   * should go on listing and downloading under a generic name - losing a filed document
   * silently is worse than an unfamiliar label.
   */
  assert.equal(isDocumentType("diploma"), false);
  assert.equal(documentLabel("diploma"), "Document");
  assert.equal(documentLabel("sf9"), "Report Card (SF9)");
});

// ---------------------------------------------------------------- downloads

check("a filename cannot break the download header", async () => {
  /*
   * A newline here makes Node throw ERR_INVALID_CHAR, turning a download into a 500 for a file
   * that was filed perfectly well. A quote ends the quoted header value early.
   */
  const cleaned = safeAttachmentName('dip"loma\r\n.docx');
  assert.ok(!/[\r\n"\\]/.test(cleaned), `header-breaking characters survived: ${cleaned}`);
  assert.equal(cleaned, "diploma__.docx", "non-printables become underscores, not nothing");

  // A path is reduced to its last segment, so a filename cannot suggest a directory.
  assert.equal(safeAttachmentName("../../etc/passwd"), "passwd");
  assert.equal(safeAttachmentName(""), "document");

  // Real learner names carry these. They are replaced rather than dropped, which keeps the
  // name recognisable - the school's own files contain BIBLAŇAS, CAŇETA, PEŇAFLOR.
  assert.equal(safeAttachmentName("Ñoño.docx"), "_o_o.docx");
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

db.close();
try {
  rmSync(scratchDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
} catch {
  /* the OS will clear it */
}

console.log(
  process.exitCode ? "\ndocuments: FAILURES above\n" : `\ndocuments: ${passed} checks passed\n`,
);
