"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { StudentDocumentRow } from "@/lib/db/queries.ts";
import { documentLabel } from "@/lib/documents.ts";

/**
 * The documents filed against this learner.
 *
 * Removal asks first, in place. Every destructive flow in this app expands rather than opening
 * a modal - see the delete-record panel, which takes a typed LRN. This one is a lighter
 * confirmation because it is a lighter act: a mis-filed certificate is a mistake to correct,
 * not a permanent record to destroy, and the learner's own record is untouched either way.
 */
export function DocumentList({
  studentId,
  documents,
}: {
  studentId: number;
  documents: StudentDocumentRow[];
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(documentId: number) {
    setBusy(documentId);
    setError(null);
    try {
      const res = await fetch(`/api/students/${studentId}/documents?documentId=${documentId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setError(await res.text());
        return;
      }
      setConfirming(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  }

  if (documents.length === 0) {
    return (
      <p className="muted" style={{ margin: 0 }}>
        No diplomas, certificates or report cards filed yet. Add one from the{" "}
        <a href="/import">Import</a> page.
      </p>
    );
  }

  return (
    <>
      <div className="table-scroll">
        <table className="ledger">
          <thead>
            <tr>
              <th>Document</th>
              <th>File</th>
              <th>Filed</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {documents.map((doc) => (
              <tr key={doc.id}>
                <td>{documentLabel(doc.document_type)}</td>
                <td className="meta">
                  <a href={`/api/students/${studentId}/documents/${doc.id}`}>{doc.filename}</a>
                </td>
                <td className="mono meta"  >
                  {doc.uploaded_at}
                </td>
                <td className="row-actions">
                  {confirming === doc.id ? (
                    <>
                      <button
                        className="row-remove"
                        data-confirm="yes"
                        disabled={busy === doc.id}
                        onClick={() => remove(doc.id)}
                      >
                        {busy === doc.id ? "…" : "Remove"}
                      </button>
                      <button className="row-move" onClick={() => setConfirming(null)}>
                        Keep
                      </button>
                    </>
                  ) : (
                    <button
                      className="row-remove"
                      aria-label={`Remove ${documentLabel(doc.document_type)}`}
                      onClick={() => {
                        setConfirming(doc.id);
                        setError(null);
                      }}
                    >
                      ×
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
