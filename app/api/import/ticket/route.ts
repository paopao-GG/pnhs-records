/**
 * Issues a short-lived credential for the browser to upload one file straight to object storage.
 *
 * ## Why the browser uploads directly
 *
 * A Vercel function caps request bodies at 4.5 MB. At the measured ~220 KB per SF10 that tops a
 * single request out at roughly twenty files, and the school's archive is over a thousand.
 * Sending the bytes past the server entirely removes the cap from the problem.
 *
 * ## Why this endpoint is the one to be careful with
 *
 * It mints write access to the bucket. Three things keep that narrow:
 *
 *  - **it requires a session** — it is not reachable signed out;
 *  - **each URL is scoped to exactly one key**, and the key is a random one generated here, in
 *    a namespace separate from the archive, so it cannot address an object that already exists;
 *  - **it expires in five minutes.**
 *
 * The caller states nothing but the file extension. It used to state the SHA-256 as well, which
 * became the key — and R2 overwrites on PUT, so a signed-in caller could name an existing
 * archived original and replace it. The importer recomputing the hash protected the database
 * row and not the object. Now the client has no say in where its bytes land.
 */

import { requireUserForApi } from "@/lib/auth/current-user.ts";
import { isRemoteStore, presignUpload } from "@/lib/blob/store.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Colocated with the database; see the sf10 route for why.
export const preferredRegion = "sin1";

const ALLOWED_EXTENSIONS = [".xlsx", ".docx"];

export async function POST(request: Request) {
  const auth = await requireUserForApi();
  if (auth.response) return auth.response;

  if (!isRemoteStore()) {
    // Development against the disk fallback: the browser posts the file to /upload instead.
    return Response.json(
      { error: "No object store is configured; upload through the server instead." },
      { status: 409 },
    );
  }

  let body: { ext?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }

  const ext = String(body.ext ?? "").toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return Response.json(
      { error: `Only ${ALLOWED_EXTENSIONS.join(" and ")} files can be imported.` },
      { status: 400 },
    );
  }

  const ticket = await presignUpload(ext);
  return Response.json(ticket, { headers: { "Cache-Control": "no-store" } });
}
