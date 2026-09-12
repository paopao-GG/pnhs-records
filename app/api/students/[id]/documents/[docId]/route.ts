/**
 * Serves one document filed against a learner - a diploma, a certificate, a report card.
 *
 * Same shape and the same care as the source-document route beside it: these are a child's own
 * papers, several of them naming parents and home addresses.
 */

import { getDocument, getStudent } from "@/lib/db/queries.ts";
import { requireUnlockedForApi } from "@/lib/auth/guard.ts";
import { getOriginal, isBlobKey } from "@/lib/blob/store.ts";
import { fileResponse } from "@/lib/blob/download.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; docId: string }> },
) {
  const auth = await requireUnlockedForApi();
  if (auth.response) return auth.response;

  const { id, docId } = await params;
  const studentId = Number(id);
  const documentId = Number(docId);
  if (!Number.isInteger(studentId) || !Number.isInteger(documentId)) {
    return new Response("Invalid id", { status: 400 });
  }

  const student = await getStudent(studentId);
  if (!student) return new Response("Student not found", { status: 404 });

  const doc = await getDocument(documentId);
  if (!doc) return new Response("Document not found", { status: 404 });

  /*
   * The document must belong to the learner in the URL.
   *
   * Without this, any document id served under any learner's path - so a link built for one
   * learner would hand over another's papers, and the check that the learner exists would have
   * passed while proving nothing about the file.
   */
  if (doc.student_id !== studentId) {
    return new Response("That document belongs to a different learner.", { status: 404 });
  }

  // A value read back out of the database must never address storage we did not write.
  if (!isBlobKey(doc.stored_path)) {
    return new Response("Stored file reference is not one of ours.", { status: 500 });
  }

  const bytes = await getOriginal(doc.stored_path);
  if (!bytes) {
    return new Response("The stored copy of this document is missing.", { status: 410 });
  }

  return fileResponse(bytes, doc.filename, doc.stored_path, "document");
}
