import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth/current-user.ts";
import { signOut } from "./login/actions.ts";
import {
  ConnectionState,
  ServiceWorkerRegistrar,
  SignOutButton,
} from "./_components/connection-state.tsx";
import { THEME_SCRIPT, ThemeToggle } from "./_components/theme-toggle.tsx";

export const metadata: Metadata = {
  title: "PNHS Records — SF10 Permanent Records",
  description: "Learner permanent record system for Pantao National High School",
  // This holds the personal data of children and is reachable on a public URL. It has no
  // business in a search index.
  robots: { index: false, follow: false, nocache: true },
};

/*
 * Preloaded faces.
 *
 * Only the ones that carry text above the fold on the first screen anyone sees — the search
 * page. The remaining faces (Plex 500/600) load on demand; preloading a face that is not used
 * immediately costs bandwidth and delays the ones that are.
 *
 * Atkinson bold joined this list when headings moved off the display face: it now sets every
 * h1-h4 in the app, so it is on the critical path of the first paint on every route.
 */
const PRELOAD_FONTS = [
  "/fonts/atkinson-400-latin.woff2",
  "/fonts/atkinson-700-latin.woff2",
  "/fonts/fraunces-var-latin.woff2",
  "/fonts/plexmono-400-latin.woff2",
];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Null on the sign-in page, which is the only place that renders without a user.
  const user = await getCurrentUser();

  /*
   * `suppressHydrationWarning` on <html> covers exactly one thing: THEME_SCRIPT writes
   * `data-theme` onto that element before React hydrates, so the client tree legitimately
   * carries an attribute the server never rendered. Without it React logs a mismatch on every
   * page load. It applies to that element's own attributes only — nothing inside <html> is
   * exempted by it, and the toggle itself hydrates cleanly without needing its own.
   */
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
         * Applies the remembered colour scheme before anything is painted. It must run here,
         * blocking, and it must come before the stylesheet does its first repaint — see the
         * note on THEME_SCRIPT. No nonce is needed: next.config.mjs sets `frame-ancestors`
         * and no `script-src`.
         */}
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        {PRELOAD_FONTS.map((href) => (
          <link key={href} rel="preload" as="font" type="font/woff2" href={href} crossOrigin="" />
        ))}
        {/*
         * One tag, not a pair keyed off the OS: the app no longer follows the OS, so a
         * `prefers-color-scheme` media attribute here would paint dark browser chrome above a
         * light page. It holds the light --plate, and ThemeToggle rewrites it when switched.
         */}
        <meta name="theme-color" content="#ffffff" />
      </head>
      <body>
        <header className="masthead">
          <div className="masthead-inner">
            <div className="seal" aria-hidden="true">
              PN
            </div>
            <div>
              <h1>Pantao National High School</h1>
              <div className="sub">Learner Permanent Records · SF10</div>
            </div>
            <nav>
              {user && (
                <>
                  <Link className="btn" data-variant="ghost" href="/">
                    Search
                  </Link>
                  <Link className="btn" data-variant="ghost" href="/import">
                    Import
                  </Link>
                  <Link className="btn" data-variant="ghost" href="/students/new">
                    New record
                  </Link>
                  {user.role === "admin" && (
                    <Link className="btn" data-variant="ghost" href="/admin/users">
                      Accounts
                    </Link>
                  )}
                  <ConnectionState />
                  <span className="who" title={`Signed in as ${user.username}`}>
                    {user.full_name}
                    <span className="who-role">{user.role}</span>
                  </span>
                </>
              )}
              {/*
               * Outside the signed-in block on purpose. Sign-in is the only screen that renders
               * without navigation, and it is also the first one anyone sees — someone who works
               * in the dark should not have to log in first to turn the lights down.
               */}
              <ThemeToggle />
              {user && (
                <form action={signOut}>
                  <SignOutButton />
                </form>
              )}
            </nav>
          </div>
        </header>
        {children}
        {user && <ServiceWorkerRegistrar />}
      </body>
    </html>
  );
}
