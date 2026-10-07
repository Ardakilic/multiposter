import { asc, eq, inArray } from 'drizzle-orm';
import { getConnector } from '../connectors';
import type { MediaFile, Ref } from '../connectors/types';
import { decrypt } from '../crypto';
import { db } from '../db/client';
import { connections, media, postItems, posts, postTargets } from '../db/schema';
import { toMediaFile } from '../media/upload';
import { splitText } from '../text/split';

type Item = { text: string; media: MediaFile[] };
type Result = { id: string; url?: string };

/** Publish a post to all its targets (SPEC §9). Never throws; per-target errors land in `post_targets.error`. */
export async function publishPost(postId: string): Promise<void> {
  try {
    const [post] = await db.select().from(posts).where(eq(posts.id, postId));
    if (!post) return;
    const itemRows = await db.select().from(postItems).where(eq(postItems.postId, postId)).orderBy(asc(postItems.position));
    const mediaRows = itemRows.length
      ? await db
          .select()
          .from(media)
          .where(
            inArray(
              media.postItemId,
              itemRows.map((i) => i.id),
            ),
          )
          .orderBy(asc(media.position))
      : [];
    const items: Item[] = itemRows.map((i) => ({
      text: i.text,
      media: mediaRows.filter((m) => m.postItemId === i.id).map(toMediaFile),
    }));
    const targets = await db
      .select({ id: postTargets.id, connection: connections })
      .from(postTargets)
      .innerJoin(connections, eq(postTargets.connectionId, connections.id))
      .where(eq(postTargets.postId, postId));

    const outcomes = await Promise.allSettled(
      targets.map(async (t) => {
        const results: Result[] = [];
        try {
          await publishTarget(t.connection, items, post.autoThread, results);
          await db.update(postTargets).set({ status: 'published', result: results, error: null }).where(eq(postTargets.id, t.id));
        } catch (err) {
          // keep partial results: chunks already posted must stay traceable
          await db
            .update(postTargets)
            .set({ status: 'failed', result: results, error: err instanceof Error ? err.message : String(err) })
            .where(eq(postTargets.id, t.id));
          throw err;
        }
      }),
    );
    const ok = outcomes.filter((o) => o.status === 'fulfilled').length;
    const status = ok > 0 && ok === outcomes.length ? 'published' : ok > 0 ? 'partial' : 'failed';
    await db.update(posts).set({ status, publishedAt: new Date() }).where(eq(posts.id, postId));
  } catch (err) {
    // a DB failure here leaves the post in 'publishing'; worker tick() fails it after 15 min
    console.error(`publishPost ${postId} failed`, err);
  }
}

async function publishTarget(
  connection: typeof connections.$inferSelect,
  items: Item[],
  autoThread: boolean,
  results: Result[],
) {
  const connector = getConnector(connection.connector);
  const creds = decrypt<Record<string, string>>(connection.credentials);
  const { settings } = connection;
  const { name, capabilities: cap } = connector;
  const max = connector.maxLength(settings);

  const chunks: Item[] = [];
  for (const item of items) {
    if (!item.media.length && !cap.textOnly) throw new Error(`${name} requires media on every post`);
    if (!cap.video && item.media.some((m) => m.mime.startsWith('video/'))) throw new Error(`${name} does not support video`);
    if (item.media.length > cap.maxMedia) throw new Error(`too many media for ${name} (${item.media.length}/${cap.maxMedia})`);
    const n = connector.countLength(item.text);
    let texts = [item.text];
    if (n > max) {
      if (!(autoThread && cap.threads)) throw new Error(`too long for ${name} (${n}/${max})`);
      texts = splitText(item.text, max, connector.countLength);
      if (!texts.length) throw new Error(`too long for ${name} (${n}/${max})`);
    }
    texts.forEach((text, i) => chunks.push({ text, media: i === 0 ? item.media : [] }));
  }
  if (chunks.length > 1 && !cap.threads) throw new Error(`${name} does not support threads`);

  let root: Ref | undefined;
  let parent: Ref | undefined;
  for (const chunk of chunks) {
    const res = await connector.post({ creds, settings, text: chunk.text, media: chunk.media, root, parent });
    results.push({ id: res.id, url: res.url });
    root ??= res.ref;
    parent = res.ref;
  }
}
