/**
 * Generates a filled SF9 (Form 138) report card for download.
 *
 * Fills a copy of the school's own form in memory - no temp files - so the response is the
 * exact document the adviser prints and cuts in two. See lib/sf10/export-sf9.ts.
 */

import { revalidatePath } from "next/cache";
import { getStudent } from "@/lib/db/queries.ts";
import { fileGeneratedCard } from "@/lib/sf9-archive.ts";
import { buildSf9Record } from "@/lib/db/to-sf9-record.ts";
import { fillSf9 } from "@/lib/sf10/export-sf9.ts";
import { requireUnlockedForApi } from "@/lib/auth/guard.ts";
import { appPath } from "@/lib/paths.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Windows rejects these in filenames, and learner names legitimately contain periods. */
function safeFilename(s: string): string {
  return s.replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, "_");
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireUnlockedForApi();
  if (auth.response) return auth.response;

  const { id } = await params;
  const studentId = Number(id);
  if (!Number.isInteger(studentId)) return new Response("Invalid student id", { status: 400 });

  const student = await getStudent(studentId);
  if (!student) return new Response("Student not found", { status: 404 });

  // Which grade level's card. Omitted means the most recent one the form can represent.
  const levelParam = new URL(request.url).searchParams.get("level");
  const level = levelParam === null ? undefined : Number(levelParam);
  if (level !== undefined && !Number.isInteger(level)) {
    return new Response("Invalid grade level", { status: 400 });
  }

  const record = await buildSf9Record(studentId, level);

  /*
   * 409 rather than a broken document, and the message says why - the button is hidden for a
   * learner with no eligible term, but the endpoint is reachable by URL, which is the same
   * reason the SF10 route guards the archive-only rule server-side rather than in the UI.
   */
  if (!record) {
    return new Response(
      "This learner has no Junior High term graded over three periods, which is what this " +
        "report card is drawn for. Nothing to print.",
      { status: 409 },
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = fillSf9(appPath("templates", "SF9-JHS.docx"), record);
  } catch (err) {
    // A missing paragraph means the template has changed under the map. Surface it rather than
    // handing over a card with fields silently blank.
    const message = err instanceof Error ? err.message : String(err);
    return new Response(`Could not generate the report card: ${message}`, { status: 500 });
  }

  const filename = safeFilename(
    `SF9_${student.last_name}_${student.first_name}_Grade${record.learner.grade}.docx`,
  );

  /*
   * A side effect on a GET, deliberately.
   *
   * The print control is a plain download link, so making this a POST would mean fetching a
   * blob and synthesising a download - more machinery on the one path that has to work. The
   * effect is not hidden: the filed card appears in the learner's Documents.
   */
  if (await fileGeneratedCard(studentId, filename, bytes)) {
    revalidatePath(`/students/${studentId}`);
  }

  return new Response(bytes as unknown as BodyInit, {
    headers: {
      "Content-Type": DOCX_MIME,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "no-store",
    },
  });
}

