"use client";

import { useActionState } from "react";
import { choosePassword, unlock, type UnlockFormState } from "./actions.ts";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/policy.ts";

const initial: UnlockFormState = { error: null };

/** The everyday screen: one field. */
export function UnlockForm() {
  const [state, action, pending] = useActionState(unlock, initial);

  return (
    <form action={action} className="unlock-form">
      <label htmlFor="password">Password</label>
      <input
        id="password"
        name="password"
        type="password"
        className="input"
        autoComplete="current-password"
        autoFocus
        required
      />

      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}

      <button className="btn" data-variant="primary" disabled={pending}>
        {pending ? "Opening…" : "Open"}
      </button>
    </form>
  );
}

/** First launch on this machine. Seen once, and never again. */
export function ChoosePasswordForm() {
  const [state, action, pending] = useActionState(choosePassword, initial);

  return (
    <form action={action} className="unlock-form">
      <label htmlFor="password">Choose a password</label>
      <input
        id="password"
        name="password"
        type="password"
        className="input"
        autoComplete="new-password"
        autoFocus
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

      {state.error && (
        <p className="form-error" role="alert">
          {state.error}
        </p>
      )}

      <button className="btn" data-variant="primary" disabled={pending}>
        {pending ? "Saving…" : "Set password and open"}
      </button>
    </form>
  );
}
