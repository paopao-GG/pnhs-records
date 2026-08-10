/**
 * Creates the first admin account.
 *
 * The chicken-and-egg step: only an admin can issue accounts, so the first one cannot come from
 * the app. It comes from here, on the machine that owns the database.
 *
 *   npm run create-admin -- --username registrar --name "Hilda S. Secillano"
 *
 * The password is read from the PNHS_ADMIN_PASSWORD environment variable rather than an
 * argument, because arguments are visible to other users in the process list and land in shell
 * history. It is checked against the same policy the app enforces.
 *
 * Refuses to run when an active admin already exists - pass --force to add another anyway.
 *
 * Run: npm run create-admin -- --username <name> --name "<full name>"
 */

import { passwordProblem } from "../lib/auth/password.ts";
import { countActiveAdmins, createUser, listUsers } from "../lib/db/users.ts";
import { applySchema } from "../lib/db/index.ts";
import { getClient } from "../lib/db/client.ts";

/**
 * Read `--flag value`, joining everything up to the next flag.
 *
 * `--name "Paolo Simeon Satuito"` does not survive the trip through npm and PowerShell as one
 * argument: the quotes are stripped somewhere in the middle and the script sees three. Taking
 * only `argv[i + 1]` would silently register the account as "Paolo" - a wrong name in a school
 * record system, written without complaint.
 */
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;

  const words: string[] = [];
  for (let j = i + 1; j < process.argv.length; j++) {
    if (process.argv[j]!.startsWith("--")) break;
    words.push(process.argv[j]!);
  }
  return words.length ? words.join(" ") : undefined;
}

const username = arg("username")?.trim();
const fullName = arg("name")?.trim();
const force = process.argv.includes("--force");
const password = process.env.PNHS_ADMIN_PASSWORD;

// Annotated rather than inferred: TypeScript only narrows past a never-returning call when the
// signature is declared, so without this every check below still sees `string | undefined`.
const die: (message: string) => never = (message) => {
  console.error(`\n  ${message}\n`);
  process.exit(1);
};

if (!username || !fullName) {
  die(
    'Usage: npm run create-admin -- --username <name> --name "<full name>"\n' +
      "  with the password in PNHS_ADMIN_PASSWORD.",
  );
}
if (!/^[a-z0-9][a-z0-9._-]{2,31}$/i.test(username)) {
  die("Usernames are 3-32 characters: letters, digits, dot, dash or underscore.");
}
if (!password) {
  die(
    "Set PNHS_ADMIN_PASSWORD first, so the password does not appear in your shell history.\n" +
      "  PowerShell:  $env:PNHS_ADMIN_PASSWORD = 'a long passphrase'",
  );
}

const problem = passwordProblem(password, username);
if (problem) die(problem);

// The tables have to exist before we can look for an admin in them.
await applySchema(getClient());

const existing = await countActiveAdmins();
if (existing > 0 && !force) {
  const who = (await listUsers())
    .filter((u) => u.role === "admin" && u.active)
    .map((u) => u.username)
    .join(", ");
  die(
    `There is already an active admin (${who}).\n` +
      "  Create further accounts from the app, or pass --force to add another admin here.",
  );
}

const id = await createUser({ username, fullName, password, role: "admin" });

console.log(`\n  created admin #${id}: ${username} (${fullName})`);
console.log("  sign in at /login\n");
