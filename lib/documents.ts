/**
 * Documents filed against a learner.
 *
 * One kind, now: the SF9 report card this app generates. Every row in `student_documents` is a
 * card it produced, so a learner's Documents list is a record of what was actually issued and
 * when - which the grades alone cannot tell you, because they change afterwards.
 *
 * ## What used to be here
 *
 * Eight more types: a diploma and seven certificate wordings, filed by hand from the Import
 * page. They were dropped along with the plan to generate them.
 *
 * The generating half was abandoned for a specific reason worth keeping written down. The
 * school's diploma and certificate files are not blank forms - each holds **sixteen
 * already-issued documents for sixteen real children**. Building a template by carving one out
 * would have shipped the other fifteen learners' names, LRNs and strands inside the installer,
 * on every machine it was put on. With nothing to generate, hand-filing an unreadable Word file
 * was archiving without a purpose, so it went too.
 *
 * `documentLabel()` survives that deletion on purpose: a database written by an older build may
 * still hold a diploma row, and a filed document should go on listing and downloading under a
 * generic name rather than disappearing from a learner's record.
 */

export const DOCUMENT_TYPES = ["sf9"] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_LABELS: Record<DocumentType, string> = {
  sf9: "Report Card (SF9)",
};

/** Reading a value back out of the database, which is `TEXT` and could be anything. */
export function isDocumentType(value: unknown): value is DocumentType {
  return typeof value === "string" && (DOCUMENT_TYPES as readonly string[]).includes(value);
}

/**
 * The label for a stored value, tolerant of one this build does not know.
 *
 * A row written before the certificate types were removed still reads as something rather than
 * breaking the page it appears on.
 */
export function documentLabel(value: unknown): string {
  return isDocumentType(value) ? DOCUMENT_LABELS[value] : "Document";
}
