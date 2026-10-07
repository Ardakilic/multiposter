/** Connections page: list/delete the user's accounts and add new ones. Credentials never leave the server. */

import { desc, eq } from 'drizzle-orm';
import { requireUser } from '@/lib/auth/session';
import { connectors } from '@/lib/connectors';
import { db } from '@/lib/db/client';
import { connections } from '@/lib/db/schema';
import { deleteConnection } from './actions';
import { ConnectForm } from './connect-form';

export default async function ConnectionsPage() {
  const user = await requireUser();
  const rows = await db
    .select({
      id: connections.id,
      label: connections.label,
      connector: connections.connector,
      accountName: connections.accountName,
      createdAt: connections.createdAt,
    })
    .from(connections)
    .where(eq(connections.userId, user.id))
    .orderBy(desc(connections.createdAt));
  const meta = Object.values(connectors).map((c) => ({
    id: c.id,
    name: c.name,
    fields: c.fields,
    capabilities: c.capabilities,
    maxLength: c.maxLength({}),
  }));

  return (
    <section className="flex flex-col gap-8">
      <div>
        <h1 className="mb-4 text-2xl font-semibold">Connections</h1>
        {rows.length === 0 ? (
          <p>No connections yet.</p>
        ) : (
          <ul className="divide-y divide-neutral-300">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 py-2">
                <div className="flex-1">
                  <div className="font-medium">
                    {r.label} <span className="font-normal text-neutral-500">· {connectors[r.connector]?.name ?? r.connector}</span>
                  </div>
                  <div className="text-sm text-neutral-500">
                    {r.accountName} · added {r.createdAt.toISOString().slice(0, 10)}
                  </div>
                </div>
                <form action={deleteConnection}>
                  <input type="hidden" name="id" value={r.id} />
                  <button type="submit" className="text-sm text-red-600 underline" aria-label={`Delete ${r.label}`}>
                    Delete
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h2 className="mb-4 text-xl font-semibold">Add connection</h2>
        <ConnectForm connectors={meta} />
      </div>
    </section>
  );
}
