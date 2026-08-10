/**
 * Accounts, sessions and lockout.
 *
 * These pin the properties that are easy to get subtly wrong and impossible to notice in a
 * browser: that a deactivated account's live cookie stops working, that changing a password
 * really does sign out the other devices, and that lockout counts attempts somewhere that
 * survives more than one server instance.
 *
 * Runs against a scratch database file, not the school's.
 *
 * Run: npm run test:auth
 */

import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hashPassword, passwordProblem, verifyPassword } from "../lib/auth/password.ts";

/*
 * Point the shared connection at a scratch file BEFORE importing anything that touches it.
 *
 * `client.ts` resolves the database path once, at module load. These tests create users and
 * sessions through the same `getDb()` the app uses, so without this they would write into the
 * school's real records - the one thing they must never do. The dynamic imports below are what
 * make the ordering guaranteed rather than incidental.
 */
const scratchDir = mkdtempSync(join(tmpdir(), "pnhs-auth-"));
process.env.PNHS_DB_PATH = join(scratchDir, "auth-test.db");
delete process.env.TURSO_DATABASE_URL;

const { applySchema } = await import("../lib/db/index.ts");
const { getClient, LOCAL_DB_PATH } = await import("../lib/db/client.ts");
const users = await import("../lib/db/users.ts");
const rateLimit = await import("../lib/auth/rate-limit.ts");

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

// ---------------------------------------------------------------- passwords

check("a correct password verifies and a wrong one does not", async () => {
  const hash = await hashPassword(PASSWORD);
  assert.equal(await verifyPassword(PASSWORD, hash), true);
  assert.equal(await verifyPassword(PASSWORD + "x", hash), false);
  assert.equal(await verifyPassword("", hash), false);
});

check("the same password hashes differently every time", async () => {
  // A per-password salt. Without it, two people who chose the same password are visibly
  // identical in the table, and one cracked hash breaks both.
  const a = await hashPassword(PASSWORD);
  const b = await hashPassword(PASSWORD);
  assert.notEqual(a, b);
  assert.equal(await verifyPassword(PASSWORD, a), true);
  assert.equal(await verifyPassword(PASSWORD, b), true);
});

check("a malformed stored hash fails closed", async () => {
  // Must return false, never throw: a corrupt row has to fail the sign-in, not 500 the route.
  for (const bad of ["", "nonsense", "scrypt$1$2$3", "bcrypt$16384$8$1$aa$bb", "$$$$$"]) {
    assert.equal(await verifyPassword(PASSWORD, bad), false, `should reject: ${bad}`);
  }
});

check("the password policy rejects what it should", async () => {
  assert.ok(passwordProblem("short"), "too short");
  assert.ok(passwordProblem("aaaaaaaaaaaaaaaa"), "no variety");
  assert.ok(passwordProblem("pantao national high school"), "contains the school name");
  assert.ok(passwordProblem("registrar12345678", "registrar"), "contains the username");
  assert.equal(passwordProblem(PASSWORD, "registrar"), null, "a passphrase is fine");
});

// ----------------------------------------------------------------- sessions

check("a session resolves to its user, and a bogus token does not", async () => {
  const id = await users.createUser({
    username: "adviser1",
    fullName: "Adviser One",
    password: PASSWORD,
    role: "adviser",
  });
  const { token } = await users.createSession(id);

  const found = await users.findSessionUser(token);
  assert.equal(found?.id, id);
  assert.equal(found?.role, "adviser");

  assert.equal(await users.findSessionUser("not-a-real-token"), null);
  assert.equal(await users.findSessionUser(undefined), null);
});

check("an expired session does not resolve", async () => {
  const id = await users.createUser({
    username: "expired",
    fullName: "Expired",
    password: PASSWORD,
    role: "adviser",
  });
  const { token } = await users.createSession(id);
  assert.ok(await users.findSessionUser(token));

  // Expiry is compared in SQL against datetime('now'), so pushing the row into the past is the
  // same thing the clock would do.
  await db.execute({
    sql: `UPDATE sessions SET expires_at = datetime('now', '-1 hour') WHERE user_id = ?`,
    args: [id],
  });
  assert.equal(await users.findSessionUser(token), null);
});

check("signing out revokes only that session", async () => {
  const id = await users.createUser({
    username: "twodevices",
    fullName: "Two Devices",
    password: PASSWORD,
    role: "adviser",
  });
  const laptop = await users.createSession(id);
  const phone = await users.createSession(id);

  await users.revokeSession(laptop.token);
  assert.equal(await users.findSessionUser(laptop.token), null, "signed-out device");
  assert.ok(await users.findSessionUser(phone.token), "the other device stays signed in");
});

