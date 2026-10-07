/** Register page; 404s when ALLOW_REGISTRATION is off (checked at request time, not build time). */

import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { getUser } from '@/lib/auth/session';
import { getConfig } from '@/lib/config';
import { register } from '../actions';
import { AuthForm } from '../auth-form';

export default async function RegisterPage() {
  await connection(); // config is runtime env, never build env
  if (!getConfig().ALLOW_REGISTRATION) notFound();
  if (await getUser()) redirect('/compose');
  return (
    <section className="mx-auto w-full max-w-sm">
      <h1 className="mb-4 text-2xl font-semibold">Register</h1>
      <AuthForm action={register} label="Create account" minPassword={8} />
      <p className="mt-4 text-sm">
        Have an account? <Link href="/login" className="underline">Log in</Link>
      </p>
    </section>
  );
}
