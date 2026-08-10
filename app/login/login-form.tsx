"use client";

import { useActionState } from "react";
import { signIn, type LoginState } from "./actions.ts";

const initial: LoginState = { error: null };

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, initial);

  return (
    <form action={action} className="login-form">
      <label htmlFor="username">Username</label>
      <input
        id="username"
        name="username"
        className="input"
        autoComplete="username"
        autoFocus
        required
      />

      <label htmlFor="password">Password</label>
      <input
        id="password"
        name="password"
        type="password"
        className="input"
        autoComplete="current-password"
        required
      />

      {state.error && (
        <p className="login-error" role="alert">
          {state.error}
        </p>
      )}

      <button className="btn" data-variant="primary" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
