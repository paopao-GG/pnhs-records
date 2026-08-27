/**
 * The password that opens the app.
 *
 * Replaces test-auth.ts, which covered the two-role account system this app no longer has.
 * Most of what that file pinned is gone with the accounts — deactivated users, sessions
 * surviving a password change on other devices, one message for every kind of sign-in failure.
 * The properties that survive are the ones about the password itself, and they are here
 * unchanged, because scrypt hashing did not become less important for being used once.
 *
 * What is new is the shape of a session. There is no `sessions` table any more: the app is one
 * long-lived local process, so an open session is an entry in a Map that dies with the process.
 * The checks below are about the consequences of that — an idle session expiring, a password
 * change closing every open one, a token that was never issued being refused.
 *
 * Runs against a scratch database file, not the school's.
 *
 * Run: npm run test:unlock
 */

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashPassword, passwordProblem, verifyPassword } from "../lib/auth/password.ts";

/*
 * Point the shared connection at a scratch file BEFORE importing anything that touches it.
 *
 * `client.ts` resolves the database path once, at module load. These tests write the password
 * through the same `getDb()` the app uses, so without this they would overwrite the password
 * on the school's real database - the one thing they must never do. The dynamic imports below
 * are what make the ordering guaranteed rather than incidental.
 */
const scratchDir = mkdtempSync(join(tmpdir(), "pnhs-unlock-"));
process.env.PNHS_DB_PATH = join(scratchDir, "unlock-test.db");
process.env.PNHS_DATA_DIR = scratchDir;

const { applySchema } = await import("../lib/db/index.ts");
const { getClient, LOCAL_DB_PATH } = await import("../lib/db/client.ts");
const unlock = await import("../lib/auth/unlock.ts");

if (!LOCAL_DB_PATH.startsWith(scratchDir)) {
  console.error(`\n  refusing to run: the database is ${LOCAL_DB_PATH}, not a scratch file\n`);
  process.exit(1);
}

const db = getClient();
await applySchema(db);

let passed = 0;
const checks: { name: string; fn: () => Promise<void> }[] = [];
const check = (name: string, fn: () => Promise<void>) => checks.push({ name, fn });

const PASSWORD = "correct horse battery staple";
const OTHER = "a different phrase entirely";

/** Wipe the password, every session and the failure count, so each check starts level. */
async function reset(): Promise<void> {
  unlock.lockAll();
  internals().failures.length = 0;
  await db.execute(`DELETE FROM school_settings WHERE key LIKE 'app_password%'`);
}

/**
 * The module's own state.
 *
 * Reached directly so that expiry and lockout can be tested by moving time rather than by
 * waiting thirty minutes for it. A test nobody runs pins nothing.
 */
function internals(): { sessions: Map<string, { lastSeen: number }>; failures: number[] } {
  return (
    globalThis as {
      __pnhsUnlock?: { sessions: Map<string, { lastSeen: number }>; failures: number[] };
    }
  ).__pnhsUnlock!;
}

// ---------------------------------------------------------------- passwords

check("a correct password verifies and a wrong one does not", async () => {
  const hash = await hashPassword(PASSWORD);
  assert.equal(await verifyPassword(PASSWORD, hash), true);
  assert.equal(await verifyPassword(PASSWORD + "x", hash), false);
  assert.equal(await verifyPassword("", hash), false);
});

check("the same password hashes differently every time", async () => {
  // A per-password salt. It matters even with one password: without it the stored hash is a
  // plain scrypt of a phrase, which is exactly what a precomputed table is built against.
  const a = await hashPassword(PASSWORD);
  const b = await hashPassword(PASSWORD);
  assert.notEqual(a, b);
  assert.equal(await verifyPassword(PASSWORD, a), true);
  assert.equal(await verifyPassword(PASSWORD, b), true);
});