check("changing a password signs out the other devices", async () => {
  const id = await users.createUser({
    username: "changer",
    fullName: "Changer",
    password: PASSWORD,
    role: "adviser",
  });
  const here = await users.createSession(id);
  const elsewhere = await users.createSession(id);
  const hereId = (await users.findSessionUser(here.token))!.session_id;

  await users.setPassword(id, "a completely different phrase", hereId);

  assert.ok(await users.findSessionUser(here.token), "the device making the change stays in");
  assert.equal(await users.findSessionUser(elsewhere.token), null, "other devices are signed out");

  const reloaded = await users.findUserForLogin("changer");
  assert.equal(await verifyPassword("a completely different phrase", reloaded!.password_hash), true);
  assert.equal(await verifyPassword(PASSWORD, reloaded!.password_hash), false, "old password dies");
});

check("a deactivated account's live session stops working immediately", async () => {
  // The one that gets missed: without it, a deactivated adviser keeps working until their
  // cookie happens to expire, which can be most of a day.
  const id = await users.createUser({
    username: "leaver",
    fullName: "Leaver",
    password: PASSWORD,
    role: "adviser",
  });
  const { token } = await users.createSession(id);
  assert.ok(await users.findSessionUser(token));

  await users.setUserActive(id, false);
  assert.equal(await users.findSessionUser(token), null);

  await users.setUserActive(id, true);
  assert.equal(await users.findSessionUser(token), null, "reactivating does not revive a session");
});

check("usernames are case-insensitive and unique", async () => {
  await users.createUser({
    username: "Registrar",
    fullName: "Registrar",
    password: PASSWORD,
    role: "admin",
  });
  assert.ok(await users.findUserForLogin("registrar"), "lookup ignores case");
  assert.ok(await users.findUserForLogin("REGISTRAR"), "lookup ignores case");

  await assert.rejects(
    users.createUser({
      username: "REGISTRAR",
      fullName: "Impostor",
      password: PASSWORD,
      role: "adviser",
    }),
    /UNIQUE/i,
    "a second Registrar must be refused",
  );
});

check("countActiveAdmins ignores deactivated admins", async () => {
  const before = await users.countActiveAdmins();
  const id = await users.createUser({
    username: "admin2",
    fullName: "Admin Two",
    password: PASSWORD,
    role: "admin",
  });
  assert.equal(await users.countActiveAdmins(), before + 1);
  await users.setUserActive(id, false);
  assert.equal(await users.countActiveAdmins(), before);
});

// ----------------------------------------------------------------- lockout

check("lockout triggers on the fifth failure and clears on success", async () => {
  const who = "lockme";
  const ip = "203.0.113.9";

  for (let i = 0; i < rateLimit.MAX_ATTEMPTS - 1; i++) {
    await rateLimit.recordFailedAttempt(who, ip);
    assert.equal((await rateLimit.checkLockout(who, ip)).locked, false, `attempt ${i + 1}`);
  }

  await rateLimit.recordFailedAttempt(who, ip);
  const state = await rateLimit.checkLockout(who, ip);
  assert.equal(state.locked, true, "locked after MAX_ATTEMPTS");
  assert.ok(state.retryAfterMinutes >= 1, "tells the user how long to wait");

  await rateLimit.clearAttempts(who);
  assert.equal((await rateLimit.checkLockout(who, ip)).locked, false, "a success clears it");
});

check("lockout expires with the window", async () => {
  const who = "waiter";
  for (let i = 0; i < rateLimit.MAX_ATTEMPTS; i++) await rateLimit.recordFailedAttempt(who, null);
  assert.equal((await rateLimit.checkLockout(who, null)).locked, true);

  await db.execute({
    sql: `UPDATE login_attempts SET at = datetime('now', ?) WHERE username = ?`,
    args: [`-${rateLimit.WINDOW_MINUTES + 1} minutes`, who],
  });
  assert.equal((await rateLimit.checkLockout(who, null)).locked, false, "old failures do not count");
});

check("one locked-out username does not lock out everyone else", async () => {
  // Counting only by address would let one attacker freeze the whole school out.
  const ip = "203.0.113.50";
  for (let i = 0; i < rateLimit.MAX_ATTEMPTS; i++) {
    await rateLimit.recordFailedAttempt("victim", ip);
  }
  assert.equal((await rateLimit.checkLockout("victim", ip)).locked, true);
  assert.equal(
    (await rateLimit.checkLockout("someone-else", ip)).locked,
    false,
    "a different username on the same address is unaffected at this volume",
  );
});

check("the client address comes from x-forwarded-for", async () => {
  const headers = new Headers({ "x-forwarded-for": "198.51.100.7, 10.0.0.1" });
  assert.equal(rateLimit.clientIp(headers), "198.51.100.7");
  assert.equal(rateLimit.clientIp(new Headers()), null);
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

console.log(process.exitCode ? "\nauth: FAILURES above\n" : `\nauth: ${passed} checks passed\n`);
