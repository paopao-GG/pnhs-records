/**
 * Accounts and sessions.
 *
 * Kept apart from queries.ts because the rules here are different in kind: a mistake in a
 * learner query shows a wrong grade, a mistake here lets the wrong person read every record in
 * the school.
 *
 * Two rules the rest of the code depends on:
 *
 *  1. **A session is only valid while its user is still active.** `findSessionUser()` checks
 *     that on every request, so deactivating an adviser takes effect immediately rather than
 *     whenever their cookie happens to expire.
 *  2. **Changing a password or deactivating an account revokes that user's sessions**, in the
 *     same transaction as the change. Otherwise the cookie issued before the change keeps
 *     working, which is the whole thing those actions were trying to stop.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getDb } from "./index.ts";
import type { Row } from "@libsql/client";
import { hashPassword } from "../auth/password.ts";

function plain<T>(row: Row): T {
  return { ...(row as unknown as object) } as T;
}

export type Role = "admin" | "adviser";

export interface UserRow {
  id: number;
  username: string;
  full_name: string;
  role: Role;
  active: number;
  created_at: string;
  password_changed_at: string;
}

/** Only the loader that checks a password ever sees this. Never hand it to a component. */
interface UserWithHash extends UserRow {
  password_hash: string;
}

const PUBLIC_COLUMNS = `id, username, full_name, role, active, created_at, password_changed_at`;

/** How long a sign-in lasts. A school day plus slack; short enough that a shared PC forgets. */
export const SESSION_HOURS = 12;

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export async function findUserForLogin(username: string): Promise<UserWithHash | null> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT ${PUBLIC_COLUMNS}, password_hash FROM users WHERE username = ?`,
    args: [username.trim()],
  });
  return result.rows[0] ? plain<UserWithHash>(result.rows[0]) : null;
}

export async function getUser(id: number): Promise<UserRow | null> {
  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`,
    args: [id],
  });
  return result.rows[0] ? plain<UserRow>(result.rows[0]) : null;
}

export async function listUsers(): Promise<UserRow[]> {
  const db = await getDb();
  const result = await db.execute(
    `SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY active DESC, role, username`,
  );
  return result.rows.map((r) => plain<UserRow>(r));
}

export async function countActiveAdmins(): Promise<number> {
  const db = await getDb();
  const result = await db.execute(`SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1`);
  return Number(result.rows[0].n);
}

export async function createUser(fields: {
  username: string;
  fullName: string;
  password: string;
  role: Role;
}): Promise<number> {
  const db = await getDb();
  const result = await db.execute({
    sql: `INSERT INTO users (username, full_name, password_hash, role)
          VALUES (?, ?, ?, ?)
          RETURNING id`,
    args: [
      fields.username.trim(),
      fields.fullName.trim(),
      await hashPassword(fields.password),
      fields.role,
    ],
  });
  return Number(result.rows[0].id);
}

/**
 * Set a new password and sign that user out everywhere.
 *
 * `keepSessionId` lets someone changing their own password stay signed in on the device they
 * are using, while every other session dies. Omit it and all sessions go - which is what an
 * admin resetting somebody else's password wants.
 */
export async function setPassword(
  userId: number,
  password: string,
  keepSessionId?: number,
): Promise<void> {
  const hash = await hashPassword(password);
  const db = await getDb();
  const tx = await db.transaction("write");
  try {
    await tx.execute({
      sql: `UPDATE users SET password_hash = ?, password_changed_at = datetime('now') WHERE id = ?`,
      args: [hash, userId],
    });
    await tx.execute({
      sql: `DELETE FROM sessions WHERE user_id = ? AND id IS NOT ?`,
      args: [userId, keepSessionId ?? null],
    });
    await tx.commit();
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

/** Deactivating also revokes the account's live sessions, in the same transaction. */
export async function setUserActive(userId: number, active: boolean): Promise<void> {
  const db = await getDb();
  const tx = await db.transaction("write");
  try {
    await tx.execute({
      sql: `UPDATE users SET active = ? WHERE id = ?`,
      args: [active ? 1 : 0, userId],
    });
    if (!active) {
      await tx.execute({ sql: `DELETE FROM sessions WHERE user_id = ?`, args: [userId] });
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/**
 * The cookie value is 32 random bytes; only its SHA-256 is stored.
 *
 * A plain digest is right here and would be wrong for passwords: the input is already 256 bits
 * of entropy, so there is nothing to brute-force and nothing to gain from a slow hash. What it
 * does buy is that a leaked database dump contains no usable session tokens.
 */
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export interface SessionUser extends UserRow {
  session_id: number;
}

export async function createSession(userId: number): Promise<{ token: string; expires: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_HOURS * 3600_000);

  const db = await getDb();
  await db.execute({
    sql: `INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)`,
    args: [hashToken(token), userId, expires.toISOString()],
  });

  return { token, expires };
}

/**
 * Resolve a cookie value to the acting user, or null.
 *
 * Expiry is compared in SQL against `datetime('now')`, both stored as UTC ISO strings, so a
 * client clock cannot extend a session.
 */
export async function findSessionUser(token: string | undefined): Promise<SessionUser | null> {
  if (!token) return null;

  const db = await getDb();
  const result = await db.execute({
    sql: `SELECT s.id AS session_id, ${PUBLIC_COLUMNS.split(", ").map((c) => `u.${c}`).join(", ")}
            FROM sessions s
            JOIN users u ON u.id = s.user_id
           WHERE s.token_hash = ?
             AND s.expires_at > datetime('now')
             AND u.active = 1`,
    args: [hashToken(token)],
  });

  return result.rows[0] ? plain<SessionUser>(result.rows[0]) : null;
}

export async function revokeSession(token: string | undefined): Promise<void> {
  if (!token) return;
  const db = await getDb();
  await db.execute({ sql: `DELETE FROM sessions WHERE token_hash = ?`, args: [hashToken(token)] });
}

/** Housekeeping. Cheap, and sessions are not records worth keeping. */
export async function pruneExpiredSessions(): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM sessions WHERE expires_at <= datetime('now')`);
}

/**
 * Compare two secrets without leaking their difference through timing.
 *
 * Exported because the create-admin script compares a confirmation, and hand-rolling this a
 * second time is how it gets hand-rolled wrongly.
 */
export function secretsMatch(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
