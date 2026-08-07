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
}: {
  studentId: number;
  forms: ("jhs" | "shs")[];
  levelsByForm: Record<string, number[]>;
}) {
  const [open, setOpen] = useState<"jhs" | "shs" | null>(null);
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
                onClick={(e) => chosen.length === 0 && e.preventDefault()}
              >
                Print SF10 {form.toUpperCase()}
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
                  <p className="muted" style={{ margin: "8px 0 0", fontSize: 12.5 }}>
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
