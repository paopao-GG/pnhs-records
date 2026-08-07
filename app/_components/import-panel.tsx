"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { runImport, scanFolder, type ScanResult } from "../actions.ts";
import type { ImportSummary } from "@/lib/import/import-sf10.ts";

/**
 * Scan-then-import, rather than a single button: the registrar sees which files were found
 * before anything is written. Importing is safe to repeat - files already taken in are
 * recognised by content hash and skipped.
 */
export function ImportPanel({ defaultFolder }: { defaultFolder: string }) {
  const router = useRouter();
  const [folder, setFolder] = useState(defaultFolder);
  const [scan, setScan] = useState<ScanResult | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const doScan = () => {
    setError(null);
    setSummary(null);
    startTransition(async () => {
      try {
        setScan(await scanFolder(folder));
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  const doImport = () => {
    setError(null);
    startTransition(async () => {
      try {
        setSummary(await runImport(folder));
        setScan(null);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });
  };

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h3>Import SF10 files</h3>
        </div>
        <div className="card-body">
          <div className="form-field" style={{ marginBottom: 14 }}>
            <label htmlFor="folder">Folder containing the .xlsx files</label>
            <input
              id="folder"
              className="input mono"
              value={folder}
              onChange={(e) => {
                setFolder(e.target.value);
                setScan(null);
                setSummary(null);
              }}
              placeholder="sf10-copy"
              onKeyDown={(e) => e.key === "Enter" && doScan()}
            />
          </div>

          <div className="btn-row" style={{ alignItems: "center" }}>
            <button className="btn" onClick={doScan} disabled={pending}>
              {pending && !scan ? "Scanning…" : "Scan folder"}
            </button>
            {scan?.exists && scan.files.length > 0 && (
              <button className="btn" data-variant="primary" onClick={doImport} disabled={pending}>
                {pending ? "Importing…" : `Import ${scan.files.length} files`}
              </button>
            )}
            {error && <span style={{ color: "var(--seal)" }}>{error}</span>}
          </div>

          {scan && !scan.exists && (
            <p className="muted" style={{ marginBottom: 0 }}>
              No folder at <span className="mono">{scan.folder}</span>
            </p>
          )}

          {scan?.exists && (
            <div style={{ marginTop: 16 }}>
              <p className="count-line">
                {scan.files.length} .xlsx {scan.files.length === 1 ? "file" : "files"} in{" "}
                <span className="mono">{scan.folder}</span>
              </p>
              {scan.files.length > 0 && (
                <ul className="file-list">
                  {scan.files.map((f) => (
                    <li key={f} className="mono">
                      {f}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </section>

      {summary && <Results summary={summary} />}
    </>
  );
}

function Results({ summary }: { summary: ImportSummary }) {
  const withIssues = summary.results.filter((r) => r.issues.length > 0);

  return (
    <section className="card">
      <div className="card-head">
        <h3>Import result</h3>
        <div className="spacer" />
        <Link className="btn" href="/">
          View records
        </Link>
      </div>
      <div className="card-body">
        <div className="tally">
          <Tally n={summary.imported} label="new learners" tone="pass" />
          <Tally n={summary.updated} label="updated" tone="info" />
          <Tally n={summary.duplicates} label="already imported" tone="muted" />
          <Tally n={summary.failed} label="failed" tone={summary.failed ? "fail" : "muted"} />
          <Tally
            n={summary.issueCount}
            label="need review"
            tone={summary.issueCount ? "warn" : "muted"}
          />
        </div>

        <div className="table-scroll" style={{ marginTop: 18 }}>
          <table className="ledger">
            <thead>
              <tr>
                <th>File</th>
                <th>Learner</th>
                <th>LRN</th>
                <th className="num">Terms</th>
                <th className="num">Subjects</th>
                <th>Result</th>
              </tr>
            </thead>
            <tbody>
              {summary.results.map((r) => (
                <tr key={r.filename}>
                  <td style={{ fontSize: 12.5 }}>{r.filename}</td>
                  <td>
                    {r.studentId ? (
                      <Link href={`/students/${r.studentId}`}>{r.learner ?? "—"}</Link>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="mono" style={{ fontSize: 12.5 }}>
                    {r.lrn ?? "—"}
                  </td>
                  <td className="num">{r.terms ?? "—"}</td>
                  <td className="num">{r.subjects ?? "—"}</td>
                  <td>
                    <StatusChip r={r} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {withIssues.length > 0 && (
          <div className="notice" style={{ marginTop: 18, marginBottom: 0 }}>
            <strong>
              {summary.issueCount} {summary.issueCount === 1 ? "item needs" : "items need"} review.
            </strong>{" "}
            Everything was still imported — nothing was dropped.{" "}
            <Link href="/import/review">See what needs checking →</Link>
          </div>
        )}
      </div>
    </section>
  );
}

function StatusChip({ r }: { r: ImportSummary["results"][number] }) {
  if (r.status === "failed") {
    return <span className="chip" data-tone="fail" title={r.error}>Failed</span>;
  }
  if (r.status === "duplicate") {
    return <span className="chip" data-tone="muted" title={r.error}>Already imported</span>;
  }
  if (r.issues.length > 0) {
    return <span className="chip" data-tone="warn">Imported · {r.issues.length} to check</span>;
  }
  return (
    <span className="chip" data-tone="pass">
      {r.status === "updated" ? "Updated" : "Imported"}
    </span>
  );
}

function Tally({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div className="tally-item" data-tone={tone}>
      <div className="tally-n mono">{n}</div>
      <div className="tally-label">{label}</div>
    </div>
  );
}
