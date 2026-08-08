"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { StudentSummary } from "@/lib/db/queries.ts";

/**
 * The whole student index ships to the browser once and filters locally. At 1,200 students
 * that payload is well under 100 KB, so search stays instant with no round trip - which is
 * the right trade for a single-office app.
 */

function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // fold ñ -> n, é -> e
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function displayName(s: StudentSummary): string {
  const given = [s.first_name, s.middle_name, s.name_ext].filter(Boolean).join(" ");
  return `${s.last_name}, ${given}`;
}

function levelLabel(levels: string): string {
  const nums = levels
    .split(",")
    .filter(Boolean)
    .map(Number)
    .sort((a, b) => a - b);
  if (nums.length === 0) return "No terms";
  const jhs = nums.filter((n) => n <= 10);
  const shs = nums.filter((n) => n >= 11);
  const parts: string[] = [];
  if (jhs.length) parts.push(`JHS ${jhs[0]}–${jhs[jhs.length - 1]}`);
  if (shs.length) parts.push(`SHS ${shs[0]}${shs.length > 1 ? `–${shs[shs.length - 1]}` : ""}`);
  return parts.join(" · ");
}

/** Highlights the matched run so the registrar can see why a row came back. */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = normalise(query);
  if (!q) return <>{text}</>;
  const idx = normalise(text).indexOf(q);
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark>{text.slice(idx, idx + q.length)}</mark>
      {text.slice(idx + q.length)}
    </>
  );
}

export function StudentSearch({ students }: { students: StudentSummary[] }) {
  const [query, setQuery] = useState("");

  const indexed = useMemo(
    () => students.map((s) => ({ student: s, haystack: normalise(`${displayName(s)} ${s.lrn}`) })),
    [students],
  );

  const results = useMemo(() => {
    const q = normalise(query);
    if (!q) return students;
    // Every whitespace-separated token must appear, so "cruz juan" and "juan cruz" both work.
    const tokens = q.split(" ");
    return indexed
      .filter(({ haystack }) => tokens.every((t) => haystack.includes(t)))
      .map(({ student }) => student);
  }, [indexed, students, query]);

  return (
    <>
      <div className="search-bar">
        <input
          className="input"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by surname, given name or LRN…"
          autoFocus
          aria-label="Search students"
        />
      </div>

      <p className="count-line">
        {results.length === students.length
          ? `${students.length} learner records on file`
          : `${results.length} of ${students.length} records match`}
      </p>

      {students.length === 0 ? (
        <div className="results">
          <div className="empty">
            No learner records yet.
            <br />
            <Link href="/import">Import SF10 files</Link> to load them in bulk, or use{" "}
            <strong>New record</strong> to add one by hand.
          </div>
        </div>
      ) : results.length === 0 ? (
        <div className="results">
          <div className="empty">
            No learner matches “{query}”.
            <br />
            Try a surname, or the full LRN.
          </div>
        </div>
      ) : (
        <div className="results">
          {results.slice(0, 60).map((s) => (
            <Link key={s.id} className="result" href={`/students/${s.id}`}>
              <div>
                <div className="result-name">
                  <Highlight text={displayName(s)} query={query} />
                </div>
                <div className="result-lrn">
                  {s.lrn.startsWith("F137-") ? (
                    // A generated marker, not a real number — see import-f137.ts.
                    <span>No LRN · pre-2011 record</span>
                  ) : (
                    <>
                      LRN <Highlight text={s.lrn} query={query} />
                    </>
                  )}
                </div>
              </div>
              <div className="spacer" />
              <span className="chip">{levelLabel(s.levels)}</span>
            </Link>
          ))}
        </div>
      )}

      {results.length > 60 && (
        <p className="count-line" style={{ marginTop: 10 }}>
          Showing the first 60. Keep typing to narrow the list.
        </p>
      )}
    </>
  );
}
