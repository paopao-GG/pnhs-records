/**
 * Refuse to ship an installer containing learner data.
 *
 * ## Why this exists
 *
 * Next's build traces which files each route reads and copies them into `.next/standalone`.
 * It does that by evaluating path expressions statically, and `dataDir()` used to be exactly
 * the shape it could evaluate. It resolved `data/`, could not tell which file inside would be
 * opened, and copied the lot: the live database, four backups sitting beside it, and twenty
 * archived Form 137 originals carrying children's names, their parents' occupations and their
 * home addresses.
 *
 * All of it landed in the standalone bundle, from where electron-builder would have packaged
 * it into `PNHS-Records-Setup.exe` and handed it to whoever installed the app — including
 * anyone the installer was ever passed on to.
 *
 * `lib/paths.ts` stops it happening. This stops it happening *again quietly*, which is the
 * part that matters: the bug produced a working installer, a passing test suite and no error
 * message. It was found by listing a directory, and nothing would have found it later.
 *
 * ## What it checks
 *
 * The bundle may contain exactly the blank forms the exporters fill, plus `db/schema.sql`.
 * Anything else that looks like learner data — a `.db`, a `.docx`, an `.xlsx` — is a file
 * nobody meant to ship.
 *
 * **The allowlist is filenames, not `templates/**`.** A directory rule would let a filled form
 * dropped in there ship unnoticed, and the SF9 template is itself a `.docx` — exactly the
 * extension this check exists to catch. Adding a template means editing the line below, which
 * is the friction that keeps the check meaning something.
 *
 * Run: npm run check:bundle   (and automatically as part of npm run build:desktop)
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const BUNDLE = join(process.cwd(), ".next", "standalone");

/** The only documents that belong in a build. Every one is a blank form, not a record. */
const ALLOWED = new Set([
  "templates/SF10-JHS.xlsx",
  "templates/SF10-SHS.xlsx",
  // The school's own blank Form 138. Verified empty: every grade cell is a run-less paragraph
  // and the identity fields are underscore runs. See lib/sf10/sf9-map.ts.
  "templates/SF9-JHS.docx",
  "db/schema.sql",
]);

/** Extensions that mean "this is somebody's record", wherever they turn up. */
const SUSPECT = /\.(db|db-wal|db-shm|sqlite|sqlite3|docx|xlsx|xls|doc)$/i;

if (!existsSync(BUNDLE)) {
  console.error(`\n  no bundle at ${BUNDLE} — run "npm run build" first\n`);
  process.exit(1);
}

const found: string[] = [];

function walk(dir: string): void {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    // node_modules holds test fixtures from dependencies; they are not this school's data and
    // scanning them would produce noise that teaches people to ignore this check.
    if (name === "node_modules") continue;

    if (statSync(full).isDirectory()) {
      walk(full);
      continue;
    }

    const rel = relative(BUNDLE, full).replace(/\\/g, "/");
    if (SUSPECT.test(rel) && !ALLOWED.has(rel)) found.push(rel);
  }
}

walk(BUNDLE);

if (found.length > 0) {
  console.error(`\n  REFUSING TO PACKAGE: ${found.length} file(s) that look like learner data\n`);
  for (const f of found.slice(0, 20)) console.error(`    ${f}`);
  if (found.length > 20) console.error(`    ... and ${found.length - 20} more`);
  console.error(
    "\n  These would be shipped inside the installer. Something is reading a path the build\n" +
      "  can resolve statically — see lib/paths.ts for how this happened the first time.\n",
  );
  process.exit(1);
}

console.log("\n  bundle: clean — no learner data, templates and schema present\n");
