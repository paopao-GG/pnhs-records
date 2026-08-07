/**
 * Proves the exporter preserves everything it does not intend to change.
 *
 * For each generated file, compares every zip entry against the source template:
 *   - the set of entries must be identical (no dropped logos, printer settings, VML or
 *     form-control parts - the exact things full-featured Excel libraries lose)
 *   - every entry we did not intend to touch must be byte-for-byte identical
 *   - every entry we did touch must still be well-formed XML
 *
 * Run: npm run verify
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unzipSync } from "fflate";

const ROOT = join(import.meta.dirname, "..");

const PAIRS = [
  { template: "templates/SF10-JHS.xlsx", output: "spike-output/JHS-sentinel.xlsx" },
  { template: "templates/SF10-JHS.xlsx", output: "spike-output/JHS-realistic.xlsx" },
  { template: "templates/SF10-SHS.xlsx", output: "spike-output/SHS-sentinel.xlsx" },
  { template: "templates/SF10-SHS.xlsx", output: "spike-output/SHS-realistic.xlsx" },
];

/** The only entries the exporter is allowed to modify. */
const EXPECTED_CHANGES = /^xl\/(worksheets\/sheet\d+\.xml|workbook\.xml)$/;

function entriesOf(path: string): Record<string, Uint8Array> {
  return unzipSync(readFileSync(join(ROOT, path)));
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Cheap well-formedness check: tags balance and no stray unescaped delimiters in text. */
function xmlIsWellFormed(xml: string): string | null {
  const stack: string[] = [];
  const tagRe = /<(\/?)([A-Za-z_][\w.:-]*)([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;

  while ((m = tagRe.exec(xml)) !== null) {
    const [, closing, name, attrs, selfClose] = m;
    if (attrs.includes("<")) return `unescaped '<' inside <${name}> attributes`;
    if (closing) {
      const open = stack.pop();
      if (open !== name) return `</${name}> closes <${open ?? "nothing"}>`;
    } else if (!selfClose && !attrs.endsWith("/")) {
      stack.push(name);
    }
  }
  if (stack.length) return `unclosed <${stack[stack.length - 1]}>`;
  return null;
}

function verify(templatePath: string, outputPath: string): boolean {
  const a = entriesOf(templatePath);
  const b = entriesOf(outputPath);

  const aNames = new Set(Object.keys(a));
  const bNames = new Set(Object.keys(b));
  const problems: string[] = [];

  for (const name of aNames) if (!bNames.has(name)) problems.push(`  DROPPED   ${name}`);
  for (const name of bNames) if (!aNames.has(name)) problems.push(`  ADDED     ${name}`);

  let identical = 0;
  const changed: string[] = [];

  for (const name of aNames) {
    if (!bNames.has(name)) continue;
    if (sameBytes(a[name], b[name])) {
      identical++;
      continue;
    }
    changed.push(name);
    if (!EXPECTED_CHANGES.test(name)) {
      problems.push(`  MODIFIED  ${name} (should not have been touched)`);
      continue;
    }
    const err = xmlIsWellFormed(new TextDecoder().decode(b[name]));
    if (err) problems.push(`  MALFORMED ${name}: ${err}`);
  }

  const label = outputPath.replace("spike-output/", "");
  if (problems.length === 0) {
    console.log(
      `  ${label.padEnd(22)} ${aNames.size} entries, ${identical} byte-identical, ` +
        `${changed.length} rewritten (${changed.map((c) => c.split("/").pop()).join(", ")})`,
    );
    return true;
  }
  console.log(`  ${label}: FAILED`);
  problems.forEach((p) => console.log(p));
  return false;
}

console.log("\nVerifying the exporter preserves every untouched part of the template\n");
let ok = true;
for (const p of PAIRS) ok = verify(p.template, p.output) && ok;
console.log(
  ok
    ? "\nAll parts preserved: logos, printer settings, VML and form controls intact.\n"
    : "\nFIDELITY FAILURE - do not use these files.\n",
);
process.exit(ok ? 0 : 1);
