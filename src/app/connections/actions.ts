'use server';

/**
 * Connection server actions. Credentials are verified against the platform before saving and
 * stored AES-GCM encrypted; every query is scoped to the current user.
 */

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { connectors } from '@/lib/connectors';
import { encrypt } from '@/lib/crypto';
import { db } from '@/lib/db/client';
import { connections } from '@/lib/db/schema';

export type ConnectState = { error?: string; saved?: number } | undefined;

/** Verify credentials with the platform, then save them encrypted. Labels are unique per user. */
export async function addConnection(_: ConnectState, form: FormData): Promise<ConnectState> {
  const user = await requireUser();
  const id = String(form.get('connector') ?? '');
  if (!Object.hasOwn(connectors, id)) return { error: 'Pick a connector.' };
  const connector = connectors[id];
  const label = String(form.get('label') ?? '').trim();
  if (!label || label.length > 100) return { error: 'Label is required (max 100 characters).' };

  const creds: Record<string, string> = {};
  for (const f of connector.fields) {
    const value = String(form.get(`field.${f.name}`) ?? '').trim();
    if (f.required && !value) return { error: `${f.label} is required.` };
    if (value) creds[f.name] = value;
  }

  let verified;
  try {
    verified = await connector.verify(creds);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }

  const [row] = await db
    .insert(connections)
    .values({
      userId: user.id,
      connector: id,
      label,
      accountName: verified.accountName,
      credentials: encrypt(creds),
      settings: verified.settings,
    })
    .onConflictDoNothing()
    .returning({ id: connections.id });
  if (!row) return { error: `You already have a connection labelled "${label}".` };
  revalidatePath('/connections');
  return { saved: Date.now() };
}

/** Delete a connection; its targets on existing posts cascade away. */
export async function deleteConnection(form: FormData) {
  const user = await requireUser();
  const id = z.uuid().safeParse(form.get('id'));
  if (!id.success) return;
  await db.delete(connections).where(and(eq(connections.id, id.data), eq(connections.userId, user.id)));
  revalidatePath('/connections');
}
