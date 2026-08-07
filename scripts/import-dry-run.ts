/**
 * Parses every SF10 in a folder and reports what WOULD be imported. Writes nothing.
 *
 * Run this before a real import to see the damage report first.
 *
 * Usage: npm run import:dry [folder]   (defaults to sf10-copy)
 */

import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseShsFile } from "../lib/sf10/import-shs.ts";
import { fullName } from "../lib/sf10/types.ts";

const folder = resolve(process.argv[2] ?? "sf10-copy");

const files = readdirSync(folder)
  .filter((f) => f.toLowerCase().endsWith(".xlsx") && !f.startsWith("~$"))
  .sort();

console.log(`\nDry run over ${folder}`);
console.log(`${files.length} .xlsx files\n`);

const seenHashes = new Map<string, string>();
const seenLrns = new Map<string, string>();
let parsed = 0;
let failed = 0;
let duplicates = 0;
const allIssues: { file: string; message: string; severity: string }[] = [];

for (const file of files) {
  const path = join(folder, file);
  const hash = createHash("sha256").update(readFileSync(path)).digest("hex");

  const firstSeen = seenHashes.get(hash);
  if (firstSeen) {
    duplicates++;
    console.log(`  DUP   ${file}`);
    console.log(`        byte-identical to ${firstSeen} — would be skipped`);
    continue;
  }
  seenHashes.set(hash, file);

  try {
    const { record, issues, termCount, subjectCount } = parseShsFile(path);
    parsed++;

    const lrn = record.student.lrn || "(none)";
    const clash = seenLrns.get(lrn);
    if (clash) {
      console.log(`  SAME  ${file}`);
      console.log(`        LRN ${lrn} already seen in ${clash} — would merge into one learner`);
    }
    seenLrns.set(lrn, file);

    const errs = issues.filter((i) => i.severity === "error").length;
    const warns = issues.length - errs;
    const flag = errs ? "ERR " : warns ? "WARN" : "ok  ";

    console.log(
      `  ${flag}  ${fullName(record.student)}  LRN ${lrn}  ` +
        `${termCount} terms, ${subjectCount} subjects`,
    );
    for (const i of issues) {
      console.log(`        ${i.severity === "error" ? "!" : "-"} ${i.message}${i.cell ? ` [${i.cell}]` : ""}`);
      allIssues.push({ file, message: i.message, severity: i.severity });
    }
  } catch (err) {
    failed++;
    console.log(`  FAIL  ${file}`);
    console.log(`        ${err instanceof Error ? err.message : String(err)}`);
  }
}

console.log("\n" + "-".repeat(72));
console.log(`  files            ${files.length}`);
console.log(`  parsed           ${parsed}`);
console.log(`  duplicate files  ${duplicates}`);
console.log(`  failed to parse  ${failed}`);
console.log(`  distinct LRNs    ${seenLrns.size}`);
console.log(`  issues raised    ${allIssues.length} (${allIssues.filter((i) => i.severity === "error").length} errors)`);
console.log("-".repeat(72) + "\n");

process.exit(failed ? 1 : 0);
