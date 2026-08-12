"use client";

import { useState, useTransition } from "react";
import { deleteRecord } from "../actions.ts";
import type { DeletionSummary } from "@/lib/db/queries.ts";

/**
 * Deleting a permanent academic record has no undo, so this deliberately is not a one-click
 * action: it states exactly what will be destroyed and requires the learner's LRN to be typed.
 * That makes an accidental deletion essentially impossible while staying quick for a
 * registrar who genuinely means it.
 */
export function DeleteRecord({
  studentId,
  lrn,
  name,
  summary,
}: {
  studentId: number;
  lrn: string;
  name: string;
  summary: DeletionSummary;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const matches = typed.trim() === lrn;

  const confirm = () => {
    setError(null);
    startTransition(async () => {
      try {
        // On success this redirects to the search page and never returns.
        await deleteRecord(studentId, typed);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        // Next.js signals redirect by throwing; that is success, not a failure.
        if (message.includes("NEXT_REDIRECT")) return;
        setError(message);
      }
    });
  };

  if (!open) {
    return (
      <button className="btn" data-variant="danger" onClick={() => setOpen(true)}>
        Delete record
      </button>
    );
  }

  return (
    <div className="danger-zone">
      <h3>Delete this permanent record?</h3>
      <p>
        This erases <strong>{name}</strong> along with{" "}
        <strong>
          {summary.terms} enrolment {summary.terms === 1 ? "term" : "terms"}
        </strong>{" "}
        and{" "}
        <strong>
          {summary.subjects} subject {summary.subjects === 1 ? "row" : "rows"}
        </strong>
        . It cannot be undone.
      </p>

      <label htmlFor="confirm-lrn">
        Type the learner&rsquo;s LRN <span className="mono">{lrn}</span> to confirm
      </label>
      <input
        id="confirm-lrn"
        className="input mono"
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={lrn}
        autoFocus
        style={{ maxWidth: 260 }}
      />

      <div className="btn-row" style={{ marginTop: 14, alignItems: "center" }}>
        <button
          className="btn"
          data-variant="danger"
          onClick={confirm}
          disabled={!matches || pending}
        >
          {pending ? "Deleting…" : "Permanently delete"}
        </button>
        <button
          className="btn"
          onClick={() => {
            setOpen(false);
            setTyped("");
            setError(null);
          }}
          disabled={pending}
        >
          Cancel
        </button>
        {error && <span style={{ color: "var(--alert)" }}>{error}</span>}
      </div>
    </div>
  );
}
