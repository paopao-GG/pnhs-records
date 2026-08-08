/**
 * Serves the original file a learner's record was imported from.
 *
 * This is the only way to reissue a Form 137: it is a 1990s Word document with no modern
 * template to fill, and printing that record onto a 2017 SF10 would assert a curriculum the
 * learner never studied. The original document is the record.
 */

import { existsSync, readFileSync } from "node:fs";
import { basename, resolve, sep } from "node:path";
import { getOriginalFile, getStudent } from "@/lib/db/queries.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const studentId = Number(id);
  if (!Number.isInteger(studentId)) return new Response("Invalid student id", { status: 400 });

  const student = getStudent(studentId);
  if (!student) return new Response("Student not found", { status: 404 });

  const original = getOriginalFile(studentId);
  if (!original) {
    return new Response("No original file was stored for this learner.", { status: 404 });
  }

  // stored_path comes from our own import, but resolve and bound it anyway — a path read back
  // out of the database should never be able to reach outside the data folder.
  const root = resolve(process.cwd(), "data");
  const full = resolve(process.cwd(), original.stored_path);
  if (full !== root && !full.startsWith(root + sep)) {
    return new Response("Stored file is outside the data folder.", { status: 500 });
  }
  if (!existsSync(full)) {
    return new Response(
      "The stored copy of this file is missing. Re-import it to restore the original.",
      { status: 410 },
    );
  }

  const ext = full.slice(full.lastIndexOf(".")).toLowerCase();

  // Read into memory rather than streaming: a Node read stream is not a web ReadableStream,
  // and handing one to Response throws "ReadableStream is already closed" at runtime. These
  // files average 180 KB, so buffering costs nothing.
  const bytes = readFileSync(full);

  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${basename(original.filename).replace(/["\\]/g, "")}"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
    },
  });
}
