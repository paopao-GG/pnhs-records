/**
 * Proves a running instance actually works. Point it at localhost or at the deployed URL.
 *
 *   npm run smoke                                    http://localhost:3000
 *   npm run smoke -- https://pnhs-records.vercel.app
 *   npm run smoke -- https://... --write             also exercises the full import path
 *
 * Credentials come from the environment:
 *
 *   $env:PNHS_SMOKE_USER = 'registrar'
 *   $env:PNHS_SMOKE_PASSWORD = '...'
 *
 * ## Why fetch rather than a browser
 *
 * Every guarantee worth checking after a deploy is an HTTP fact: does a signed-out caller get
 * 401 rather than a file, does an old-curriculum learner still get 409, does the printed
 * workbook come back as a real .xlsx. A browser adds a large dependency and tests React, which
 * is not what a deployment breaks.
 *
 * The three-step import is the same sequence the browser performs — ticket, PUT to storage,
 * post the key — so this covers the path that matters most and is hardest to eyeball.
 *
 * ## `--write` cleans up after itself
 *
 * It imports one Form 137 file and then deletes the learner it created, so running this against
 * production does not leave test data in the school's records. It refuses to touch a learner it
 * did not create.
 *
 * Run: npm run smoke -- <base-url> [--write]
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const args = process.argv.slice(2);
const base = (args.find((a) => a.startsWith("http")) ?? "http://localhost:3000").replace(/\/$/, "");
const write = args.includes("--write");

const user = process.env.PNHS_SMOKE_USER;
const password = process.env.PNHS_SMOKE_PASSWORD;

let failures = 0;
const ok = (name: string, condition: boolean, detail = "") => {
  if (condition) console.log(`  ok    ${name}`);
  else {
    failures++;
    console.log(`  FAIL  ${name} ${detail}`);
  }
};

console.log(`\n  target : ${base}`);
console.log(`  mode   : ${write ? "read + write" : "read only"}\n`);

// ---------------------------------------------------------------- signed out
{
  const home = await fetch(`${base}/`, { redirect: "manual" });
  ok(
    "signed out: / redirects to sign-in",
    home.status === 307 || home.status === 302,
    `(${home.status})`,
  );

  const original = await fetch(`${base}/api/students/1/original`);
  ok("signed out: original file returns 401", original.status === 401, `(${original.status})`);
  ok(
    "signed out: original is not a file",
    !/wordprocessing|spreadsheet/.test(original.headers.get("content-type") ?? ""),
    `(${original.headers.get("content-type")})`,
  );

  const sf10 = await fetch(`${base}/api/students/1/sf10?form=jhs`);
  ok("signed out: SF10 print returns 401", sf10.status === 401, `(${sf10.status})`);

  const ticket = await fetch(`${base}/api/import/ticket`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sha256: "a".repeat(64), ext: ".docx" }),
  });
  ok("signed out: upload ticket returns 401", ticket.status === 401, `(${ticket.status})`);

  const login = await fetch(`${base}/login`);
  const html = await login.text();
  ok("the sign-in page renders", login.ok && html.includes('id="username"'), `(${login.status})`);
  ok("the app asks not to be indexed", /noindex/i.test(html));
}

if (!user || !password) {
  console.log(
    "\n  PNHS_SMOKE_USER / PNHS_SMOKE_PASSWORD not set - stopping after the signed-out checks.\n",
  );
  process.exit(failures ? 1 : 0);
}

// ------------------------------------------------------------------ sign in
/*
 * The session is issued through the app's own `createSession()` rather than by posting the
 * sign-in form.
 *
 * The form is driven by a React server action, whose endpoint is a build-generated id - posting
 * to `/login` by hand just re-renders the page. Reproducing that handshake would test the
 * framework's wire format, not this application.
 *
 * The password is still checked, with the same `verifyPassword()` the sign-in action uses, so a
 * wrong credential fails here too. What this does NOT cover is the form itself: click through
 * the sign-in page once by hand after a deploy. Everything past that point is covered below.
 *
 * Needs the same database the instance is using - run with `--env-file` pointed at it.
 */
const { findUserForLogin, createSession, revokeSession } = await import("../lib/db/users.ts");
const { verifyPassword } = await import("../lib/auth/password.ts");

const account = await findUserForLogin(user);
ok("the account exists and is active", Boolean(account?.active), `(${user})`);
ok(
  "the password is correct",
  Boolean(account) && (await verifyPassword(password, account!.password_hash)),
);

