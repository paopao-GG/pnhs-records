"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "@/lib/auth/current-user.ts";
import { verifyPassword } from "@/lib/auth/password.ts";
import {
  checkLockout,
  clearAttempts,
  clientIp,
  pruneOldAttempts,
  recordFailedAttempt,
} from "@/lib/auth/rate-limit.ts";
import {
  createSession,
  findUserForLogin,
  pruneExpiredSessions,
  revokeSession,
} from "@/lib/db/users.ts";

/** Deliberately identical for every failure. See below. */
const REJECTED = "That username or password is incorrect.";

export interface LoginState {
  error: string | null;
}

export async function signIn(_prev: LoginState, form: FormData): Promise<LoginState> {
  const username = String(form.get("username") ?? "").trim();
  const password = String(form.get("password") ?? "");

  if (!username || !password) return { error: "Enter your username and password." };

  const ip = clientIp(await headers());

  const lockout = await checkLockout(username, ip);
  if (lockout.locked) {
    return {
      error: `Too many failed sign-in attempts. Try again in ${lockout.retryAfterMinutes} minute${
        lockout.retryAfterMinutes === 1 ? "" : "s"
      }.`,
    };
  }

  const user = await findUserForLogin(username);

  /*
   * One message for every failure: no such user, wrong password, deactivated account.
   *
   * Distinguishing them turns the form into a directory of who works at the school, and tells
   * an attacker which usernames are worth spending guesses on.
   *
   * The password is verified even when the user does not exist, against a dummy hash, so the
   * response takes the same time either way. Without that, "fast rejection" means "no such
   * user" to anyone with a stopwatch.
   */
  const hash = user?.password_hash ?? DUMMY_HASH;
  const passwordOk = await verifyPassword(password, hash);

  if (!user || !passwordOk || !user.active) {
    await recordFailedAttempt(username, ip);
    return { error: REJECTED };
  }

  await clearAttempts(username);

  /*
   * Housekeeping, not awaited - the user should not wait on it to sign in.
   *
   * The `.catch()` is not decoration. An unhandled rejection terminates the Node process by
   * default, so without it one transient database error during a background DELETE takes down
   * the request that had already authenticated successfully.
   */
  void Promise.all([pruneOldAttempts(), pruneExpiredSessions()]).catch(() => {});

  const { token, expires } = await createSession(user.id);
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });

  redirect("/");
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  await revokeSession(jar.get(SESSION_COOKIE)?.value);
  jar.delete(SESSION_COOKIE);
  redirect("/login");
}

/**
 * A real scrypt hash of a value nobody knows, used only to spend the same time verifying a
 * password for a username that does not exist. Generated once with the current parameters.
 */
const DUMMY_HASH =
  "scrypt$16384$8$1$855638b7d0938fc25921d430238c1bb7$" +
  "9be45a184f8feb6801fa8230a1da6c9e2ad7e3c9f40e2c022aff6b4b7c670742" +
  "d8a401ecb952c17bf4864fbd19179814dc4c0b26f2695af3dcf8978a050a790d";
