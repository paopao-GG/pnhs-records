"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { passwordProblem } from "@/lib/auth/password.ts";
import {
  isPasswordSet,
  lock,
  lockoutMinutes,
  setPassword,
  UNLOCK_COOKIE,
  verifyAndOpen,
} from "@/lib/auth/unlock.ts";

export interface UnlockFormState {
  error: string | null;
}

/**
 * The cookie.
 *
 * No `expires`, so it is a session cookie and dies with the window. `secure` is omitted
 * deliberately: the app is served over plain HTTP on 127.0.0.1, where there is no transport
 * to secure and where setting the flag would stop the cookie being stored at all.
 */
function openSession(jar: Awaited<ReturnType<typeof cookies>>, token: string): void {
  jar.set(UNLOCK_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
}

/** Enter the password. */
export async function unlock(_prev: UnlockFormState, form: FormData): Promise<UnlockFormState> {
  const password = String(form.get("password") ?? "");
  if (!password) return { error: "Enter the password." };

  const locked = lockoutMinutes();
  if (locked > 0) {
    return {
      error: `Too many wrong attempts. Try again in ${locked} minute${locked === 1 ? "" : "s"}.`,
    };
  }

  const token = await verifyAndOpen(password);
  if (!token) {
    // One message whether the password was wrong or the attempt tipped into a lockout: the
    // second is visible on the next try, and saying it now only helps someone counting.
    const after = lockoutMinutes();
    return {
      error:
        after > 0
          ? `Too many wrong attempts. Try again in ${after} minute${after === 1 ? "" : "s"}.`
          : "That password is incorrect.",
    };
  }

  openSession(await cookies(), token);
  redirect("/");
}

/**
 * Choose the password, on a machine that has never had one.
 *
 * Refuses if one is already set, because this action needs no current password and would
 * otherwise be a reset anyone could reach by posting to it. Changing an existing password
 * lives in Settings and asks for the old one.
 */
export async function choosePassword(
  _prev: UnlockFormState,
  form: FormData,
): Promise<UnlockFormState> {
  if (await isPasswordSet()) return { error: "A password is already set for this machine." };

  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirm") ?? "");

  if (password !== confirm) return { error: "The two passwords do not match." };

  const problem = passwordProblem(password);
  if (problem) return { error: problem };

  await setPassword(password);

  const token = await verifyAndOpen(password);
  if (!token) return { error: "The password was saved but could not be verified. Try unlocking." };

  openSession(await cookies(), token);
  redirect("/");
}

/** Lock the app. */
export async function lockApp(): Promise<void> {
  const jar = await cookies();
  lock(jar.get(UNLOCK_COOKIE)?.value);
  jar.delete(UNLOCK_COOKIE);
  redirect("/unlock");
}
