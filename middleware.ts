/**
 * Sends a visitor with no session cookie to the sign-in page.
 *
 * **This is not the security boundary.** It runs on the Edge runtime, where `node:crypto` is
 * unavailable, so it cannot verify the cookie - only notice whether one exists. A forged or
 * expired cookie sails straight through here and is rejected by `requireUser()` in the page,
 * action or route handler, which is where the actual check lives.
 *
 * Its only job is to save a signed-out visitor from a redirect chain on every link. Treating it
 * as protection is how Next.js applications have been walked past their own authentication.
 */

import { NextResponse, type NextRequest } from "next/server";
// Deliberately from cookie.ts, not current-user.ts: that module reaches the database, and
// nothing here can run on the Edge runtime. See lib/auth/cookie.ts.
import { SESSION_COOKIE } from "./lib/auth/cookie.ts";

/** Reachable without a session. Everything else needs one. */
const PUBLIC_PATHS = ["/login"];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  if (request.cookies.has(SESSION_COOKIE)) return NextResponse.next();

  // API routes answer for themselves - a redirect would hand a client an HTTP 200 sign-in page
  // where it expected a file, which reads as success.
  if (pathname.startsWith("/api/")) return NextResponse.next();

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  // Everything except Next's own assets and the favicon.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
