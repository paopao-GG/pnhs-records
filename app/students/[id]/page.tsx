import Link from "next/link";
import { notFound } from "next/navigation";
import {
  availableForms,
  countIssuesForStudent,
  getAttendanceForStudent,
  getDeletionSummary,
  getOriginalFile,
  getStudent,
  listDocuments,
  getSubjectsForStudent,
  getTerms,
  hasOldCurriculum,
  type AttendanceRow,
  type SubjectRow,
  type TermRow,
} from "@/lib/db/queries.ts";
import { requireUnlocked } from "@/lib/auth/guard.ts";
import { DeleteRecord } from "@/app/_components/delete-record.tsx";
import { PrintPanel } from "@/app/_components/print-panel.tsx";
import { StatusPicker } from "@/app/_components/status-picker.tsx";
import { DocumentList } from "@/app/_components/document-list.tsx";
import { isStudentStatus, suggestStudentStatus } from "@/lib/status.ts";
import { sf9Terms } from "@/lib/db/to-sf9-record.ts";
import { Guilloche } from "@/app/_components/guilloche.tsx";
import { Seal, type SealTone } from "@/app/_components/seal.tsx";
import {
  exactFinalRating,
  finalRating,
  generalAverage,
  isPassing,
  quarterFieldsFor,
} from "@/lib/grading.ts";

export const dynamic = "force-dynamic";

/** Old-curriculum terms are named as the source document names them, not as Grade 7-10. */
const OLD_YEAR_LABEL: Record<number, string> = {
  7: "First Year",
  8: "Second Year",
  9: "Third Year",
  10: "Fourth Year",
};

function termLabel(t: TermRow): string {
  if (t.curriculum === "old") return OLD_YEAR_LABEL[t.level] ?? `Year ${t.level - 6}`;
  return t.semester
    ? `Grade ${t.level} · ${t.semester === 1 ? "First" : "Second"} Semester`
    : `Grade ${t.level}`;
}

/**
 * Resolves a subject's final rating.
 *
 * Mirrors the template exactly: JHS averages four quarters, SHS two - except JHS Homeroom
 * Guidance and CAT, which carry no formula on the form and so use the stored value.
 *
 * `exact` is the unrounded value, which the general average must be computed from; `display`
 * is what the form prints. Rounding twice shifts the result.
 */
function resolveFinal(
  s: SubjectRow,
  _index: number,
  isJhs: boolean,
): { exact: number | null; display: number | null } {
  // A stored final wins. On an imported record that is the value the original form carries -
  // often a rounded figure the registrar pasted over the formula - and the form's own general
  // average is built from those. Recomputing would quietly disagree with the paper record.
  if (s.final_rating != null) {
    return { exact: s.final_rating, display: excelRoundForDisplay(s.final_rating) };
  }
  const level = isJhs ? "jhs" : "shs";
  const quarters = { q1: s.q1, q2: s.q2, q3: s.q3, q4: s.q4 };
  return { exact: exactFinalRating(quarters, level), display: finalRating(quarters, level) };
}

/** Both templates print final ratings as whole numbers. */
function excelRoundForDisplay(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n));
}

/**
 * A term's finals, its general average and whether it passed.
 *
 * Shared by the term plate and the rail seal so the two can never disagree — the seal is a
 * claim about the record and must be derived from exactly the same numbers shown beneath it.
 */
function standing(term: TermRow, subjects: SubjectRow[]) {
  const isJhs = term.level <= 10;
  const resolved = subjects.map((s, i) => resolveFinal(s, i, isJhs));

  // An imported record shows the general average its own form carried. Across the school's
  // real files that figure was produced three different ways, so recomputing it would quietly
  // disagree with the paper record. We only compute when nothing was stored.
  const genAve =
    term.general_average != null
      ? excelRoundForDisplay(term.general_average)
      : generalAverage(
          resolved.map((r) => r.exact),
          isJhs ? "jhs" : "shs",
        );

  return { isJhs, finals: resolved.map((r) => r.display), genAve, passing: isPassing(genAve) };
}

