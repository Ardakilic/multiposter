/** Landing page of the confirmation link. Confirming is an explicit POST: mail scanners prefetch links, and only an action may set the session cookie. */

import { verifyEmail } from '../actions';
import { AuthForm } from '../auth-form';

export default async function VerifyPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return (
    <section className="mx-auto w-full max-w-sm">
      <h1 className="mb-4 text-2xl font-semibold">Confirm your email</h1>
      {typeof token === 'string' && token ? (
        <AuthForm action={verifyEmail} label="Confirm email" fields={[]} token={token} />
      ) : (
        <p role="alert" className="text-red-600">
          This link is invalid or has expired.
        </p>
      )}
    </section>
  );
}
