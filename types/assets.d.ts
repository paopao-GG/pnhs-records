/**
 * Declares the non-code modules the app imports for their side effects.
 *
 * TypeScript 6 rejects `import "./globals.css"` unless the module has a declaration
 * (TS2882 - "Cannot find module or type declarations for side-effect import"). Next.js does not
 * ship one, and `next-env.d.ts` must not be edited, so it lives here.
 *
 * Without this `next build` fails at the type-check step, which means the app cannot deploy -
 * `npm run dev` never surfaced it because dev does not type-check.
 */

declare module "*.css";
