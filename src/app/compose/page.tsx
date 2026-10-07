/** Compose page; lists the user's connections with each connector's length limit for the form. */

import { eq } from 'drizzle-orm';
import Link from 'next/link';
import { requireUser } from '@/lib/auth/session';
import { connectors } from '@/lib/connectors';
import { db } from '@/lib/db/client';
import { connections } from '@/lib/db/schema';
import { ComposeForm } from './compose-form';

export default async function ComposePage() {
  const user = await requireUser();
  const rows = await db.select().from(connections).where(eq(connections.userId, user.id)).orderBy(connections.label);
  const targets = rows.flatMap((r) => {
    const c = connectors[r.connector];
    return c ? [{ id: r.id, label: r.label, accountName: r.accountName, connector: c.name, maxLength: c.maxLength(r.settings) }] : [];
  });

  return (
    <section>
      <h1 className="mb-4 text-2xl font-semibold">Compose</h1>
      {targets.length === 0 ? (
        <p>
          Add a <Link href="/connections" className="underline">connection</Link> first.
        </p>
      ) : (
        <ComposeForm targets={targets} />
      )}
    </section>
  );
}