/**
 * The promotion mark for a term — the words, the tone, and whether the term plate shows one.
 *
 * One function because this page renders the same claim twice: as the stamp on the term plate
 * and as the seal in the rail. Two copies of the rule drift, and they drifted immediately — the
 * plate said "Incomplete" while the seal said "Not stated" about the same term. A permanent
 * record that describes itself two ways on one screen is a record nobody should trust.
 */
function promotionMark(
  term: TermRow,
  passing: boolean | null,
): { text: string; tone: SealTone; onPlate: boolean } {
  const tone: SealTone = passing === null ? "none" : passing ? "pass" : "fail";

  if (term.promotion_remark) return { text: term.promotion_remark, tone, onPlate: true };

  // Old records carry Action Taken per subject rather than a promotion remark for the year, so
  // there is nothing to state and the plate shows no stamp at all. The seal still needs words,
  // and says what the record is instead of inventing a decision nobody recorded.
  if (term.curriculum === "old") return { text: "Archive copy", tone: "none", onPlate: false };

  return { text: "Incomplete", tone, onPlate: true };
}

function Grade({ value }: { value: number | null }) {
  if (value == null) return <span className="muted">—</span>;
  return <span className={isPassing(value) ? undefined : "grade-fail"}>{value}</span>;
}

/** Monthly attendance, recorded by Form 137 and by nothing else. */
function Attendance({ rows }: { rows: AttendanceRow[] }) {
  const sum = (pick: (r: AttendanceRow) => number | null) =>
    rows.reduce((n, r) => n + (pick(r) ?? 0), 0);

  return (
    <div style={{ marginTop: 20 }}>
      <div className="eyebrow" style={{ marginBottom: 9 }}>
        Attendance
      </div>
      <div className="table-scroll">
        <table className="ledger">
          <thead>
            <tr>
              <th />
              {rows.map((r, i) => (
                <th key={i} className="num">
                  {r.month}
                </th>
              ))}
              <th className="final">Total</th>
            </tr>
          </thead>
          <tbody>
            {(
              [
                ["Days of School", (r: AttendanceRow) => r.days_of_school],
                ["Days Present", (r: AttendanceRow) => r.days_present],
              ] as const
            ).map(([label, pick]) => (
              <tr key={label}>
                <td className="subject">{label}</td>
                {rows.map((r, i) => (
                  <td key={i} className="num">
                    {pick(r) ?? <span className="muted">—</span>}
                  </td>
                ))}
                <td className="final">{sum(pick)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TermCard({
  term,
  index,
  subjects,
  attendance,
}: {
  term: TermRow;
  index: number;
  subjects: SubjectRow[];
  attendance: AttendanceRow[];
}) {
  const isOld = term.curriculum === "old";
  const showUnits = subjects.some((s) => s.units_earned != null);
  const { isJhs, finals, genAve, passing } = standing(term, subjects);
  const mark = promotionMark(term, passing);
  /*
   * Which quarter columns this term actually has. A three-period Grade 9 shows Q1-Q3, and a
   * Grade 7 encoded before the change still shows four — on the same record.
   */
  const quarters = quarterFieldsFor(term);

  return (
    // Capped so a learner with six years of records does not crawl in one plate at a time.
    <section className="card" style={{ animationDelay: `${Math.min(index, 5) * 55}ms` }}>
      <div className="card-head">
        <h3>{termLabel(term)}</h3>
        {term.section && <span className="chip">{term.section}</span>}
        <span className="muted mono" style={{ fontSize: 12.5 }}>
          {term.school_year ?? "—"}
        </span>
        <div className="spacer" />
        {mark.onPlate && (
          <span className="stamp" data-tone={mark.tone}>
            {mark.text}
          </span>
        )}
      </div>

      <div className="card-body">
        {term.track_strand && (
          <p className="muted" style={{ marginTop: 0, fontSize: 13.5 }}>
            <span className="eyebrow">Track / Strand </span> {term.track_strand}
          </p>
        )}

        <div className="table-scroll">
          <table className="ledger">
            <thead>
              <tr>
                {!isJhs && <th>Type</th>}
                <th className="subject">{isJhs ? "Learning Area" : "Subject"}</th>
                {quarters.map((q) => (
                  <th className="num" key={q}>
                    {q.toUpperCase()}
                  </th>
                ))}
                <th className="final">Final</th>
                {showUnits && <th className="num">Units</th>}
                {isOld && <th>Action</th>}
              </tr>
            </thead>
            <tbody>
              {subjects.map((s, i) => (
                <tr key={s.id}>
                  {!isJhs && (
                    <td>
                      {s.category && (
                        <span className="cat-tag">{s.category.replace("_", " ")}</span>
                      )}
                    </td>
                  )}
                  <td className="subject">{s.subject_name}</td>
                  {quarters.map((q) => (
                    <td className="num" key={q}>
                      <Grade value={s[q]} />
                    </td>
                  ))}
                  <td className="final">
                    <Grade value={finals[i]} />
                  </td>
                  {showUnits && (
                    <td className="num mono">
                      {s.units_earned ?? <span className="muted">—</span>}
                    </td>
                  )}
                  {isOld && (
                    <td style={{ fontSize: 13 }}>
                      {s.remarks ?? <span className="muted">—</span>}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                {/* Subject column, plus the Type column on SHS, plus however many quarters
                    this term has. Hard-coding it breaks the moment a term has three. */}
                <td colSpan={(isJhs ? 1 : 2) + quarters.length}>
                  General Average
                  {term.adviser && (
                    <span className="muted" style={{ fontWeight: 400 }}>
                      {"  ·  Adviser: "}
                      {term.adviser}
                    </span>
                  )}
                </td>
                <td className="final">
                  <Grade value={genAve} />
                </td>
                {showUnits && <td />}
                {isOld && <td />}
              </tr>
            </tfoot>
          </table>
        </div>

        {attendance.length > 0 && <Attendance rows={attendance} />}
      </div>
    </section>
  );
}

export default async function StudentPage({ params }: { params: Promise<{ id: string }> }) {
  await requireUnlocked();

  const { id } = await params;
  const studentId = Number(id);
  const student = await getStudent(studentId);
  if (!student) notFound();

  // Everything this page needs, fetched together. The per-term lookups this replaces were a
  // network round trip each once the database stopped being a local file.
  const [
    terms,
    subjectsByTerm,
    attendanceByTerm,
    issueCount,
    original,
    deletionSummary,
    documents,
  ] = await Promise.all([
    getTerms(studentId),
    getSubjectsForStudent(studentId),
    getAttendanceForStudent(studentId),
    countIssuesForStudent(studentId),
    getOriginalFile(studentId),
    getDeletionSummary(studentId),
    listDocuments(studentId),
  ]);

  const forms = availableForms(terms);
  const isOldRecord = hasOldCurriculum(terms);

  // Only offer levels the learner actually has, per form.
  const levelsByForm: Record<string, number[]> = {};
  for (const form of forms) {
    levelsByForm[form] = [
      ...new Set(
        terms.filter((t) => (form === "jhs" ? t.level <= 10 : t.level >= 11)).map((t) => t.level),
      ),
    ].sort((a, b) => a - b);
  }
  const given = [student.first_name, student.middle_name, student.name_ext]
    .filter(Boolean)
    .join(" ");
  const birthplace = [
    student.birthplace_barrio,
    student.birthplace_town,
    student.birthplace_province,
  ]
    .filter(Boolean)
    .join(", ");

  /*
   * The rail seal states the record's current standing — the latest term's mark, computed by
   * the same function the term plate uses so the two cannot say different things.
   */
  const latest = terms.length > 0 ? terms[terms.length - 1] : null;
  const latestStanding = latest ? standing(latest, subjectsByTerm.get(latest.id) ?? []) : null;
  const sealMark: { text: string; tone: SealTone } = latest
    ? promotionMark(latest, latestStanding?.passing ?? null)
    : { text: "No terms", tone: "none" };

  return (
    <main className="page" data-layout="record">
      <aside className="rail">
        <div>
          <div className="eyebrow">
            <Link href="/">← All records</Link>
          </div>
          <h2 className="rail-name">
            {student.last_name}, {given}
          </h2>
          {/* Never show a generated marker as if it were the learner's number. Form 137
              records predate the LRN system, so there is nothing real to show. */}
          {/* Labelled, because a bare twelve-digit number on a permanent record could be read
              as several other things. */}
          <div className="rail-lrn">
            <span className="eyebrow">LRN </span>
            {student.lrn_placeholder ? "No LRN · pre-2011 record" : student.lrn}
          </div>
        </div>

        <section className="card">
          <Guilloche />
          <div className="seal-plate">
            <Seal
              remark={sealMark.text}
              tone={sealMark.tone}
              rim={latest?.school_year ?? null}
              caption={latest ? termLabel(latest).toUpperCase() : null}
            />
          </div>
          <dl className="fields">
            <div className="field">
              <dt>Status</dt>
              <dd>
                <StatusPicker
                  studentId={student.id}
                  status={isStudentStatus(student.status) ? student.status : null}
                  suggestion={suggestStudentStatus(terms, student)}
                />
              </dd>
            </div>
            <div className="field">
              <dt>Sex</dt>
              <dd>{student.sex === "M" ? "Male" : student.sex === "F" ? "Female" : ""}</dd>
            </div>
            <div className="field">
              <dt>Date of Birth</dt>
              <dd className="mono">{student.birthdate ?? ""}</dd>
            </div>
            {/* Form 137 records these; the SF10 does not, so they only appear for old records. */}
            {birthplace && (
              <div className="field">
                <dt>Place of Birth</dt>
                <dd>{birthplace}</dd>
              </div>
            )}
            {student.guardian_name && (
              <div className="field">
                <dt>Parent / Guardian</dt>
                <dd>
                  {student.guardian_name}
                  {student.guardian_occupation && (
                    <span className="muted"> · {student.guardian_occupation}</span>
                  )}
                </dd>
              </div>
            )}
            {student.guardian_address && (
              <div className="field">
                <dt>Guardian Address</dt>
                <dd>{student.guardian_address}</dd>
              </div>
            )}
          </dl>
        </section>

        <div className="btn-row">
          <Link className="btn" data-variant="primary" href={`/students/${studentId}/edit`}>
            Edit record
          </Link>
          {original && (
            <a className="btn" href={`/api/students/${studentId}/original`}>
              Download original
            </a>
          )}
          <PrintPanel
            studentId={studentId}
            forms={forms}
            levelsByForm={levelsByForm}
            sf9Levels={sf9Terms(terms).map((t) => t.level)}
          />
        </div>
      </aside>

      <div className="rail-body">
        {/* Stamped as the server builds the page. If this HTML later comes back out of the
            service worker's cache, that is the moment the copy was taken. */}

        {isOldRecord && (
          <div className="notice">
            <strong>Pre-K-12 record (Form 137).</strong> This learner studied the old secondary
            curriculum, so their years are named as the original document names them. The record
            cannot be reissued on a modern SF10 — that would state a curriculum they never took.
            {original ? " Use Download original instead." : ""}
          </div>
        )}

        {issueCount > 0 && (
          <div className="notice">
            <strong>
              {issueCount} {issueCount === 1 ? "item" : "items"} on this record need checking
            </strong>{" "}
            against the original form. <Link href="/import/review">Review →</Link>
          </div>
        )}

        <div className="eyebrow" style={{ margin: "2px 0 14px" }}>
          Scholastic Record
        </div>

        {terms.length === 0 ? (
          <div className="card">
            <div className="empty">No enrolment terms recorded yet.</div>
          </div>
        ) : (
          terms.map((t, i) => (
            <TermCard
              key={t.id}
              term={t}
              index={i}
              subjects={subjectsByTerm.get(t.id) ?? []}
              attendance={t.curriculum === "old" ? (attendanceByTerm.get(t.id) ?? []) : []}
            />
          ))
        )}

        <div className="eyebrow" style={{ margin: "26px 0 14px" }}>
          Documents
        </div>

        <section className="card">
          <div className="card-head">
            <h3>Diplomas, certificates and report cards</h3>
          </div>
          <div className="card-body">
            <DocumentList studentId={studentId} documents={documents} />
          </div>
        </section>

        <DeleteRecord
          studentId={studentId}
          lrn={student.lrn}
          name={`${student.last_name}, ${given}`}
          summary={deletionSummary}
        />

        <div className="foot">
          <span>Pantao National High School · School ID 301860</span>
          <span>Printed forms are generated from the school&rsquo;s official SF10 template</span>
        </div>
      </div>
    </main>
  );
}
