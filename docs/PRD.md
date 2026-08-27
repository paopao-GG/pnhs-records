# PNHS Records — Product Requirements Document

**Product:** Learner permanent record system for Pantao National High School
**Status:** Delivered as a **local Windows application**. Written **as-built**.
**Version:** 2.0 · 18 August 2026
**Owner:** Commissioned build (solo)

> **What changed in 2.0.** Version 1.0 described a hosted web application with two-role
> accounts, running on Vercel with a Turso database and a Cloudflare R2 bucket. The school's
> requirement changed after delivery: it is now an **Electron application installed on the
> registrar's PC and opened with one password**. Accounts, object storage and the offline
> service worker are removed. Every claim about the SF10 itself — the fidelity guarantee, the
> round trip, the three importers — is unchanged and re-verified.

**Companion documents.** This PRD is the summary layer. It does not repeat what those documents
hold, and where they disagree with this one, they win:

| Document | What it holds |
|---|---|
| [technical-design.md](technical-design.md) | How the system works, and the invariants that must not be broken |
| [production-design.md](production-design.md) | The production round's architecture, and the open questions |
| [changes.md](changes.md) | The backlog, and what each built item settled |
| [../README.md](../README.md) | Running, importing, deploying |

> ### What this PRD deliberately leaves out
>
> The template this was written from assumes a product entering a market. This is a commissioned
> internal system for **one school**, with a known user population of roughly a dozen staff and
> no acquisition motion. Four sections are therefore omitted rather than filled with invention:
>
> - **Market sizing (TAM/SAM/SOM)** — there is no market. There is one school and a signed scope.
> - **Competitive landscape** — there is no competitor. There is a status quo, and §2 describes it.
> - **Marketing positioning and launch messaging** — the users are named individuals who were
>   trained in person. §8 covers rollout and support, which is the part that is real.
> - **Team composition and resource planning** — a solo commission. §9 records what was delivered
>   and when, which is the part worth keeping.
>
> Stating the omissions is the point. A PRD that invents a TAM for a school registrar's office is
> less useful than one that says why it did not.

---

## 1. Executive summary

### Problem

Pantao National High School's permanent academic records — the DepEd **SF10** — lived as a folder
of loose `.xlsx` files, one per learner, on the registrar's PC. That arrangement has four failure
modes, all of them realised:

1. **Finding a record means knowing its filename.** There is no search across a thousand files.
2. **Reissuing a record means editing a copy of the form by hand**, which is slow and puts the
   formatting DepEd expects at risk every time.
3. **Nothing is verified.** A mistyped grade or a broken formula looks exactly like a correct one.
   A permanent record that is subtly wrong is indistinguishable from a right one until it matters.
4. **Pre-K-12 records are a separate problem entirely.** The school also holds paper-era **Form
   137** records in `.docx`, which no SF10 tool can read and which cannot legitimately be reprinted
   onto a modern form at all.

### Solution

A Windows application that holds every record in one searchable database and **reprints the
SF10 by filling the school's own Excel template** rather than redrawing it. Records get in by
importing the school's existing files — three formats, detected from content — or by hand.
Everything runs on the machine it is installed on: no server, no account, no network.

The design decision that carries the product: the exporter opens the official template as a zip and
rewrites **only** the worksheet cells that hold learner data, leaving logos, print scale, printer
settings and form controls byte-identical. It writes **inputs only** — final ratings and general
averages stay as the template's own formulas, so every printed form independently re-derives every
number the screen shows. A disagreement between screen and paper is a bug the print catches for
free.

### Impact

| Before | After |
|---|---|
| A folder of `.xlsx` files, found by filename | One search box, whole-index, sub-second |
| Reissue by hand-editing a copy | One click, template fidelity proven byte-for-byte |
| Pre-2011 records unreadable and unsearchable | Imported, searchable, original preserved for reissue |
| Anyone who sits down can read every record | A password on opening, and after 30 minutes idle |
| Backup = copying a file, if remembered | A button in Settings, plus a schedulable command |

### Key metrics — all verifiable by running a command

| Metric | Target | Actual |
|---|---|---|
| Data lost in file → database → printed form | Zero | **52 of 52 records survive** (`npm run roundtrip`) |
| Template internals preserved on fill | No loss of logos/settings/controls | **23 of 26 entries byte-identical** (JHS), 22 of 25 (SHS) (`npm run verify`) |
| Mapped cells verified safe to write | 100% | **786** — 449 JHS + 337 SHS (`npm run spike`) |
| Real school files importing | All | **72 of 72** — 22 SHS, 30 JHS, 20 Form 137 |
| Automated checks | — | **Eight unit suites + browser checks through real Chrome** |
| Accessibility | WCAG 2.1 AA | Verified across **36 contrast pairs**, both themes |
| Learner data in the shipped installer | Zero | Asserted by `npm run check:bundle`, which is why it exists |

