/**
 * Where things are on this machine.
 *
 * Two roots, and the distinction is the whole point:
 *
 *     appDir()   read-only resources shipped with the app - db/schema.sql, templates/*.xlsx
 *     dataDir()  everything written at runtime - pnhs.db, originals/, backups/
 *
 * ## Why this file exists
 *
 * Every path in this project used to be `join(process.cwd(), ...)`, which is correct for a
 * repository and wrong for an installed application in two separate ways.
 *
 * The install directory is **read-only**. A user-scope install lands under
 * `%LOCALAPPDATA%\Programs\`, a per-machine one under `C:\Program Files\`, and neither is
 * somewhere the school's permanent records can live. Writing the database beside the code
 * works on the developer's machine and fails on the registrar's.
 *
 * And `process.cwd()` is not the repository once the app is packaged - it is wherever the
 * Electron main process happened to spawn the server. Resources resolved against it are found
 * during development and missing in production, which is the worst order to discover it in.
 *
 * ## Where the data goes, and why it is not `%APPDATA%`
 *
 * `%LOCALAPPDATA%`, not Roaming `%APPDATA%` and never a folder inside OneDrive or any other
 * sync client. SQLite and file-sync tools corrupt each other: the sync client copies the file
 * mid-write and hands back something that is not a database. Roaming profiles do the same
 * thing on a domain network. Local AppData is the one location Windows guarantees stays put.
 *
 * ## Defaults keep the repository working
 *
 * Both fall back to today's layout when nothing is set, so `npm run dev` and every
 * verification script behave exactly as they did. Only the packaged app sets the variables.
 */

import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

/*
 * The data folder's name, held in a variable rather than written into the `join()` below.
 *
 * Next's build traces which files each route reads so it can copy them into the standalone
 * bundle. It does that by evaluating path expressions statically, and `join(process.cwd(),
 * "data")` is exactly the shape it can evaluate: it resolved the folder, could not tell which
 * file inside would be opened, and copied **all of it** - the live database, four backups
 * beside it, and twenty archived Form 137 originals carrying children's names, their parents'
 * occupations and their home addresses. Straight into `.next/standalone/data`, from where the
 * installer would have shipped them to whoever installed the app.
 *
 * Reading the segment from the environment is what defeats that evaluation: the build cannot
 * know what `PNHS_DATA_FOLDER` will hold, so it stops trying to resolve the path and copies
 * nothing. `outputFileTracingExcludes` was tried first and had no effect at all - the traced
 * entries are relative paths like `../../../data/x.db` and no pattern matched them.
 *
 * `npm run check:bundle` asserts the result, because the bug shipped a working installer, a
 * passing test suite and no error message. It was found by listing a directory.
 */
const DATA_FOLDER = process.env.PNHS_DATA_FOLDER || "data";

/**
 * The root of the read-only application bundle.
 *
 * Set by the Electron main process to the folder holding `db/` and `templates/`. Unset in the
 * repository, where the working directory already is that folder.
 */
export function appDir(): string {
  return process.env.PNHS_APP_DIR || process.cwd();
}

/**
 * The root of everything this app writes.
 *
 * Set by the Electron main process to `%LOCALAPPDATA%\PNHS Records`. Unset in the repository,
 * where it is `data/` beside the code - which is also why that folder is in `.gitignore`.
 */
export function dataDir(): string {
  return process.env.PNHS_DATA_DIR || resolve(DATA_FOLDER);
}

/** A path inside the application bundle. */
export function appPath(...parts: string[]): string {
  return join(appDir(), ...parts);
}

/** A path inside the writable data directory, whose parent is created if it is missing. */
export function dataPath(...parts: string[]): string {
  const path = join(dataDir(), ...parts);
  mkdirSync(dataDir(), { recursive: true });
  return path;
}
