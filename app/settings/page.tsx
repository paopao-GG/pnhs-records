import Link from "next/link";
import { requireUnlocked } from "@/lib/auth/guard.ts";
import { IDLE_TIMEOUT_MS, passwordChangedAt } from "@/lib/auth/unlock.ts";
import { defaultBackupRoot } from "@/lib/backup.ts";
import { dataDir } from "@/lib/paths.ts";
import { BackupForm, ChangePasswordForm } from "./settings-forms.tsx";

export const dynamic = "force-dynamic";

function when(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "unknown"
    : d.toLocaleString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

export default async function SettingsPage() {
  await requireUnlocked();

  const changed = await passwordChangedAt();

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link href="/">← All records</Link>
          </div>
          <h2>Settings</h2>
        </div>
      </div>

      {/* Backup first, deliberately. It is the only thing on this page that can lose records. */}
      <section className="card">
        <div className="card-head">
          <h3>Backup</h3>
        </div>
        <div className="card-body">
          <p className="muted" style={{ marginTop: 0 }}>
            This machine holds the only copy of these records. Copy them to a removable drive
            regularly, and <strong>keep one copy outside the school</strong> — a backup in the
            same room as the computer does not survive the things most likely to destroy it.
          </p>
          <p className="muted">
            A backup nobody has restored is a hypothesis. Open one occasionally and check that a
            learner&rsquo;s record is really in it.
          </p>
          <BackupForm suggested={defaultBackupRoot()} />
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Password</h3>
          <span className="muted" style={{ fontSize: 12.5 }}>
            Last changed {when(changed)}
          </span>
        </div>
        <div className="card-body">
          <p className="muted" style={{ marginTop: 0 }}>
            Changing the password closes the app immediately — you and anyone else with it open
            will be asked for the new one. It also locks itself after{" "}
            {Math.round(IDLE_TIMEOUT_MS / 60000)} minutes of no use.
          </p>
          <ChangePasswordForm />
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>Where the records are</h3>
        </div>
        <div className="card-body">
          <p className="muted" style={{ marginTop: 0 }}>
            Everything this app stores — the database and every imported original — is in:
          </p>
          <p className="mono" style={{ wordBreak: "break-all" }}>
            {dataDir()}
          </p>
          <p className="muted">
            Uninstalling the app does not delete that folder. Do not move it into OneDrive or any
            other syncing folder: file-sync tools and databases corrupt each other.
          </p>
        </div>
      </section>
    </main>
  );
}
