/** Landing page of the password reset link: hidden token + new password. */

import Link from 'next/link';
import { resetPassword } from '../actions';
import { AuthForm } from '../auth-form';

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ token?: string | string[] }> }) {
  const { token } = await searchParams;
  return (
    <section className="mx-auto w-full max-w-sm">
      <h1 className="mb-4 text-2xl font-semibold">Choose a new password</h1>
      {typeof token === 'string' && token ? (
        <AuthForm action={resetPassword} label="Set password" fields={['password']} minPassword={8} token={token} />
      ) : (
        <p role="alert" className="text-red-600">
          This link is invalid or has expired. <Link href="/forgot" className="underline">Request a new one</Link>.
        </p>
      )}
    </section>
  );
}
