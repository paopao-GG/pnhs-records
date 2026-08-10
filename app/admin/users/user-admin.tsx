"use client";

import { useActionState } from "react";
import { createAccount, resetPassword, setActive, type AdminState } from "./actions.ts";
import type { UserRow } from "@/lib/db/users.ts";

const initial: AdminState = { error: null, notice: null };

function Message({ state }: { state: AdminState }) {
  if (state.error) {
    return (
      <p className="login-error" role="alert">
        {state.error}
      </p>
    );
  }
  if (state.notice) {
    return (
      <p className="notice" role="status">
        {state.notice}
      </p>
    );
  }
  return null;
}

export function NewAccountForm() {
  const [state, action, pending] = useActionState(createAccount, initial);

  return (
    <form action={action} className="account-form">
      <div className="field-row">
        <div>
          <label htmlFor="username">Username</label>
          <input id="username" name="username" className="input" autoComplete="off" required />
        </div>
        <div>
          <label htmlFor="fullName">Full name</label>
          <input id="fullName" name="fullName" className="input" autoComplete="off" required />
        </div>
        <div>
          <label htmlFor="role">Role</label>
          <select id="role" name="role" className="select" defaultValue="adviser">
            <option value="adviser">Adviser</option>
            <option value="admin">Admin</option>
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="password">Temporary password</label>
        <input
          id="password"
          name="password"
          className="input"
          type="text"
          autoComplete="off"
          required
        />
        <p className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>
          At least 12 characters. Shown as plain text so you can read it out to them &mdash; they
          should change it once signed in.
        </p>
      </div>

      <Message state={state} />

      <button className="btn" data-variant="primary" disabled={pending}>
        {pending ? "Creating…" : "Create account"}
      </button>
    </form>
  );
}

export function UserRowActions({ user, isSelf }: { user: UserRow; isSelf: boolean }) {
  const [resetState, resetAction, resetting] = useActionState(resetPassword, initial);
  const [activeState, activeAction, toggling] = useActionState(setActive, initial);

  return (
    <div className="account-actions">
      <form action={resetAction} className="btn-row">
        <input type="hidden" name="userId" value={user.id} />
        <input
          name="password"
          className="input"
          type="text"
          placeholder="New password"
          autoComplete="off"
          style={{ maxWidth: 230 }}
        />
        <button className="btn" disabled={resetting}>
          {resetting ? "Saving…" : "Set password"}
        </button>
      </form>

      <form action={activeAction}>
        <input type="hidden" name="userId" value={user.id} />
        <input type="hidden" name="active" value={user.active ? "0" : "1"} />
        <button className="btn" disabled={toggling || (isSelf && Boolean(user.active))}>
          {user.active ? "Deactivate" : "Reactivate"}
        </button>
      </form>

      <Message state={resetState.error || resetState.notice ? resetState : activeState} />
    </div>
  );
}
