/**
 * Finish the standalone build, which Next deliberately leaves half-done.
 *
 * `output: "standalone"` emits `.next/standalone/server.js` with the dependencies it traced —
 * and **not** the two asset folders that server expects to find beside it. Next documents this
 * and leaves the copy to the caller, because a Docker build normally does it in a `COPY` line.
 *
 *     .next/static  ->  .next/standalone/.next/static
 *     public        ->  .next/standalone/public
 *
 * The server resolves both relative to its own directory. Without them it starts, answers, and
 * renders every page with **no stylesheet, no JavaScript and no typefaces** — an app that looks
 * catastrophically broken but reports no error anywhere, because 404s on static assets are not
 * server errors.
 *
 * This is exactly the class of failure the packaged app is prone to and development is not:
 * `npm run dev` never reads `.next/standalone` at all, so the gap is invisible until somebody
 * installs the `.exe`. Hence a script rather than a note in the README.
 *
 * Run: npm run prepare:standalone   (and automatically as part of npm run build:desktop)
 */

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const standalone = join(root, ".next", "standalone");

if (!existsSync(standalone)) {
  console.error(`\n  no standalone build at ${standalone} — run "npm run build" first\n`);
  process.exit(1);
}

const copies: [from: string, to: string, label: string][] = [
  [join(root, ".next", "static"), join(standalone, ".next", "static"), "the stylesheet and JS"],
  [join(root, "public"), join(standalone, "public"), "the typefaces and favicon"],
];

for (const [from, to, label] of copies) {
  if (!existsSync(from)) {
    console.error(`\n  missing ${from} — cannot copy ${label}\n`);
    process.exit(1);
  }
  mkdirSync(to, { recursive: true });
  cpSync(from, to, { recursive: true });
  console.log(`  copied  ${label}`);
}

console.log("\n  standalone: ready to package\n");
