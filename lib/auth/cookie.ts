/**
 * The session cookie's name, and nothing else.
 *
 * Its own module **with no imports** on purpose. `middleware.ts` needs this name, and middleware
 * is compiled for the Edge runtime where `node:crypto`, `node:url` and the rest are unavailable.
 * Importing it from `current-user.ts` pulled in the whole database layer and failed the build
 * with *"Reading from node:url is not handled"*.
 *
 * That build error is the boundary doing its job: middleware can know a cookie's name, and
 * cannot verify one. Keep this file dependency-free.
 */

export const SESSION_COOKIE = "pnhs_session";
