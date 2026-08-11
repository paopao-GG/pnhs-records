/**
 * Serves the original file a learner's record was imported from.
 *
 * This is the only way to reissue a Form 137: it is a 1990s Word document with no modern
 * template to fill, and printing that record onto a 2017 SF10 would assert a curriculum the
 * learner never studied. The original document is the record.
 */

import { basename } from "node:path";
import { getOriginalFile, getStudent } from "@/lib/db/queries.ts";
import { requireUserForApi } from "@/lib/auth/current-user.ts";
import { getOriginal, isBlobKey } from "@/lib/blob/store.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Colocated with the database; see the sf10 route for why.
export const preferredRegion = "sin1";

const MIME: Record<string, string> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  // This hands over a learner's source document - the single most sensitive response the app
  // produces, containing parents' names and home addresses on a Form 137.
  const auth = await requireUserForApi();
  if (auth.response) return auth.response;

  const { id } = await params;
  const studentId = Number(id);
  if (!Number.isInteger(studentId)) return new Response("Invalid student id", { status: 400 });

  const student = await getStudent(studentId);
  if (!student) return new Response("Student not found", { status: 404 });

  const original = await getOriginalFile(studentId);
  if (!original) {
    return new Response("No original file was stored for this learner.", { status: 404 });
  }

  // stored_path comes from our own import, but bound it anyway — a value read back out of the
  // database should never be able to address storage we did not write. This replaces a
  // filesystem path check; the mechanism changed when files moved to object storage, the
  // concern did not.
  if (!isBlobKey(original.stored_path)) {
    return new Response("Stored file reference is not one of ours.", { status: 500 });
  }

  // Read into memory rather than streaming: these files average 180 KB, so buffering costs
  // nothing, and a Node read stream is not a web ReadableStream — handing one to Response
  // throws "ReadableStream is already closed" at runtime.
  const bytes = await getOriginal(original.stored_path);
  if (!bytes) {
    return new Response(
      "The stored copy of this file is missing. Re-import it to restore the original.",
      { status: 410 },
    );
  }

  const ext = original.stored_path.slice(original.stored_path.lastIndexOf(".")).toLowerCase();

  /*
   * The filename came off an uploaded file, so it is not ours to trust in a header.
   *
   * Everything outside printable ASCII goes, which covers the quotes and backslashes that would
   * end the quoted string early and — the reason this is not cosmetic — the carriage returns
   * and newlines that make Node throw ERR_INVALID_CHAR. That turns a download the registrar was
   * waiting for into a 500, for a file that imported perfectly well.
   */
  const filename = basename(original.filename).replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "");

  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename || "original"}"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
    },
  });
}
