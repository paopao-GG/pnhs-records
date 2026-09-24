"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markIssueResolved } from "../actions.ts";

/**
 * Marks a flagged item as checked. This only clears the flag - it never edits the record,
 * because the fix belongs on the learner's page where the correction is visible.
 */
export function ResolveButton({ issueId }: { issueId: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button
        className="btn"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            try {
              setError(null);
              await markIssueResolved(issueId);
              router.refresh();
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            }
          })
        }
      >
        {pending ? "…" : "Checked"}
      </button>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
