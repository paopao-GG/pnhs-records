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
 * Only the three that carry text above the fold on the first screen anyone sees — the search
 * page. The remaining faces (Atkinson bold, Plex 500/600) load on demand; preloading a face
 * that is not used immediately costs bandwidth and delays the ones that are.
 */
const PRELOAD_FONTS = [
  "/fonts/atkinson-400-latin.woff2",
  "/fonts/fraunces-var-latin.woff2",
  "/fonts/plexmono-400-latin.woff2",
];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Null on the sign-in page, which is the only place that renders without a user.
  const user = await getCurrentUser();

  return (
    <html lang="en">
      <head>
        {PRELOAD_FONTS.map((href) => (
          <link key={href} rel="preload" as="font" type="font/woff2" href={href} crossOrigin="" />
        ))}
        {/* Matches --plate in each scheme, so the browser chrome does not flash a white bar. */}
        <meta name="theme-color" media="(prefers-color-scheme: light)" content="#f8f7f4" />
        <meta name="theme-color" media="(prefers-color-scheme: dark)" content="#141a1e" />
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
            {user && (
              <nav>
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
                <form action={signOut}>
                  <SignOutButton />
                </form>
              </nav>
            )}
          </div>
        </header>
        {children}
        {user && <ServiceWorkerRegistrar />}
      </body>
    </html>
  );
}
