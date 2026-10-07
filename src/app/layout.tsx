/** Root layout. Rendered per request (`connection()`) because APP_NAME comes from runtime env. */

import type { Metadata } from 'next';
import Link from 'next/link';
import { connection } from 'next/server';
import { getUser } from '@/lib/auth/session';
import { getConfig } from '@/lib/config';
import { logout } from './(auth)/actions';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  await connection(); // request-time only: config comes from runtime env, not build env
  return { title: getConfig().APP_NAME };
}

export default async function RootLayout({ children }: LayoutProps<'/'>) {
  await connection();
  const user = await getUser();
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        <header className="border-b border-neutral-300">
          <nav className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-3">
            <Link href="/" className="font-semibold">
              {getConfig().APP_NAME}
            </Link>
            {user && (
              <>
                <Link href="/compose">Compose</Link>
                <Link href="/posts">Posts</Link>
                <Link href="/connections">Connections</Link>
                <form action={logout} className="ml-auto">
                  <button type="submit" className="underline">
                    Log out
                  </button>
                </form>
              </>
            )}
          </nav>
        </header>
        <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-6">{children}</main>
      </body>
    </html>
  );
}
