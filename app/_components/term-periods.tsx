"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setTermPeriods } from "../actions.ts";

/**
 * How many quarters this term is graded over.
 *
 * The school is moving from four periods to three, and every record imported before that change
 * carries four. The count could be chosen when a record was created and never afterwards, so an
 * imported Grade 9 was stuck on the old scheme permanently - and the three-column report card
 * could never be printed for it.
 *
 * **Nothing is deleted when the count drops.** Fourth-quarter marks stay in the record; they
 * stop counting toward the final rating and stop printing, and they come back if the term is
 * switched back. The warning says so rather than the control refusing, because the registrar is
 * the one who knows whether the fourth quarter happened.
 */
export function TermPeriods({
  termId,
  periods,
  quartersWithMarks,
}: {
  termId: number;
  periods: number;
  /** Which quarters actually hold a mark, so the warning can name what stops counting. */
  quartersWithMarks: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // Only worth warning about when there is something in the column being dropped.
  const losesAQuarter = periods === 4 && quartersWithMarks === 4;

  function change(next: number) {
    setError(null);
    startTransition(async () => {
      try {
        await setTermPeriods(termId, next);
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="term-periods">
      <label>
        <span className="eyebrow">Periods</span>
        <select
          className="select"
          value={String(periods)}
          disabled={pending}
          onChange={(e) => change(Number(e.target.value))}
          aria-label="Quarters this term is graded over"
        >
          <option value="4">4 quarters</option>
          <option value="3">3 terms</option>
        </select>
      </label>

      {losesAQuarter && (
        <p className="muted term-periods-note">
          Switching to 3 stops the fourth quarter counting and printing. The marks are kept.
        </p>
      )}

      {error && (
        <p className="unlock-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
