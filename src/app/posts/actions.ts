'use server';

/** Post server actions. */

import { and, eq } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { posts } from '@/lib/db/schema';

/** Cancel a post only while it is still 'scheduled'; a claimed post can no longer be stopped. */
export async function cancelPost(form: FormData) {
  const user = await requireUser();
  const id = z.uuid().safeParse(form.get('id'));
  if (!id.success) return;
  await db
    .update(posts)
    .set({ status: 'cancelled' })
    .where(and(eq(posts.id, id.data), eq(posts.userId, user.id), eq(posts.status, 'scheduled')));
  revalidatePath('/posts');
}
