/**
 * The database handle, and where the schema gets applied.
 *
 * Connection details live in ./client.ts - one `@libsql/client` driver pointed at either a
 * local file or the hosted database. This module is about lifecycle: handing out the client,
 * and making sure the tables exist before anything reads them.
 *
 * ## Why schema setup is not automatic in production
 *
 * This used to run `schema.sql` plus every migration on each call. On a single machine that was
 * free - the connection outlived the process. On a serverless host there is no long-lived
 * process: every cold start would re-run fifteen `CREATE TABLE IF NOT EXISTS` statements and a
 * migration check against a database over the network, for nothing.
 *
 * So setup is an explicit step - `npm run db:migrate` - and production just connects.
 * Development keeps it automatic, because a fresh clone should work after `npm run dev` alone.
 */

import type { Client } from "@libsql/client";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createDbClient, getClient, LOCAL_DB_PATH } from "./client.ts";
import { runMigrations, type MigrationResult } from "./migrations.ts";

const SCHEMA_PATH = join(process.cwd(), "db", "schema.sql");

declare global {
  // eslint-disable-next-line no-var
  var __pnhsSchemaReady: Promise<void> | undefined;
}

/**
 * The shared connection, with the schema guaranteed present in development.
 *
 * The readiness promise is cached rather than the boolean, so concurrent requests during a cold
 * start await the same setup instead of racing to apply it.
 */
export async function getDb(): Promise<Client> {
  const client = getClient();

  if (process.env.NODE_ENV !== "production") {
    globalThis.__pnhsSchemaReady ??= applySchema(client).then(() => undefined);
    await globalThis.__pnhsSchemaReady;
  }

  return client;
}

/** Open a connection to a specific file, schema applied - for scripts that manage their own. */
export async function openDb(path: string = LOCAL_DB_PATH): Promise<Client> {
  const db = createDbClient(path);
  await applySchema(db);
  return db;
}

/**
 * Create anything missing, then migrate anything that already exists.
 *
 * Order matters: `schema.sql` creates new tables, and only then do migrations alter tables that
 * were already there. See migrations.ts for why both halves are needed.
 */
export async function applySchema(db: Client): Promise<MigrationResult> {
  await db.executeMultiple(readFileSync(SCHEMA_PATH, "utf8"));
  return runMigrations(db);
}

export { LOCAL_DB_PATH as DB_FILE } from "./client.ts";