### Delivery status

Delivered as an installer. The one item that was scoped and never built — offline **sync** — no
longer exists: it was gated on a question about what offline was for, and putting the records on
the machine that reads them answered it by removing the problem. See
[production-design.md](production-design.md) §5.

---

## 2. Context and baseline

### What it replaces

Not a competitor — a status quo. The alternatives considered were: keep the folder of files
(free, and every failure above persists), buy a commercial SIS (priced for districts, and none
fill *this school's* SF10 template), or build. The build was commissioned because the template
fidelity requirement is the whole problem and no general tool solves it.

### Evidence base

Requirements came from the school's real files rather than from interviews about them, and the
files were the more reliable source. Every branch in
[`lib/sf10/normalise.ts`](../lib/sf10/normalise.ts) exists because of something in this list:

| Found in the real files | Consequence |
|---|---|
| Birthdates stored as Excel serials (`37896`) | Converted, epoch 1899-12-30 |
| A birthdate reading `06/09/200` — a year short | **Kept verbatim and flagged.** Correcting it would be inventing a fact about a person |
| LRNs of 11, 12 and 14 digits | Kept and flagged; length is not enforced |
| `Ň` (N with caron) where `Ñ` was meant — `BIBLAŇAS`, `CAŇETA`, `PEŇAFLOR` | Why LRN, never name, is the identity key |
| Genuine typos (`Fundammentals of Accountancy…`) | Stored verbatim. Never re-word a permanent record |
| Form 137 finals that are **not** the mean of their quarters (`75,80,85,87` → `83.20`) | Never recompute an old-curriculum final |
| Form 137 text broken mid-word (`FEM ALE`, `Gen. Av e: 80`) | Runs joined per paragraph, labels matched tolerantly |
| One file (`PALIZA`) containing the same learner's form twice | First copy imported, rest flagged |
| 72 real files averaging **180 KB** | The capacity model in [production-design.md](production-design.md) §6 |

**The governing principle this evidence produced: flag, never drop.** A record with a suspect LRN
still imports in full, with the problem recorded against the exact source cell. A learner with a
mistyped LRN is still that learner's permanent record; refusing the import leaves them with none.

---

## 3. Users and journeys

Roughly a dozen staff, sharing one machine and one password. There are no roles: whoever opens
the app can do everything.

### Registrar

Custodian of the records and the primary user. Handles reissue requests, encodes and corrects
grades, runs the bulk import of the archive, keeps the backups.

*Goals:* find any learner in seconds; produce a correct SF10 on request; never lose a record.
*Pain points the product targets:* filename-based search, hand-editing forms, no undo, no backup.
*Constraint that shaped the UI:* reads this grid for hours. Legibility beats decoration
everywhere it competes — see §6.

### Adviser

Encodes their own section's grades each term, at the same machine.

**Everyone sees every learner, and everyone can do everything.** That was already true of the
account system — there was never an adviser-to-section mapping, because sections change yearly
and a small school covers for itself — and it is now the only possible arrangement.

*What this costs, stated plainly:* the accounts version could say who changed a grade.
`record_history` still records what changed, from what, to what and when, which is what makes
autosave-with-no-undo recoverable. It no longer records who. On a single shared office machine
there was never much of an answer to give, but the school should be told rather than left to
assume otherwise.

`docs/patch-1.md` asks for a sharper role split. It predates this design and is answered there.

### The four journeys that matter

| Journey | Path | Notes |
|---|---|---|
| **Open the app** | Double-click → password → search | Asked every launch and after 30 minutes idle. Nobody can reset it |
| **Reissue a record** | Search → record → *Print SF10* → Save dialog → filled `.xlsx` | The most common task. Form 137 learners get their original document instead — the form cannot legitimately be reprinted |
| **Encode a term** | Search → record → *Edit* → type into the grid | No Save button. Each cell saves 700 ms after typing and reports its own state |
| **Load the archive** | *Import* → pick files → progress → tallies + per-file result | Re-running is safe: files are identified by SHA-256, so nothing imports twice |
| **Clear flagged items** | *Needs review* → per-item *Checked* | Populated by import; clearing a flag never changes a grade |
| **Back up** | *Settings* → *Back up now* → a removable drive | The only thing standing between a failed disk and losing the records |

---

## 4. Goals and success criteria

Framed as acceptance criteria that can be *run*, not as adoption metrics that would have to be
invented.

| # | Objective | Criterion | Met by |
|---|---|---|---|
| G1 | A reissued SF10 is indistinguishable from one the school produced | Template internals survive filling; every number re-derived by Excel | `npm run verify`, §4.2 of technical-design |
| G2 | Nothing is lost between the file and the print | Round trip through the database loses no field | `npm run roundtrip` — 52/52 |
| G3 | Every real file the school holds can be taken in | All three formats, including both Form 137 storage variants | `npm run test:f137` — 20/20 |
| G4 | A wrong record is visible, not silent | Anything suspect is flagged with its source cell and surfaced in a queue | `import_issues`, `/import/review` |
| G5 | Every change is recoverable | When, old → new, for every field, written in the same transaction as the change | `record_history`. *No longer answers "who" — see §3* |
| G6 | The records survive the machine | A backup that is a consistent snapshot, taken to a drive that leaves the building | `VACUUM INTO` in `lib/backup.ts`; the schedule is the school's |
| G8 | No learner data leaves the machine | The installer contains none; nothing is fetched or sent at runtime | `npm run check:bundle`; loopback binding in `electron/main.cjs` |
| G7 | Usable by staff reading it all day | WCAG 2.1 AA in both themes; the grid is fully keyboard-driven | 36 contrast pairs verified; browser checks |

### Early-warning indicators

Things that mean something is going wrong, worth watching rather than measuring:

- **The review queue growing without being cleared** — imports are producing more doubt than the
  registrar can absorb.
- **A backup that has never been restored.** An untested backup is a hypothesis, and it is now
  the only copy of the records that exists anywhere.
- **The date on Settings drifting.** It shows when the password was last changed; the backup
  cadence is the thing to watch beside it.
- **`record_history` growth**, which is unbounded by decision-not-yet-taken (§10).

---

## 5. Feature requirements

MoSCoW, as-built. Everything under Must and Should is delivered.

### Must — delivered

| Feature | Notes |
|---|---|
| Search the whole learner index | Client-side, accent-folded, matches name and LRN |
| View a complete scholastic record | Sticky identity rail beside one plate per enrolment term |
| Print a correctly formatted SF10 (JHS and SHS) | Fills the school's own template; inputs only |
| Import SF10-SHS, SF10-JHS and Form 137 | Format detected from content, never from filename |
| Deduplicate by content hash | Re-importing a folder imports nothing already present |
| Flag anomalies without dropping data | `import_issues` + a review queue |
| Encode and correct grades | Autosave per cell, full keyboard navigation |
| A password on opening | Set on first launch, scrypt-hashed. Lockout, minimum policy, idle re-lock |
| Record every change | `record_history`, append-only. See §3 for what it stopped recording |
| Preserve every imported original | For Form 137 the original **is** the reissuable artefact |
| Install and run with no network | One `.exe`. Nothing is fetched or sent at any point |
| Back up from inside the app | `VACUUM INTO` plus a copy of every original, to a folder of your choosing |

### Should — delivered

| Feature | Notes |
|---|---|
| Print selected grade levels | Rather than always every term of that form type |
| Add subjects individually, reorder them | Position is data: it decides the printed row and which subjects count toward the general average |
| Three- or four-period grading | Both are real in the school's files |
| Light/dark, light by default | Toggle in the masthead, reachable before the app is unlocked |

### Won't — deliberately excluded, with reasons

These are decisions, and each is written up where a developer will find it:

| Excluded | Why | Where |
|---|---|---|
| **Reprinting Form 137 onto an SF10** | It would assert a curriculum the learner never studied. Archive-only, enforced in `buildSf10Record` — hiding the button alone left the endpoint reachable by URL | changes.md #7 |
| **Soft delete and restore** | Would silently re-break the importer's dedup rule; the required query change is written out in advance | production-design §4 |
| **Offline editing with sync** | ~4–6 weeks, gated on what offline was *for*. Dissolved: the records are on the machine that reads them | production-design §5 |
| **Accounts and roles** | Built, then removed with the hosted deployment. One password cannot express two permission sets | production-design §4, patch-1.md |
| **Encrypting the database file** | The password gates the app, not the file. Doing it properly needs a different SQLite driver and would break the verification scripts' "same driver that ships" property. Disk encryption on the machine is the proportionate answer | production-design §6 |
| **Multi-machine installs** | Two installs are two databases and no server to arbitrate. Putting the file on a network share is the corruption scenario this design avoids | production-design §5 |
| **Invented app icons** | A made-up crest on a government record system is a claim the school did not make | — |

### Out of scope

The `ANNEX` sheet, remedial-class records, and the certification section — read by nothing and
written by nothing.

### Requested, not yet specified

The **report card (SF9 / Form 138)** in `docs/patch-1.md`. A fourth form with its own template,
cell map, parser and print path. Blocked on the school providing a blank form and a few filled
examples — every branch in the existing importers exists because of something in a real file,
and designing this one from a blank template would repeat guesswork already paid for once.

---

## 6. User experience requirements

### Principles

1. **Numbers win.** Wherever a grade, an LRN or a count appears, legibility and tabular alignment
   beat every other consideration. The visual softening of the interface stops at the grid.
2. **State is permanent chrome, never a toast.** A toast tells you once, while you are looking
   elsewhere, then deletes the evidence. Save state persists in the cell it belongs to. The
   connection indicator this principle was written for is gone with the network it described.
3. **No modals.** Every destructive or optional flow is progressive disclosure — deleting requires
   typing the learner's LRN into a panel that expands in place.

### Key interactions

- **Autosave.** Grades save 700 ms after typing; learner details on blur. No Save button anywhere
  except Create, Unlock and Settings. Save state lives **in the cell** as an underline that fills,
  not in a floating indicator: forty cells saving independently need forty answers, and one
  spinner only says that *something* saved.
- **Keyboard model in the grid.** Enter/↓ move down a column, Tab across, and **arrow keys are
  re-bound so they cannot silently increment a mark** — on `<input type="number">` they otherwise
  would. A safety property, not an ergonomic one; covered by a browser check.
- **Unlocking.** One password field, no username. On a machine that has never been used it
  offers to *set* the password instead of asking for it, and says plainly that nobody can reset
  it. The app locks itself after 30 minutes idle and whenever it is closed.
- **Printing is a download.** The Electron shell shows a Save dialog defaulting to Downloads,
  rather than saving silently — the registrar is producing a document for somebody and needs to
  know where it went.

### Information architecture

Flat. One masthead on every screen; search is the home page. Eight routes: `/unlock`, `/`
(search), `/students/[id]`, `/students/[id]/edit`, `/students/new`, `/import`, `/import/review`,
`/settings`.

### Accessibility — WCAG 2.1 AA

- **Contrast verified by computation, not by eye:** all **36** foreground/background pairs clear
  4.5:1 in both light and dark. Two tokens were tightened during verification, including one that
  cleared on a white plate and quietly failed against the page ground.
- **Atkinson Hyperlegible** sets all UI text and headings — drawn by the Braille Institute to keep
  characters distinguishable for low-vision readers. Not a niche concern in an office reading names
  and six-digit numbers all day.
- Full keyboard operation of the encoding grid; visible focus on every control;
  `prefers-reduced-motion` disables all animation.
- **Light is the default and the OS preference is not consulted** — on shared office machines, an
  app that looks different from the one beside it is a surprise that costs more than the
  convenience.

### Performance

- Self-hosted typefaces, no runtime fetches of any kind. This was a preference when the app was
  hosted and is now a fact: there is no network to fetch over.
- Server components query the database directly; no API round trip for page rendering, and the
  database is a file on the same disk.
- Startup is the one number the desktop shape added: the shell waits for the server to answer
  before showing a window, and the first launch on a new machine also creates the schema.

---

## 7. Technical considerations

Summary only. [technical-design.md](technical-design.md) is the authority and holds the
invariants.

| | |
|---|---|
| **Platform** | Windows desktop. A Next.js 15 / React 19 application inside an Electron shell, served on `127.0.0.1` |
| **Distribution** | `PNHS-Records-Setup-<version>.exe`, NSIS, per-user install — no administrator needed |
| **Data** | 11 tables, plain SQL, no ORM, one SQLite file in `%LOCALAPPDATA%`. Subjects are rows, not columns — SHS lists vary by track |
| **Integrations** | None, and now structurally none: nothing is fetched or sent at any point |
| **Scale** | Modelled at 5,000 learners: ~200k subject rows, ~900 MB of originals, 40–80 MB database. Existing indexes suffice |
| **Security** | `requireUnlocked()` in every page, action and route — there is no middleware and no ambient protection. API routes answer 401, never a redirect. The server binds loopback |
| **Compliance** | RA 10173 (Data Privacy Act) applies. See §10 |

**Five constraints a new developer will otherwise re-break.** Each has already cost this project
once, and each is written up with its evidence in technical-design:

1. **Write inputs only.** Final ratings and averages are the template's shared formulas; writing
   into one breaks its siblings in confusing ways.
2. **Unused subject rows must be cleared.** The blank SHS template pre-prints subject names; a
   learner with 8 subjects once printed a form listing 2 they never took.
3. **A subject's position is data.** `ordinal` decides the printed row, which finals the app owns,
   and which eight subjects count toward the general average.
4. **The server must bind `127.0.0.1`.** Next binds `0.0.0.0` by default, which would put every
   learner's record on the school LAN behind nothing but a password screen.
5. **The build must not ship learner data.** Next's file tracing once swept the live database and
   twenty Form 137 originals into the bundle, silently, producing a working installer.
   `npm run check:bundle` refuses to package it.

---

## 8. Rollout, training and support

*Marketing positioning is not applicable — the users are named individuals. This section covers
the part that is real.*

### Rollout

1. `npm run build:desktop` — builds, checks the bundle, and writes
   `dist/PNHS-Records-Setup-<version>.exe`.
2. Install it on the registrar's PC. **Confirm `%LOCALAPPDATA%\PNHS Records` is not inside
   OneDrive** — it is not by default, and it must not be moved there.
3. First launch: choose the password, with the registrar present. Write it down and put it
   somewhere the records are not.
4. Import the archive through **Import**. The files are already on this disk, so this is the
   normal path now rather than a bulk-load script.
5. Take a first backup to a removable drive from **Settings**, and restore it once to prove it
   works.
6. Schedule `npm run backup` with Task Scheduler, or agree a day of the week for the button.
7. **Turn on BitLocker.** The password gates the app, not the file.

### Decommissioning the hosted deployment

Not optional, and not finished by deleting files from the working tree:

1. Confirm every archived original is present in `%LOCALAPPDATA%\PNHS Records\originals`. The
   R2 bucket is the authority for anything imported through the deployed app.
2. **Revoke the Turso auth token and the three R2 credentials at the provider.** They stay live
   until somebody does.
3. Delete the Vercel project and the bucket, in that order.

### Training and support

- The registrar needs to know four things the system cannot enforce: **nobody can reset the
  password**; backups must be *restored* occasionally to count; one copy must leave the
  building; and the review queue is a work item, not a notification.
- Everyone else needs one thing: **there is no Save button, and there is no undo** — though
  `record_history` means "no undo" never means "unrecoverable".
- There are no accounts to administer, which removes the single-admin availability problem the
  hosted version had and replaces it with a single-password one.

### Feedback

The review queue and `record_history` are the two places the system tells on itself. A queue that
grows without being cleared, or a field corrected repeatedly, are both signals worth reading.

---

## 9. Delivery record

| # | Item | State |
|---|---|---|
| 0 | Migrations — before anything that adds a column | ✅ |
| 1 | Print selected levels; add subjects individually | ✅ |
| 2 | Autosave with `record_history` | ✅ |
| 3 | JHS importer | ✅ |
| 4 | Accounts, two roles | ✅ → removed in 10 |
| 5 | Form 137 importer | ✅ |
| 6 | Deploy to Vercel / Turso / R2 | ✅ → removed in 10 |
| 7 | Security review of the deployed shape | ✅ |
| 8 | Frontend redesign + read-only offline | ✅ → offline half removed in 10 |
| 9 | Offline **sync** | ✖ dissolved by 10 |
| 10 | **Desktop conversion** — paths, one password, Electron, installer | ✅ |

**Migrations were built first for a specific reason:** `CREATE TABLE IF NOT EXISTS` cannot add a
column to a table that already exists — it is a silent no-op. Almost every item after it adds
columns to tables already holding real learner data. That decision paid off again in item 10,
which needed a migration to drop the accounts tables from databases that already had them.

### What the change of direction cost

Items 4, 6 and part of 8 were built, ran with real data, and were then removed. That is real
work discarded, and it is worth being straight about: roughly the accounts system, the
deployment configuration, and the offline shell.

It was not discovered late or wasted through error — the requirement changed after delivery.
Two things limited the damage, both of which were design decisions taken earlier for other
reasons:

- **`lib/db/client.ts` was already the single place the database location is decided**, so
  removing the hosted database was a file, not a search.
- **`lib/blob/store.ts` had a local-disk backing all along**, because the verification scripts
  had to run with no network and no cloud account. Removing object storage meant deleting the
  remote half, not writing a replacement.

Everything that was about *records* rather than *hosting* — three importers, the exporter, the
audit trail, the review queue, the frontend — came through untouched, and `npm run roundtrip`
and `npm run verify` are the evidence.

---

## 10. Risks

Real risks to this system, in this school. Market and adoption risk are not applicable.

The shape of this table changed with the deployment. The hosted version's top risks were about
credentials and a bucket; those are gone, and what replaced them is about one disk and one
password.

| Risk | Severity | Mitigation | State |
|---|---|---|---|
| **The machine fails and the backup was never real.** One disk holds the only copy of thousands of children's permanent records, with no provider replication behind it | **High** | Settings → Back up now, or `npm run backup` scheduled. `VACUUM INTO` for a consistent snapshot. One encrypted copy off-site. Restore one and open a record | Tooling built; **the schedule is the school's to keep** |
| **The password is forgotten.** Nobody can reset it — there is no administrator and no recovery address | **High** | Write it down and store it away from the machine. A backup is the only way back | Accepted; stated on the first-run screen |
| **The disk is read directly.** The password gates the app, not the file. Anyone who can copy `pnhs.db` has every record | **High** | BitLocker on the machine; encrypt the backup drive. Full database encryption was considered and rejected — see §5 | ⚠ **Open — school action** |
| **RA 10173 accountability is unnamed.** Thousands of children's data, including parents' names, occupations and addresses | **High** | Someone must be named accountable. Flagging is not addressing | ⚠ **Open — school action** |
| **Silent print corruption** — a wrong permanent record looks exactly like a right one | **High** | The template re-derives every number independently of the app, so each print cross-checks the screen. Plus `roundtrip` and `verify` | Controlled — this is the product's central safeguard |
| **The old cloud credentials are still live.** The Turso token and three R2 values work until revoked at the provider, whatever is deleted locally | **High** | Revoke them; confirm every original is local first; then delete the project and bucket | ⚠ **Open — see §8** |
| **The build ships learner data.** Next's file tracing once swept the live database and twenty Form 137 originals into the bundle, producing a working installer and no error | Medium | `npm run check:bundle` refuses to package it; `lib/paths.ts` stops it happening | Controlled — both are in place |
| **Nothing distinguishes one operator from another.** New `record_history` rows carry no user | Medium | Accepted cost of removing accounts. Rows written during the accounts round keep their ids; `users` is kept so they still resolve | Accepted; reversal costs accounts — see patch-1.md |
| **A second machine is wanted later.** Two installs are two databases with no server to arbitrate | Medium | Do **not** put the file on a network share. One shared install by Remote Desktop, or go back to hosting | Not needed today; production-design §5 |
| **`record_history` grows without bound.** Autosave writes a row per field change, forever | Low | Set a retention window, or state that unbounded is accepted. Decide while the table is small | ⚠ **Open** |
| **Delete is permanent** — no soft delete, no restore | Low | Typed-LRN confirmation, plus the backup | Accepted; design for reversal in production-design §4 |

---

## Version history

| Version | Date | Change |
|---|---|---|
| 1.0 | 17 Aug 2026 | First PRD. Written as-built, after the frontend redesign and the documentation audit that corrected `technical-design.md` |
| 2.0 | 18 Aug 2026 | The system became a **local Windows application opened with one password**. Accounts, hosting, object storage and the offline shell removed; installer, backup and first-run password added. §§1, 3, 5–10 rewritten |

### Sign-off

| Role | Responsibility | Status |
|---|---|---|
| School (registrar / principal) | Accept delivery; name the RA 10173 accountable person; keep the backup schedule; turn on disk encryption; revoke the old cloud credentials | Pending |
| Build | Delivery, handover documentation, the open items listed above | Complete for scope built |

The offline question this document used to list as the school's to answer is closed. It was
resolved by architecture rather than by a decision — see [production-design.md](production-design.md) §5.

### Maintenance

This is a living document, but it is the **summary** layer. Facts belong in
[technical-design.md](technical-design.md) and [production-design.md](production-design.md); when
this document disagrees with either, they are right and this one is stale. The audit that produced
version 1.0 found `technical-design.md` describing a system three rounds out of date — the same
will happen here if it is updated in isolation.
