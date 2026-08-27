import Link from "next/link";
import { getOpenIssues, type IssueRow } from "@/lib/db/queries.ts";
import { requireUnlocked } from "@/lib/auth/guard.ts";
import { ResolveButton } from "@/app/_components/resolve-button.tsx";

export const dynamic = "force-dynamic";

/** Issues are grouped by learner, because that is the unit a registrar actually fixes. */
function groupByLearner(issues: IssueRow[]): Map<string, IssueRow[]> {
  const groups = new Map<string, IssueRow[]>();
  for (const i of issues) {
    const key = i.student_id ? String(i.student_id) : `file:${i.filename}`;
    const list = groups.get(key) ?? [];
    list.push(i);
    groups.set(key, list);
  }
  return groups;
}

export default async function ReviewPage() {
  await requireUnlocked();

  const issues = await getOpenIssues();
  const groups = groupByLearner(issues);

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link href="/import">← Import</Link>
          </div>
          <h2>Needs review</h2>
        </div>
      </div>

      {issues.length === 0 ? (
        <div className="card">
          <div className="empty">Nothing needs review.</div>
        </div>
      ) : (
        <>
          <div className="notice">
            These records were imported in full — nothing was dropped. Each item below is
            something the original file recorded oddly and a person should confirm against the
            paper record.
          </div>

          {[...groups.entries()].map(([key, list]) => {
            const first = list[0];
            const name = first.last_name
              ? `${first.last_name}, ${first.first_name}`
              : first.filename;

            return (
              <section className="card" key={key}>
                <div className="card-head">
                  <h3>
                    {first.student_id ? (
                      <Link href={`/students/${first.student_id}`}>{name}</Link>
                    ) : (
                      name
                    )}
                  </h3>
                  {first.lrn && <span className="chip mono">{first.lrn}</span>}
                  <div className="spacer" />
                  <span className="muted" style={{ fontSize: 12.5 }}>
                    {first.filename}
                  </span>
                </div>
                <div className="card-body">
                  <ul className="issue-list">
                    {list.map((i) => (
                      <li key={i.id} data-severity={i.severity}>
                        <div>
                          <span className="issue-badge" data-severity={i.severity}>
                            {i.severity}
                          </span>
                          {i.message}
                          {i.cell && <span className="issue-cell mono">cell {i.cell}</span>}
                        </div>
                        <ResolveButton issueId={i.id} />
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            );
          })}
        </>
      )}
    </main>
  );
}
