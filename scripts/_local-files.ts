/**
 * Walk a folder for importable files.
 *
 * **For scripts only.** This used to live in the importer and be reachable from the web app,
 * which stopped making sense once the app was going to run on a host whose filesystem is the
 * deployment bundle rather than the school's archive — there is nothing there to scan.
 *
 * Scripts are different: they run on a developer's or the registrar's own machine, pointed at
 * a real folder of real files. Walking a directory is legitimate there. It is only the *server*
 * that must not.
 *
 * `~$` files are Word/Excel lock files left behind by an open document, not records.
 */

import { readdirSync, statSync } from "node:fs";

export function listImportableFiles(folder: string): string[] {
  return readdirSync(folder, { recursive: true, encoding: "utf8" })
    .filter((f) => {
      const base = f.split(/[\\/]/).pop() ?? f;
      const lower = f.toLowerCase();
      // .xlsx is SF10 (both variants); .docx is Form 137.
      return (lower.endsWith(".xlsx") || lower.endsWith(".docx")) && !base.startsWith("~$");
    })
    .sort();
}

export function folderExists(folder: string): boolean {
  try {
    return statSync(folder).isDirectory();
  } catch {
    return false;
  }
}