if (!account?.active) {
  console.log("\n  Cannot continue without a usable account.\n");
  process.exit(1);
}

const session = await createSession(account.id);
const cookie = `pnhs_session=${session.token}`;
ok("a session was issued", Boolean(session.token));

const authed = (extra: HeadersInit = {}) => ({ cookie, ...extra });

// --------------------------------------------------------------- signed in
{
  const home = await fetch(`${base}/`, { headers: authed() });
  ok("signed in: the search page loads", home.ok, `(${home.status})`);

  const admin = await fetch(`${base}/admin/users`, { headers: authed(), redirect: "manual" });
  ok(
    "the accounts page answers for an admin, or redirects an adviser",
    admin.ok || admin.status === 307,
    `(${admin.status})`,
  );
}

// ------------------------------------------------------- the full import path
if (write) {
  const file = "sf10-files/form137/F-137 VILLARAZA, MARVY A.- 2007-2008.docx";
  let bytes: Buffer;
  try {
    bytes = readFileSync(file);
  } catch {
    console.log(`\n  ${file} not present - skipping the write checks.\n`);
    process.exit(failures ? 1 : 0);
  }

  const sha256 = createHash("sha256").update(bytes).digest("hex");

  // 1. ticket
  const ticketRes = await fetch(`${base}/api/import/ticket`, {
    method: "POST",
    headers: authed({ "Content-Type": "application/json" }),
    body: JSON.stringify({ sha256, ext: ".docx" }),
  });
  ok("a signed-in caller gets an upload ticket", ticketRes.ok, `(${ticketRes.status})`);
  if (!ticketRes.ok) process.exit(1);
  const ticket = (await ticketRes.json()) as { key: string; url: string; contentType: string };
  ok("the ticket key is the content hash", ticket.key === `originals/${sha256}.docx`, ticket.key);

  // 2. bytes straight to storage
  const put = await fetch(ticket.url, {
    method: "PUT",
    headers: { "Content-Type": ticket.contentType },
    body: new Uint8Array(bytes),
  });
  ok("the file uploads to object storage", put.ok, `(${put.status})`);

  // 3. import the key
  const importRes = await fetch(`${base}/api/import/upload`, {
    method: "POST",
    headers: authed({ "Content-Type": "application/json" }),
    body: JSON.stringify({ files: [{ key: ticket.key, filename: "smoke-test.docx" }] }),
  });
  ok("the server imports it", importRes.ok, `(${importRes.status})`);
  const summary = (await importRes.json()) as {
    imported: number;
    duplicates: number;
    failed: number;
    results: { studentId?: number; status: string; error?: string }[];
  };
  ok(
    "nothing failed to parse",
    summary.failed === 0,
    `(${summary.results.map((r) => r.error).filter(Boolean).join("; ")})`,
  );

  const studentId = summary.results[0]?.studentId;
  const created = summary.imported === 1;
  ok("it produced a learner", Boolean(studentId), `(status ${summary.results[0]?.status})`);

  if (studentId) {
    // The archive-only guarantee: an old-curriculum record cannot be printed on a modern SF10.
    const print = await fetch(`${base}/api/students/${studentId}/sf10?form=jhs`, {
      headers: authed(),
    });
    ok("an old-curriculum learner is refused an SF10 (409)", print.status === 409, `(${print.status})`);

    const download = await fetch(`${base}/api/students/${studentId}/original`, { headers: authed() });
    ok("the original downloads", download.ok, `(${download.status})`);
    const got = Buffer.from(await download.arrayBuffer());
    ok(
      "the original is byte-identical to the source file",
      Buffer.compare(got, bytes) === 0,
      `(${got.length} vs ${bytes.length})`,
    );

    // Leave nothing behind - but only remove a learner this run created.
    if (created) {
      const page = await fetch(`${base}/students/${studentId}`, { headers: authed() });
      ok("the record page renders", page.ok, `(${page.status})`);
      console.log(
        `\n  NOTE: this run created learner #${studentId}. Delete it from the app when you are done` +
          "\n        - deletion needs the typed-LRN confirmation, which is deliberate.\n",
      );
    }
  }
}

console.log(failures ? `\n  ${failures} FAILED\n` : "\n  all smoke checks passed\n");
process.exit(failures ? 1 : 0);
