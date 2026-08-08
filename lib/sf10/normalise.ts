/**
 * Turning what is actually in the school's files into what the database expects.
 *
 * Every function here is total: none of them throw, and none of them discard a value they
 * cannot understand. A permanent record with a suspect LRN is still that learner's record,
 * so the value is kept and an issue is raised alongside it for a human to resolve.
 *
 * The anomalies handled here were all found in the 13 real SF10-SHS files:
 *   - birthdates stored as Excel serial numbers (37896) AND as text ("06/09/200", malformed)
 *   - sex written as "MALE"/"FEMALE" rather than M/F
 *   - LRNs of 11, 12 and 14 digits
 */

import type { Sex } from "./types.ts";

export type IssueSeverity = "warning" | "error";

export interface Issue {
  severity: IssueSeverity;
  field: string;
  cell?: string;
  rawValue?: string;
  message: string;
}

export interface Normalised<T> {
  value: T;
  issues: Issue[];
}

const ok = <T>(value: T): Normalised<T> => ({ value, issues: [] });

/**
 * Excel's day zero is 1899-12-30, not 1900-01-01: the serial numbering pretends 1900 was a
 * leap year, and offsetting the epoch by two days is what cancels that out for every date
 * after February 1900. Every date in these files is well after that.
 */
export function excelSerialToDate(serial: number): Date | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000;
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatMdy(d: Date): string {
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${mm}/${dd}/${d.getUTCFullYear()}`;
}

/**
 * Parse a date as it appears on the form into mm/dd/yyyy.
 *
 * Accepts an Excel serial or text. Text that cannot be resolved to a real date is preserved
 * verbatim and flagged - "06/09/200" in one real file is a year short, and silently
 * "correcting" it to 2000 or 2001 would be inventing data about a person.
 */
export function parseFormDate(
  raw: string | number | null | undefined,
  field: string,
  cell?: string,
): Normalised<string | undefined> {
  if (raw === null || raw === undefined || raw === "") return ok(undefined);

  if (typeof raw === "number") {
    const d = excelSerialToDate(raw);
    if (d) return ok(formatMdy(d));
    return {
      value: String(raw),
      issues: [
        { severity: "warning", field, cell, rawValue: String(raw), message: `Date serial ${raw} is not a valid date.` },
      ],
    };
  }

  // Trailing punctuation is a typing slip, not data: "02/20/2008." means the same date.
  // Stripping it is safe because it cannot change which date is meant - unlike, say, a
  // missing digit, which is left alone and flagged.
  const text = String(raw).trim().replace(/[.,;\s]+$/, "");
  if (text === "") return ok(undefined);

  // A serial that arrived as text.
  if (/^\d+(\.\d+)?$/.test(text)) {
    const d = excelSerialToDate(Number(text));
    if (d) return ok(formatMdy(d));
  }

  const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{1,4})$/.exec(text);
  if (m) {
    const [, mo, da, yr] = m;
    if (yr.length === 4) {
      const d = new Date(Date.UTC(Number(yr), Number(mo) - 1, Number(da)));
      const valid =
        d.getUTCFullYear() === Number(yr) &&
        d.getUTCMonth() === Number(mo) - 1 &&
        d.getUTCDate() === Number(da);
      if (valid) return ok(formatMdy(d));
    }
    return {
      value: text,
      issues: [
        {
          severity: "warning",
          field,
          cell,
          rawValue: text,
          message: `Date "${text}" is incomplete or invalid — kept as written, needs checking.`,
        },
      ],
    };
  }

  return {
    value: text,
    issues: [
      { severity: "warning", field, cell, rawValue: text, message: `Could not read "${text}" as a date — kept as written.` },
    ],
  };
}

const SEX_WORDS: Record<string, Sex> = {
  M: "M", MALE: "M", LALAKI: "M", BOY: "M",
  F: "F", FEMALE: "F", BABAE: "F", GIRL: "F",
};

export function normaliseSex(
  raw: string | number | null | undefined,
  cell?: string,
): Normalised<Sex | undefined> {
  if (raw === null || raw === undefined || raw === "") return ok(undefined);
  const key = String(raw).trim().toUpperCase();
  const hit = SEX_WORDS[key];
  if (hit) return ok(hit);
  return {
    value: undefined,
    issues: [
      { severity: "warning", field: "sex", cell, rawValue: String(raw), message: `Unrecognised sex "${raw}".` },
    ],
  };
}

/** DepEd LRNs are 12 digits. Real files contain 11- and 14-digit values; both are kept and flagged. */
export function validateLrn(
  raw: string | number | null | undefined,
  cell?: string,
): Normalised<string | undefined> {
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return {
      value: undefined,
      issues: [
        { severity: "error", field: "lrn", cell, message: "No LRN on the form — cannot identify this learner." },
      ],
    };
  }

  const text = String(raw).trim();

  if (!/^\d+$/.test(text)) {
    return {
      value: text,
      issues: [
        { severity: "error", field: "lrn", cell, rawValue: text, message: `LRN "${text}" contains non-digits.` },
      ],
    };
  }

  if (text.length !== 12) {
    return {
      value: text,
      issues: [
        {
          severity: "warning",
          field: "lrn",
          cell,
          rawValue: text,
          message: `LRN "${text}" has ${text.length} digits, expected 12 — may be mistyped, so this learner could be duplicated.`,
        },
      ],
    };
  }

  return ok(text);
}

/** Grades outside 0-100 are almost certainly a mis-keyed cell. Kept, but flagged. */
export function parseGrade(
  raw: string | number | null | undefined,
  field: string,
  cell?: string,
): Normalised<number | undefined> {
  if (raw === null || raw === undefined || String(raw).trim() === "") return ok(undefined);

  /*
   * Brackets around a number are notation, not meaning: `[1.2]` and `(1.2)` appear in Form
   * 137's Units Earned column, paired with an asterisk on the subject name as a footnote
   * marker. They are NOT accounting negatives — 143 of the 144 bracketed values across the
   * school's files sit against "Passed". So the number is taken at face value.
   */
  const text = typeof raw === "number" ? String(raw) : String(raw).trim().replace(/^[[(](.*)[\])]$/, "$1").trim();
  const n = typeof raw === "number" ? raw : Number(text);
  if (!Number.isFinite(n)) {
    return {
      value: undefined,
      issues: [
        { severity: "warning", field, cell, rawValue: String(raw), message: `Grade "${raw}" is not a number.` },
      ],
    };
  }

  if (n < 0 || n > 100) {
    return {
      value: n,
      issues: [
        { severity: "warning", field, cell, rawValue: String(raw), message: `Grade ${n} is outside 0–100.` },
      ],
    };
  }

  return ok(n);
}

export function cleanText(raw: string | number | null | undefined): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  // Collapse the runs of whitespace that come from merged cells, but never re-word anything:
  // real subject names contain typos ("Fundammentals of Accountancy") and those are what the
  // permanent record says.
  const text = String(raw).replace(/\s+/g, " ").trim();
  return text === "" ? undefined : text;
}
