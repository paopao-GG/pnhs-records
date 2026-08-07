"use client";

import { useState, useTransition } from "react";
import { createRecord, type NewStudentInput } from "../actions.ts";
import { SHS_TRACKS } from "@/lib/sf10/subject-templates.ts";

const EMPTY: NewStudentInput = {
  lrn: "",
  lastName: "",
  firstName: "",
  middleName: "",
  nameExt: "",
  sex: "",
  birthdate: "",
  level: "7",
  semester: "1",
  schoolYear: "",
  section: "",
  adviser: "",
  trackStrand: SHS_TRACKS[0],
};

export function NewStudentForm() {
  const [form, setForm] = useState<NewStudentInput>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isShs = Number(form.level) >= 11;
  const set = (k: keyof NewStudentInput, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = () => {
    setError(null);
    if (!form.lrn.trim() || !form.lastName.trim() || !form.firstName.trim()) {
      setError("LRN, last name and first name are required.");
      return;
    }
    startTransition(async () => {
      try {
        // On success this redirects into the new record's editor and never returns.
        await createRecord(form);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        setError(
          /UNIQUE/i.test(message)
            ? `LRN ${form.lrn.trim()} already belongs to another learner.`
            : message,
        );
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
            <Field label="LRN *">
              <input
                className="input mono"
                value={form.lrn}
                onChange={(e) => set("lrn", e.target.value)}
                placeholder="12-digit LRN"
                autoFocus
              />
            </Field>
            <Field label="Last Name *">
              <input
                className="input"
                value={form.lastName}
                onChange={(e) => set("lastName", e.target.value)}
              />
            </Field>
            <Field label="First Name *">
              <input
                className="input"
                value={form.firstName}
                onChange={(e) => set("firstName", e.target.value)}
              />
            </Field>
            <Field label="Middle Name">
              <input
                className="input"
                value={form.middleName}
                onChange={(e) => set("middleName", e.target.value)}
              />
            </Field>
            <Field label="Name Ext.">
              <input
                className="input"
                value={form.nameExt}
                placeholder="Jr, II, III"
                onChange={(e) => set("nameExt", e.target.value)}
              />
            </Field>
            <Field label="Sex">
              <select className="select" value={form.sex} onChange={(e) => set("sex", e.target.value)}>
                <option value="">—</option>
                <option value="M">Male</option>
                <option value="F">Female</option>
              </select>
            </Field>
            <Field label="Date of Birth">
              <input
                className="input mono"
                value={form.birthdate}
                placeholder="mm/dd/yyyy"
                onChange={(e) => set("birthdate", e.target.value)}
              />
            </Field>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>First Enrolment Term</h3>
        </div>
        <div className="card-body">
          <div className="form-grid">
            <Field label="Grade Level">
              <select
                className="select"
                value={form.level}
                onChange={(e) => set("level", e.target.value)}
              >
                {[7, 8, 9, 10, 11, 12].map((l) => (
                  <option key={l} value={l}>
                    Grade {l}
                  </option>
                ))}
              </select>
            </Field>

            {isShs && (
              <Field label="Semester">
                <select
                  className="select"
                  value={form.semester}
                  onChange={(e) => set("semester", e.target.value)}
                >
                  <option value="1">First Semester</option>
                  <option value="2">Second Semester</option>
                </select>
              </Field>
            )}

            <Field label="School Year">
              <input
                className="input mono"
                value={form.schoolYear}
                placeholder="2025-2026"
                onChange={(e) => set("schoolYear", e.target.value)}
              />
            </Field>
            <Field label="Section">
              <input
                className="input"
                value={form.section}
                onChange={(e) => set("section", e.target.value)}
              />
            </Field>
            <Field label="Adviser">
              <input
                className="input"
                value={form.adviser}
                onChange={(e) => set("adviser", e.target.value)}
              />
            </Field>
          </div>

          {isShs && (
            <div style={{ marginTop: 14 }}>
              <Field label="Track / Strand">
                <select
                  className="select"
                  value={form.trackStrand}
                  onChange={(e) => set("trackStrand", e.target.value)}
                >
                  {SHS_TRACKS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          )}
        </div>
      </section>

      <div className="btn-row" style={{ alignItems: "center" }}>
        <button className="btn" data-variant="primary" onClick={submit} disabled={pending}>
          {pending ? "Creating…" : "Create record"}
        </button>
        {error && <span style={{ color: "var(--seal)" }}>{error}</span>}
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
