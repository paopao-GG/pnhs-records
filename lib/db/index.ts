/**
 * SQLite connection and schema bootstrap.
 *
 * Uses Node's built-in `node:sqlite` rather than better-sqlite3, so there is no native
 * module to compile - which matters a lot on Windows, and removes the only dependency in
 * this project that would have needed a build toolchain.
 *
 * The connection is cached on globalThis because Next.js dev reloads modules on every edit
 * and we would otherwise leak file handles.
 */

import { DatabaseSync } from "node:sqlite";
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const DB_DIR = join(process.cwd(), "data");
const DB_PATH = join(DB_DIR, "pnhs.db");
const SCHEMA_PATH = join(process.cwd(), "db", "schema.sql");

declare global {
  // eslint-disable-next-line no-var
  var __pnhsDb: DatabaseSync | undefined;
}

export function getDb(): DatabaseSync {
  if (globalThis.__pnhsDb) return globalThis.__pnhsDb;

  mkdirSync(DB_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec(readFileSync(SCHEMA_PATH, "utf8"));

  globalThis.__pnhsDb = db;
  return db;
}

/** Open a connection without the global cache - for scripts that manage their own lifetime. */
export function openDb(path: string = DB_PATH): DatabaseSync {
  mkdirSync(DB_DIR, { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(readFileSync(SCHEMA_PATH, "utf8"));
  return db;
}

export const DB_FILE = DB_PATH;
