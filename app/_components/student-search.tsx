"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { StudentSummary } from "@/lib/db/queries.ts";
import { STUDENT_STATUSES, statusLabel } from "@/lib/status.ts";
import { displayName, levelLabel, normalise, useStudentFilter } from "./student-filter.ts";

/**
 * The whole student index ships to the browser once and filters locally. At 1,200 students
 * that payload is well under 100 KB, so search stays instant with no round trip - which is
 * the right trade for a single-office app.
 *
 * ## Finding one learner, and finding a group of them
 *
 * The search box answers "where is this learner's record". The filters answer a different
 * question the registrar has just as often - who is in Grade 9 Sampaguita, who graduated last
 * year, who is still enrolled - and the status behind it has been stored since categorisation
 * went in with nothing able to use it.
 *
 * The two compose: filters narrow, then the text search runs over what is left, so a query
 * behaves the same way whether or not a filter is on.
 */

/** What the list can be broken up by. `none` is the flat list this page has always been. */
type GroupBy = "none" | "status" | "grade" | "section";

const ANY = "";

/** The current grade level: the highest one the learner has a term for. */
function currentLevel(levels: string): number | null {
  const nums = levels
    .split(",")
    .filter(Boolean)
    .map(Number)
    .filter((n) => Number.isFinite(n));
  return nums.length === 0 ? null : Math.max(...nums);
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

function Result({ student, query }: { student: StudentSummary; query: string }) {
  return (
    <Link className="result" href={`/students/${student.id}`}>
      <div>
        <div className="result-name">
          <Highlight text={displayName(student)} query={query} />
        </div>
        <div className="result-lrn">
          {student.lrn.startsWith("F137-") ? (
            // A generated marker, not a real number — see import-f137.ts.
            <span>No LRN · pre-2011 record</span>
          ) : (
            <>
              LRN <Highlight text={student.lrn} query={query} />
            </>
          )}
        </div>
      </div>
      <div className="spacer" />
      {student.section && <span className="chip" data-tone="muted">{student.section}</span>}
      {/* Only once someone has confirmed it. An unconfirmed learner shows the levels
          alone rather than a guess dressed as a fact — see lib/status.ts. */}
      {statusLabel(student.status) && (
        <span className="chip" data-status={student.status}>
          {statusLabel(student.status)}
        </span>
      )}
      <span className="chip">{levelLabel(student.levels)}</span>
    </Link>
  );
}

export function StudentSearch({ students }: { students: StudentSummary[] }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string>(ANY);
  const [grade, setGrade] = useState<string>(ANY);
  const [section, setSection] = useState<string>(ANY);
  const [groupBy, setGroupBy] = useState<GroupBy>("none");

  /*
   * The options are built from what the index actually holds, not from a fixed list, so a
   * school with no Senior High never sees Grades 11-12 and a section that was renamed stops
   * being offered once no learner is in it.
   */
  const grades = useMemo(() => {
    const set = new Set<number>();
    for (const s of students) {
      const level = currentLevel(s.levels);
      if (level !== null) set.add(level);
    }
    return [...set].sort((a, b) => a - b);
  }, [students]);

  const sections = useMemo(() => {
    const set = new Set<string>();
    for (const s of students) if (s.section) set.add(s.section);
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [students]);

  const statuses = useMemo(() => {
    const present = new Set(students.map((s) => s.status));
    return STUDENT_STATUSES.filter((v) => present.has(v));
  }, [students]);

  const filtered = useMemo(
    () =>
      students.filter((s) => {
        if (status !== ANY) {
          // "unconfirmed" is a real answer to "which of these still needs deciding".
          if (status === "unconfirmed" ? s.status != null : s.status !== status) return false;
        }
        if (grade !== ANY && currentLevel(s.levels) !== Number(grade)) return false;
        if (section !== ANY && s.section !== section) return false;
        return true;
      }),
    [students, status, grade, section],
  );

  const results = useStudentFilter(filtered, query);

  const filtering = status !== ANY || grade !== ANY || section !== ANY;

  /**
   * The visible list, grouped or flat.
   *
   * Ordered so the groups a registrar works through first come first: enrolled before
   * graduates, lower grades before higher, sections alphabetically. Unconfirmed learners sort
   * last under a plain heading rather than being hidden - that group is a prompt to do
   * something, not an error.
   */
  const groups = useMemo((): { key: string; label: string; rows: StudentSummary[] }[] => {
    if (groupBy === "none") return [{ key: "all", label: "", rows: results }];

    const buckets = new Map<string, StudentSummary[]>();
    for (const s of results) {
      const key =
        groupBy === "status"
          ? (s.status ?? "unconfirmed")
          : groupBy === "grade"
            ? String(currentLevel(s.levels) ?? "none")
            : (s.section ?? "none");
      const bucket = buckets.get(key);
      if (bucket) bucket.push(s);
      else buckets.set(key, [s]);
    }

    const order = (key: string): number => {
      if (groupBy === "status") {
        const i = (STUDENT_STATUSES as readonly string[]).indexOf(key);
        return i === -1 ? Number.MAX_SAFE_INTEGER : i;
      }
      if (groupBy === "grade") return key === "none" ? Number.MAX_SAFE_INTEGER : Number(key);
      return key === "none" ? Number.MAX_SAFE_INTEGER : 0;
    };

    const label = (key: string): string => {
      if (groupBy === "status") return statusLabel(key) ?? "Not confirmed";
      if (groupBy === "grade") return key === "none" ? "No terms" : `Grade ${key}`;
      return key === "none" ? "No section" : key;
    };

    return [...buckets.entries()]
      .map(([key, rows]) => ({ key, label: label(key), rows }))
      .sort((a, b) => order(a.key) - order(b.key) || a.label.localeCompare(b.label));
  }, [results, groupBy]);

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

      <div className="filter-bar">
        <label>
          <span className="eyebrow">Status</span>
          <select
            className="select"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            aria-label="Filter by status"
          >
            <option value={ANY}>All</option>
            {statuses.map((v) => (
              <option key={v} value={v}>
                {statusLabel(v)}
              </option>
            ))}
            <option value="unconfirmed">Not confirmed</option>
          </select>
        </label>

        <label>
          <span className="eyebrow">Grade</span>
          <select
            className="select"
            value={grade}
            onChange={(e) => setGrade(e.target.value)}
            aria-label="Filter by grade level"
          >
            <option value={ANY}>All</option>
            {grades.map((g) => (
              <option key={g} value={String(g)}>
                Grade {g}
              </option>
            ))}
          </select>
        </label>

        {sections.length > 0 && (
          <label>
            <span className="eyebrow">Section</span>
            <select
              className="select"
              value={section}
              onChange={(e) => setSection(e.target.value)}
              aria-label="Filter by section"
            >
              <option value={ANY}>All</option>
              {sections.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        )}

        <label>
          <span className="eyebrow">Group by</span>
          <select
            className="select"
            value={groupBy}
            onChange={(e) => setGroupBy(e.target.value as GroupBy)}
            aria-label="Group the list"
          >
            <option value="none">Nothing</option>
            <option value="status">Status</option>
            <option value="grade">Grade</option>
            <option value="section">Section</option>
          </select>
        </label>

        {(filtering || query !== "") && (
          <button
            className="btn"
            data-variant="ghost"
            data-size="sm"
            onClick={() => {
              setQuery("");
              setStatus(ANY);
              setGrade(ANY);
              setSection(ANY);
            }}
          >
            Clear
          </button>
        )}
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
            {query !== "" ? <>No learner matches “{query}”.</> : <>No learner matches those filters.</>}
            <br />
            {filtering ? "Try widening the filters." : "Try a surname, or the full LRN."}
          </div>
        </div>
      ) : groupBy === "none" ? (
        <div className="results">
          {results.slice(0, 60).map((s) => (
            <Result key={s.id} student={s} query={query} />
          ))}
        </div>
      ) : (
        groups.map((group) => (
          <section key={group.key} className="result-group">
            <div className="group-head">
              <span className="eyebrow">{group.label}</span>
              <span className="muted">{group.rows.length}</span>
            </div>
            <div className="results">
              {group.rows.slice(0, 60).map((s) => (
                <Result key={s.id} student={s} query={query} />
              ))}
            </div>
          </section>
        ))
      )}

      {groupBy === "none" && results.length > 60 && (
        <p className="count-line" style={{ marginTop: 10 }}>
          Showing the first 60. Keep typing, or narrow the filters.
        </p>
      )}
    </>
  );
}
