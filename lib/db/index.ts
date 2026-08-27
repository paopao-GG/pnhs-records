/**
 * The database handle, and where the schema gets applied.
 *
 * Connection details live in ./client.ts - one `@libsql/client` driver pointed at a SQLite
 * file on this machine. This module is about lifecycle: handing out the client, and making
 * sure the tables exist before anything reads them.
 *
 * ## Why setup runs in production too
 *
 * This used to skip schema setup entirely when `NODE_ENV === "production"`, and that was
 * right for the deployment it was written for. On a serverless host there is no long-lived
 * process: every cold start would re-run fifteen `CREATE TABLE IF NOT EXISTS` statements and
 * a migration check against a database over the network, for nothing. So setup became an
 * explicit `npm run db:migrate` step and production just connected.
 *
 * The installed Windows app runs as production and has no such step. A first launch on a new
 * machine would connect to an empty file, skip the creates, and fail on the first query with
 * `no such table` - the schema never applied because the environment said not to bother.
 *
 * It has one long-lived process and a local file, which is the situation the old guard was
 * written before. So setup runs on first use and is memoised for the life of the process:
 * once per launch, microseconds, against a file that is already open.
 */

import type { Client } from "@libsql/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createDbClient, getClient, LOCAL_DB_PATH } from "./client.ts";
import { runMigrations, type MigrationResult } from "./migrations.ts";
import { appPath, dataDir } from "../paths.ts";

declare global {
  // eslint-disable-next-line no-var
  var __pnhsSchemaReady: Promise<void> | undefined;
}

/**
 * The shared connection, with the schema guaranteed present.
 *
 * The readiness promise is cached rather than a boolean, so concurrent requests during startup
 * await the same setup instead of racing to apply it.
 */
export async function getDb(): Promise<Client> {
  const client = getClient();
  /*
   * This is the one path that is always the real database, so it is the one that asks for a
   * pre-upgrade backup. See runMigrations() for why the destination is passed rather than
   * resolved: a scratch database in a test must not file its backups here.
   */
  globalThis.__pnhsSchemaReady ??= applySchema(client, {
    snapshotDir: join(dataDir(), "backups"),
  }).then(() => undefined);
  await globalThis.__pnhsSchemaReady;
  return client;
}

/**
 * Open a connection to a specific file, schema applied - for scripts that manage their own.
 *
 * No snapshot: the caller chose the path, so only the caller knows whether it holds anything
 * worth copying.
 */
export async function openDb(path: string = LOCAL_DB_PATH): Promise<Client> {
  const db = createDbClient(path);
  await applySchema(db);
  return db;
}

/**
 * Create anything missing, then migrate anything that already exists.
 *
 * Order matters: `schema.sql` creates new tables, and only then do migrations alter tables
 * that were already there. See migrations.ts for why both halves are needed.
 *
 * `schema.sql` is read from the application bundle rather than the working directory, because
 * in the installed app those are not the same folder. See lib/paths.ts.
 *
 * `snapshotDir` is forwarded to the migration runner, which copies the database aside before
 * altering it. Callers that pass nothing get today's behaviour; only a caller that knows it is
 * holding real learner data should ask for one.
 */
export async function applySchema(
  db: Client,
  opts: { snapshotDir?: string } = {},
): Promise<MigrationResult> {
  const schema = readFileSync(appPath("db", "schema.sql"), "utf8");
  await db.executeMultiple(schema);
  return runMigrations(db, opts.snapshotDir);
}

export { LOCAL_DB_PATH as DB_FILE } from "./client.ts";
