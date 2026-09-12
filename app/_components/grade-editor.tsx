"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { moveSubject, removeSubject, saveLearnerInfo } from "../actions.ts";
import { TermPeriods } from "./term-periods.tsx";
import {
  exactFinalRating,
  finalRating,
  generalAverage,
  gradingPeriods,
  isPassing,
  promotionRemark,
  quarterFieldsFor,
} from "@/lib/grading.ts";
import { jhsFinalRatingIsComputed } from "@/lib/sf10/jhs-map.ts";
import type { StudentRow, SubjectRow, TermRow } from "@/lib/db/queries.ts";
import { GradeCell, type QuarterField, type SaveState } from "./subject-row.tsx";
import { AddSubject } from "./add-subject.tsx";

/**
 * Grade encoding grid.
 *
 * Grades save themselves as you type — there is no Save button. Every change is written to
 * `record_history` with its previous value, which is what makes that safe despite there being
 * no undo.
 *
 * Learner-identity fields save on **blur**, not per keystroke. Autosaving the LRN as it is
 * typed would fire a UNIQUE violation on every prefix of a valid one.
 */

interface TermBundle {
  term: TermRow;
  subjects: SubjectRow[];
}

export function GradeEditor({
  student,
  bundles,
}: {
  student: StudentRow;
  bundles: TermBundle[];
}) {
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  /** Live grade values, seeded from the server and updated as cells save. */
  const [grades, setGrades] = useState<Record<number, Record<string, number | null>>>(() => {
    const g: Record<number, Record<string, number | null>> = {};
    for (const b of bundles) {
      for (const s of b.subjects) {
        g[s.id] = { q1: s.q1, q2: s.q2, q3: s.q3, q4: s.q4, final_rating: s.final_rating };
      }
    }
    return g;
  });

  const onStateChange = useCallback((state: SaveState, msg?: string) => {
    setSaveState(state);
    setMessage(msg ?? null);
    if (state === "saved") setTimeout(() => setSaveState("idle"), 1600);
  }, []);

  const onSaved = useCallback(
    (subjectId: number) => (field: QuarterField, value: number | null) => {
      setGrades((g) => ({ ...g, [subjectId]: { ...g[subjectId], [field]: value } }));
    },
    [],
  );

  const computed = useMemo(() => {
    const out: Record<number, { finals: (number | null)[]; genAve: number | null }> = {};
    for (const b of bundles) {
      const isJhs = b.term.level <= 10;
      const level = isJhs ? "jhs" : "shs";

      const pairs = b.subjects.map((s) => {
        const g = grades[s.id] ?? {};
        // A stored final wins — on an imported record that is what the paper form carries.
        if (g.final_rating != null) {
          return { display: round(g.final_rating), exact: g.final_rating };
        }
        const quarters = { q1: g.q1, q2: g.q2, q3: g.q3, q4: g.q4 };
        return { display: finalRating(quarters, level), exact: exactFinalRating(quarters, level) };
      });

      // Editing any quarter clears the imported general average server-side, so once a term
      // has been touched this computation is the authority.
      const stored = b.term.general_average;
      out[b.term.id] = {
        finals: pairs.map((p) => p.display),
        genAve:
          stored != null
            ? round(stored)
            : generalAverage(
                pairs.map((p) => p.exact),
                level,
              ),
      };
    }
    return out;
  }, [bundles, grades]);

  return (
    <>
      <LearnerInfo student={student} onStateChange={onStateChange} />

      {bundles.map((b) => {
        const isJhs = b.term.level <= 10;
        // Q1-Q3 on a term graded over three periods, Q1-Q4 on one graded over four. Per term,
        // so a record can hold both — see gradingPeriods() in lib/grading.ts.
        const quarters = quarterFieldsFor(b.term);
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
              {b.term.section && <span className="chip">{b.term.section}</span>}
              <div className="spacer" />
              {/* Junior High only: an SHS semester has two quarters and always did. What
                  changed there is the number of semester blocks, which lives on the learner. */}
              {isJhs && (
                <TermPeriods
                  termId={b.term.id}
                  periods={gradingPeriods(b.term)}
                  quartersWithMarks={
                    b.subjects.some((s) => s.q4 != null) ? 4 : gradingPeriods(b.term)
                  }
                />
              )}
              <span
                className="stamp"
                data-tone={passing === null ? "none" : passing ? "pass" : "fail"}
              >
                {remark ?? "Incomplete"}
              </span>
            </div>

            <div className="card-body">
              {b.subjects.length === 0 ? (
                <p className="muted" style={{ marginTop: 0 }}>
                  No subjects yet. Add them one at a time as they appear on the form.
                </p>
              ) : (
                <div className="table-scroll">
                  {/*
                   * Keyboard navigation is scoped to one term's table rather than the whole
                   * page. Holding ArrowDown past the last subject of Grade 7 should stop, not
                   * land silently in Grade 8 — a grade typed into the wrong year is exactly
                   * the error this grid exists to prevent.
                   */}
                  <table className="ledger" data-encoding-grid>
                    <thead>
                      <tr>
                        <th className="subject">{isJhs ? "Learning Area" : "Subject"}</th>
                        {quarters.map((q) => (
                          <th className="num" key={q}>
                            {q.toUpperCase()}
                          </th>
                        ))}
                        <th className="final">Final</th>
                        <th className="num" />
                      </tr>
                    </thead>
                    <tbody>
                      {b.subjects.map((s, i) => {
                        const manualFinal = isJhs && !jhsFinalRatingIsComputed(i);
                        const value = finals[i];
                        return (
                          <tr key={s.id}>
                            <td className="subject">{s.subject_name}</td>
                            {quarters.map((q, qi) => (
                              <td className="num" key={q}>
                                <GradeCell
                                  subjectId={s.id}
                                  field={q}
                                  initial={s[q]}
                                  label={`${s.subject_name} ${q.toUpperCase()}`}
                                  row={i}
                                  col={qi}
                                  onSaved={onSaved(s.id)}
                                  onStateChange={onStateChange}
                                />
                              </td>
                            ))}
                            <td className="final">
                              {manualFinal ? (
                                <GradeCell
                                  subjectId={s.id}
                                  field="final_rating"
                                  initial={s.final_rating}
                                  label={`${s.subject_name} final rating`}
                                  row={i}
                                  col={quarters.length}
                                  onSaved={onSaved(s.id)}
                                  onStateChange={onStateChange}
                                />
                              ) : value == null ? (
                                <span className="muted">—</span>
                              ) : (
                                <span className={isPassing(value) ? undefined : "grade-fail"}>
                                  {value}
                                </span>
                              )}
                            </td>
                            <td className="num row-actions">
                              <MoveSubject
                                subjectId={s.id}
                                name={s.subject_name}
                                isFirst={i === 0}
                                isLast={i === b.subjects.length - 1}
                                onStateChange={onStateChange}
                              />
                              <RemoveSubject
                                subjectId={s.id}
                                name={s.subject_name}
                                onStateChange={onStateChange}
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr>
                        {/* The subject column plus this term's quarters. */}
                        <td colSpan={1 + quarters.length}>General Average</td>
                        <td className="final">
                          {genAve == null ? (
                            <span className="muted">—</span>
                          ) : (
                            <span className={passing ? undefined : "grade-fail"}>{genAve}</span>
                          )}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}

              <div style={{ marginTop: 14 }}>
                <AddSubject
                  termId={b.term.id}
                  level={b.term.level}
                  semester={b.term.semester}
                  existing={b.subjects.map((s) => s.subject_name)}
                />
              </div>
            </div>
          </section>
        );
      })}

      <SaveIndicator state={saveState} message={message} />
    </>
  );
}

function round(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n));
}

/**
 * Moves a subject one row up or down.
 *
 * No confirmation, unlike removal: the other arrow puts it back. The order is what the SF10
 * prints, so this is how a record encoded out of sequence is made to match its paper form.
 */
function MoveSubject({
  subjectId,
  name,
  isFirst,
  isLast,
  onStateChange,
}: {
  subjectId: number;
  name: string;
  isFirst: boolean;
  isLast: boolean;
  onStateChange: (s: SaveState, m?: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const move = (direction: "up" | "down") =>
    startTransition(async () => {
      onStateChange("saving");
      try {
        await moveSubject(subjectId, direction);
        onStateChange("saved");
        router.refresh();
      } catch (e) {
        onStateChange("error", e instanceof Error ? e.message : String(e));
      }
    });

  return (
    <>
      <button
        className="row-move"
        title={`Move ${name} up`}
        aria-label={`Move ${name} up`}
        disabled={pending || isFirst}
        onClick={() => move("up")}
      >
        ↑
      </button>
      <button
        className="row-move"
        title={`Move ${name} down`}
        aria-label={`Move ${name} down`}
        disabled={pending || isLast}
        onClick={() => move("down")}
      >
        ↓
      </button>
    </>
  );
}

function RemoveSubject({
  subjectId,
  name,
  onStateChange,
}: {
  subjectId: number;
  name: string;
  onStateChange: (s: SaveState, m?: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        className="row-remove"
        title={`Remove ${name}`}
        aria-label={`Remove ${name}`}
        onClick={() => setConfirming(true)}
      >
        ×
      </button>
    );
  }

  return (
    <span className="btn-row" style={{ flexWrap: "nowrap" }}>
      <button
        className="row-remove"
        data-confirm="yes"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            try {
              await removeSubject(subjectId);
              router.refresh();
            } catch (e) {
              onStateChange("error", e instanceof Error ? e.message : String(e));
            }
          })
        }
      >
        Remove
      </button>
      <button className="row-remove" onClick={() => setConfirming(false)} disabled={pending}>
        Keep
      </button>
    </span>
  );
}

function SaveIndicator({ state, message }: { state: SaveState; message: string | null }) {
  if (state === "idle" && !message) return null;
  return (
    <div className="save-indicator" data-state={state}>
      {state === "saving" && "Saving…"}
      {state === "saved" && "Saved"}
      {state === "error" && (message ?? "Could not save")}
    </div>
  );
}

function LearnerInfo({
  student,
  onStateChange,
}: {
  student: StudentRow;
  onStateChange: (s: SaveState, m?: string) => void;
}) {
  const [info, setInfo] = useState({
    lrn: student.lrn,
    lastName: student.last_name,
    firstName: student.first_name,
    middleName: student.middle_name ?? "",
    nameExt: student.name_ext ?? "",
    sex: student.sex ?? "",
    birthdate: student.birthdate ?? "",
  });
  const [saved, setSaved] = useState(info);

  const commit = () => {
    if (JSON.stringify(info) === JSON.stringify(saved)) return;
    onStateChange("saving");
    saveLearnerInfo(student.id, {
      lrn: info.lrn,
      lastName: info.lastName,
      firstName: info.firstName,
      middleName: info.middleName || null,
      nameExt: info.nameExt || null,
      sex: info.sex || null,
      birthdate: info.birthdate || null,
    })
      .then(() => {
        setSaved(info);
        onStateChange("saved");
      })
      .catch((e: unknown) =>
        onStateChange("error", e instanceof Error ? e.message : String(e)),
      );
  };

  const field = (key: keyof typeof info, label: string, extra?: string) => (
    <div className="form-field">
      <label>{label}</label>
      <input
        className={`input${extra ?? ""}`}
        value={info[key]}
        onChange={(e) => setInfo({ ...info, [key]: e.target.value })}
        onBlur={commit}
      />
    </div>
  );

  return (
    <section className="card">
      <div className="card-head">
        <h3>Learner Information</h3>
        <span className="muted" style={{ fontSize: 12.5 }}>
          Saves when you leave a field
        </span>
      </div>
      <div className="card-body">
        <div className="form-grid">
          {field("lrn", "LRN", " mono")}
          {field("lastName", "Last Name")}
          {field("firstName", "First Name")}
          {field("middleName", "Middle Name")}
          {field("nameExt", "Name Ext.")}
          <div className="form-field">
            <label>Sex</label>
            <select
              className="select"
              value={info.sex}
              onChange={(e) => setInfo({ ...info, sex: e.target.value })}
              onBlur={commit}
            >
              <option value="">—</option>
              <option value="M">Male</option>
              <option value="F">Female</option>
            </select>
          </div>
          {field("birthdate", "Date of Birth", " mono")}
        </div>
      </div>
    </section>
  );
}
