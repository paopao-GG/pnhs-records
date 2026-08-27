/**
 * Whether this request may see learner data.
 *
 * **This is the guard, and every page, server action and route handler calls it for itself.**
 *
 * That discipline came from the hosted deployment, where `middleware.ts` could not verify a
 * session even in principle - it runs on the Edge runtime, which has no `node:crypto` - and
 * where Next has shipped more than one middleware auth-bypass advisory. The middleware is now
 * deleted along with the rest of the hosted shape, so there is no ambient protection left at
 * all, and the rule matters more rather than less:
 *
 * **If it reads or writes learner data, it starts with `requireUnlocked()`.**
 *
 * It is tempting to think a local app does not need this. It does. The app is an HTTP server
 * listening on loopback, and every process running as this user can send it a request.
 */

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isPasswordSet, isUnlocked, UNLOCK_COOKIE } from "./unlock.ts";

export { UNLOCK_COOKIE };

/**
 * Three states, not two.
 *
 * `"unset"` is a fresh installation that has never had a password chosen. It is separate from
 * `"locked"` because the unlock screen has to offer to *set* one rather than ask for one, and
 * because treating it as locked would make a new install permanently unopenable.
 */
export type UnlockState = "unlocked" | "locked" | "unset";

/**
 * Wrapped in React's `cache()` so the layout and the page it renders resolve this once between
 * them. The cache is per-request: it cannot leak one request's state into another.
 */
export const getUnlockState = cache(async (): Promise<UnlockState> => {
  const jar = await cookies();
  if (isUnlocked(jar.get(UNLOCK_COOKIE)?.value)) return "unlocked";
  return (await isPasswordSet()) ? "locked" : "unset";
});

/**
 * Require an unlocked app, or send the visitor to the unlock screen.
 *
 * For pages and server actions. `redirect()` throws, so nothing after this line runs.
 */
export async function requireUnlocked(): Promise<void> {
  if ((await getUnlockState()) !== "unlocked") redirect("/unlock");
}

/**
 * The route-handler form: answer with 401, never a redirect.
 *
 * A client following a redirect to the unlock page would receive HTTP 200 and an HTML form
 * where it expected a workbook - which reads as success to anything not looking closely.
 */
export async function requireUnlockedForApi(): Promise<{ response?: Response }> {
  if ((await getUnlockState()) !== "unlocked") {
    return {
      response: new Response("The app is locked. Enter the password to continue.", {
        status: 401,
        headers: { "Cache-Control": "no-store" },
      }),
    };
  }
  return {};
}
