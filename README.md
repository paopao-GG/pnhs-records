# PNHS Records — SF10 Permanent Records

Learner permanent record system for **Pantao National High School** (School ID 301860,
Libon, Albay, Region V). Search a learner, read their whole scholastic record, encode
grades, and print a correctly formatted SF10.

It is a **Windows desktop application**. Everything runs on the machine it is installed on —
the records, the imported originals, the templates. There is no server, no account, and no
network involved at any point.

> **The database starts empty.** Records get in either by importing the school's existing
> files (**Import**) or by adding them by hand (**New record**).

## Installing and using it

Run `PNHS-Records-Setup-<version>.exe` and open **PNHS Records** from the Start menu. It
installs for the current user only, so it needs no administrator, and it lands in
`%LOCALAPPDATA%\Programs\PNHS Records`.

### What the PC needs

| | |
|---|---|
| Windows | **10 (64-bit) or 11.** Electron 40 dropped Windows 7, 8 and 8.1 |
| Processor | 64-bit Intel or AMD. The build is x64 only; an ARM PC would emulate it, untested |
| Memory | 4 GB. The app itself uses around 400 MB |
| Disk | About 700 MB for the app. Allow 2 GB, and another 1 GB if you load the school's full archive of original files |
| Anything else | **Nothing.** No .NET, no Visual C++ redistributable, no internet connection — at install time or ever |

> ### Installing on a second PC gives you a second, separate set of records
>
> There is no sync. Two installations are two databases that never see each other, and copying
> the database onto a shared network drive corrupts it — see
> [docs/production-design.md](docs/production-design.md) §5.
>
> If you are **replacing** a machine rather than adding one, follow *Moving to a replacement
> PC* below. If you genuinely need two people working on the same records at once, that is a
> different system and it needs designing.

**The first launch asks you to choose a password.** It is asked for every time the app is
opened, and after thirty minutes of no use. There are no accounts and no usernames — one
password opens the app, and everyone who uses this machine shares it.

> **Nobody can reset that password.** There is no administrator to ask and no recovery
> address. If it is forgotten, the way back is a backup. Write it down somewhere the records
> themselves are not.

Change it under **Settings**, which also holds the backup button and says where the records
are kept.

## Where your data lives

```
%LOCALAPPDATA%\PNHS Records\
  pnhs.db          the records
  originals\       every file ever imported, kept forever
  backups\         whatever the backup button has written here
```

Two things about that folder:

- **Uninstalling the app does not delete it.** The uninstaller deliberately leaves it alone.
  Removing the school's permanent records is not something a checkbox should do.
- **Do not move it into OneDrive**, or any other syncing folder. File-sync clients copy a
  database while it is being written and hand back something that is not a database. This is
  also why it is in Local AppData rather than Roaming, which a domain network may sync.

## Backing up — read this one

One machine holds the only copy of thousands of children's permanent records, and the disk in
it will eventually fail.

**Settings → Back up now** copies the database and every imported original to a folder you
choose. `npm run backup` does the same from the command line, which is what to schedule with
Task Scheduler.

Three rules, none of which the app can enforce:

1. **A copy must leave the building.** An encrypted external drive taken home covers the fire,
   the flood and the theft. A second copy on the same desk covers none of them.
2. **An untested backup is a hypothesis.** Restore one occasionally and open a learner:
   ```powershell
   $env:PNHS_DATA_DIR = 'E:\pnhs-backup-2026-08-18-1030'; npm run dev
   ```
3. **The password gates the app, not the file.** Anyone who can read `pnhs.db` has the records
   whatever the app asks for. Turn on BitLocker, and encrypt the backup drive.

## Updating an installed copy

