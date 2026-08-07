import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "PNHS Records — SF10 Permanent Records",
  description: "Learner permanent record system for Pantao National High School",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