check("a malformed stored hash fails closed", async () => {
  // Must return false, never throw: a corrupt row has to fail the unlock, not 500 the page and
  // leave the app unopenable.
  for (const bad of ["", "nonsense", "scrypt$1$2$3", "bcrypt$16384$8$1$aa$bb", "$$$$$"]) {
    assert.equal(await verifyPassword(PASSWORD, bad), false, `should reject: ${bad}`);
  }
});

check("the password policy refuses what would make it pointless", async () => {
  assert.ok(passwordProblem("short"), "a short password should be refused");
  assert.ok(passwordProblem("pantao national high school"), "the school's own name");
  assert.ok(passwordProblem("aaaaaaaaaaaaaaaa"), "one repeated character");
  assert.equal(passwordProblem(PASSWORD), null, "a real passphrase should be accepted");
});

// ---------------------------------------------------------------- first run

check("a fresh machine reports no password set", async () => {
  await reset();
  assert.equal(await unlock.isPasswordSet(), false);
});

check("setting a password makes it set, and it verifies", async () => {
  await reset();
  await unlock.setPassword(PASSWORD);
  assert.equal(await unlock.isPasswordSet(), true);
  assert.ok(await unlock.verifyAndOpen(PASSWORD), "the password just set should open the app");
});

check("no session can be opened before a password exists", async () => {
  // Otherwise a fresh install is an unlocked one, and the first-run screen is decoration.
  await reset();
  assert.equal(await unlock.verifyAndOpen(""), null);
  assert.equal(await unlock.verifyAndOpen(PASSWORD), null);
});

check("the change date is recorded", async () => {
  await reset();
  assert.equal(await unlock.passwordChangedAt(), null);
  await unlock.setPassword(PASSWORD);
  const at = await unlock.passwordChangedAt();
  assert.ok(at && !Number.isNaN(new Date(at).getTime()), `expected a date, got ${at}`);
});

// ---------------------------------------------------------------- sessions

check("a wrong password opens nothing", async () => {
  await reset();
  await unlock.setPassword(PASSWORD);
  assert.equal(await unlock.verifyAndOpen(OTHER), null);
  assert.equal(await unlock.verifyAndOpen(""), null);
});

check("an issued token unlocks and an invented one does not", async () => {
  await reset();
  await unlock.setPassword(PASSWORD);
  const token = await unlock.verifyAndOpen(PASSWORD);
  assert.ok(token);
  assert.equal(unlock.isUnlocked(token!), true);

  // The whole guard rests on this. A token is 32 random bytes and nothing else opens the app.
  assert.equal(unlock.isUnlocked("not-a-real-token"), false);
  assert.equal(unlock.isUnlocked(""), false);
  assert.equal(unlock.isUnlocked(undefined), false);
});

check("two unlocks issue different tokens", async () => {
  await reset();
  await unlock.setPassword(PASSWORD);
  const a = await unlock.verifyAndOpen(PASSWORD);
  const b = await unlock.verifyAndOpen(PASSWORD);
  assert.notEqual(a, b);
});

check("locking closes that session and leaves the others", async () => {
  await reset();
  await unlock.setPassword(PASSWORD);
  const a = (await unlock.verifyAndOpen(PASSWORD))!;
  const b = (await unlock.verifyAndOpen(PASSWORD))!;

  unlock.lock(a);
  assert.equal(unlock.isUnlocked(a), false);
  assert.equal(unlock.isUnlocked(b), true);
});

check("changing the password closes every open session", async () => {
  /*
   * The reason this matters: someone changes the password because they think another person
   * knows it. If the sessions that person already has stay open, the change did nothing about
   * the thing it was done for.
   */
  await reset();
  await unlock.setPassword(PASSWORD);
  const token = (await unlock.verifyAndOpen(PASSWORD))!;
  assert.equal(unlock.isUnlocked(token), true);

  await unlock.setPassword(OTHER);
  assert.equal(unlock.isUnlocked(token), false);
  assert.equal(await unlock.verifyAndOpen(PASSWORD), null, "the old password must stop working");
  assert.ok(await unlock.verifyAndOpen(OTHER), "the new password must work");
});

