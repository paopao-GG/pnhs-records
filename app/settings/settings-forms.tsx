"use client";

import { useActionState } from "react";
import { changePassword, runBackup, type SettingsState } from "./actions.ts";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/policy.ts";

const initial: SettingsState = { error: null, done: null };

function Notice({ state }: { state: SettingsState }) {
  if (state.error) {
    return (
      <p className="unlock-error" role="alert">
        {state.error}
      </p>
    );
  }
  if (state.done) {
    return (
      <p className="settings-done" role="status">
        {state.done}
      </p>
    );
  }
  return null;
}

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePassword, initial);

  return (
    <form action={action} className="settings-form">
      <label htmlFor="current">Current password</label>
      <input
        id="current"
        name="current"
        type="password"
        className="input"
        autoComplete="current-password"
        required
      />

      <label htmlFor="next">New password</label>
      <input
        id="next"
        name="next"
        type="password"
        className="input"
        autoComplete="new-password"
        required
        minLength={MIN_PASSWORD_LENGTH}
      />

      <label htmlFor="confirm">Type it again</label>
      <input
        id="confirm"
        name="confirm"
        type="password"
        className="input"
        autoComplete="new-password"
        required
        minLength={MIN_PASSWORD_LENGTH}
      />

      <Notice state={state} />

      <button className="btn" data-variant="primary" disabled={pending}>
        {pending ? "Changing…" : "Change password"}
      </button>
    </form>
  );
}

export function BackupForm({ suggested }: { suggested: string }) {
  const [state, action, pending] = useActionState(runBackup, initial);

  return (
    <form action={action} className="settings-form">
      <label htmlFor="target">Copy to</label>
      <input
        id="target"
        name="target"
        className="input"
        defaultValue={suggested}
        spellCheck={false}
        placeholder="E:\PNHS backups"
      />

      <Notice state={state} />

      <button className="btn" data-variant="primary" disabled={pending}>
        {pending ? "Copying…" : "Back up now"}
      </button>
    </form>
  );
}
