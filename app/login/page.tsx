import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user.ts";
import { LoginForm } from "./login-form.tsx";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Already signed in: there is nothing to do here.
  if (await getCurrentUser()) redirect("/");

  return (
    <main className="page login-page">
      <section className="card login-card">
        <div className="card-head">
          <h3>Sign in</h3>
        </div>
        <div className="card-body">
          <p className="muted" style={{ marginTop: 0 }}>
            Learner permanent records. Accounts are issued by the registrar.
          </p>
          <LoginForm />
        </div>
      </section>

      <div className="foot">
        <span>Pantao National High School · School ID 301860</span>
        <span>Confidential learner information</span>
      </div>
    </main>
  );
}
