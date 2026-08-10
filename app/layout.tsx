import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { getCurrentUser } from "@/lib/auth/current-user.ts";
import { signOut } from "./login/actions.ts";

export const metadata: Metadata = {
  title: "PNHS Records — SF10 Permanent Records",
  description: "Learner permanent record system for Pantao National High School",
  // This holds the personal data of children and is reachable on a public URL. It has no
  // business in a search index.
  robots: { index: false, follow: false, nocache: true },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Null on the sign-in page, which is the only place that renders without a user.
  const user = await getCurrentUser();

  return (
    <html lang="en">
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
                <Link className="btn" href="/">
                  Search
                </Link>
                <Link className="btn" href="/import">
                  Import
                </Link>
                <Link className="btn" href="/students/new">
                  New record
                </Link>
                {user.role === "admin" && (
                  <Link className="btn" href="/admin/users">
                    Accounts
                  </Link>
                )}
                <span className="who" title={`Signed in as ${user.username}`}>
                  {user.full_name}
                  <span className="who-role">{user.role}</span>
                </span>
                <form action={signOut}>
                  <button className="btn">Sign out</button>
                </form>
              </nav>
            )}
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
