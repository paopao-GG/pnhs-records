# PNHS Records — SF10 Demo

Learner permanent record system for **Pantao National High School** (School ID 301860,
Libon, Albay, Region V). Search a learner, read their whole scholastic record, encode
grades, and print a correctly formatted SF10.

> **The database starts empty.** Records get in either by importing the school's existing
> SF10 files (**Import**) or by adding them by hand (**New record**).

## Running it

```bash
npm install         # first time only
npm run db:migrate  # create/upgrade the database
npm run dev         # http://localhost:3000
```

**The app requires a sign-in.** Create the first account once, from this machine:

```bash
# PowerShell
$env:PNHS_ADMIN_PASSWORD = 'a long passphrase you will remember'
npm run create-admin -- --username registrar --name "Hilda S. Secillano"
```

The password comes from the environment rather than an argument so it does not land in your
shell history. Every account after that is created from **Accounts** in the app, by an admin.

The database and the school's own details (name, ID, district, division, region, principal)
are created by `db:migrate`. Development also applies the schema on first use, so `npm run dev`
alone works on a fresh clone — but run `db:migrate` after any schema change, and always before
deploying.

By default everything lives in a local file at `data/pnhs.db`. Set `TURSO_DATABASE_URL` and
`TURSO_AUTH_TOKEN` to point the same code at a hosted libSQL database instead; nothing else
changes.

## Importing

Two ways in, both under **Import**:

- **Choose files** — pick one SF10 or several with the file picker.
- **Or scan a whole folder** — type the folder path, **Scan folder**, then **Import**.

Re-running either is safe. Files are identified by content hash, so importing the same folder
twice imports nothing the second time, and byte-identical duplicates collapse to one learner.
A re-imported file replaces that learner's SHS terms rather than appending a second copy.

A file counts as already-imported **only while the learner it produced still exists**. Delete
a record and re-import its file and the record comes back — the hash on its own is not treated
as "seen". The same rule means a file that failed to parse can be retried once the reason it
failed is fixed.

Nothing is ever silently dropped. Records with something odd about them — an LRN that is not
12 digits, a birthdate the form recorded badly — still import in full, and the problem is
listed under **Needs review** with the exact cell it came from. The school's real files
contain all of these.

**Three formats are supported**, detected from the file's contents rather than its name:

| Format | File | Notes |
|---|---|---|
| SF10-SHS | `.xlsx`, sheets `FRONT`/`BACK` | Prints back to the SF10 template |
| SF10-JHS | `.xlsx`, sheets `Front`/`Back` | Prints back to the SF10 template |
| Form 137 | `.docx` | Pre-K-12 record. **Archive only — never reprinted.** |

Form 137 is the old *Secondary Student's Permanent Record*, First to Fourth Year. Those
learners have no LRN (the system postdates them) and their records cannot be reissued on a
modern SF10, because that would state a curriculum they never studied. The original document is
kept and can be downloaded from the record page instead.

## How printing works

This is the part worth understanding, because it is what makes the output acceptable to
DepEd.

The app does **not** redraw the SF10. It opens the school's own template as a zip, rewrites
only the two worksheet XML parts that hold learner data, and leaves everything else
byte-identical — logos, fonts, column widths, the 74% print scale, printer settings, form
controls. A fidelity check (`npm run verify`) proves 23 of the 26 internal files come
through untouched.

It also writes **inputs only**. Final ratings, general averages and PASSED/FAILED are
formulas that belong to the template; the app sets a recalculate-on-load flag and lets
Excel compute them. That means the printed form independently re-derives every number the
screen shows — so a disagreement between them is a bug the print catches for free.

Two rows are exceptions, and the code knows it: JHS **Homeroom Guidance** and **CAT** carry
no AVERAGE formula on the form, so their final rating is entered by hand rather than
computed.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the app |
| `npm run db:migrate` | Apply the schema and any pending migrations, and report what changed |
| `npm run create-admin` | Create the first admin account (see above) |
| `npm run import:dry` | Parse a folder of SF10 files and report what would be imported, writing nothing |
| `npm run roundtrip` | Prove file → database → printed form loses nothing |
| `npm test` | Check grade arithmetic against the template's formulas |
| `npm run verify` | Prove the template survives filling byte-for-byte |
| `npm run spike` | Validate all 786 mapped cells, write sample forms |
| `npm run check` | Generate SF10 files straight from the database |

## Layout

```
app/                    Next.js pages, print + upload routes, server actions
lib/xlsx/               Zip-level workbook reader/writer (style-preserving)
lib/sf10/               Cell maps for both forms, the Sf10Record contract, parser, exporter
lib/import/             Import orchestration — hashing, dedup, issue recording
lib/db/                 Schema access and the DB -> Sf10Record bridge
lib/db/client.ts        One libSQL driver, pointed at a local file or a hosted database
lib/auth/                Sign-in: password hashing, sessions, lockout, the requireUser guard
lib/grading.ts          DepEd grade rules, used by the UI and re-run on save
db/schema.sql           Twelve tables
docs/technical-design.md  How and why it works — read before changing lib/sf10 or lib/xlsx
templates/              The school's official SF10 files — treat as read-only
data/pnhs.db            The records database (git-ignored)
```

**[docs/technical-design.md](docs/technical-design.md)** is the handover document: the
constraints the DepEd form imposes, the invariants that must not be broken, and the bugs that
have already been paid for once.

## Accounts

Two roles. Both can search, view, print, import, add, edit and delete; an **admin** can also
issue accounts, reset passwords and deactivate people.

Every page, server action and API endpoint checks the session for itself. `middleware.ts` only
redirects a visitor with no cookie to the sign-in page — it runs on the Edge runtime and cannot
verify anything, so it is a convenience, not the guard. **Anything added later that touches
learner data starts with `requireUser()`.**

Sign-ins are locked out for 15 minutes after 5 failures, counted in the database rather than in
memory so the limit still holds when more than one server instance is running. Changing a
password or deactivating an account ends that person's other sessions immediately.

Keep **two** admin accounts. Only an admin can issue accounts or reset a password, so a single
admin who is away is a system nobody can administer.

## Notes for the next build

- **Deployment** — `data/` currently sits inside a OneDrive-synced folder. While the database
  is a local file, move it somewhere unsynced: SQLite and file-sync tools corrupt each other.
  Pointing at a hosted database (`TURSO_DATABASE_URL`) sidesteps this entirely.
- Not yet built: remedial-class records, the certification section, backups.
