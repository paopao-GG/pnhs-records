import { redirect } from "next/navigation";
import { getUnlockState } from "@/lib/auth/guard.ts";
import { Guilloche } from "@/app/_components/guilloche.tsx";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/policy.ts";
import { ChoosePasswordForm, UnlockForm } from "./unlock-form.tsx";

export const dynamic = "force-dynamic";

export default async function UnlockPage() {
  const unlockState = await getUnlockState();

  // Already open: there is nothing to do here.
  if (unlockState === "unlocked") redirect("/");

  const firstRun = unlockState === "unset";

  return (
    <main className="page unlock-page">
      <section className="card unlock-card">
        {/* The one screen every user sees before they see anything else. The watermark does
            the work of saying what kind of system this is. */}
        <Guilloche />
        <div className="card-head">
          <h3>{firstRun ? "Set a password" : "Open records"}</h3>
        </div>
        <div className="card-body">
          {firstRun ? (
            <>
              <p className="muted" style={{ marginTop: 0 }}>
                This machine has no password yet. Choose one now — it will be asked for every
                time the app is opened. At least {MIN_PASSWORD_LENGTH} characters; a short
                phrase you can remember is fine.
              </p>
              <p className="muted">
                There is no way to recover it. Nobody can reset it for you.
              </p>
              <ChoosePasswordForm />
            </>
          ) : (
            <>
              <p className="muted" style={{ marginTop: 0 }}>
                Learner permanent records.
              </p>
              <UnlockForm />
            </>
          )}
        </div>
      </section>

      <div className="foot">
        <span>Pantao National High School · School ID 301860</span>
        <span>Confidential learner information</span>
      </div>
    </main>
  );
}
