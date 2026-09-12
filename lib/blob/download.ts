/**
 * Handing a stored file back to the browser.
 *
 * Two routes serve archived bytes - the source document a record was imported from, and the
 * diplomas and certificates filed against a learner. They need the same header handling, and
 * the filename rule below is subtle enough that having two copies of it would mean fixing it
 * in one of them.
 */

import { basename } from "node:path";

const MIME: Record<string, string> = {
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pdf": "application/pdf",
};

/**
 * A filename safe to put inside a quoted header value.
 *
 * The name came off a file somebody uploaded, so it is not ours to trust. Everything outside
 * printable ASCII goes, which covers the quotes and backslashes that would end the quoted
 * string early and - the reason this is not cosmetic - the carriage returns and newlines that
 * make Node throw `ERR_INVALID_CHAR`. That turns a download the registrar was waiting for into
 * a 500, for a file that imported perfectly well.
 */
export function safeAttachmentName(filename: string, fallback = "document"): string {
  const cleaned = basename(filename)
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "");
  return cleaned || fallback;
}

/**
 * Serve bytes as a download.
 *
 * Buffered rather than streamed: these files average 180 KB, so holding one in memory costs
 * nothing, and a Node read stream is not a web `ReadableStream` - handing one to `Response`
 * throws "ReadableStream is already closed" at runtime.
 */
export function fileResponse(
  bytes: Uint8Array,
  filename: string,
  storedPath: string,
  fallback = "document",
): Response {
  const ext = storedPath.slice(storedPath.lastIndexOf(".")).toLowerCase();

  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeAttachmentName(filename, fallback)}"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
    },
  });
}
