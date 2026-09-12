"use client";

import { useMemo } from "react";
import type { StudentSummary } from "@/lib/db/queries.ts";

/**
 * Finding a learner by typing.
 *
 * Extracted so the search page and the document picker match names the same way. They are two
 * surfaces onto one index, and a registrar who learns that "cruz juan" finds Juan Cruz on one
 * screen should not discover it does not on the other.
 */

/**
 * Fold a name down to something matchable.
 *
 * The accent stripping is not decoration: the school's real files contain `Ň` where `Ñ` was
 * meant - `BIBLAŇAS`, `CAŇETA`, `PEŇAFLOR` - so a registrar typing the name correctly must
 * still find the record that spells it wrong.
 */
export function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // fold ñ -> n, é -> e
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function displayName(s: StudentSummary): string {
  const given = [s.first_name, s.middle_name, s.name_ext].filter(Boolean).join(" ");
  return `${s.last_name}, ${given}`;
}

/** The grade levels a learner has terms for, e.g. "JHS 7–10 · SHS 11–12". */
export function levelLabel(levels: string): string {
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

/**
 * The learners matching a query.
 *
 * Every whitespace-separated token must appear somewhere, so "cruz juan" and "juan cruz" both
 * find the same person - a registrar should not have to remember which order the form used.
 */
export function useStudentFilter(
  students: StudentSummary[],
  query: string,
): StudentSummary[] {
  const indexed = useMemo(
    () => students.map((s) => ({ student: s, haystack: normalise(`${displayName(s)} ${s.lrn}`) })),
    [students],
  );

  return useMemo(() => {
    const q = normalise(query);
    if (!q) return students;
    const tokens = q.split(" ");
    return indexed
      .filter(({ haystack }) => tokens.every((t) => haystack.includes(t)))
      .map(({ student }) => student);
  }, [indexed, students, query]);
}