Records are never at risk from an update. They live in `%LOCALAPPDATA%\PNHS Records\`, which is
outside the folder the installer replaces, and the app copies the database aside before
applying any schema change — see *Upgrade safety* below.

On the machine you build from:

1. **Bump `version` in `package.json`** — `0.1.0` to `0.1.1`.
2. `npm run build:desktop`
3. Copy the new `dist/PNHS-Records-Setup-<version>.exe` to the school's PC and run it.

It replaces the old installation in place. Shortcuts, the password and every record stay as
they were.

Two ways to get this subtly wrong, both silent:

- **The version bump is not cosmetic.** Windows uses it to recognise the new installer as an
  upgrade of the old one rather than a repair of the same version.
- **Never change `appId` or `productName`** in [electron-builder.yml](electron-builder.yml).
  Windows identifies the application by those, so changing either installs a *second* copy
  beside the first, with its own Start menu entry — both pointing at the same records.

### Upgrade safety

The first time the app runs after an update, it checks whether the database needs a schema
change. If it does, it writes a complete copy of the database first:

```
%LOCALAPPDATA%\PNHS Records\backups\pre-upgrade-v4-to-v5-<date>\pnhs.db
```

**If that copy cannot be written, the update does not touch the database.** Every screen will
show an error instead, which is deliberate: changing records that could not be backed up first
is the one outcome worth refusing. The usual cause is a full disk. Free some space and open the
app again — the records are untouched and it will pick up where it stopped.

There is one copy per update, and each is a full copy of the database, so they are worth
keeping. Delete old ones by hand if you ever need the space.

## Moving to a replacement PC

Follow this exactly. The shortcut that looks like it should work — copying the whole data
folder while the app is open — is how a database gets corrupted.

**On the old PC**

1. **Settings → Back up now**, choosing a USB drive.
2. Open the folder it wrote and check it holds `pnhs.db` and an `originals` folder.

**On the new PC**

3. Run the installer. Open the app once so it creates its folders, then **close it completely**.
4. Open `%LOCALAPPDATA%\PNHS Records\` and delete these three files:
   `pnhs.db`, `pnhs.db-wal`, `pnhs.db-shm`.

   > The last two are SQLite's working files and they belong to the database you are about to
   > replace. A backup is one self-contained file; leaving another database's working files
   > beside it is exactly the mismatch that corrupts records.

5. Copy `pnhs.db` from the backup into `%LOCALAPPDATA%\PNHS Records\`.
6. Copy everything inside the backup's `originals` folder into
   `%LOCALAPPDATA%\PNHS Records\originals\`.
7. Open the app. **It asks for the old machine's password** — the password lives inside the
   database, so it travels with the records.

**Before retiring the old PC**

8. Search for a learner, open their record, and print an SF10. Keep the old machine until that
   has worked.

## Importing

Pick the files under **Import** — one, or a whole year's worth. Three formats, detected from
the contents of each file rather than its name: **SF10-SHS**, **SF10-JHS** and **Form 137**.

Re-running an import is safe. Files are identified by content hash, so importing the same
folder twice imports nothing the second time, and byte-identical duplicates collapse to one
learner. A re-imported file replaces that learner's SHS terms rather than appending a copy.

A file counts as already-imported **only while the learner it produced still exists**. Delete
a record and re-import its file and the record comes back — the hash on its own is not treated
as "seen". The same rule lets a file that failed to parse be retried once the reason is fixed.

Nothing is ever silently dropped. Records with something odd about them — an LRN that is not
12 digits, a birthdate the form recorded badly — still import in full, and the problem is
listed under **Needs review** with the exact cell it came from. The school's real files
contain all of these.

**Form 137 learners cannot be printed onto an SF10.** Those records predate K-12 and a modern
form would assert a curriculum the learner never studied. They are searchable and readable,
and the original document is offered for download instead — which is why every imported file
is kept.

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

## Working on it

```bash
npm install         # first time only
npm run dev         # http://localhost:3000, data in ./data
```

The schema is applied on first use, so a fresh clone works after `npm run dev` alone. In the
repository the data folder is `./data` beside the code; the installed app is pointed at
`%LOCALAPPDATA%` instead. See [lib/paths.ts](lib/paths.ts).

### Building the installer

```bash
npm run build:desktop     # -> dist/PNHS-Records-Setup-<version>.exe
```

That runs `next build`, copies the assets the standalone server needs beside it, then two
checks, then electron-builder. **Neither check is ceremony** — each stands in front of a failure
that produced a working installer and no error message:

- **`check:bundle`** refuses to package anything that looks like learner data. Next's file
  tracing once swept the live database and twenty Form 137 originals into the bundle, from where
  the installer would have shipped children's records to whoever installed the app.
- **`check:server`** starts the built server and requires this machine's own LAN address to
  refuse the connection. Next binds `0.0.0.0` unless told otherwise; without the one environment
  variable in `electron/main.cjs`, every learner record is served to the school LAN behind
  nothing but a password screen.

### Commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the app in the browser |
| `npm run desktop` | Start the Electron shell against a build |
| `npm run build:desktop` | Build, check the bundle, and package the installer |
| `npm run check:bundle` | Refuse a bundle containing learner data |
| `npm run check:server` | Prove the built server is reachable only on loopback |
| `npm run backup` | Copy the database and originals somewhere else |
| `npm run test:backup` | Prove a backup opens and the learner is in it |
| `npm run db:migrate` | Apply the schema and any pending migrations, and report what changed |
| `npm run import:dry` | Parse a folder and report what would import, writing nothing |
| `npm run roundtrip` | Prove file → database → printed form loses nothing |
| `npm test` | Eight unit suites — grade arithmetic, migrations, Form 137, the password, storage, the backup |
| `npm run test:browser` | Real Chrome: the grid's keyboard model, the unlock screen, the theme |
| `npm run verify` | Prove the template survives filling byte-for-byte |
| `npm run spike` | Validate all 786 mapped cells, write sample forms |
| `npm run check` | Generate SF10 files straight from the database |

### Layout

```
electron/main.cjs       The desktop shell: one instance, loopback server, downloads
app/                    Next.js pages, print + upload routes, server actions
lib/paths.ts            Where the app bundle is, and where the data goes
lib/xlsx/               Zip-level workbook reader/writer (style-preserving)
lib/sf10/               Cell maps for both forms, the Sf10Record contract, parser, exporter
lib/import/             Import orchestration — hashing, dedup, issue recording
lib/db/                 Schema access and the DB -> Sf10Record bridge
lib/auth/               The password gate: hashing, unlock sessions, the requireUnlocked guard
lib/blob/store.ts       Where imported originals live on disk
lib/backup.ts           VACUUM INTO, plus a copy of originals/
lib/grading.ts          DepEd grade rules, used by the UI and re-run on save
db/schema.sql           Eleven tables
templates/              The school's official SF10 files — treat as read-only
```

**[docs/technical-design.md](docs/technical-design.md)** is the handover document: the
constraints the DepEd form imposes, the invariants that must not be broken, and the bugs that
have already been paid for once.

### The guard

Every page, server action and API route calls `requireUnlocked()` for itself. There is no
middleware and no ambient protection to inherit — **anything added later that touches learner
data starts with that line.**

It is tempting to think a local app does not need it. The app is an HTTP server listening on
loopback, and every process running as this user can send it a request. The server binds
`127.0.0.1` explicitly for the same reason; on `0.0.0.0` the school LAN could read every record
in the building.

## Notes for the next build

- **Not built:** remedial-class records and the certification section.
- **`docs/patch-1.md` asks for a report card** (SF9 / Form 138) that can be imported and
  printed. It is a separate form with its own template, cell map, parser and print path, and
  it needs the school's blank form plus a few filled examples before it can be specified.
- **`docs/patch-1.md` also asks for two roles**, Admin and Adviser. That predates the move to a
  local single-password app and was superseded by it. If roles are ever wanted back, they need
  accounts back with them — one password cannot express two permission sets.
