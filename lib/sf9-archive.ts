/**
 * Keeping a copy of every report card that was issued.
 *
 * Grades change after a card goes home. The record alone therefore cannot answer what a parent
 * was actually handed in April, which is the question a disputed mark turns into. This files
 * the exact bytes that were downloaded, so the answer is a document rather than a
 * reconstruction from grades that have moved since.
 *
 * Separate from the route that calls it so it can be tested directly: a route handler reads
 * cookies through `next/headers` and cannot run outside a request.
 */

import { createHash } from "node:crypto";
import { addDocument, findDuplicateDocument } from "./db/queries.ts";
import { putOriginal } from "./blob/store.ts";

/**
 * File a generated card against the learner it was made for.
 *
 * Returns the new document's id, or null when nothing was filed - either because an identical
 * card is already on record, or because storing it failed.
 *
 * **Never throws.** The registrar asked for a card and the card exists; a storage problem is
 * not their problem and must not turn a working download into an error page.
 *
 * Byte-identical to one already filed means nothing new was issued: printing a second copy of
 * the same card is not a second issuance. A card reprinted after a grade was corrected has
 * different bytes and files as its own row, which is the history worth keeping.
 */
export async function fileGeneratedCard(
  studentId: number,
  filename: string,
  bytes: Uint8Array,
): Promise<number | null> {
  try {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    if (await findDuplicateDocument(studentId, "sf9", sha256)) return null;

    const storedPath = await putOriginal(sha256, ".docx", bytes);
    if (!storedPath) return null;

    return await addDocument({ studentId, documentType: "sf9", filename, sha256, storedPath });
  } catch {
    return null;
  }
}
