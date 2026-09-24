"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ImportSummary, FileResult } from "@/lib/import/import-sf10.ts";

/**
 * Pick files and import them.
 *
 * ## How a file gets in
 *
 *     browser --> POST /api/import/upload --> server reads, parses, writes
 *
 * One hop. This used to be three: the browser asked for a presigned upload ticket, PUT the
 * bytes straight into an object store, then told the server which keys to import. That dance
 * existed because a Vercel function caps request bodies at 4.5 MB — about twenty SF10s — and
 * the school's archive is over a thousand files. The server is now on this machine and the
 * file is already on its disk, so the cap, the bucket and the ticket all went together.
 *
 * Still batched. Not for a time limit any more, but because it is what lets the progress
 * counter move during a thousand-file import instead of sitting still for several minutes.
 *
 * Importing is always safe to repeat: a file counts as already imported only while the learner
 * it produced still exists.
 */

/** Small enough that the progress counter moves, large enough not to be chatty. */
const BATCH_SIZE = 5;

export function ImportPanel() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [chosen, setChosen] = useState<File[]>([]);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; stage: string } | null>(
    null,
  );

  const reset = () => {
    setChosen([]);
    if (fileInput.current) fileInput.current.value = "";
  };

  const doImport = async () => {
    if (chosen.length === 0) return;
    setError(null);
    setSummary(null);
    setBusy(true);

    const results: FileResult[] = [];

    try {
      const send = async (payload: BodyInit) => {
        const res = await fetch("/api/import/upload", { method: "POST", body: payload });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? `Import failed (${res.status})`);
        return json as ImportSummary;
      };

      for (let i = 0; i < chosen.length; i += BATCH_SIZE) {
        const batch = chosen.slice(i, i + BATCH_SIZE);
        setProgress({ done: i, total: chosen.length, stage: "Importing" });
        const body = new FormData();
        for (const f of batch) body.append("files", f);
        results.push(...(await send(body)).results);
      }

      setSummary({
        folder: "(uploaded files)",
        results,
        imported: results.filter((r) => r.status === "imported").length,
        updated: results.filter((r) => r.status === "updated").length,
        duplicates: results.filter((r) => r.status === "duplicate").length,
        failed: results.filter((r) => r.status === "failed").length,
        issueCount: results.reduce((n, r) => n + r.issues.length, 0),
      });
      reset();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // Whatever did land is still worth showing - those records are in.
      if (results.length > 0) {
        setSummary({
          folder: "(uploaded files)",
          results,
          imported: results.filter((r) => r.status === "imported").length,
          updated: results.filter((r) => r.status === "updated").length,
          duplicates: results.filter((r) => r.status === "duplicate").length,
          failed: results.filter((r) => r.status === "failed").length,
          issueCount: results.reduce((n, r) => n + r.issues.length, 0),
        });
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <>
      <section className="card">
        <div className="card-head">
          <h3>Choose files</h3>
          <span className="muted meta"  >
            One record, or a whole year&rsquo;s worth
          </span>
        </div>
        <div className="card-body">
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.docx"
            multiple
            className="file-input"
            disabled={busy}
            onChange={(e) => {
              setChosen(Array.from(e.target.files ?? []));
              setSummary(null);
              setError(null);
            }}
          />

          {chosen.length > 0 && (
            <p className="count-line" style={{ marginTop: 14 }}>
              {chosen.length} {chosen.length === 1 ? "file" : "files"} selected
              {chosen.length <= 25 && (
                <ul className="file-list" style={{ marginTop: 8 }}>
                  {chosen.map((f) => (
                    <li key={f.name} className="mono">
                      {f.name}
                    </li>
                  ))}
                </ul>
              )}
            </p>
          )}

          <div className="btn-row" style={{ marginTop: 14, alignItems: "center" }}>
            <button
              className="btn"
              data-variant="primary"
              onClick={doImport}
              disabled={busy || chosen.length === 0}
            >
              {busy
                ? "Working…"
                : chosen.length === 0
                  ? "Import selected files"
                  : `Import ${chosen.length} ${chosen.length === 1 ? "file" : "files"}`}
            </button>
            {chosen.length > 0 && !busy && (
              <button className="btn" onClick={reset}>
                Clear
              </button>
            )}
            {error && <span style={{ color: "var(--alert)" }}>{error}</span>}
          </div>

          {progress && (
            // A thousand files takes minutes. A page that says nothing looks like a page that
            // has hung, and the registrar reloads it halfway through.
            <div className="progress" style={{ marginTop: 14 }}>
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%` }}
                />
              </div>
              <span className="muted meta"  >
                {progress.stage} {progress.done} of {progress.total}
              </span>
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
                  <td className="meta">{r.filename}</td>
                  <td>
                    {r.studentId ? (
                      <Link href={`/students/${r.studentId}`}>{r.learner ?? "—"}</Link>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td className="mono meta"  >
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
