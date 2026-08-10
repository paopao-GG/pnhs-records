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
import { createDbClient, getClient, isRemote, LOCAL_DB_PATH } from "./client.ts";
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
 * Statements that only mean something for a database file we own.
 *
 * `journal_mode` and `foreign_keys` are properties of a local SQLite connection. A hosted
 * database manages its own journalling and rejects the attempt - the failure is an HTTP 400
 * carrying no explanation, which is a genuinely hard error to read backwards.
 *
 * They stay in schema.sql because they are right for the local file, and are filtered out on
 * the way to a hosted one.
 */
const LOCAL_ONLY_PRAGMA = /^\s*PRAGMA\s+(journal_mode|foreign_keys)\b[^;]*;/gim;

/**
 * Create anything missing, then migrate anything that already exists.
 *
 * Order matters: `schema.sql` creates new tables, and only then do migrations alter tables that
 * were already there. See migrations.ts for why both halves are needed.
 */
export async function applySchema(db: Client): Promise<MigrationResult> {
  const schema = readFileSync(SCHEMA_PATH, "utf8");
  await db.executeMultiple(isRemote() ? schema.replace(LOCAL_ONLY_PRAGMA, "") : schema);
  return runMigrations(db);
}

export { LOCAL_DB_PATH as DB_FILE } from "./client.ts";
