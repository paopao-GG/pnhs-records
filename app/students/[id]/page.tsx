import Link from "next/link";
import { notFound } from "next/navigation";
import {
  availableForms,
  countIssuesForStudent,
  getDeletionSummary,
  getStudent,
  getSubjects,
  getTerms,
  type SubjectRow,
  type TermRow,
} from "@/lib/db/queries.ts";
import { DeleteRecord } from "@/app/_components/delete-record.tsx";
import { finalRating, generalAverage, isPassing } from "@/lib/grading.ts";
import { jhsFinalRatingIsComputed } from "@/lib/sf10/jhs-map.ts";

export const dynamic = "force-dynamic";

function termLabel(t: TermRow): string {
  return t.semester ? `Grade ${t.level} · ${t.semester === 1 ? "First" : "Second"} Semester` : `Grade ${t.level}`;
}

/**
 * Resolves the printed final rating for a subject row.
 *
 * Mirrors the template exactly: JHS averages four quarters, SHS two - except JHS Homeroom
 * Guidance and CAT, which carry no formula on the form and so use the stored value.
 */
function resolveFinal(s: SubjectRow, index: number, isJhs: boolean): number | null {
  if (isJhs && !jhsFinalRatingIsComputed(index)) return s.final_rating;
  return finalRating({ q1: s.q1, q2: s.q2, q3: s.q3, q4: s.q4 }, isJhs ? "jhs" : "shs");
}

function Grade({ value }: { value: number | null }) {
  if (value == null) return <span className="muted">—</span>;
  return <span className={isPassing(value) ? undefined : "grade-fail"}>{value}</span>;
}

function TermCard({ term, index }: { term: TermRow; index: number }) {
  const isJhs = term.level <= 10;
  const subjects = getSubjects(term.id);
  const finals = subjects.map((s, i) => resolveFinal(s, i, isJhs));
  const genAve = generalAverage(finals);
  const passing = isPassing(genAve);

  return (
    // Capped so a learner with six years of records does not crawl in one card at a time.
    <section className="card" style={{ animationDelay: `${Math.min(index, 5) * 55}ms` }}>
      <div className="card-head">
        <h3>{termLabel(term)}</h3>
        {term.section && <span className="chip">{term.section}</span>}
        <span className="muted mono" style={{ fontSize: 13 }}>
          {term.school_year ?? "—"}
        </span>
        <div className="spacer" />
        <span className="stamp" data-tone={passing === null ? "none" : passing ? "pass" : "fail"}>
          {term.promotion_remark ?? "Incomplete"}
        </span>
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
                <th className="num">Q1</th>
                <th className="num">Q2</th>
                {isJhs && <th className="num">Q3</th>}
                {isJhs && <th className="num">Q4</th>}
                <th className="final">Final</th>
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
                  <td className="num">
                    <Grade value={s.q1} />
                  </td>
                  <td className="num">
                    <Grade value={s.q2} />
                  </td>
                  {isJhs && (
                    <td className="num">
                      <Grade value={s.q3} />
                    </td>
                  )}
                  {isJhs && (
                    <td className="num">
                      <Grade value={s.q4} />
                    </td>
                  )}
                  <td className="final">
                    <Grade value={finals[i]} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={isJhs ? 5 : 4}>
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
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </section>
  );
}

export default async function StudentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const studentId = Number(id);
  const student = getStudent(studentId);
  if (!student) notFound();

  const terms = getTerms(studentId);
  const forms = availableForms(terms);
  const issueCount = countIssuesForStudent(studentId);
  const given = [student.first_name, student.middle_name, student.name_ext]
    .filter(Boolean)
    .join(" ");

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link href="/">← All records</Link>
          </div>
          <h2>
            {student.last_name}, {given}
          </h2>
        </div>
        <div className="spacer" />
        <div className="btn-row">
          <Link className="btn" href={`/students/${studentId}/edit`}>
            Edit record
          </Link>
          {forms.map((form) => (
            <a
              key={form}
              className="btn"
              data-variant="primary"
              href={`/api/students/${studentId}/sf10?form=${form}`}
            >
              Print SF10 {form.toUpperCase()}
            </a>
          ))}
        </div>
      </div>

      {issueCount > 0 && (
        <div className="notice">
          <strong>
            {issueCount} {issueCount === 1 ? "item" : "items"} on this record need checking
          </strong>{" "}
          against the original form.{" "}
          <Link href="/import/review">Review →</Link>
        </div>
      )}

      <section className="card">
        <div className="card-head">
          <h3>Learner Information</h3>
        </div>
        <div className="card-body">
          <dl className="fields">
            <div className="field">
              <dt>LRN</dt>
              <dd className="mono">{student.lrn}</dd>
            </div>
            <div className="field">
              <dt>Last Name</dt>
              <dd>{student.last_name}</dd>
            </div>
            <div className="field">
              <dt>First Name</dt>
              <dd>{student.first_name}</dd>
            </div>
            <div className="field">
              <dt>Middle Name</dt>
              <dd>{student.middle_name ?? ""}</dd>
            </div>
            <div className="field">
              <dt>Sex</dt>
              <dd>{student.sex === "M" ? "Male" : student.sex === "F" ? "Female" : ""}</dd>
            </div>
            <div className="field">
              <dt>Date of Birth</dt>
              <dd className="mono">{student.birthdate ?? ""}</dd>
            </div>
          </dl>
        </div>
      </section>

      <div className="eyebrow" style={{ margin: "30px 0 12px" }}>
        Scholastic Record
      </div>

      {terms.length === 0 ? (
        <div className="card">
          <div className="empty">No enrolment terms recorded yet.</div>
        </div>
      ) : (
        terms.map((t, i) => <TermCard key={t.id} term={t} index={i} />)
      )}

      <DeleteRecord
        studentId={studentId}
        lrn={student.lrn}
        name={`${student.last_name}, ${given}`}
        summary={getDeletionSummary(studentId)}
      />

      <div className="foot">
        <span>Pantao National High School · School ID 301860</span>
        <span>Printed forms are generated from the school&rsquo;s official SF10 template</span>
      </div>
    </main>
  );
}
