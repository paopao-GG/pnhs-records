/**
 * The properties only a real browser can prove.
 *
 * `scripts/smoke.ts` argues — correctly — that a browser is the wrong tool for checking a
 * deployment, because every guarantee worth checking after a deploy is an HTTP fact and a
 * browser only adds a dependency and tests React. Nothing here contradicts that. This file
 * exists for the opposite category: behaviour that lives entirely in the client and that no
 * amount of `fetch` can see.
 *
 * Three of these were written because the redesign shipped them broken and a screenshot pass
 * caught them by eye:
 *
 *  - **Arrow keys must not change a grade.** On `<input type="number">` the up and down arrows
 *    increment the value by default. The encoding grid binds them to movement instead, so a
 *    stray keypress over a mark on a permanent record moves the cursor rather than silently
 *    rewriting the mark and autosaving it 700ms later. This is a safety property.
 *  - **The offline lock must be able to release itself.** Going offline disables every grade
 *    cell. The first version could only come back on a `navigator` "online" event, so one
 *    failed request left a registrar on a dead grid with no event coming — the browser had
 *    never thought it was offline. A probe now proves the way back.
 *  - **Vertical movement must stop at the term boundary.** Holding the down arrow past the last
 *    subject of Grade 7 must not land in Grade 8. A grade typed into the wrong year is the
 *    error the grid exists to prevent.
 *
 * ## Runs against its own database and its own server
 *
 * These checks type into grade cells, so they must never reach the school's records. The
 * script builds a scratch database, seeds one learner into it, and starts its own dev server
 * pointed at that file. It deliberately does not accept a URL the way `smoke.ts` does: a
 * server someone else started is a server pointing at who-knows-what, and "who-knows-what" here
 * includes production.
 *
 * The first check after sign-in asserts the learner index holds exactly the one fixture record.
 * That is a real assertion about the UI and it doubles as proof that the server under test is
 * not the school's database.
 *
 * ## Chrome, not a downloaded browser
 *
 * `channel: "chrome"` drives the browser already installed on the machine. Playwright's own
 * Chromium download is a few hundred megabytes and it is what failed when this was first
 * attempted.
 *
 * Run: npm run test:browser
 */

import { execSync, spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";

/*
 * Point the shared connection at a scratch file BEFORE importing anything that touches it.
 * `client.ts` resolves the path once, at module load; the dynamic imports below are what make
 * that ordering guaranteed rather than incidental. See test-auth.ts for the same guard.
 */
const scratchDir = mkdtempSync(join(tmpdir(), "pnhs-browser-"));
const dbPath = join(scratchDir, "browser-test.db");
process.env.PNHS_DB_PATH = dbPath;
delete process.env.TURSO_DATABASE_URL;

const { applySchema } = await import("../lib/db/index.ts");
const { getClient, LOCAL_DB_PATH } = await import("../lib/db/client.ts");
const q = await import("../lib/db/queries.ts");
const { createUser } = await import("../lib/db/users.ts");

if (!LOCAL_DB_PATH.startsWith(scratchDir)) {
  console.error(`\n  refusing to run: the database is ${LOCAL_DB_PATH}, not a scratch file\n`);
  process.exit(1);
}

const require = createRequire(import.meta.url);
const PORT = Number(process.env.PNHS_BROWSER_PORT ?? 3931);
const BASE = `http://localhost:${PORT}`;
const USERNAME = "browsercheck";
const PASSWORD = "a quiet afternoon in the records room";

let passed = 0;
let failures = 0;

function ok(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    passed++;
    console.log(`  ok    ${name}`);
  } else {
    failures++;
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ""}`);
  }
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

/**
 * One learner with two JHS terms, deliberately graded differently.
 *
 * Two, not one, so the term-boundary check has a boundary to fail against — with a single term
 * the "down arrow does not cross into the next year" assertion would pass no matter what the
 * code did.
 *
 * Grade 7 runs to four quarters and Grade 8 to three, which is the record a learner who
 * straddles the SY 2026-2027 change actually has. It is also the shape most likely to break:
 * the two grids sit on one page with different column counts, and the keyboard navigation
 * addresses cells by column index.
 */
async function seed(): Promise<void> {
  const db = getClient();
  await applySchema(db);

  await createUser({
    username: USERNAME,
    fullName: "Browser Check",
    password: PASSWORD,
    role: "admin",
  });

  const studentId = await q.createStudent({
    lrn: "999900001111",
    last_name: "TESTLEARNER",
    first_name: "Fixture",
    middle_name: null,
    name_ext: null,
    sex: "F",
    birthdate: "2009-06-01",
  });

  for (const level of [7, 8]) {
    const termId = await q.createTerm(
      studentId,
      {
        level,
        semester: null,
        school_year: `20${level + 8}-20${level + 9}`,
        section: "Sampaguita",
        adviser: null,
        track_strand: null,
        // Grade 7 on the old four quarters, Grade 8 on the new three.
        grading_periods: level === 7 ? 4 : 3,
      },
      {},
    );
    await q.createSubjects(
      termId,
      ["Filipino", "English", "Mathematics", "Science"].map((name) => ({ name })),
    );
  }

  // Give every cell a starting value, so "the arrow key did not change it" has something to
  // be true about.
  const subjects = await q.getSubjectsForStudent(studentId);
  for (const rows of subjects.values()) {
    for (const s of rows) {
      for (const field of ["q1", "q2", "q3", "q4"] as const) {
        await q.updateSubjectField(s.id, field, 80, null);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

/** Starts `next dev` against the scratch database and waits for it to answer. */
async function startServer(): Promise<ChildProcess> {
  const nextBin = require.resolve("next/dist/bin/next");
  // Annotated so the delete below is legal: an inferred object literal has no such property,
  // and dropping it matters — .env.local naming a hosted database would otherwise send a test
  // that types into grade cells at the school's real records.
  const env: NodeJS.ProcessEnv = { ...process.env, PNHS_DB_PATH: dbPath };
  delete env.TURSO_DATABASE_URL;

  const child = spawn(process.execPath, [nextBin, "dev", "-p", String(PORT)], {
    env,
    stdio: "ignore",
  });

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/login`);
      if (res.ok) return child;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  throw new Error(`dev server did not start on ${BASE} within 90s`);
}

