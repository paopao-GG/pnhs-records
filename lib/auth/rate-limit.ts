/**
 * Sign-in lockout.
 *
 * Without this, a login form on a public URL is a password oracle you can hammer at whatever
 * rate the network allows. `scrypt` makes each guess expensive, which slows an attacker down
 * but also means an unthrottled attack is a denial-of-service against the server as well.
 *
 * **State lives in the database, not in memory.** On a serverless host each request may be a
 * different instance, so a module-level counter counts a fraction of the attempts and limits
 * nothing. This is the single most common way rate limiting is deployed broken.
 */

import { getDb } from "../db/index.ts";

/** Five wrong guesses buys a fifteen-minute pause. */
export const MAX_ATTEMPTS = 5;
export const WINDOW_MINUTES = 15;

/**
 * Attempts are counted per username *and* per address, and the address budget is deliberately
 * looser. Counting only by username lets anyone lock the registrar out of their own system by
 * failing five times on purpose; counting only by address lets one attacker work through every
 * username from a single machine.
 */
const IP_MULTIPLIER = 4;

export interface LockoutState {
  locked: boolean;
  /** Whole minutes remaining, for the message shown to the user. */
  retryAfterMinutes: number;
}

export async function checkLockout(username: string, ip: string | null): Promise<LockoutState> {
  const db = await getDb();
  const since = `-${WINDOW_MINUTES} minutes`;

  const result = await db.execute({
    sql: `SELECT
            (SELECT COUNT(*) FROM login_attempts
              WHERE username = ? AND at > datetime('now', ?))              AS by_user,
            (SELECT COUNT(*) FROM login_attempts
              WHERE ip IS NOT NULL AND ip = ? AND at > datetime('now', ?)) AS by_ip,
            (SELECT MAX(at) FROM login_attempts
              WHERE username = ? OR (ip IS NOT NULL AND ip = ?))           AS last_at`,
    args: [username.trim(), since, ip, since, username.trim(), ip],
  });

  const row = result.rows[0];
  const byUser = Number(row.by_user);
  const byIp = Number(row.by_ip);
  const locked = byUser >= MAX_ATTEMPTS || byIp >= MAX_ATTEMPTS * IP_MULTIPLIER;
  if (!locked) return { locked: false, retryAfterMinutes: 0 };

  // The window runs from the most recent attempt, so continuing to guess extends the lockout.
  const lastAt = row.last_at ? Date.parse(`${String(row.last_at).replace(" ", "T")}Z`) : Date.now();
  const elapsedMinutes = (Date.now() - lastAt) / 60_000;
  const remaining = Math.max(1, Math.ceil(WINDOW_MINUTES - elapsedMinutes));

  return { locked: true, retryAfterMinutes: remaining };
}

export async function recordFailedAttempt(username: string, ip: string | null): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO login_attempts (username, ip) VALUES (?, ?)`,
    args: [username.trim(), ip],
  });
}

/** A correct password clears that username's failures, so a typo does not haunt the next login. */
export async function clearAttempts(username: string): Promise<void> {
  const db = await getDb();
  await db.execute({
    sql: `DELETE FROM login_attempts WHERE username = ?`,
    args: [username.trim()],
  });
}

/** Housekeeping, so the table does not grow without bound. */
export async function pruneOldAttempts(): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM login_attempts WHERE at <= datetime('now', '-1 day')`);
}

/**
 * Best-effort client address.
 *
 * Behind Vercel the useful value is the first entry of `x-forwarded-for`. This is spoofable in
 * general, which is why the per-username limit is the real protection and the per-address one
 * is only a broader net.
 */
export function clientIp(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim() || null;
  return headers.get("x-real-ip");
}
