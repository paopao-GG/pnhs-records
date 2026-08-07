# PNHS Records — SF10 Demo

Learner permanent record system for **Pantao National High School** (School ID 301860,
Libon, Albay, Region V). Search a learner, read their whole scholastic record, encode
grades, and print a correctly formatted SF10.

> **The database starts empty.** Records get in either by importing the school's existing
> SF10 files (**Import**) or by adding them by hand (**New record**).

## Running it

```bash
npm install     # first time only
npm run dev     # http://localhost:3000
```

The database and the school's own details (name, ID, district, division, region, principal)
are created automatically on first run.

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

**SHS only for now.** JHS import needs a real filled SF10-JHS to build and verify against.

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
lib/grading.ts          DepEd grade rules, used by the UI and re-run on save
db/schema.sql           Eight tables
docs/technical-design.md  How and why it works — read before changing lib/sf10 or lib/xlsx
templates/              The school's official SF10 files — treat as read-only
data/pnhs.db            The records database (git-ignored)
```

**[docs/technical-design.md](docs/technical-design.md)** is the handover document: the
constraints the DepEd form imposes, the invariants that must not be broken, and the bugs that
have already been paid for once.

## Notes for the next build

- **The importer** — reading the school's existing filled SF10 files into the database. The
  cell maps needed for it already exist; this is the main remaining piece before real use.
- **Deployment** — `data/` currently sits inside a OneDrive-synced folder. Before this runs
  for real, move the database somewhere unsynced: SQLite and file-sync tools corrupt each
  other.
- Not yet built: remedial-class records, the certification section, backups, access PIN.