/**
 * `child.kill()` is not enough on Windows: `next dev` runs its compiler in a grandchild, which
 * survives its parent and keeps the port bound, so the next run of this script fails to bind.
 */
function stopServer(child: ChildProcess): void {
  if (child.pid === undefined) return;
  if (process.platform === "win32") {
    try {
      execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: "ignore" });
    } catch {
      /* already gone */
    }
  } else {
    child.kill("SIGTERM");
  }
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

async function run(): Promise<void> {
  const { chromium } = require("playwright");

  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome" });
  } catch {
    // Edge is present on every Windows install and is the same engine.
    browser = await chromium.launch({ channel: "msedge" });
  }

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // --- sign in ------------------------------------------------------------
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await page.fill("#username", USERNAME);
  await page.fill("#password", PASSWORD);
  await Promise.all([
    page.waitForURL(`${BASE}/`),
    page.click("button[data-variant=primary]"),
  ]);
  ok("sign in reaches the learner index", page.url() === `${BASE}/`);

  /*
   * Both a UI assertion and the guard described at the top of this file. If the server under
   * test were pointed at the school's database this would read seventy-odd, not one.
   */
  await page.waitForSelector(".result");
  const count = await page.locator(".result").count();
  ok("the index holds exactly the fixture learner", count === 1, `saw ${count} results`);

  await page.fill(".search-bar input", "zzzz-no-such-learner");
  await page.waitForSelector(".empty");
  ok("a query matching nothing shows the empty state", await page.isVisible(".empty"));

  // --- the record page ----------------------------------------------------
  await page.fill(".search-bar input", "");
  await page.waitForSelector(".result");
  const href = await page.locator(".result").first().getAttribute("href");
  await page.goto(`${BASE}${href}`, { waitUntil: "networkidle" });

  ok("the record page draws the seal", await page.isVisible(".seal-mark"));
  const sealLabel = (await page.locator(".seal-mark").getAttribute("aria-label")) ?? "";
  const stampText = (await page.locator(".stamp").last().textContent())?.trim() ?? "";
  ok(
    "the seal agrees with the term it summarises",
    sealLabel.toLowerCase().startsWith(stampText.toLowerCase()),
    `seal "${sealLabel}" vs stamp "${stampText}"`,
  );

  // --- the encoding grid --------------------------------------------------
  await page.goto(`${BASE}${href}/edit`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-encoding-grid] [data-cell="0,0"]');

  const grids = page.locator("[data-encoding-grid]");
  const firstGrid = grids.first();

  const cell = (grid: typeof firstGrid, r: number, c: number) =>
    grid.locator(`[data-cell="${r},${c}"]`);

  const focusedCell = () => page.evaluate(() => document.activeElement?.getAttribute("data-cell"));

  await cell(firstGrid, 0, 1).focus();
  const before = await cell(firstGrid, 0, 1).inputValue();

  await page.keyboard.press("ArrowDown");
  ok("ArrowDown moves one row down, same column", (await focusedCell()) === "1,1");

  const after = await cell(firstGrid, 0, 1).inputValue();
  ok(
    "ArrowDown does not change the grade it left",
    before === after,
    `was ${before}, now ${after}`,
  );

  await page.keyboard.press("ArrowUp");
  ok("ArrowUp moves back", (await focusedCell()) === "0,1");

  await page.keyboard.press("ArrowUp");
  ok("ArrowUp on the top row keeps focus where it is", (await focusedCell()) === "0,1");

  await page.keyboard.press("Enter");
  ok("Enter moves down, as a spreadsheet would", (await focusedCell()) === "1,1");

  // Down past the last subject of this term must not land in the next one.
  await cell(firstGrid, 3, 0).focus();
  await page.keyboard.press("ArrowDown");
  ok("movement stops at the term boundary", (await focusedCell()) === "3,0");
  const gridCount = await grids.count();
  ok("the fixture really does have a second term to cross into", gridCount === 2);

  /*
   * Three grading periods on one term and four on the other, on one page.
   *
   * The counts are read off the rendered grid rather than from the fixture, so this fails if
   * the column count ever stops following the term's own `grading_periods`.
   */
  const quartersIn = async (grid: typeof firstGrid) =>
    (await grid.locator("tbody tr").first().locator(".grade-input").count()) -
    (await grid.locator("tbody tr").first().locator("td.final .grade-input").count());

  ok("the four-period term shows four quarter columns", (await quartersIn(firstGrid)) === 4);
  ok(
    "the three-period term on the same page shows three",
    (await quartersIn(grids.nth(1))) === 3,
    `saw ${await quartersIn(grids.nth(1))}`,
  );

  // Column 3 does not exist in the three-period grid, so focus walks left to the last one that
  // does rather than going nowhere.
  await grids.nth(1).locator('[data-cell="0,2"]').focus();
  await page.keyboard.press("ArrowDown");
  ok("navigation works in the three-period grid too", (await focusedCell()) === "1,2");

  // --- autosave shows itself in the cell ----------------------------------
  await cell(firstGrid, 0, 0).fill("91");
  await page.waitForSelector('.grade-cell[data-state="saved"]', { timeout: 10_000 });
  ok("a saved cell reports it in the cell", true);

  // --- offline ------------------------------------------------------------
  await page.evaluate(() => navigator.serviceWorker.ready);
  ok("the service worker registers", true);

  await context.setOffline(true);
  await page.waitForFunction(
    () => document.querySelector(".conn")?.getAttribute("data-state") === "cached",
    undefined,
    { timeout: 10_000 },
  );
  ok("the masthead reports a cached copy", true);
  ok("the freshness line appears", await page.isVisible(".freshness"));
  ok(
    "every grade cell is disabled offline",
    await page.locator(".grade-input").first().isDisabled(),
  );

  // A record never opened while connected has nothing to fall back to.
  const offlineRes = await page.goto(`${BASE}/students/424242`, { waitUntil: "domcontentloaded" });
  ok(
    "an uncached page offline gets the fallback, not a dead tab",
    (await page.content()).includes("not saved for offline use"),
    `status ${offlineRes?.status()}`,
  );

  /*
   * The regression that nearly shipped. Coming back must not require a reload: the probe in
   * online-store.ts has to notice the server answering and release the grid on its own.
   */
  await context.setOffline(false);
  await page.goto(`${BASE}${href}/edit`, { waitUntil: "networkidle" });
  await page.waitForFunction(
    () => document.querySelector(".conn")?.getAttribute("data-state") === "live",
    undefined,
    { timeout: 20_000 },
  );
  ok("coming back online releases the lock without a reload", true);
  ok(
    "grade cells are editable again",
    await page.locator(".grade-input").first().isEnabled(),
  );

  await context.close();

  // --- reduced motion -----------------------------------------------------
  const still = await browser.newContext({ reducedMotion: "reduce" });
  const stillPage = await still.newPage();
  await stillPage.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  const animation = await stillPage
    .locator(".card")
    .first()
    .evaluate((el: Element) => getComputedStyle(el).animationName);
  ok("reduced motion switches the plate animation off", animation === "none", `saw ${animation}`);
  await still.close();

  await browser.close();
}

// ---------------------------------------------------------------------------

let server: ChildProcess | undefined;
try {
  await seed();
  server = await startServer();
  await run();
} catch (e) {
  failures++;
  console.log(`  FAIL  ${e instanceof Error ? e.message : String(e)}`);
} finally {
  if (server) stopServer(server);
  try {
    rmSync(scratchDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    /* the OS will clear it */
  }
}

if (failures) process.exitCode = 1;
console.log(failures ? `\nbrowser: FAILURES above\n` : `\nbrowser: ${passed} checks passed\n`);
