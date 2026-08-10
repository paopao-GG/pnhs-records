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
 *  - **each URL is scoped to exactly one key**, derived from the caller's stated content hash,
 *    so it cannot be replayed against a different object;
 *  - **it expires in five minutes.**
 *
 * The client sends the SHA-256 it computed, which decides the key. A dishonest hash only lets a
 * caller write to a key nobody will look for: the importer recomputes the hash from the bytes it
 * actually reads, and stores the record under that. There is nothing to gain by lying.
 */

import { requireUserForApi } from "@/lib/auth/current-user.ts";
import { isRemoteStore, presignUpload } from "@/lib/blob/store.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SHA256 = /^[0-9a-f]{64}$/;
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

  let body: { sha256?: unknown; ext?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Expected JSON." }, { status: 400 });
  }

  const sha256 = String(body.sha256 ?? "").toLowerCase();
  const ext = String(body.ext ?? "").toLowerCase();

  if (!SHA256.test(sha256)) {
    return Response.json({ error: "sha256 must be 64 hex characters." }, { status: 400 });
  }
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return Response.json(
      { error: `Only ${ALLOWED_EXTENSIONS.join(" and ")} files can be imported.` },
      { status: 400 },
    );
  }

  const ticket = await presignUpload(sha256, ext);
  return Response.json(ticket, { headers: { "Cache-Control": "no-store" } });
}
