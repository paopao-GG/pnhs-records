/**
 * The properties only a real browser can prove.
 *
 * These cover behaviour that lives entirely in the client and that no amount of `fetch` can
 * see. Most of them were written because something shipped broken and was caught by eye:
 *
 *  - **Arrow keys must not change a grade.** On `<input type="number">` the up and down arrows
 *    increment the value by default. The encoding grid binds them to movement instead, so a
 *    stray keypress over a mark on a permanent record moves the cursor rather than silently
 *    rewriting the mark and autosaving it 700ms later. This is a safety property.
 *  - **Vertical movement must stop at the term boundary.** Holding the down arrow past the last
 *    subject of Grade 7 must not land in Grade 8. A grade typed into the wrong year is the
 *    error the grid exists to prevent.
 *
 * ## Runs against its own database and its own server
 *
 * These checks type into grade cells, so they must never reach the school's records. The
 * script builds a scratch database, seeds one learner into it, and starts its own dev server
 * pointed at that file. It deliberately does not accept a URL: a server someone else started
 * is a server pointing at who-knows-what.
 *
 * The first check after unlocking asserts the learner index holds exactly the one fixture
 * record. That is a real assertion about the UI and it doubles as proof that the server under
 * test is not the school's database.
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
 * that ordering guaranteed rather than incidental. See test-unlock.ts for the same guard.
 */
const scratchDir = mkdtempSync(join(tmpdir(), "pnhs-browser-"));
const dbPath = join(scratchDir, "browser-test.db");
process.env.PNHS_DB_PATH = dbPath;
process.env.PNHS_DATA_DIR = scratchDir;

const { applySchema } = await import("../lib/db/index.ts");
const { getClient, LOCAL_DB_PATH } = await import("../lib/db/client.ts");
const q = await import("../lib/db/queries.ts");
const { setPassword } = await import("../lib/auth/unlock.ts");

if (!LOCAL_DB_PATH.startsWith(scratchDir)) {
  console.error(`\n  refusing to run: the database is ${LOCAL_DB_PATH}, not a scratch file\n`);
  process.exit(1);
}

