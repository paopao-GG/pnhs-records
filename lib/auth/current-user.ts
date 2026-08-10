/**
 * Who is acting, and whether they are allowed to.
 *
 * **This is the guard. `middleware.ts` is not.**
 *
 * Next middleware runs on the Edge runtime, which has no `node:crypto`, so it cannot verify
 * anything here; and Next has shipped more than one middleware auth-bypass advisory, because a
 * check that lives in front of a route can be routed around. So middleware only redirects a
 * visitor with no cookie to the sign-in page, as a convenience, and every page, server action
 * and route handler calls `requireUser()` itself.
 *
 * The rule for anything added later: **if it reads or writes learner data, it starts with
 * `requireUser()`.** There is no ambient protection to rely on.
 */

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { findSessionUser, type SessionUser } from "../db/users.ts";
import { SESSION_COOKIE } from "./cookie.ts";

export { SESSION_COOKIE };

/**
 * The signed-in user, or null. Use this only where being signed out is a valid state.
 *
 * Wrapped in React's `cache()`, so the layout and the page it renders resolve the session once
 * between them rather than twice. That was free when the database was a local file and is a
 * second network round trip on every page once it is not. The cache is per-request: it cannot
 * leak one visitor's identity into another's render.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const jar = await cookies();
  return findSessionUser(jar.get(SESSION_COOKIE)?.value);
});

/**
 * Require a signed-in user, or redirect to sign-in.
 *
 * For pages and server actions. `redirect()` throws, so nothing after this line runs for a
 * visitor who is not signed in.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Require an admin. An adviser who reaches an admin page is sent to the search page. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "admin") redirect("/?denied=1");
  return user;
}

/**
 * The route-handler form: answer with 401, never a redirect.
 *
 * An API client following a redirect to the sign-in page would receive HTTP 200 and a login
 * form where it expected a workbook - which reads as success to anything not looking closely.
 * Returns the user, or the Response to send back.
 */
export async function requireUserForApi(): Promise<
  { user: SessionUser; response?: never } | { user?: never; response: Response }
> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      response: new Response("Sign in to access learner records.", {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      }),
    };
  }
  return { user };
}
