/**
 * The one password rule the browser is allowed to know.
 *
 * **Keep this file dependency-free.** It exists for the same reason `lib/auth/cookie.ts` used
 * to: the unlock form and the settings form are client components, and they need the minimum
 * length to set `minLength` on an input. Importing it from `password.ts` instead drags
 * `node:crypto` and `node:util` into the browser bundle, and the build fails outright with
 * *"Reading from node:crypto is not handled by plugins"*.
 *
 * That failure is the boundary announcing itself, and it is worth keeping loud. Everything
 * else in `password.ts` — the hashing, the verification, the rules — belongs on the server and
 * must never be reachable from a page. A number is the whole of what the client needs, so a
 * number is the whole of what this file holds.
 *
 * ## The rule, and why it is this one
 *
 * Eight characters, with a letter, a capital and a number among them.
 *
 * This file used to argue the opposite case — length over character classes, on the grounds
 * that a twelve-character passphrase beats `P@ssw0rd!` and is easier to remember. The school
 * asked for the shorter rule, and it was traded knowingly: a passphrase like
 * `pnhs records 2026` no longer qualifies, because it has no capital.
 *
 * What the old rule also did, and this one does not, is refuse the school's own vocabulary —
 * `pnhs`, `pantao`, the school ID. Those are allowed now, which is the point of the change and
 * also its cost: the likely password is `Pnhs2026`, and a complexity rule does not prevent
 * that so much as decide its shape.
 *
 * None of which is the real protection. The database is not encrypted, so anybody holding
 * `pnhs.db` never sees this prompt at all — full-disk encryption on the machine is what keeps
 * these records private, and the README says so under *Where your data lives*.
 */

export const MIN_PASSWORD_LENGTH = 8;
