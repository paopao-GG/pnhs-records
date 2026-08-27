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
 * else in `password.ts` — the hashing, the verification, the banned-word list — belongs on the
 * server and must never be reachable from a page. A number is the whole of what the client
 * needs, so a number is the whole of what this file holds.
 *
 * The rule itself: length over character classes. A twelve-character passphrase beats
 * `P@ssw0rd!` and people can actually remember it, which matters more here than anywhere —
 * there is exactly one password, nobody can reset it, and a forgotten one means restoring from
 * a backup.
 */

export const MIN_PASSWORD_LENGTH = 12;
