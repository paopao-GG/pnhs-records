import Link from "next/link";
import { requireAdmin } from "@/lib/auth/current-user.ts";
import { listUsers } from "@/lib/db/users.ts";
import { NewAccountForm, UserRowActions } from "./user-admin.tsx";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  // Admin only. The actions in ./actions.ts check again for themselves - a hidden page is not a
  // closed endpoint.
  const admin = await requireAdmin();
  const users = await listUsers();

  const activeAdmins = users.filter((u) => u.role === "admin" && u.active).length;

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link href="/">← All records</Link>
          </div>
          <h2>Accounts</h2>
        </div>
      </div>

      {activeAdmins < 2 && (
        <div className="notice">
          <strong>There is only one admin account.</strong> Only an admin can issue accounts or
          reset a password, so if this one is unavailable nobody can. Create a second admin for
          someone else who is usually in school.
        </div>
      )}

      <section className="card">
        <div className="card-head">
          <h3>Existing accounts</h3>
        </div>
        <div className="card-body">
          <div className="table-scroll">
            <table className="ledger">
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Password changed</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="mono">{u.username}</td>
                    <td>
                      {u.full_name}
                      {u.id === admin.id && <span className="muted"> · you</span>}
                    </td>
                    <td>
                      <span className="chip">{u.role}</span>
                    </td>
                    <td>
                      <span className="chip" data-tone={u.active ? "pass" : "fail"}>
                        {u.active ? "active" : "deactivated"}
                      </span>
                    </td>
                    <td className="mono" style={{ fontSize: 12.5 }}>
                      {u.password_changed_at}
                    </td>
                    <td>
                      <UserRowActions user={u} isSelf={u.id === admin.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h3>New account</h3>
        </div>
        <div className="card-body">
          <NewAccountForm />
        </div>
      </section>
    </main>
  );
}
