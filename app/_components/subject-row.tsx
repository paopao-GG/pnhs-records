"use client";

import { useEffect, useRef, useState } from "react";
import { saveSubjectField } from "../actions.ts";

export type QuarterField = "q1" | "q2" | "q3" | "q4" | "final_rating";
export type SaveState = "idle" | "saving" | "saved" | "error";

const AUTOSAVE_DELAY_MS = 700;

/**
 * One grade cell that saves itself.
 *
 * Held as a string so a cleared box stays empty rather than collapsing to 0 — on a permanent
 * record, "not encoded" and "scored zero" are very different claims.
 *
 * Saving is debounced per cell and only fires when the value actually changed, so tabbing
 * across a row writes nothing. The previous value is kept in `record_history`, which is what
 * makes save-as-you-type recoverable despite having no undo.
 */
export function GradeCell({
  subjectId,
  field,
  initial,
  label,
  onSaved,
  onStateChange,
}: {
  subjectId: number;
  field: QuarterField;
  initial: number | null;
  label: string;
  onSaved: (field: QuarterField, value: number | null) => void;
  onStateChange: (state: SaveState, message?: string) => void;
}) {
  const [text, setText] = useState(initial == null ? "" : String(initial));
  const lastSaved = useRef(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    const value = trimmed === "" ? null : Number(trimmed);

    if (trimmed !== "" && !Number.isFinite(value)) {
      onStateChange("error", `${label} is not a number.`);
      return;
    }
    if (value === lastSaved.current) return;

    onStateChange("saving");
    saveSubjectField(subjectId, field, value)
      .then(() => {
        lastSaved.current = value;
        onSaved(field, value);
        onStateChange("saved");
      })
      .catch((e: unknown) => {
        onStateChange("error", e instanceof Error ? e.message : String(e));
      });
  };

  return (
    <input
      className="grade-input"
      type="number"
      min={0}
      max={100}
      value={text}
      aria-label={label}
      onChange={(e) => {
        setText(e.target.value);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => commit(e.target.value), AUTOSAVE_DELAY_MS);
      }}
      onBlur={() => {
        // Don't make the registrar wait out the debounce before moving on.
        if (timer.current) clearTimeout(timer.current);
        commit(text);
      }}
    />
  );
}
