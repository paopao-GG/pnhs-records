/**
 * Where the database is, and how to reach it.
 *
 * One `@libsql/client` driver pointed at one SQLite file on this machine:
 *
 *     file:%LOCALAPPDATA%/PNHS Records/pnhs.db   the installed app
 *     file:./data/pnhs.db                        the repository, and every script
 *
 * `PNHS_DB_PATH` overrides both. That exists so tests can point the shared connection at a
 * scratch file: without it, anything calling `getDb()` reaches the school's real records, and
 * a test that writes is one mistake away from damaging them.
 *
 * ## Why the driver stayed after the hosted database went
 *
 * This used to branch on `TURSO_DATABASE_URL` and speak to a hosted libSQL database instead.
 * That branch is gone with the rest of the hosted deployment, but the driver is not, for one
 * reason worth keeping: `npm run roundtrip` and `npm run check:ga` are the proof that a
 * printed SF10 matches the source form, and they only prove it while they exercise the driver
 * that ships. Swapping to a second SQLite library now would make them prove something about
 * code the app does not run.
 *
 * The async API is the cost of that, and it is already paid throughout `lib/db/queries.ts`.
 * Against a local file every call resolves in microseconds.
 */

import { createClient, type Client } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { dataDir } from "../paths.ts";

/**
 * The database file.
 *
 * Resolved through `dataDir()` so the installed app writes to `%LOCALAPPDATA%` rather than
 * into its own read-only install directory. See lib/paths.ts for why that is not `%APPDATA%`.
 */
export const LOCAL_DB_PATH = process.env.PNHS_DB_PATH || join(dataDir(), "pnhs.db");

declare global {
  // eslint-disable-next-line no-var
  var __pnhsClient: Client | undefined;
}

/**
 * Build a client. Callers normally want `getDb()` from ./index.ts instead - this is exported
 * for scripts that need a second connection to a specific file.
 */
export function createDbClient(path?: string): Client {
  const file = path ?? LOCAL_DB_PATH;
  // libSQL opens the file but will not create the folder holding it.
  mkdirSync(dirname(file), { recursive: true });
  // A Windows path is not a valid URL on its own - `C:\...` parses as scheme `c:`.
  return createClient({ url: pathToFileURL(file).href });
}

/**
 * The shared connection.
 *
 * Cached on globalThis because Next.js reloads modules on every edit in development, and a
 * fresh client per reload leaks file handles against the database.
 */
export function getClient(): Client {
  if (!globalThis.__pnhsClient) globalThis.__pnhsClient = createDbClient();
  return globalThis.__pnhsClient;
}
