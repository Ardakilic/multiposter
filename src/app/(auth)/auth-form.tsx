'use client';

/**
 * Shared auth form (login, register, forgot/reset password, email confirmation), driven by a `useActionState`
 * server action. `fields` picks the visible inputs; `token` (from an emailed link) is posted as a hidden field.
 */

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
  fields = ['email', 'password'],
  token,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  label: string;
  minPassword?: number;
  fields?: ('email' | 'password')[];
  token?: string;
}) {
  const [state, formAction] = useActionState(action, undefined);
  return (
    <form action={formAction} className="flex flex-col gap-3">
      {token && <input type="hidden" name="token" value={token} />}
      {fields.includes('email') && (
        <label className="field">
          Email
          <input name="email" type="email" required autoComplete="email" className="input" />
        </label>
      )}
      {fields.includes('password') && (
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
      )}
      {state?.error && (
        <p role="alert" className="text-red-600">
          {state.error}
        </p>
      )}
      {state?.message && (
        <p role="status" className="text-green-700">
          {state.message}
        </p>
      )}
      <Submit label={label} />
    </form>
  );
}
