"use client";

import { useState } from "react";

/**
 * Print controls: pick a form, then narrow to particular grade levels.
 *
 * Everything is selected by default, so the common case — reprint the whole record — stays a
 * single click. Deselecting is for reissuing one year, which is what a registrar needs when a
 * learner transfers mid-stream.
 */
export function PrintPanel({
  studentId,
  forms,
  levelsByForm,
  sf9Levels,
}: {
  studentId: number;
  forms: ("jhs" | "shs")[];
  levelsByForm: Record<string, number[]>;
  /**
   * Grade levels that can be printed as a report card.
   *
   * Only terms graded over three periods qualify - the form has three TERM columns and no
   * defined layout for a fourth, so a four-quarter term would print with a quarter silently
   * missing. Empty means no button.
   */
  sf9Levels: number[];
}) {
  const [open, setOpen] = useState<"jhs" | "shs" | null>(null);
  /*
   * Which print is being prepared, if any.
   *
   * Filling a workbook takes a beat, and these are plain download links - the browser gives no
   * signal that anything is happening, so the natural response to a slow machine is to click
   * again and generate the document twice. This says the click landed.
   *
   * Cleared on a timer rather than on completion because a download has no event we can
   * observe from here: the response never becomes a page. Two seconds is long enough to stop
   * the second click and short enough that the button is never wrongly stuck.
   */
  const [preparing, setPreparing] = useState<string | null>(null);

  function markPreparing(key: string) {
    setPreparing(key);
    setTimeout(() => setPreparing((p) => (p === key ? null : p)), 2000);
  }
  const [selected, setSelected] = useState<Record<string, number[]>>(levelsByForm);

  const toggle = (form: string, level: number) => {
    setSelected((s) => {
      const current = s[form] ?? [];
      const next = current.includes(level)
        ? current.filter((l) => l !== level)
        : [...current, level].sort((a, b) => a - b);
      return { ...s, [form]: next };
    });
  };

  const href = (form: "jhs" | "shs") => {
    const chosen = selected[form] ?? [];
    const all = levelsByForm[form] ?? [];
    const complete = chosen.length === all.length;
    return complete
      ? `/api/students/${studentId}/sf10?form=${form}`
      : `/api/students/${studentId}/sf10?form=${form}&levels=${chosen.join(",")}`;
  };

  return (
    <div className="btn-row">
      {sf9Levels.map((level) => (
        <a
          key={`sf9-${level}`}
          className="btn"
          href={`/api/students/${studentId}/sf9?level=${level}`}
          title="The report card sent home, printed twice on one sheet"
          data-busy={preparing === `sf9-${level}` ? "yes" : undefined}
          onClick={() => markPreparing(`sf9-${level}`)}
        >
          {preparing === `sf9-${level}`
            ? "Preparing…"
            : `Report card${sf9Levels.length > 1 ? ` · Grade ${level}` : ""}`}
        </a>
      ))}
      {forms.map((form) => {
        const levels = levelsByForm[form] ?? [];
        const chosen = selected[form] ?? [];
        const isOpen = open === form;

        return (
          <div key={form} className="print-group">
            <div className="btn-row">
              <a
                className="btn"
                data-variant="primary"
                href={href(form)}
                aria-disabled={chosen.length === 0}
                data-busy={preparing === form ? "yes" : undefined}
                onClick={(e) => {
                  if (chosen.length === 0) {
                    e.preventDefault();
                    return;
                  }
                  markPreparing(form);
                }}
              >
                {preparing === form ? "Preparing…" : `Print SF10 ${form.toUpperCase()}`}
                {chosen.length > 0 && chosen.length < levels.length && (
                  <span className="print-count">
                    {chosen.length} of {levels.length}
                  </span>
                )}
              </a>
              {levels.length > 1 && (
                <button
                  className="btn"
                  onClick={() => setOpen(isOpen ? null : form)}
                  title="Choose which grade levels to print"
                  aria-expanded={isOpen}
                >
                  {isOpen ? "Done" : "Levels…"}
                </button>
              )}
            </div>

            {isOpen && (
              <div className="level-picker">
                <div className="eyebrow" style={{ marginBottom: 8 }}>
                  Grade levels to include
                </div>
                {levels.map((level) => (
                  <label key={level} className="level-option">
                    <input
                      type="checkbox"
                      checked={chosen.includes(level)}
                      onChange={() => toggle(form, level)}
                    />
                    Grade {level}
                  </label>
                ))}
                {chosen.length === 0 && (
                  <p className="muted meta" style={{ margin: "8px 0 0" }}>
                    Select at least one level.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
