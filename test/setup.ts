import { sql } from 'drizzle-orm';
import { beforeEach } from 'vitest';
import { resetConfig } from '../src/lib/config';
import { db } from '../src/lib/db/client';

beforeEach(async () => {
  resetConfig();
  await db.execute(sql`TRUNCATE users, sessions, connections, posts, post_items, media, post_targets CASCADE`);
});
