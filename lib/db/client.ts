/**
 * Where the database is, and how to reach it.
 *
 * One driver, two URLs. `@libsql/client` speaks the same async API to a local SQLite file and
 * to a hosted libSQL database, so development, every verification script, and the deployed app
 * all run the same code path:
 *
 *     file:.../data/pnhs.db        local dev and scripts - no network, works offline
 *     libsql://...turso.io         Vercel
 *
 * That matters more than it looks. `npm run roundtrip` and `npm run check:ga` are the proof
 * that a printed SF10 matches the source form; if they exercised a different driver from the
 * one that ships, they would stop proving anything about production.
 *
 * libSQL is a SQLite dialect, so `db/schema.sql`, `PRAGMA user_version`, `GROUP_CONCAT` and
 * every SQL string in this project are carried across unchanged.
 */

import { createClient, type Client } from "@libsql/client";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The local file used when no hosted database is configured.
 *
 * `PNHS_DB_PATH` overrides it. That exists so tests can point the shared connection at a
 * scratch file: without it, anything calling `getDb()` reaches the school's real records, and a
 * test that writes is one mistake away from damaging them.
 */
export const LOCAL_DB_PATH = process.env.PNHS_DB_PATH || join(process.cwd(), "data", "pnhs.db");

declare global {
  // eslint-disable-next-line no-var
  var __pnhsClient: Client | undefined;
}

/** True when pointing at a hosted database rather than a file on this machine. */
export function isRemote(): boolean {
  return Boolean(process.env.TURSO_DATABASE_URL);
}

/**
 * Build a client. Callers normally want `getDb()` from ./index.ts instead - this is exported
 * for scripts that need a second connection to a specific file.
 */
export function createDbClient(path?: string): Client {
  const remoteUrl = process.env.TURSO_DATABASE_URL;

  if (remoteUrl && !path) {
    const authToken = process.env.TURSO_AUTH_TOKEN;
    if (!authToken) {
      throw new Error(
        "TURSO_DATABASE_URL is set but TURSO_AUTH_TOKEN is not. Both are required to reach the hosted database.",
      );
    }
    return createClient({ url: remoteUrl, authToken });
  }

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
 * fresh client per reload leaks file handles against the local database.
 */
export function getClient(): Client {
  if (!globalThis.__pnhsClient) globalThis.__pnhsClient = createDbClient();
  return globalThis.__pnhsClient;
}
