/**
 * Imports files the browser has chosen, one batch at a time.
 *
 * Multipart form data, and nothing else. There used to be a second, primary path taking JSON
 * `{ files: [{ key }] }` — the browser having already PUT the bytes into an object store using
 * a presigned ticket, because a serverless function caps request bodies at 4.5 MB and one SF10
 * is ~220 KB. The server runs on this machine now. The bytes have nowhere to travel and no cap
 * to travel under, so the ticket route and the key-import branch are both gone.
 *
 * Still deliberately a route handler rather than a server action: server actions cap request
 * bodies at 1 MB by default, which one SF10 already exceeds.
 *
 * The client sends **small batches** and adds up the summaries itself, which is what makes the
 * progress counter move while a thousand files go through.
 */

import { revalidatePath } from "next/cache";
import { importBytes, type FileResult, type ImportSummary } from "@/lib/import/import-sf10.ts";
import { requireUnlockedForApi } from "@/lib/auth/guard.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  const auth = await requireUnlockedForApi();
  if (auth.response) return auth.response;

  const results: FileResult[] = [];

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

  revalidatePath("/");
  revalidatePath("/import");

  return Response.json(summarise(results));
}
