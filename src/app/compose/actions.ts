'use server';

import { and, eq, inArray } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireUser } from '@/lib/auth/session';
import { db } from '@/lib/db/client';
import { connections, media, postItems, posts, postTargets } from '@/lib/db/schema';
import { storeUpload } from '@/lib/media/upload';

export type ComposeState = { error?: string } | undefined;

const schema = z.object({
  items: z
    .array(
      z
        .object({
          text: z.string().trim().max(100_000),
          files: z.array(z.object({ file: z.instanceof(File), alt: z.string().trim().max(1500) })),
        })
        .refine((i) => i.text || i.files.length, 'Each post needs text or media.'),
    )
    .min(1, 'Add at least one post.')
    .max(100),
  targets: z.array(z.uuid('Unknown connection.')).min(1, 'Pick at least one connection.'),
  autoThread: z.boolean(),
  scheduledAt: z.union([z.literal(''), z.iso.datetime({ offset: true, message: 'Invalid schedule time.' })]),
});

/** Reads `items[i].text`, `items[i].files`, `items[i].alt[j]`, `targets`, `autoThread`, `scheduledAt`. */
function read(form: FormData) {
  const items = [];
  for (let i = 0; form.has(`items[${i}].text`); i++) {
    const files = form.getAll(`items[${i}].files`).filter((f) => f instanceof File && f.size > 0) as File[];
    items.push({
      text: String(form.get(`items[${i}].text`)),
      files: files.map((file, j) => ({ file, alt: String(form.get(`items[${i}].alt[${j}]`) ?? '') })),
    });
  }
  return {
    items,
    targets: [...new Set(form.getAll('targets').map(String))],
    autoThread: form.get('autoThread') === 'on',
    scheduledAt: String(form.get('scheduledAt') ?? ''),
  };
}

/** Validate, upload media, then insert the post atomically. Due immediately when no schedule time is given. */
export async function createPost(_: ComposeState, form: FormData): Promise<ComposeState> {
  const user = await requireUser();
  const parsed = schema.safeParse(read(form));
  if (!parsed.success) return { error: parsed.error.issues[0].message };
  const { items, targets, autoThread, scheduledAt } = parsed.data;

  const owned = await db
    .select({ id: connections.id })
    .from(connections)
    .where(and(eq(connections.userId, user.id), inArray(connections.id, targets)));
  if (owned.length !== targets.length) return { error: 'Unknown connection.' };

  // ponytail: uploads from a submit that later fails stay in the bucket; add a sweeper if storage cost matters.
  const errors: string[] = [];
  const stored: (Awaited<ReturnType<typeof storeUpload>> & { alt: string | null })[][] = [];
  for (const item of items) {
    const out: (typeof stored)[number] = [];
    for (const { file, alt } of item.files) {
      try {
        out.push({ ...(await storeUpload(file)), alt: alt || null });
      } catch (e) {
        errors.push(e instanceof Error ? e.message : String(e));
      }
    }
    stored.push(out);
  }
  if (errors.length) return { error: errors.join('\n') };

  await db.transaction(async (tx) => {
    const [post] = await tx
      .insert(posts)
      .values({ userId: user.id, autoThread, scheduledAt: scheduledAt ? new Date(scheduledAt) : new Date() })
      .returning({ id: posts.id });
    for (const [position, item] of items.entries()) {
      const [row] = await tx.insert(postItems).values({ postId: post.id, position, text: item.text }).returning({ id: postItems.id });
      const files = stored[position];
      if (files.length)
        await tx.insert(media).values(
          files.map((m, i) => ({ postItemId: row.id, position: i, storageKey: m.key, mime: m.mime, size: m.size, alt: m.alt })),
        );
    }
    await tx.insert(postTargets).values(targets.map((connectionId) => ({ postId: post.id, connectionId })));
  });
  revalidatePath('/posts');
  redirect('/posts');
}
