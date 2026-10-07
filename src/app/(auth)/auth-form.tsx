'use client';

/** Shared email/password form for login and register, driven by a `useActionState` server action. */

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import type { FormState } from './actions';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn">
      {pending ? 'Please wait…' : label}
    </button>
  );
}

export function AuthForm({
  action,
  label,
  minPassword = 1,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  label: string;
  minPassword?: number;
}) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label className="field">
        Email
        <input name="email" type="email" required autoComplete="email" className="input" />
      </label>
      <label className="field">
        Password
        <input
          name="password"
          type="password"
          required
          minLength={minPassword}
          autoComplete={minPassword > 1 ? 'new-password' : 'current-password'}
          className="input"
        />
      </label>
      {state?.error && (
        <p role="alert" className="text-red-600">
          {state.error}
        </p>
      )}
      <Submit label={label} />
    </form>
  );
}
