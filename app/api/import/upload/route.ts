/**
 * Imports SF10 files chosen with a file picker, as opposed to scanning a folder.
 *
 * Deliberately a route handler rather than a server action: server actions cap request bodies
 * at 1 MB by default, and one SF10 is around 220 KB, so selecting a handful of files would
 * fail with a confusing body-size error. Route handlers have no such cap.
 *
 * Returns the same ImportSummary shape as the folder path, so the UI renders both with one
 * component.
 */

import { revalidatePath } from "next/cache";
import { importBytes, type FileResult, type ImportSummary } from "@/lib/import/import-sf10.ts";
import { requireUserForApi } from "@/lib/auth/current-user.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const auth = await requireUserForApi();
  if (auth.response) return auth.response;

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

  const results: FileResult[] = [];

  for (const file of files) {
    // .xlsx is SF10 (both variants), .docx is Form 137. The form itself is detected from the
    // file's contents further in; this only rejects things that cannot be either.
    const name = file.name.toLowerCase();
    if (!name.endsWith(".xlsx") && !name.endsWith(".docx")) {
      results.push({
        filename: file.name,
        status: "failed",
        issues: [],
        error: "Not an .xlsx or .docx file.",
      });
      continue;
    }

    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      results.push(await importBytes(bytes, file.name));
    } catch (err) {
      results.push({
        filename: file.name,
        status: "failed",
        issues: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const summary: ImportSummary = {
    folder: "(uploaded files)",
    results,
    imported: results.filter((r) => r.status === "imported").length,
    updated: results.filter((r) => r.status === "updated").length,
    duplicates: results.filter((r) => r.status === "duplicate").length,
    failed: results.filter((r) => r.status === "failed").length,
    issueCount: results.reduce((n, r) => n + r.issues.length, 0),
  };

  revalidatePath("/");
  revalidatePath("/import");

  return Response.json(summary);
}
