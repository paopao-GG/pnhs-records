"use client";

import { useEffect, useRef, useState } from "react";
import { saveSubjectField } from "../actions.ts";
import { useConnState } from "./online-store.ts";

export type QuarterField = "q1" | "q2" | "q3" | "q4" | "final_rating";
export type SaveState = "idle" | "saving" | "saved" | "error";

const AUTOSAVE_DELAY_MS = 700;
const SAVED_HOLD_MS = 1400;

/**
 * Moves focus to another cell in the same grid.
 *
 * Cells are addressed by their `data-cell="row,col"` attribute rather than by refs, because
 * the grid is assembled across three components and threading a ref matrix through them buys
 * nothing a query selector does not already do.
 *
 * A shorter row - SHS terms have two quarters where JHS has four - is handled by walking left
 * until a cell exists, so moving down a Q4 column into an SHS term lands on its Final rather
 * than nowhere.
 */
function focusCell(from: HTMLElement, row: number, col: number): void {
  const grid = from.closest("[data-encoding-grid]");
  if (!grid) return;

  for (let c = col; c >= 0; c--) {
    const target = grid.querySelector<HTMLInputElement>(`[data-cell="${row},${c}"]`);
    if (target) {
      target.focus();
      target.select();
      return;
    }
  }
}

/**
 * One grade cell that saves itself.
 *
 * Held as a string so a cleared box stays empty rather than collapsing to 0 — on a permanent
 * record, "not encoded" and "scored zero" are very different claims.
 *
 * Saving is debounced per cell and only fires when the value actually changed, so tabbing
 * across a row writes nothing. The previous value is kept in `record_history`, which is what
 * makes save-as-you-type recoverable despite having no undo.
 *
 * The cell shows its own save state as an underline that fills. That is deliberate rather than
 * decorative: once sync exists, versioning is per `term_subjects` row, so one subject can be in
 * conflict while the other thirty-nine are fine. A single floating indicator cannot say that,
 * and this one already can.
 */
export function GradeCell({
  subjectId,
  field,
  initial,
  label,
  row,
  col,
  onSaved,
  onStateChange,
}: {
  subjectId: number;
  field: QuarterField;
  initial: number | null;
  label: string;
  /** Position in the enclosing encoding grid, for keyboard navigation. */
  row: number;
  col: number;
  onSaved: (field: QuarterField, value: number | null) => void;
  onStateChange: (state: SaveState, message?: string) => void;
}) {
  const [text, setText] = useState(initial == null ? "" : String(initial));
  const [state, setState] = useState<SaveState>("idle");
  /*
   * Offline, the cell is disabled rather than accepting a value it cannot keep.
   *
   * This is the read-only half of the offline work and the honesty of it is the whole point:
   * there is no outbox behind these cells yet, so a grade typed while disconnected would be
   * written nowhere and reported as saved. A visibly dead field costs an adviser a minute; a
   * silently discarded quarter costs a learner their record.
   */
  const locked = useConnState() === "cached";
  const lastSaved = useRef(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      if (hold.current) clearTimeout(hold.current);
    },
    [],
  );

  const settle = (next: SaveState) => {
    setState(next);
    if (next === "saved") {
      if (hold.current) clearTimeout(hold.current);
      hold.current = setTimeout(() => setState("idle"), SAVED_HOLD_MS);
    }
  };

  const commit = (raw: string) => {
    const trimmed = raw.trim();
    const value = trimmed === "" ? null : Number(trimmed);

    if (trimmed !== "" && !Number.isFinite(value)) {
      settle("error");
      // Errors still surface globally — the cell can show that something is wrong but has no
      // room to say what.
      onStateChange("error", `${label} is not a number.`);
      return;
    }
    if (value === lastSaved.current) return;

    settle("saving");
    saveSubjectField(subjectId, field, value)
      .then(() => {
        lastSaved.current = value;
        onSaved(field, value);
        settle("saved");
      })
      .catch((e: unknown) => {
        settle("error");
        onStateChange("error", e instanceof Error ? e.message : String(e));
      });
  };

  /*
   * Vertical navigation, and a hazard removed at the same time.
   *
   * A registrar encodes a column — every subject's Q1, then every subject's Q2 — so down is
   * the motion the grid needs and Tab already covers across. Enter moves down too, which is
   * what every spreadsheet has trained them to expect.
   *
   * The safety argument matters more than the ergonomic one: on `<input type="number">` the
   * up and down arrows *increment the value*. Without this handler, an arrow key pressed over
   * a grade silently changes a mark on a permanent record and autosaves it 700ms later, with
   * nothing on screen having asked for confirmation. Binding those keys to movement takes
   * that away.
   */
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    let delta = 0;
    if (e.key === "ArrowDown") delta = 1;
    else if (e.key === "ArrowUp") delta = -1;
    else if (e.key === "Enter") delta = e.shiftKey ? -1 : 1;
    else return;

    e.preventDefault();
    // Write before leaving, so the value is in flight by the time the next cell has focus.
    if (timer.current) clearTimeout(timer.current);
    commit(e.currentTarget.value);
    focusCell(e.currentTarget, row + delta, col);
  };

  return (
    <span className="grade-cell" data-state={state} data-locked={locked}>
      <input
        className="grade-input"
        type="number"
        min={0}
        max={100}
        value={text}
        aria-label={label}
        disabled={locked}
        title={locked ? "Editing is unavailable while showing a saved copy." : undefined}
        data-cell={`${row},${col}`}
        onKeyDown={onKeyDown}
        onFocus={(e) => e.currentTarget.select()}
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
    </span>
  );
}