check("an idle session expires", async () => {
  await reset();
  await unlock.setPassword(PASSWORD);
  const token = (await unlock.verifyAndOpen(PASSWORD))!;

  const { sessions } = internals();
  sessions.get(token)!.lastSeen = Date.now() - unlock.IDLE_TIMEOUT_MS - 1000;

  assert.equal(unlock.isUnlocked(token), false);
  // And it is forgotten rather than merely reported closed, so the Map cannot grow forever.
  assert.equal(sessions.has(token), false);
});

check("using a session keeps it alive", async () => {
  await reset();
  await unlock.setPassword(PASSWORD);
  const token = (await unlock.verifyAndOpen(PASSWORD))!;

  const { sessions } = internals();
  // Old enough to be close to expiry, but not past it.
  sessions.get(token)!.lastSeen = Date.now() - unlock.IDLE_TIMEOUT_MS + 5000;

  assert.equal(unlock.isUnlocked(token), true);
  // The check itself should have refreshed it, so it is no longer near expiry.
  assert.ok(Date.now() - sessions.get(token)!.lastSeen < 1000);
});

// ---------------------------------------------------------------- lockout

check("five wrong attempts lock guessing out", async () => {
  /*
   * The counter lives in this process rather than in the database, which inverts the reason it
   * was in the database before: a serverless host may run several instances, so an in-memory
   * counter would see a fraction of the attempts. There is one process now, and it sees all of
   * them.
   */
  await reset();
  await unlock.setPassword(PASSWORD);
  assert.equal(unlock.lockoutMinutes(), 0);

  for (let i = 0; i < 5; i++) await unlock.verifyAndOpen(OTHER);

  assert.ok(unlock.lockoutMinutes() > 0, "should be locked out after five failures");
  // And the correct password is refused too, or the lockout is trivially bypassed by the
  // attacker eventually guessing right.
  assert.equal(await unlock.verifyAndOpen(PASSWORD), null);
});

check("a correct password clears the failure count", async () => {
  await reset();
  await unlock.setPassword(PASSWORD);

  for (let i = 0; i < 4; i++) await unlock.verifyAndOpen(OTHER);
  assert.equal(unlock.lockoutMinutes(), 0, "four failures is not yet a lockout");

  assert.ok(await unlock.verifyAndOpen(PASSWORD));

  // Without the reset, four failures today plus one tomorrow would lock out a legitimate user.
  for (let i = 0; i < 4; i++) await unlock.verifyAndOpen(OTHER);
  assert.equal(unlock.lockoutMinutes(), 0);
});

// ---------------------------------------------------------------- schema

check("the accounts tables are gone and users survives", async () => {
  /*
   * Migration 4 drops `sessions` and `login_attempts` and deliberately keeps `users`:
   * `record_history.user_id` names real people on every row written while accounts existed,
   * and dropping the table would leave that history pointing at nothing.
   *
   * On a scratch database `users` never existed - schema.sql no longer creates it - so what is
   * asserted here is the half that has to be true everywhere: the two transient tables are not
   * present after migrations run.
   */
  const names = await db.execute(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('sessions', 'login_attempts')`,
  );
  assert.equal(names.rows.length, 0, "sessions and login_attempts should not exist");

  const history = await db.execute(`SELECT name FROM pragma_table_info('record_history')`);
  const columns = history.rows.map((r) => String(r.name));
  assert.ok(columns.includes("user_id"), "record_history must keep its user_id column");
});

for (const { name, fn } of checks) {
  try {
    await fn();
    passed++;
  } catch (err) {
    console.log(`  FAIL  ${name}`);
    console.log(`        ${err instanceof Error ? err.message : err}`);
    process.exitCode = 1;
  }
}

db.close();
try {
  rmSync(scratchDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
} catch {
  /* Windows may still hold the file; the OS will clear it */
}

console.log(process.exitCode ? "\nunlock: FAILURES above\n" : `\nunlock: ${passed} checks passed\n`);
