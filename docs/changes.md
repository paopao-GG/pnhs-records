# Production backlog

The MVP is working and holds real learner data. This is the agreed scope for taking it to
production, ordered **easiest to hardest** — which is also close to the order it should be
built.

Architecture for the larger items is in
[production-design.md](production-design.md). Current system design is in
[technical-design.md](technical-design.md).

> **Revised after a design review.** The review found four design bugs, two of which would have
> re-broken behaviour already fixed in this project. The corrections are folded in below and
> detailed in production-design. Most consequential:
>
> - **A migration step is now item #0** — the current schema bootstrap physically cannot add a
>   column to an existing table, and almost everything here adds columns.
> - **Offline sync is re-estimated at 4–6 weeks**, and carries an open question that could
>   remove most of it.
> - Soft delete and Form 137 each need a guard in existing code, or they silently undo a
>   decision made elsewhere.

---

## Decisions taken

| Question | Decision |
|---|---|
| Offline access | **True offline editing with sync.** Encode with no network; sync on reconnect. |
| Form 137 | **Import as a searchable archive and keep the original file.** No reprinting a 1990s record onto a modern SF10 form. |
| Autosave | **Saves silently as you type.** |
| Adviser permissions | **Import, add, edit, delete, print.** Admin additionally manages adviser accounts. |

Two of these carry risk, handled in the design without changing the behaviour asked for:

- Autosave with no undo is backed by an append-only **`record_history`** table — every change
  records who, when, and old → new. "No undo" never means "unrecoverable".
- Adviser delete is implemented as **soft delete**. It behaves exactly like deletion (the
  record leaves search immediately) but an admin can restore it, and it is always attributable.

---

## 0. Migrations · ~½ day · **prerequisite for most of this list**

`db/schema.sql` is eight `CREATE TABLE IF NOT EXISTS` statements re-run on every boot. That
works for new tables and **cannot add a column to a table that already exists** — the statement
is simply skipped, silently.

Almost everything below adds columns to tables already holding real learner data: `deleted_at`,
`deleted_by`, `version`, `curriculum`, `units_earned`, guardian fields, place of birth. Without
a migration step, none of them arrive and nothing reports a problem.

- `PRAGMA user_version` plus ordered, append-only steps applied on boot.
- Back up before the first run against real data.

Do this before #4, #6 or #7. See production-design §3.

---

## 1. Print selected grade levels · ~½ day

Choose which grade level or levels go on the printed form instead of always printing every
term for that form type.

- `buildSf10Record()` in `lib/db/to-sf10-record.ts` already filters terms by form — extend it
  to take an explicit level set.
- Checkboxes on the record page; pass levels through to `/api/students/[id]/sf10`.

**No dependencies.** Smallest useful change in the list.

---

## 2. Folder chooser, import only new files · **DONE, then REMOVED**

Built as a server-side folder browser, and deleted again when the target became a serverless
host: it enumerated `process.cwd()`, which there is the deployment bundle rather than the
school's archive. There is nothing on that disk to scan.

Import is now the file picker alone. "Only new" still works and always did — files are
identified by SHA-256, so re-importing takes in nothing already present.

Directory walking survives in `scripts/_local-files.ts` for the scripts, which run on a real
machine pointed at real folders. It is only the *server* that must not.

---

## 3. Add subjects one at a time · ~1 day

When creating a record, start with no subjects and add them individually — click **Add
subject**, pick from that grade level's list, then enter grades.

- Replaces the current behaviour of seeding a fixed subject list.
- The catalogue already exists: `jhsLearningAreas()` in `lib/sf10/jhs-map.ts` and
  `SHS_SUBJECT_TEMPLATES` in `lib/sf10/subject-templates.ts`. Turn them into a picker.
- Allow a free-text subject for anything not in the list — the real files contain subjects the
  standard catalogue does not have.

---

## 4. Autosave and edit history · ~2 days

Grades save as you type, with no Save button.

- Changes **coalesced per field** — one pending save per field, not one per keystroke — with a
  visible saved indicator.
- New **`record_history`** table written on every change: student, field, old value, new value,
  who, when.
