"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { markIssueResolved } from "../actions.ts";

/**
 * Marks a flagged item as checked. This only clears the flag - it never edits the record,
 * because the fix belongs on the learner's page where the correction is visible.
 */
export function ResolveButton({ issueId }: { issueId: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      className="btn"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await markIssueResolved(issueId);
          router.refresh();
        })
      }
    >
      {pending ? "…" : "Checked"}
    </button>
  );
}
