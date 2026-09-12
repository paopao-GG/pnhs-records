/**
 * Password hashing.
 *
 * `scrypt` from `node:crypto` - no new dependency, consistent with the rest of this project,
 * and a memory-hard function rather than a plain digest. A password store is the one place
 * where being slow on purpose is the whole point.
 *
 * Stored form:
 *
 *     scrypt$16384$8$1$<salt hex>$<derived key hex>
 *
 * The parameters travel with the hash so they can be raised later without invalidating
 * everyone's password: `verify()` reads them from the stored string rather than assuming
 * today's values.
 */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { MIN_PASSWORD_LENGTH } from "./policy.ts";

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/** Current cost. N=16384 needs 128 * N * r = 16 MB, so maxmem is set above that. */
const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 64;
const MAXMEM = 64 * 1024 * 1024;

/*
 * Re-exported so server-side callers have one place to import from. The value itself lives in
 * policy.ts, which has no imports, because the client needs it and must not reach this module.
 */
export { MIN_PASSWORD_LENGTH };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return `scrypt$${N}$${R}$${P}$${salt.toString("hex")}$${key.toString("hex")}`;
}

/**
 * Check a password against a stored hash.
 *
 * Returns false rather than throwing on a malformed stored value: a corrupt row must fail the
 * sign-in, not crash the login route into a 500 that leaks which usernames exist.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltHex, keyHex] = parts;
  const options = { N: Number(n), r: Number(r), p: Number(p), maxmem: MAXMEM };
  if (!Number.isFinite(options.N) || !Number.isFinite(options.r) || !Number.isFinite(options.p)) {
    return false;
  }

  let expected: Buffer;
  try {
    expected = Buffer.from(keyHex, "hex");
    if (expected.length === 0) return false;
  } catch {
    return false;
  }

  let actual: Buffer;
  try {
    actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length, options);
  } catch {
    return false;
  }

  // Constant-time: a length check first, because timingSafeEqual throws on a length mismatch.
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/**
 * Reject passwords that would make the lock pointless.
 *
 * Eight characters, with a letter, a capital and a number among them. The reasoning behind
 * that shape - and what it gave up - is in [policy.ts](./policy.ts), next to the number
 * itself.
 *
 * **There is no banned-word list.** There was: `pnhs`, `pantao`, the school ID, and the role
 * names. The school asked for its own vocabulary back, so `Pnhs2026` is now a valid password.
 *
 * Each rule returns its own message. One generic "invalid password" would leave the registrar
 * guessing which of four things was wrong, on the one screen where being stuck has no way out
 * - nobody can reset this for them.
 */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.length > 200) {
    return "That password is unreasonably long.";
  }
  if (!/[a-zA-Z]/.test(password)) {
    return "Include at least one letter.";
  }
  if (!/[A-Z]/.test(password)) {
    return "Include at least one capital letter.";
  }
  if (!/[0-9]/.test(password)) {
    return "Include at least one number.";
  }
  // A single repeated character clears every rule above it: `Aaaa1111` has all three classes.
  if (new Set(password).size < 5) {
    return "The password needs more variety than that.";
  }
  return null;
}
