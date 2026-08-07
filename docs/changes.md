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

## 2. Folder chooser, import only new files · ~½ day

Pick which folder to scan rather than typing a path, and take in only files not already
imported.

- **"Only new" already works** — files are identified by SHA-256, so re-importing a folder
  skips everything already taken in. Nothing to build there.
- What's missing is choosing the folder. Once deployed the files live *on the server*, so this
  needs a small server-side folder browser, not a browser file picker.
- Remember recently used folders.
- Also fixes a live papercut: `npm run roundtrip`, `npm run import:dry` and the `/import` page
  still default to `sf10-copy`, which has moved to `sf10-files/sf10-copy`.

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

## 6. Accounts: admin and adviser · ~3 days

- `users` and `sessions` tables; passwords hashed with `scrypt` from `node:crypto` — **no new
  dependency**.
- Signed, HTTP-only session cookies. Route protection for every page and endpoint.
- Admin screens to create advisers and reset their passwords.
- Every mutating action attributed in `record_history` from #4.
- Login rate limiting and lockout, a minimum password policy, and session invalidation on
  password change or deactivation. Easy to skip, and the reason most small systems get in.

**Soft delete needs a matching change in the importer.** The dedup rule treats a file as
already-imported only if its learner still exists — and a soft-deleted learner still exists.
Without `AND s.deleted_at IS NULL` on that query, a deleted record can no longer be restored by
re-importing its file, which is the bug fixed earlier in this project, reintroduced. See
production-design §4.

Needs #0. **Build before #8** — sync needs a user identity to attribute and resolve changes.

---

## 7. Form 137 importer · ~4–5 days

Import the old *Secondary Student's Permanent Record*. Highest-variance item in this list.

**The 20 sample files are not one format — they are two:**

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

## 8. Offline editing with sync · ~4–6 weeks

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

## 9. Home server deployment · advisory

Specs, setup and backup policy rather than code — sizing is grounded in the real files.

| Resource | At 5,000 learners |
|---|---|
| Original files | ~900 MB (measured average 180 KB × 5,000) |
| Database | ~40–80 MB (measured 7.6 KB per learner) |
| **Total working set** | **~2 GB** |
| RAM | 8 GB comfortable, 4 GB workable |
| CPU | Any modern dual or quad core |
| Disk | **SSD** — SQLite is sensitive to write latency |

Storage is not the constraint at this scale. The real requirements are an SSD, a backup
schedule, and keeping the database **off any synced folder**.

The database figure is a conservative ceiling rather than a measurement — 44% of the current
database is fixed per-table overhead, so extrapolating from 22 learners overstates it. It errs
high, which is safe for buying hardware.

Also covered in production-design §6: one backup copy must **leave the building** and be
restore-tested, and the personal data of thousands of children needs an owner and encryption at
rest.

---

## Open questions

Carried from the review; each one changes work that follows.

1. **What is offline actually for** — off-site laptops, or insurance against downtime? Decides
   whether #8 is 4–6 weeks or 2–3 days.
2. **`PALIZA`'s 16 tables** — transferee, two schools, or two learners in one file? The one
   thing that could blow the Form 137 estimate.
3. **Who is admin when the registrar is away?** Only admins restore deleted records, so a
   single admin means a wrong deletion waits for their return.
4. **Should advisers see every learner in the school**, or only their own section? Currently
   assumed to be all — a policy question for the school, not a technical one.
