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

export const MIN_PASSWORD_LENGTH = 12;

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
 * Reject passwords that would make the accounts pointless.
 *
 * Length over character classes: a 12-character passphrase beats `P@ssw0rd!` and people can
 * actually remember it. The banned list exists because, left alone, a school system's password
 * becomes the school's name.
 */
const BANNED = [
  "password",
  "pantao",
  "pnhs",
  "301860",
  "national high school",
  "12345678",
  "qwerty",
];

/**
 * Role names, refused only as whole words.
 *
 * These were in the list above, matched as substrings, which refused any passphrase containing
 * them inside a longer word - "the administrator sang badly" is a perfectly good password and
 * was rejected. A rule that turns down good passwords teaches people to pick worse ones.
 */
const BANNED_WORDS = /\b(admin|adviser|registrar|teacher)\b/;

export function passwordProblem(password: string, username?: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters. A short phrase you can remember is fine.`;
  }
  if (password.length > 200) {
    return "That password is unreasonably long.";
  }

  const lower = password.toLowerCase();
  if (username && lower.includes(username.toLowerCase())) {
    return "The password must not contain the username.";
  }
  for (const bad of BANNED) {
    if (lower.includes(bad)) {
      return `The password must not contain "${bad}".`;
    }
  }
  const word = BANNED_WORDS.exec(lower);
  if (word) {
    return `The password must not contain the word "${word[1]}".`;
  }
  // A single repeated character clears the length rule but nothing else.
  if (new Set(password).size < 5) {
    return "The password needs more variety than that.";
  }
  return null;
}