const require = createRequire(import.meta.url);
const PORT = Number(process.env.PNHS_BROWSER_PORT ?? 3931);
const BASE = `http://localhost:${PORT}`;
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

  // The app is opened with one password and has no accounts. Setting it here is what the
  // first-run screen does; these checks start from an installed machine, not a fresh one.
  await setPassword(PASSWORD);

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
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PNHS_DB_PATH: dbPath,
    PNHS_DATA_DIR: scratchDir,
  };

  const child = spawn(process.execPath, [nextBin, "dev", "-p", String(PORT)], {
    env,
    stdio: "ignore",
  });

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/unlock`);
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

  // --- unlock -------------------------------------------------------------
  /*
   * A page behind the guard must send an unauthenticated visitor here rather than render.
   * There is no middleware any more, so this is the only thing standing in front of every
   * record - worth asserting before anything else.
   */
  await page.goto(`${BASE}/students/1`, { waitUntil: "domcontentloaded" });
  ok("a locked app redirects to the unlock screen", page.url() === `${BASE}/unlock`);

  await page.goto(`${BASE}/unlock`, { waitUntil: "networkidle" });
  ok("the unlock screen asks for a password and not a username", !(await page.isVisible("#username")));

  await page.fill("#password", "the wrong phrase entirely");
  await page.click("button[data-variant=primary]");
  await page.waitForSelector(".unlock-error");
  ok("a wrong password is refused", page.url().startsWith(`${BASE}/unlock`));

  await page.fill("#password", PASSWORD);
  await Promise.all([
    page.waitForURL(`${BASE}/`),
    page.click("button[data-variant=primary]"),
  ]);
  ok("the password reaches the learner index", page.url() === `${BASE}/`);

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

  /*
   * --- the typefaces actually arrive --------------------------------------
   *
   * This is here because they did not, for months, and nothing noticed. A stylesheet's
   * `@font-face` request and a `<link rel="preload" crossorigin>` are anonymous — no cookie —
   * so `middleware.ts` saw no session and redirected all six woff2 files to /login, for signed-in
   * users too. The browser got an HTML page where it expected a font and quietly fell back to
   * Segoe UI, which looks close enough that a screenshot pass does not catch it.
   *
   * That middleware is deleted and cannot do it again. The check stays because the failure it
   * describes is about a font arriving as something else, and a packaged app has its own way of
   * getting that wrong: the typefaces are files in `public/`, and an installer that does not
   * ship them fails exactly this way, silently, on the registrar's machine and not on ours.
   *
   * `document.fonts.check` is the assertion that catches it: it reports whether a face is
   * loaded and usable, not merely whether a rule mentioning it was parsed. It runs on the
   * editor because that is the one screen setting all three — the masthead in Fraunces, its own
   * chrome in Atkinson, every grade cell in Plex Mono.
   */
  await page.evaluate(() => document.fonts.ready);
  for (const [label, face] of [
    ["Atkinson", '400 15px "Atkinson"'],
    ["Fraunces", '600 17px "Fraunces"'],
    ["Plex Mono", '400 13px "Plex Mono"'],
  ] as const) {
    ok(
      `${label} is loaded, not silently falling back`,
      await page.evaluate((f: string) => document.fonts.check(f), face),
    );
  }

  // --- learner status -----------------------------------------------------
  /*
   * The fixture learner has Grade 7 and 8 terms and no status, so the page should offer a
   * suggestion rather than assert one. Accepting it is the only way the value is ever written.
   */
  await page.goto(`${BASE}${href}`, { waitUntil: "networkidle" });
  ok("an unconfirmed learner shows a status picker", await page.isVisible(".status-picker"));
  ok(
    "and the status is not pre-filled",
    (await page.locator(".status-picker select").inputValue()) === "",
  );

  /*
   * The fixture's terms carry no promotion remark and no general average, so their outcome
   * cannot be read - and the app declines to guess rather than proposing "enrolled" because
   * that is the safe-looking default. That restraint is the whole reason status is stored
   * rather than derived, so it is worth asserting in the real UI and not only in unit tests.
   */
  ok(
    "no suggestion is offered when the last term's outcome cannot be read",
    (await page.locator(".status-suggestion").count()) === 0,
  );

  // Setting one by hand is the path that always exists, suggestion or not.
  await page.selectOption(".status-picker select", "shs_graduate");
  await page.waitForFunction(
    () => document.querySelector<HTMLSelectElement>(".status-picker select")?.value === "shs_graduate",
  );
  await page.reload({ waitUntil: "networkidle" });
  ok(
    "a status set by hand survives a reload",
    (await page.locator(".status-picker select").inputValue()) === "shs_graduate",
  );

  // The chip on the search page is what makes "who graduated" answerable at a glance.
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  ok(
    "a confirmed status shows on the search list",
    (await page.locator('.result .chip[data-status="shs_graduate"]').count()) === 1,
  );

  // --- changing a term's grading periods -----------------------------------
  /*
   * The fixture's Grade 7 is four-quarter, which is what every imported record looks like.
   * Switching it to three is the only way such a record ever becomes printable, so the grid has
   * to redraw with one fewer column - and the marks must survive the round trip, because the
   * whole promise of the control is that nothing is thrown away.
   */
  await page.goto(`${BASE}/students/1/edit`, { waitUntil: "networkidle" });
  await page.waitForSelector('[data-encoding-grid] [data-cell="0,0"]');

  const q4Cell = page.locator('[data-encoding-grid]').first().locator('[data-cell="0,3"]');
  ok("the four-quarter term shows a fourth column to begin with", (await q4Cell.count()) === 1);

  const periodSelect = page.locator(".term-periods select").first();
  ok("each Junior High term offers a period count", (await periodSelect.count()) === 1);
  ok("and starts on what the record says", (await periodSelect.inputValue()) === "4");

  await periodSelect.selectOption("3");
  await page.waitForSelector('[data-encoding-grid] [data-cell="0,3"]', { state: "detached" });
  ok("switching to three drops the fourth column from the grid", (await q4Cell.count()) === 0);

  await page.reload({ waitUntil: "networkidle" });
  ok(
    "and the change stuck",
    (await page.locator(".term-periods select").first().inputValue()) === "3",
  );

  // Back again: the marks were kept, so the fourth column returns still populated.
  await page.locator(".term-periods select").first().selectOption("4");
  await page.waitForSelector('[data-encoding-grid] [data-cell="0,3"]');
  const restored = await page
    .locator('[data-encoding-grid]')
    .first()
    .locator('[data-cell="0,3"]')
    .inputValue();
  ok("switching back restores the fourth quarter's marks", restored === "80", `saw "${restored}"`);

  // --- the report card ----------------------------------------------------
  /*
   * The fixture has Grade 7 on four quarters and Grade 8 on three, so exactly one of them can
   * be printed as a report card. That asymmetry is the check: a button per eligible year, and
   * none for the year the form has no layout for.
   */
  await page.goto(`${BASE}${href}`, { waitUntil: "networkidle" });
  const cardLinks = page.locator('a[href*="/sf9?level="]');
  ok("a report card is offered for the three-period year", (await cardLinks.count()) === 1);
  ok(
    "and not for the four-quarter one",
    (await cardLinks.first().getAttribute("href"))?.endsWith("level=8"),
    `href was ${await cardLinks.first().getAttribute("href")}`,
  );

  const card = await page.evaluate(async (u: string) => {
    const res = await fetch(u);
    return { status: res.status, type: res.headers.get("content-type"), size: (await res.blob()).size };
  }, `${BASE}/api/students/1/sf9?level=8`);
  ok(
    "the report card downloads as a Word document",
    card.status === 200 && (card.type ?? "").includes("wordprocessingml") && card.size > 10_000,
    `status ${card.status}, type ${card.type}, ${card.size} bytes`,
  );

  const noCard = await page.evaluate(async (u: string) => (await fetch(u)).status, `${BASE}/api/students/1/sf9?level=7`);
  ok("and the four-quarter year is refused by the endpoint too, not just hidden", noCard === 409);

  // --- the card is filed as it is printed ---------------------------------
  /*
   * Printing is also the act of issuing, so the card lands on the learner's record. Grades move
   * afterwards; without this, "what was this parent actually given" has no answer.
   */
  await page.goto(`${BASE}${href}`, { waitUntil: "networkidle" });
  const filed = page.locator(".ledger a", { hasText: "SF9_" });
  ok("the printed card is filed against the learner", (await filed.count()) === 1);
  ok(
    "and is labelled as a report card",
    (await page.locator(".ledger td", { hasText: "Report Card" }).count()) === 1,
  );

  const filedHref = await filed.getAttribute("href");
  const back = await page.evaluate(async (u: string) => {
    const res = await fetch(u);
    return { status: res.status, size: (await res.blob()).size, type: res.headers.get("content-type") };
  }, `${BASE}${filedHref}`);
  ok(
    "and downloads again as the Word document it was",
    back.status === 200 && (back.type ?? "").includes("wordprocessingml") && back.size > 10_000,
    `status ${back.status}, ${back.size} bytes`,
  );

  // Printing the identical card again is not a second issuance.
  await page.evaluate((u: string) => fetch(u), `${BASE}/api/students/1/sf9?level=8`);
  await page.reload({ waitUntil: "networkidle" });
  ok(
    "reprinting the same card does not file a second copy",
    (await page.locator(".ledger a", { hasText: "SF9_" }).count()) === 1,
  );

  // --- filtering and grouping the list ------------------------------------
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  ok("the list offers filters", await page.isVisible(".filter-bar"));

  // The fixture learner is Grade 8 at furthest, in Sampaguita, and shs_graduate from earlier.
  await page.selectOption('.filter-bar select[aria-label="Filter by grade level"]', "8");
  await page.waitForFunction(() => document.querySelectorAll(".result").length === 1);
  ok("filtering by grade keeps the learner", (await page.locator(".result").count()) === 1);

  /*
   * Grade 7 is deliberately not an option even though the learner has a Grade 7 term: the
   * filter is on their CURRENT grade, the furthest term they have, which is what a registrar
   * means by "who is in Grade 9". So the non-matching case is tested through status instead.
   */
  const gradeOptions = await page
    .locator('.filter-bar select[aria-label="Filter by grade level"] option')
    .allTextContents();
  ok(
    "the grade filter offers the current grade only, not every year attended",
    gradeOptions.join(",") === "All,Grade 8",
    `saw ${gradeOptions.join(",")}`,
  );

  await page.selectOption('.filter-bar select[aria-label="Filter by status"]', "unconfirmed");
  await page.waitForFunction(() => document.querySelectorAll(".result").length === 0);
  ok(
    "a filter matching nobody empties the list",
    (await page.locator(".empty").count()) === 1,
  );

  await page.locator(".filter-bar button", { hasText: "Clear" }).click();
  await page.waitForFunction(() => document.querySelectorAll(".result").length === 1);
  ok("Clear puts every learner back", (await page.locator(".result").count()) === 1);

  await page.selectOption('.filter-bar select[aria-label="Group the list"]', "status");
  await page.waitForSelector(".result-group");
  ok(
    "grouping by status heads the list with the status",
    (await page.locator(".group-head .eyebrow").first().textContent())?.trim() === "SHS Graduate",
    `saw ${await page.locator(".group-head .eyebrow").first().textContent()}`,
  );

  await context.close();

  /*
   * The redirect itself, from a context with no session. `context.request`, not `page.goto`:
   * navigating to a woff2 makes the browser start a download rather than a navigation.
   */
  const fontCtx = await browser.newContext();
  const fontRes = await fontCtx.request.get(`${BASE}/fonts/atkinson-400-latin.woff2`);
  ok(
    "a signed-out request for a typeface is not redirected to sign-in",
    fontRes.status() === 200 && fontRes.headers()["content-type"] === "font/woff2",
    `status ${fontRes.status()}, type ${fontRes.headers()["content-type"]}`,
  );
  await fontCtx.close();

  /*
   * --- the light/dark switch ----------------------------------------------
   *
   * Light is the default and the OS is not consulted, so this context deliberately declares
   * `colorScheme: "dark"`: a machine set to dark must still open the app in light.
   */
  const themeCtx = await browser.newContext({ colorScheme: "dark" });
  const themePage = await themeCtx.newPage();
  const themeOf = () =>
    themePage.evaluate(() => ({
      attr: document.documentElement.dataset.theme ?? "",
      bg: getComputedStyle(document.body).backgroundColor,
    }));

  await themePage.goto(`${BASE}/unlock`, { waitUntil: "networkidle" });
  const fresh = await themeOf();
  ok("a first visit is light even on a dark machine", fresh.attr === "", `data-theme=${fresh.attr}`);

  // The switch lives outside the signed-in block, so sign-in has it too.
  ok("the switch is on the sign-in page", await themePage.isVisible(".theme-toggle"));

  await themePage.click(".theme-toggle");
  const flipped = await themeOf();
  ok("pressing it turns the app dark", flipped.attr === "dark", `data-theme=${flipped.attr}`);
  ok("the ground really repaints", flipped.bg !== fresh.bg, `still ${flipped.bg}`);

  await themePage.reload({ waitUntil: "networkidle" });
  const remembered = await themeOf();
  ok("the choice survives a reload", remembered.attr === "dark");
  ok(
    "and the browser chrome follows it",
    (await themePage.getAttribute('meta[name="theme-color"]', "content")) !== "#ffffff",
  );

  /*
   * The reason the theme script is inline and blocking rather than an effect. At `commit` the
   * document has barely started parsing; if the attribute is already there, the first paint is
   * dark and a dark-mode user never sees a white flash on navigation.
   *
   * `commit` fires when the response is committed, which can be *before* any markup has been
   * parsed — and against a dev server compiling the route for the first time, usually is. Read
   * naively the assertion then passes or fails on whether the document was empty, which tests
   * nothing either way. So this waits for the first sign of parsing and asserts on the same
   * tick: `<body>` must not exist yet, and `data-theme` must already be set. That is the real
   * property — the attribute is there before there is anything to paint.
   */
  const early = await themeCtx.newPage();
  await early.goto(`${BASE}/unlock`, { waitUntil: "commit" });
  const atFirstParse = await early.waitForFunction(
    () =>
      document.head?.childElementCount
        ? {
            theme: document.documentElement.dataset.theme ?? "",
            bodyExists: Boolean(document.body),
          }
        : null,
    undefined,
    { timeout: 10_000, polling: "raf" },
  );
  const early_state = (await atFirstParse.jsonValue()) as { theme: string; bodyExists: boolean };
  ok(
    "the theme is applied before the page paints",
    early_state.theme === "dark",
    `data-theme=${early_state.theme} at first parse (body ${
      early_state.bodyExists ? "already" : "not yet"
    } present)`,
  );

  await themePage.click(".theme-toggle");
  await themePage.reload({ waitUntil: "networkidle" });
  ok("and it switches back", (await themeOf()).attr === "light");
  await themeCtx.close();

  // --- reduced motion -----------------------------------------------------
  const still = await browser.newContext({ reducedMotion: "reduce" });
  const stillPage = await still.newPage();
  await stillPage.goto(`${BASE}/unlock`, { waitUntil: "networkidle" });
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
