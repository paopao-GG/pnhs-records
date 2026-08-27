# Patch 1 — requested changes

> ## Status: item 1 superseded · item 2 open
>
> **Read this before acting on anything below.** This patch was written while the system was a
> hosted web application with two-role accounts. On 18 August 2026 it became a **local Windows
> application opened with one password**, and that decision was taken with this document in
> front of it.
>
> | | Request | State |
> |---|---|---|
> | 1 | Sharper Admin / Adviser split | **Superseded.** One password cannot express two roles |
> | 2 | Report card — import and print | **Open**, and blocked on the school. See below |

---

## The original request

### 1 USERS

    Changes in authorization

        - Admin
            can do everything (import, delete, edit, print, add user, make new record)
        - Adviser
            can ONLY import files

### 2 REPORT CARD

    System can Import or print Also report card

        - Import
            Admin can import report card

---

## 1. Roles — superseded, and what it would take to bring them back

This asks for a **narrower** adviser than ever existed. The built system let advisers search,
view, print, import, add, edit and delete; only account management was reserved to admins. This
asks for import and nothing else.

It was overtaken. The app now has no accounts at all — one password opens it, and everyone at
the machine can do everything. A single shared password cannot express two permission sets:
whoever types it is either an admin or an adviser, and there is nothing to tell them apart.

**Reinstating roles means reinstating accounts.** Not a permission check on top of what exists —
the `users` table, sessions in a table rather than in process memory, a per-request role check in
every one of the ~28 guarded entry points, and a screen for issuing and deactivating accounts.
The design is recorded in [production-design.md](production-design.md) §4, including the
corrections the build made to it, so it would not have to be re-derived.

Two intermediate options exist if the real concern is narrower than "we need accounts back":

- **Two passwords, one per role.** No usernames and no account management, but the app can tell
  an adviser from an admin by which password was typed. Cheap, and it holds as long as the two
  passwords do not circulate together — which on a shared office PC they will.
- **A mode switch.** One password, then a choice of "Registrar" or "Adviser" that shapes the
  interface without enforcing anything. Honest about being a convenience rather than a control,
  and worth nothing against someone who does not want to be guided.

Neither is a security boundary. If the requirement is genuinely that an adviser *must not* be
able to delete a record, that is accounts, and it should be asked for as such.

---

## 2. Report card — open, and what it needs first

This is a real feature request and nothing in the desktop conversion affects it. It is deferred
rather than declined.

"Report card" is presumably the DepEd **SF9** (formerly Form 138) — the card a learner takes
home each quarter, as distinct from the SF10 permanent record this system holds. **Confirm that
with the school before anyone starts**, because the two are related but not the same document
and the word is used loosely.

Assuming SF9, the work is a fourth form alongside the three already supported, and it follows
the same shape as every one of them:

| Piece | Notes |
|---|---|
| The blank template | Must come from the school. `templates/` holds their own files, not a redrawn copy — see [technical-design.md](technical-design.md) §4.1 |
| A cell map | `lib/sf10/sf9-map.ts`, alongside `jhs-map.ts` and `shs-map.ts`. SHS blocks are irregular; do not assume SF9 is regular either until the file says so |
| A parser | Only if importing. Dispatched by content, never by filename — see §2 of production-design |
| A fill path | `fillSf9()`, writing **inputs only**, letting the template's own formulas re-derive every number |
| A round trip | `npm run roundtrip` must cover it, or it is not finished |

**It cannot be specified without files.** Two things are needed from the school:

1. The **blank SF9 template** they actually print, as `.xlsx`.
2. **A few filled examples**, ideally awkward ones. Every branch in `lib/sf10/normalise.ts`
   exists because of something in a real file — birthdates stored as Excel serials, a date
   reading `06/09/200`, LRNs of 11 and 14 digits, `Ň` where `Ñ` was meant. Designing an SF9
   importer from a blank form would reproduce the same guesswork this project already paid for
   once.

One thing worth settling early, because it decides the data model: **does the report card hold
grades this system already stores, or grades it does not?** If SF9 is a different presentation
of the same quarterly marks, it is a print path and nothing more. If it carries values the SF10
has no home for — conduct, values, observed behaviours — it needs its own tables, and that is a
materially larger piece of work.
