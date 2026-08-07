"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addSubject } from "../actions.ts";
import { subjectCatalogue } from "@/lib/sf10/subject-templates.ts";

/**
 * Adds one subject to a term.
 *
 * The dropdown is the grade level's standard list, but free text is always available: the
 * school's real files contain subjects the catalogue does not have, and refusing them would
 * make the app unable to represent records that already exist on paper.
 *
 * Subjects already on the term are hidden from the list so the same one is not added twice.
 */
export function AddSubject({
  termId,
  level,
  semester,
  existing,
}: {
  termId: number;
  level: number;
  semester: number | null;
  existing: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState("");
  const [custom, setCustom] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const taken = new Set(existing.map((n) => n.toLowerCase()));
  const options = subjectCatalogue(level, semester).filter((o) => !taken.has(o.name.toLowerCase()));
  const isCustom = choice === "__custom__";
  const name = isCustom ? custom : choice;

  const submit = () => {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Choose a subject or type its name.");
      return;
    }
    if (taken.has(trimmed.toLowerCase())) {
      setError("That subject is already on this term.");
      return;
    }

    const category = options.find((o) => o.name === trimmed)?.category ?? null;

    startTransition(async () => {
      try {
        await addSubject(termId, trimmed, category);
        setChoice("");
        setCustom("");
        setOpen(false);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  if (!open) {
    return (
      <button className="btn add-subject-btn" onClick={() => setOpen(true)}>
        + Add subject
      </button>
    );
  }

  return (
    <div className="add-subject">
      <select
        className="select"
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        autoFocus
        style={{ maxWidth: 380 }}
      >
        <option value="">Choose a subject…</option>
        {options.map((o) => (
          <option key={o.name} value={o.name}>
            {o.name}
            {o.category ? ` · ${o.category.replace("_", " ")}` : ""}
          </option>
        ))}
        <option value="__custom__">Something else…</option>
      </select>

      {isCustom && (
        <input
          className="input"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
          placeholder="Subject name as it appears on the form"
          style={{ maxWidth: 380 }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      )}

      <div className="btn-row" style={{ alignItems: "center" }}>
        <button className="btn" data-variant="primary" onClick={submit} disabled={pending}>
          {pending ? "Adding…" : "Add"}
        </button>
        <button
          className="btn"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={pending}
        >
          Cancel
        </button>
        {error && <span style={{ color: "var(--seal)" }}>{error}</span>}
      </div>
    </div>
  );
}