- History also satisfies the audit requirement that comes with adding accounts (#6), so this
  work is not spent twice.
- Decide a **retention policy** for that table now, while it is empty. Autosave generates rows
  indefinitely; unbounded is a defensible choice, silence is not.

Needs #0.

---

## 5. JHS importer · ~2 days

Import SF10-JHS files alongside SHS.

**Mostly de-risked already.** `sf10-files/SF10-jhs/` holds 30 genuine school files, and the
existing map in `lib/sf10/jhs-map.ts` reads them correctly — name, LRN and Grade 7 subject rows
all resolve.

- Mirror `lib/sf10/import-shs.ts` against the JHS map.
- Dispatch on sheet names: JHS uses `Front`/`Back`, SHS uses `FRONT`/`BACK`. The casing is a
  clean discriminator.
- Two pieces already anticipate this: `import_files.form` records the form type, and
  `writeRecord()` scopes term replacement by grade level, so importing a learner's JHS form
  will not disturb their SHS terms.

---

## 6. Accounts: admin and adviser · **DONE**

- `users` and `sessions` tables; passwords hashed with `scrypt` from `node:crypto` — **no new
  dependency**.
- Signed, HTTP-only session cookies. Route protection for every page and endpoint.
- Admin screens to create advisers and reset their passwords.
- Every mutating action attributed in `record_history` from #4.
- Login rate limiting and lockout, a minimum password policy, and session invalidation on
  password change or deactivation. Easy to skip, and the reason most small systems get in.

**Soft delete was deliberately left out**, so delete stays permanent and the importer's dedup
query is untouched. If it is added later, the trap is written out in production-design §4: the
join must gain `AND s.deleted_at IS NULL`, or a deleted record can never be restored by
re-importing its file — the bug this project already fixed once, reintroduced by another route.

What the build settled that the plan could not:

- **Middleware cannot be the guard.** It runs on the Edge runtime with no `node:crypto`.
  Importing the cookie name from the auth module dragged the database layer into the Edge bundle
  and failed the build outright — which is the boundary announcing itself. Every page, action and
  route calls `requireUser()` for itself.
- **API routes answer 401, never a redirect.** A caller following a redirect to the sign-in page
  gets HTTP 200 and an HTML form where it asked for a workbook, which reads as success.
- **Rate limiting had to move into the database.** A module-level counter is per-instance memory;
  on a host that runs more than one instance it counts a fraction of the attempts.
- **Deactivation is checked on every request**, not at sign-in. Otherwise a deactivated adviser
  keeps working until their cookie expires, which can be most of a school day.
- **Advisers see every learner** — decided, not assumed. No adviser-to-section mapping exists.

45 browser checks and 15 unit checks cover it, including that a forged cookie is refused and that
an adviser posting directly to the admin route creates nothing.

---

## 7. Form 137 importer · **DONE**

Import the old *Secondary Student's Permanent Record*. All 20 files import; both storage
variants share one normaliser.

What the build settled that the plan could not:

- **No LRN exists on these forms.** A generated `F137-…` key derived from name and birthdate
  keeps identity stable across re-imports; `lrn_placeholder` makes the UI show *No LRN ·
  pre-2011 record* so an invented value is never shown as a real one.
- **A year with printed subject names but no marks is not an attended year.** VILLARAZA
  dropped out in January 2009; importing the blank Third and Fourth Year would have asserted
  enrolment that never happened.
- **Bracketed unit values (`[1.2]`, `(1.2)`) are notation, not negatives** — 143 of the 144 in
  the real files sit against "Passed".
- **`PALIZA` is one learner's form duplicated**, not two learners. First copy imported, rest
  flagged.
- **The print guard belongs in `buildSf10Record`, not just the UI.** Hiding the button left the
  endpoint reachable by URL, and it returned 200 — a 1995 record on a 2017 form. Now 409.

Original documents are stored under `data/originals/` and served by
`/api/students/[id]/original`.

**The 20 files are not one format — they are two:**

| Variant | Files | Grades stored as |
|---|---|---|
| Word tables | **17** (1998–2016) | 8 native `<w:tbl>` tables — straightforward to parse |
| Embedded worksheets | **3** (1995–1998) | 8 embedded Excel workbooks rendered as EMF images |

Both carry the same logical content — 4 years × (grades table + monthly attendance) — so the
two extraction strategies converge on one normaliser. One file (`PALIZA`) has **16 tables**
rather than 8 and needs investigating; it may be a transferee or a two-school record.

Other differences from SF10 that drive schema work:

- **Old curriculum**: First–Fourth Year, subjects like `FILIPINO I`,
  `TECHNOLOGY & HOME ECONOMICS I`.
- **Final ratings are decimals and are not the mean of the quarters** — `75, 80, 85, 87` gives
  a final of `83.20`, not `81.75`. The old form used a different computation. **Store what the
  document says; never recompute.**
- Carries **Units Earned**, **monthly attendance**, **parent/guardian** with occupation and
  address, and **place of birth** — none of which the current schema holds.
- Learner details sit in loose Word text runs broken mid-word (`FEM ALE`, `Year: 19 82`,
  `Gen. Av e: 80`), so parsing means joining runs per paragraph then matching labels
  tolerantly.

The original `.docx` is stored and can be re-served on request.

**`availableForms()` needs a guard.** It decides which print buttons appear purely from grade
level, so a Form 137 learner stored at levels 7–10 would be offered **"Print SF10 JHS"** — a
1995 record on a 2017 form, which is precisely what the archive-only decision rules out. Exclude
terms with `curriculum = 'old'`.

Needs #0.

---

## 8. Offline editing with sync · ~4–6 weeks · **read-only half DONE, sync still open**

> **The cheap column of the table below now exists** — service worker, cached records, a
> permanent `Live`/`Cached` indicator, a freshness timestamp, and editing visibly disabled while
> disconnected. That is the ~2–3 day insurance version, built alongside the frontend redesign
> and covered by `npm run test:browser`. See production-design §5a.
>
> **Everything below this line — the outbox, per-row versioning, conflict resolution, offline
> record creation — is still unbuilt and still gated on the same open question.** If the answer
> is "insurance against downtime", it is already answered and this item is closed.

The architectural change, and roughly three-quarters of this round on its own — everything else
here totals about 13 days.

> **Settle this before building any of it.** The server is on the school LAN, so it already
> works whether or not the internet is up. "No internet" is not by itself a reason for this
> work.
>
> - If advisers genuinely encode grades **away from school** and sync later → build this, 4–6
>   weeks.
> - If the real worry is **the server or network being down** → a UPS plus a read-only cached
>   copy gets you most of the value in ~2–3 days, and most of this item should be deleted.
>
> The answer changes this line item more than any other decision in the document.

If it is being built:

- **An API layer becomes necessary.** Pages currently read SQLite directly inside server
  components, which an offline client cannot do. Read-only pages can stay as they are; the
  record editor and sync move to JSON endpoints.
- Client store in **IndexedDB**: the learner index plus any record opened.
- **Outbox** of queued changes, replayed on reconnect, surviving a browser restart and visibly
  showing what is pending.
- Creating records offline, including **matching by LRN on sync** so two advisers encoding the
  same new transferee merge instead of failing on `UNIQUE(lrn)`.
- **Conflicts** detected with a version on each `term_subjects` row — *not* on the parent term,
  or advisers editing different subjects collide spuriously and learn to dismiss the prompt.
- HTTPS is required for service workers, and a self-signed certificate must be trusted on
  **every** client device or offline silently fails.

See [production-design.md](production-design.md) §5 for the full design.

---

## 9. Deployment · **DONE (code side)**

Deployed to Vercel rather than a home server: the app on Vercel `sin1`, the database on Turso,
original files in a private Cloudflare R2 bucket. See
[production-design.md](production-design.md) §6, which was rewritten for this.

What the change of target settled:

- **Nothing may assume a writable disk.** That drove the whole of Phases 1-3: the database, the
  stored originals and the folder scan each assumed one.
- **Vercel Blob would have run out.** ~900 MB of originals at 5,000 learners against roughly 1 GB
  included. R2 gives 10 GB and charges no egress.
- **Backups stopped being free.** Copying `data/pnhs.db` was something the registrar could do
  without being told. `npm run backup` replaces it, and now has to be scheduled and *tested* —
  the single biggest operational regression from leaving the local machine.
- **Vercel Hobby is non-commercial-use only**, which this system is not. Accepted knowingly.

`npm run smoke -- <url> --write` verifies a running instance: the 401s, the 409 archive-only
guard, and a file through ticket → object storage → import → byte-identical download.

Remaining and not code: create the Turso database, create the Vercel project, set the
environment variables, add the deployed origin to the R2 CORS rule, and schedule the backup.

---

## 10. Security review of the deployed shape · **DONE**

A review of everything #6 and #9 added. Three findings were worth stopping for, and all three
were places where a rule was written down correctly and enforced somewhere it did not reach.

**The browser chose its own upload key.** The presigned PUT was scoped to a key derived from the
SHA-256 the *client* stated, so a signed-in caller could name an archived original and have R2
overwrite it. The comment defending this said a dishonest hash "only lets a caller write to a key
nobody will look for" — true of the database row, which the importer keys by a hash it recomputes,
and false of the object, which had already been replaced. A Form 137 is the only reissuable copy
of a pre-K-12 record. Upload keys are now random and generated server-side, in a separate
`uploads/` namespace that cannot name anything in the archive, and are deleted after import.

**Deleting a learner did not delete their file.** `deleteOriginal()` had no callers outside a
test. `deleteStudent()` cleared the learner but left the document — parents' names, occupation,
home address — in the bucket indefinitely, for a record the registrar had been told was gone.
`deleteRecord()` now removes the object after the row, in that order: a failure between the two
orphans a file, and the reverse order destroys the file of a record that survives.

**A background prune could take down the sign-in route.** `void pruneOldAttempts()` with no
`.catch` — an unhandled rejection ends the Node process by default, so one transient database
error during housekeeping would kill the request that had just authenticated successfully.

Also: response headers (`frame-ancestors`, `nosniff`, `Referrer-Policy`), expired sessions now
actually pruned, `Content-Disposition` filenames stripped of the control characters that turn a
download into a 500, and the password policy no longer refusing "the administrator sang badly"
for containing `admin`.

Verified by `npm test` (62), a full `npm run smoke -- --write` against a scratch database and the
real bucket, and by checking all 20 stored originals still read back.

---

## Open questions

Carried from the review; each one changes work that follows.

1. **What is offline actually for** — off-site laptops, or insurance against downtime? Decides
   whether #8 is 4–6 weeks or 2–3 days.
2. **`PALIZA`'s 16 tables** — transferee, two schools, or two learners in one file? The one
   thing that could blow the Form 137 estimate.
3. **Who is admin when the registrar is away?** Still open, and now visible in the app: the
   Accounts page warns while only one admin exists. Only an admin can issue accounts or reset a
   password, so a lone admin who is away is a system nobody can administer.
4. ~~Should advisers see every learner in the school?~~ **Settled: every learner.** No
   adviser-to-section mapping exists, sections change yearly, and a small school covers for
   itself. Access is attributable through `record_history`.
