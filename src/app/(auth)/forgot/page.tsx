/** Request a password reset link (the action refuses when email is not configured). */

import Link from 'next/link';
import { requestPasswordReset } from '../actions';
import { AuthForm } from '../auth-form';

export default function ForgotPage() {
  return (
    <section className="mx-auto w-full max-w-sm">
      <h1 className="mb-4 text-2xl font-semibold">Reset password</h1>
      <AuthForm action={requestPasswordReset} label="Send reset link" fields={['email']} />
      <p className="mt-4 text-sm">
        <Link href="/login" className="underline">Back to log in</Link>
      </p>
    </section>
  );
}
