/** Login page; already-signed-in users go straight to /compose. */

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getUser } from '@/lib/auth/session';
import { getConfig } from '@/lib/config';
import { login } from '../actions';
import { AuthForm } from '../auth-form';

export default async function LoginPage() {
  if (await getUser()) redirect('/compose');
  return (
    <section className="mx-auto w-full max-w-sm">
      <h1 className="mb-4 text-2xl font-semibold">Log in</h1>
      <AuthForm action={login} label="Log in" />
      {getConfig().ALLOW_REGISTRATION && (
        <p className="mt-4 text-sm">
          No account? <Link href="/register" className="underline">Register</Link>
        </p>
      )}
    </section>
  );
}
