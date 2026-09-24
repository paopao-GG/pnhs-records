"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setStudentStatus } from "../actions.ts";
import { STATUS_LABELS, STUDENT_STATUSES, type StudentStatus } from "@/lib/status.ts";

/**
 * What this learner is: enrolled, graduated, gone.
 *
 * Two states, and the difference between them is the point of the whole feature.
 *
 * **Unconfirmed** (`status` is null) shows the menu plus a suggestion the server worked out
 * from the learner's terms, with an Accept button. The suggestion is never applied on its own -
 * see lib/status.ts for why. A diploma is printed against this value, and a learner who left
 * after Grade 10 looks exactly like one who graduated after Grade 10.
 *
 * **Confirmed** shows the menu alone. Changing it is one pick, saved immediately, and logged to
 * `record_history` like any grade edit, so "who decided this learner graduated" stays
 * answerable.
 */
export function StatusPicker({
  studentId,
  status,
  suggestion,
}: {
  studentId: number;
  status: StudentStatus | null;
  suggestion: StudentStatus | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save(next: StudentStatus | null) {
    startTransition(async () => {
      try {
        setError(null);
        await setStudentStatus(studentId, next);
        router.refresh();
      } catch (err) {
        // Without this the rejection went nowhere and the menu silently snapped back, which
        // reads as "the app ignored me" rather than "that did not save".
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="status-picker">
      <select
        className="select"
        aria-label="Learner status"
        value={status ?? ""}
        disabled={pending}
        onChange={(e) => save(e.target.value === "" ? null : (e.target.value as StudentStatus))}
      >
        {/* Selectable, so a status set by mistake can be taken back off rather than
            replaced with a second guess. */}
        <option value="">Not confirmed</option>
        {STUDENT_STATUSES.map((value) => (
          <option key={value} value={value}>
            {STATUS_LABELS[value]}
          </option>
        ))}
      </select>

      {status === null && suggestion !== null && (
        <div className="status-suggestion">
          <span className="muted">Suggested: {STATUS_LABELS[suggestion]}</span>
          <button
            className="btn"
            data-variant="ghost"
            data-size="sm"
            disabled={pending}
            onClick={() => save(suggestion)}
          >
            {pending ? "…" : "Accept"}
          </button>
        </div>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
