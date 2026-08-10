/**
 * Generates a filled SF10 for download.
 *
 * Fills a copy of the school's own template in memory - no temp files - so the response is
 * the exact workbook the registrar opens and prints. Formatting, print area and 74% scale
 * come from the template itself; see lib/sf10/export.ts for why we write inputs only.
 */

import { join } from "node:path";
import { buildSf10Record } from "@/lib/db/to-sf10-record.ts";
import { fillJhs, fillShs } from "@/lib/sf10/export.ts";
import { getStudent } from "@/lib/db/queries.ts";
import { requireUserForApi } from "@/lib/auth/current-user.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Windows rejects these in filenames, and registrar names legitimately contain periods. */
function safeFilename(s: string): string {
  return s.replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, "_");
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  // 401 rather than a redirect: a client following a redirect to the sign-in page would get
  // HTTP 200 and an HTML form where it asked for a workbook.
  const auth = await requireUserForApi();
  if (auth.response) return auth.response;

  const { id } = await params;
  const studentId = Number(id);
  if (!Number.isInteger(studentId)) {
    return new Response("Invalid student id", { status: 400 });
  }

  const search = new URL(request.url).searchParams;
  const form = search.get("form");
  if (form !== "jhs" && form !== "shs") {
    return new Response("form must be 'jhs' or 'shs'", { status: 400 });
  }

  // Optional `?levels=7,8`. Absent means every level this form covers.
  const levelParam = search.get("levels");
  const levels = levelParam
    ? levelParam
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n))
    : undefined;

  if (levelParam && (levels?.length ?? 0) === 0) {
    return new Response("levels must be a comma-separated list of grade levels", { status: 400 });
  }

  const student = await getStudent(studentId);
  if (!student) return new Response("Student not found", { status: 404 });

  const record = await buildSf10Record(studentId, form, levels);
  if (!record || record.terms.length === 0) {
    const scope = levels ? `grade ${levels.join(", ")}` : form.toUpperCase();
    return new Response(
      `This learner has no ${scope} terms on record, so there is nothing to print.`,
      { status: 409 },
    );
  }

  const template = join(
    process.cwd(),
    "templates",
    form === "jhs" ? "SF10-JHS.xlsx" : "SF10-SHS.xlsx",
  );

  let bytes: Uint8Array;
  try {
    const wb = form === "jhs" ? fillJhs(template, record) : fillShs(template, record);
    bytes = wb.toBuffer();
  } catch (err) {
    // Most likely a subject overflow or a cell-map mismatch - surface it rather than
    // handing the registrar a silently incomplete permanent record.
    const message = err instanceof Error ? err.message : String(err);
    return new Response(`Could not generate the SF10: ${message}`, { status: 500 });
  }

  const filename = safeFilename(
    `SF10-${form.toUpperCase()}_${student.last_name}_${student.first_name}_${student.lrn}.xlsx`,
  );

  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": XLSX_MIME,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
    },
  });
}
