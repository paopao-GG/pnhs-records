/**
 * Imports files the browser has chosen, one batch at a time.
 *
 * Two ways in, because the two deployments differ:
 *
 *  - **JSON `{ files: [{ key, filename }] }`** — the normal path. The browser has already
 *    uploaded the bytes straight to object storage using a ticket from `/api/import/ticket`,
 *    and sends only the keys. This is what keeps the request under Vercel's **4.5 MB body cap**:
 *    at ~220 KB per SF10, posting the bytes themselves tops out around twenty files.
 *  - **multipart form data** — development against the disk fallback, where there is no bucket
 *    to upload to and no cap to worry about.
 *
 * Deliberately a route handler rather than a server action: server actions cap request bodies
 * at 1 MB by default, which one SF10 already exceeds.
 *
 * The client sends **small batches** and adds up the summaries itself, so no single invocation
 * runs near the function time limit and the registrar sees progress while a thousand files go
 * through.
 */

import { revalidatePath } from "next/cache";
import { importBytes, type FileResult, type ImportSummary } from "@/lib/import/import-sf10.ts";
import { requireUserForApi } from "@/lib/auth/current-user.ts";
import { deleteOriginal, getOriginal, isUploadKey } from "@/lib/blob/store.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Colocated with the database; see the sf10 route for why.
export const preferredRegion = "sin1";
/** Hobby's ceiling. Batches are sized so this is headroom, not a target. */
export const maxDuration = 60;

const IMPORTABLE = /\.(xlsx|docx)$/i;

function summarise(results: FileResult[]): ImportSummary {
  return {
    folder: "(uploaded files)",
    results,
    imported: results.filter((r) => r.status === "imported").length,
    updated: results.filter((r) => r.status === "updated").length,
    duplicates: results.filter((r) => r.status === "duplicate").length,
    failed: results.filter((r) => r.status === "failed").length,
    issueCount: results.reduce((n, r) => n + r.issues.length, 0),
  };
}

const rejected = (filename: string, error: string): FileResult => ({
  filename,
  status: "failed",
  issues: [],
  error,
});

/** Import one file's bytes, turning any parser explosion into a per-file failure. */
async function importOne(bytes: Uint8Array, filename: string): Promise<FileResult> {
  try {
    return await importBytes(bytes, filename);
  } catch (err) {
    return rejected(filename, err instanceof Error ? err.message : String(err));
  }
}

export async function POST(request: Request) {
  const auth = await requireUserForApi();
  if (auth.response) return auth.response;

  const results: FileResult[] = [];
  const contentType = request.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    let body: { files?: unknown };
    try {
      body = await request.json();
    } catch {
      return Response.json({ error: "Expected JSON." }, { status: 400 });
    }

    const files = Array.isArray(body.files) ? body.files : [];
    if (files.length === 0) {
      return Response.json({ error: "No files were sent." }, { status: 400 });
    }

    for (const entry of files as { key?: unknown; filename?: unknown }[]) {
      const key = String(entry?.key ?? "");
      const filename = String(entry?.filename ?? key);

      // getOriginal() refuses anything that is not a key we would have written, so a caller
      // cannot point this at arbitrary storage.
      const bytes = await getOriginal(key);
      if (!bytes) {
        results.push(rejected(filename, "The uploaded copy could not be read back."));
        continue;
      }
      results.push(await importOne(bytes, filename));

      /*
       * The inbound copy has served its purpose. `importBytes` has written the archive copy
       * under its own content-hash key, from the bytes just read, so this one is a duplicate.
       *
       * Deleted whether or not the import succeeded: a failed parse leaves nothing that refers
       * to this object, and re-importing uploads it again. Left behind, every file the school
       * ever imports would sit in the bucket twice.
       */
      if (isUploadKey(key)) await deleteOriginal(key);
    }
  } else {
    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return Response.json({ error: "Expected a file upload." }, { status: 400 });
    }

    const files = form.getAll("files").filter((f): f is File => f instanceof File);
    if (files.length === 0) {
      return Response.json({ error: "No files were selected." }, { status: 400 });
    }

    for (const file of files) {
      // .xlsx is SF10 (both variants); .docx is Form 137. The form itself is detected from the
      // file's contents further in — this only rejects what cannot be either.
      if (!IMPORTABLE.test(file.name)) {
        results.push(rejected(file.name, "Not an .xlsx or .docx file."));
        continue;
      }
      results.push(await importOne(new Uint8Array(await file.arrayBuffer()), file.name));
    }
  }

  revalidatePath("/");
  revalidatePath("/import");

  return Response.json(summarise(results));
}
