import Link from "next/link";
import { ImportPanel } from "@/app/_components/import-panel.tsx";
import { getImportHistory, countOpenIssues } from "@/lib/db/queries.ts";

export const dynamic = "force-dynamic";

export default function ImportPage() {
  const history = getImportHistory(12);
  const openIssues = countOpenIssues();

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link href="/">← All records</Link>
          </div>
          <h2>Import</h2>
        </div>
        <div className="spacer" />
        {openIssues > 0 && (
          <Link className="btn" href="/import/review">
            {openIssues} to review
          </Link>
        )}
      </div>

      <div className="notice">
        Pick individual SF10 files, or point this at a whole folder. Running either again is
        safe — a file counts as already imported only while the learner it produced still
        exists, so deleting a record and re-importing its file brings the record back.
        <br />
        <strong>SHS forms only for now.</strong> JHS import needs a real filled SF10-JHS to
        build against.
      </div>

      <ImportPanel defaultFolder="sf10-files" />

      {history.length > 0 && (
        <section className="card">
          <div className="card-head">
            <h3>Recently imported</h3>
          </div>
          <div className="card-body">
            <div className="table-scroll">
              <table className="ledger">
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Learner</th>
                    <th>Result</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td style={{ fontSize: 12.5 }}>{h.filename}</td>
                      <td>
                        {h.student_id ? (
                          <Link href={`/students/${h.student_id}`}>
                            {h.last_name}, {h.first_name}
                          </Link>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                      <td>
                        <span
                          className="chip"
                          data-tone={h.status === "failed" ? "fail" : "pass"}
                          title={h.notes ?? undefined}
                        >
                          {h.status}
                        </span>
                      </td>
                      <td className="mono" style={{ fontSize: 12.5 }}>
                        {h.imported_at}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
