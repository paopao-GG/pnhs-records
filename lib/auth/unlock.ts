/**
 * The password that opens the app.
 *
 * One password, no accounts. There is one person at this machine and the records on it are
 * the school's; the question this answers is "should whoever sat down be looking at this",
 * not "which of twelve staff is typing".
 *
 * ## What it protects, and what it does not
 *
 * It gates the interface. It does **not** encrypt the database: anyone who can read
 * `pnhs.db` off the disk has the records whatever this file does. That is a real reduction
 * from the hosted deployment, where the data sat behind a credential, and the proportionate
 * answer is disk encryption on the machine rather than a key derived here - a half-encrypted
 * store would read as protection without being any.
 *
 * What it does buy is worth having: the app is an HTTP server on loopback, so every other
 * process on this machine can reach it, and a shared office PC left unattended is the
 * realistic exposure. Both are covered by a lock.
 *
 * ## Sessions live in memory, not in a table
 *
 * The `sessions` table existed because a serverless deployment has no process to remember
 * anything in. This one is a single long-lived process whose lifetime is the app's, so a Map
 * is both simpler and better behaved: **closing the app re-locks it**, with no expiry sweep,
 * no pruning and no rows to leak. Migration 4 drops the table.
 *
 * Cached on `globalThis` for the same reason the database client is - Next reloads modules on
 * every edit in development, and a fresh Map per reload would sign the developer out mid-type.
 */

import { randomBytes } from "node:crypto";
import { getDb } from "../db/index.ts";
import { hashPassword, verifyPassword } from "./password.ts";

/** The unlock cookie. Session-scoped: no `expires`, so closing the browser drops it. */
export const UNLOCK_COOKIE = "pnhs_unlock";

/** `school_settings` keys. The table is a key/value store and already exists. */
const HASH_KEY = "app_password_hash";
const CHANGED_KEY = "app_password_changed_at";

/**
 * How long the app may sit untouched before it locks itself.
 *
 * Long enough to survive a lunch break interrupted by a phone call, short enough that a
 * machine left on at the end of the day is locked by the time the room is empty.
 */
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;

/** Five wrong guesses, then a quarter of an hour. */
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

interface UnlockSession {
  lastSeen: number;
}

interface UnlockState {
  sessions: Map<string, UnlockSession>;
  failures: number[];
}

declare global {
  // eslint-disable-next-line no-var
  var __pnhsUnlock: UnlockState | undefined;
}

function state(): UnlockState {
  globalThis.__pnhsUnlock ??= { sessions: new Map(), failures: [] };
  return globalThis.__pnhsUnlock;
}

/* -------------------------------------------------------------------------- the password -- */

async function storedHash(): Promise<string | null> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT value FROM school_settings WHERE key = ?`,
    args: [HASH_KEY],
  });
  const value = result.rows[0]?.value;
  return value == null ? null : String(value);
}

/**
 * Has a password been chosen yet?
 *
 * False exactly once per installation, on first launch, which is what makes the unlock screen
 * offer to set one instead of asking for one. This replaces the old `npm run create-admin`
 * bootstrap - a command-line step is not something to ask a registrar for.
 */
export async function isPasswordSet(): Promise<boolean> {
  return (await storedHash()) !== null;
}

/** Write the password. Used by first-run setup and by Settings. */
export async function setPassword(plain: string): Promise<void> {
  const db = await getDb();
  const hash = await hashPassword(plain);
  const tx = await db.transaction("write");
  try {
    for (const [key, value] of [
      [HASH_KEY, hash],
      [CHANGED_KEY, new Date().toISOString()],
    ]) {
      await tx.execute({
        sql: `INSERT INTO school_settings (key, value) VALUES (?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        args: [key, value],
      });
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }

  /*
   * Every open session dies with the old password.
   *
   * Changing a password because you think someone else knows it has to mean something, and a
   * session that outlives the change means it does not.
   */
  state().sessions.clear();

  /*
   * The failure counter goes too.
   *
   * Reaching this line means the caller proved they know the password - Settings verifies the
   * current one, and first-run setup only runs when there is none. Holding a lockout against
   * them afterwards would be counting guesses at a password that no longer exists, and would
   * lock the one person who is definitely entitled to be here out of their own records.
   */
  state().failures = [];
}

/** When the password was last changed, for the Settings page. Null if never. */
export async function passwordChangedAt(): Promise<string | null> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT value FROM school_settings WHERE key = ?`,
    args: [CHANGED_KEY],
  });
  const value = result.rows[0]?.value;
  return value == null ? null : String(value);
}

/* ------------------------------------------------------------------------------ lockout -- */

/** Minutes until guessing is allowed again, or 0 if it is allowed now. */
export function lockoutMinutes(): number {
  const now = Date.now();
  const recent = state().failures.filter((at) => now - at < LOCKOUT_MS);
  state().failures = recent;
  if (recent.length < MAX_ATTEMPTS) return 0;
  const oldest = Math.min(...recent);
  return Math.max(1, Math.ceil((LOCKOUT_MS - (now - oldest)) / 60_000));
}

/* ----------------------------------------------------------------------------- sessions -- */

/**
 * Check the password and open a session.
 *
 * Returns the token to put in the cookie, or null if the password was wrong or guessing is
 * currently locked out. The caller cannot tell those apart from the return value alone and
 * should call `lockoutMinutes()` to say which.
 */
export async function verifyAndOpen(plain: string): Promise<string | null> {
  if (lockoutMinutes() > 0) return null;

  const hash = await storedHash();
  if (hash === null) return null;

  if (!(await verifyPassword(plain, hash))) {
    state().failures.push(Date.now());
    return null;
  }

  state().failures = [];
  const token = randomBytes(32).toString("base64url");
  state().sessions.set(token, { lastSeen: Date.now() });
  return token;
}

/**
 * Is this token an open session? Touches it if so.
 *
 * A Map lookup, which is not constant-time — and deliberately not dressed up as one. Timing a
 * hash lookup to recover 32 random bytes is not a practical attack, and it would have to be
 * mounted by something already running as this user on this machine, which has the database
 * file itself available to it. Pretending otherwise would be security theatre in a comment.
 */
export function isUnlocked(token: string | undefined): boolean {
  if (!token) return false;

  const session = state().sessions.get(token);
  if (!session) return false;

  if (Date.now() - session.lastSeen > IDLE_TIMEOUT_MS) {
    state().sessions.delete(token);
    return false;
  }

  session.lastSeen = Date.now();
  return true;
}

/** Close one session. */
export function lock(token: string | undefined): void {
  if (token) state().sessions.delete(token);
}

/** Close every session. Exported for tests and for the password-change path. */
export function lockAll(): void {
  state().sessions.clear();
}
