"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveRecord, type RecordEdit } from "../actions.ts";
import { finalRating, generalAverage, isPassing, promotionRemark } from "@/lib/grading.ts";
import { jhsFinalRatingIsComputed } from "@/lib/sf10/jhs-map.ts";
import type { StudentRow, SubjectRow, TermRow } from "@/lib/db/queries.ts";

/**
 * Grade encoding grid.
 *
 * Grades are held as strings so a cleared box stays empty instead of collapsing to 0 - the
 * difference between "not yet encoded" and "scored zero" matters on a permanent record.
 * Final ratings and the general average recompute as you type, using the same lib/grading
 * module the server re-runs on save.
 */

type Draft = Record<number, { q1: string; q2: string; q3: string; q4: string; final: string }>;

interface TermBundle {
  term: TermRow;
  subjects: SubjectRow[];
}

const num = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

const str = (n: number | null): string => (n == null ? "" : String(n));

export function GradeEditor({
  student,
  bundles,
}: {
  student: StudentRow;
  bundles: TermBundle[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [info, setInfo] = useState({
    lrn: student.lrn,
    lastName: student.last_name,
    firstName: student.first_name,
    middleName: student.middle_name ?? "",
    nameExt: student.name_ext ?? "",
    sex: student.sex ?? "",
    birthdate: student.birthdate ?? "",
  });

  const [termMeta, setTermMeta] = useState(() =>
    Object.fromEntries(
      bundles.map((b) => [
        b.term.id,
        {
          schoolYear: b.term.school_year ?? "",
          section: b.term.section ?? "",
          adviser: b.term.adviser ?? "",
        },
      ]),
    ),
  );

  const [draft, setDraft] = useState<Draft>(() => {
    const d: Draft = {};
    for (const b of bundles) {
      for (const s of b.subjects) {
        d[s.id] = {
          q1: str(s.q1),
          q2: str(s.q2),
          q3: str(s.q3),
          q4: str(s.q4),
          final: str(s.final_rating),
        };
      }
    }
    return d;
  });

  const setCell = (id: number, key: keyof Draft[number], value: string) => {
    setDraft((d) => ({ ...d, [id]: { ...d[id], [key]: value } }));
    setSaved(false);
  };

  /** Recomputed on every keystroke so the registrar sees the consequence immediately. */
  const computed = useMemo(() => {
    const out: Record<number, { finals: (number | null)[]; genAve: number | null }> = {};
    for (const b of bundles) {
      const isJhs = b.term.level <= 10;
      const finals = b.subjects.map((s, i) => {
        const d = draft[s.id];
        if (isJhs && !jhsFinalRatingIsComputed(i)) return num(d.final);
        return finalRating(
          { q1: num(d.q1), q2: num(d.q2), q3: num(d.q3), q4: num(d.q4) },
          isJhs ? "jhs" : "shs",
        );
      });
      out[b.term.id] = { finals, genAve: generalAverage(finals) };
    }
    return out;
  }, [bundles, draft]);

  const onSave = () => {
    setError(null);
    if (!info.lrn.trim() || !info.lastName.trim() || !info.firstName.trim()) {
      setError("LRN, last name and first name are required.");
      return;
    }

    const payload: RecordEdit = {
      studentId: student.id,
      student: {
        lrn: info.lrn,
        lastName: info.lastName,
        firstName: info.firstName,
        middleName: info.middleName || null,
        nameExt: info.nameExt || null,
        sex: info.sex || null,
        birthdate: info.birthdate || null,
      },
      terms: bundles.map((b) => ({
        id: b.term.id,
        level: b.term.level,
        schoolYear: termMeta[b.term.id].schoolYear || null,
        section: termMeta[b.term.id].section || null,
        adviser: termMeta[b.term.id].adviser || null,
        subjects: b.subjects.map((s) => ({
          id: s.id,
          q1: num(draft[s.id].q1),
          q2: num(draft[s.id].q2),
          q3: num(draft[s.id].q3),
          q4: num(draft[s.id].q4),
          finalRating: num(draft[s.id].final),
        })),
      })),
    };

    startTransition(async () => {
      try {
        await saveRecord(payload);
        setSaved(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not save the record.");
      }
    });
  };

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h3>Learner Information</h3>
        </div>
        <div className="card-body">
          <div className="form-grid">
            <Field label="LRN">
              <input
                className="input mono"
                value={info.lrn}
                onChange={(e) => setInfo({ ...info, lrn: e.target.value })}
              />
            </Field>
            <Field label="Last Name">
              <input
                className="input"
                value={info.lastName}
                onChange={(e) => setInfo({ ...info, lastName: e.target.value })}
              />
            </Field>
            <Field label="First Name">
              <input
                className="input"
                value={info.firstName}
                onChange={(e) => setInfo({ ...info, firstName: e.target.value })}
              />
            </Field>
            <Field label="Middle Name">
              <input
                className="input"
                value={info.middleName}
                onChange={(e) => setInfo({ ...info, middleName: e.target.value })}
              />
            </Field>
            <Field label="Name Ext.">
              <input
                className="input"
                value={info.nameExt}
                placeholder="Jr, II, III"
                onChange={(e) => setInfo({ ...info, nameExt: e.target.value })}
              />
            </Field>
            <Field label="Sex">
              <select
                className="select"
                value={info.sex}
                onChange={(e) => setInfo({ ...info, sex: e.target.value })}
              >
                <option value="">—</option>
                <option value="M">Male</option>
                <option value="F">Female</option>
              </select>
            </Field>
            <Field label="Date of Birth">
              <input
                className="input mono"
                value={info.birthdate}
                placeholder="mm/dd/yyyy"
                onChange={(e) => setInfo({ ...info, birthdate: e.target.value })}
              />
            </Field>
          </div>
        </div>
      </section>

      {bundles.map((b) => {
        const isJhs = b.term.level <= 10;
        const { finals, genAve } = computed[b.term.id];
        const passing = isPassing(genAve);
        const remark = promotionRemark(genAve, isJhs ? "jhs" : "shs");

        return (
          <section className="card" key={b.term.id}>
            <div className="card-head">
              <h3>
                Grade {b.term.level}
                {b.term.semester ? ` · ${b.term.semester === 1 ? "First" : "Second"} Semester` : ""}
              </h3>
              <div className="spacer" />
              <span className="stamp" data-tone={passing === null ? "none" : passing ? "pass" : "fail"}>
                {remark ?? "Incomplete"}
              </span>
            </div>
            <div className="card-body">
              <div className="form-grid" style={{ marginBottom: 18 }}>
                <Field label="School Year">
                  <input
                    className="input mono"
                    value={termMeta[b.term.id].schoolYear}
                    placeholder="2024-2025"
                    onChange={(e) =>
                      setTermMeta({
                        ...termMeta,
                        [b.term.id]: { ...termMeta[b.term.id], schoolYear: e.target.value },
                      })
                    }
                  />
                </Field>
                <Field label="Section">
                  <input
                    className="input"
                    value={termMeta[b.term.id].section}
                    onChange={(e) =>
                      setTermMeta({
                        ...termMeta,
                        [b.term.id]: { ...termMeta[b.term.id], section: e.target.value },
                      })
                    }
                  />
                </Field>
                <Field label="Adviser">
                  <input
                    className="input"
                    value={termMeta[b.term.id].adviser}
                    onChange={(e) =>
                      setTermMeta({
                        ...termMeta,
                        [b.term.id]: { ...termMeta[b.term.id], adviser: e.target.value },
                      })
                    }
                  />
                </Field>
              </div>

              <div className="table-scroll">
                <table className="ledger">
                  <thead>
                    <tr>
                      <th className="subject">{isJhs ? "Learning Area" : "Subject"}</th>
                      <th className="num">Q1</th>
                      <th className="num">Q2</th>
                      {isJhs && <th className="num">Q3</th>}
                      {isJhs && <th className="num">Q4</th>}
                      <th className="final">Final</th>
                    </tr>
                  </thead>
                  <tbody>
                    {b.subjects.map((s, i) => {
                      const manualFinal = isJhs && !jhsFinalRatingIsComputed(i);
                      const value = finals[i];
                      return (
                        <tr key={s.id}>
                          <td className="subject">{s.subject_name}</td>
                          {(["q1", "q2", "q3", "q4"] as const)
                            .slice(0, isJhs ? 4 : 2)
                            .map((q) => (
                              <td className="num" key={q}>
                                <input
                                  className="grade-input"
                                  type="number"
                                  min={60}
                                  max={100}
                                  value={draft[s.id][q]}
                                  onChange={(e) => setCell(s.id, q, e.target.value)}
                                  aria-label={`${s.subject_name} ${q.toUpperCase()}`}
                                />
                              </td>
                            ))}
                          <td className="final">
                            {manualFinal ? (
                              // No AVERAGE formula exists for this row on the printed form,
                              // so the mark is entered rather than derived.
                              <input
                                className="grade-input"
                                type="number"
                                min={60}
                                max={100}
                                value={draft[s.id].final}
                                onChange={(e) => setCell(s.id, "final", e.target.value)}
                                aria-label={`${s.subject_name} final rating`}
                              />
                            ) : value == null ? (
                              <span className="muted">—</span>
                            ) : (
                              <span className={isPassing(value) ? undefined : "grade-fail"}>
                                {value}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={isJhs ? 5 : 3}>General Average</td>
                      <td className="final">
                        {genAve == null ? (
                          <span className="muted">—</span>
                        ) : (
                          <span className={passing ? undefined : "grade-fail"}>{genAve}</span>
                        )}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          </section>
        );
      })}

      <div
        style={{
          position: "sticky",
          bottom: 0,
          background: "var(--paper)",
          borderTop: "1px solid var(--rule)",
          padding: "14px 0",
          display: "flex",
          alignItems: "center",
          gap: 14,
        }}
      >
        <button className="btn" data-variant="primary" onClick={onSave} disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </button>
        {saved && !pending && <span style={{ color: "var(--pass)" }}>Record saved.</span>}
        {error && <span style={{ color: "var(--seal)" }}>{error}</span>}
        <span className="muted" style={{ marginLeft: "auto", fontSize: 12.5 }}>
          Final ratings and the general average are computed as you type.
        </span>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="form-field">
      <label>{label}</label>
      {children}
    </div>
  );
}
