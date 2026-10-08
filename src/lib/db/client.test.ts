import { sql } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { Pool } from 'pg';
import { describe, expect, it } from 'vitest';
import { db, migrate } from './client';
import * as schema from './schema';
import { connections, users } from './schema';

describe('db client', () => {
  it('migrate is idempotent and the schema is usable', async () => {
    await migrate();
    const [u] = await db.insert(users).values({ email: 'a@b.c', passwordHash: 'h' }).returning();
    expect(u.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(u.createdAt).toBeInstanceOf(Date);
    const row = { userId: u.id, connector: 'x', label: 'x-main', accountName: '@a', credentials: 'enc' };
    await db.insert(connections).values(row);
    await expect(db.insert(connections).values(row)).rejects.toThrow(); // unique(user_id, label)
    const { rows } = await db.execute(sql`select 1 as one`);
    expect(rows).toEqual([{ one: 1 }]);
  });
});

describe('schema', () => {
  it('exposes the pg Pool lazily', () => {
    expect(db.$client).toBeInstanceOf(Pool);
  });

  it('every foreign key cascades on delete', () => {
    const fks = Object.values(schema)
      .filter((t) => t && typeof t === 'object' && Symbol.for('drizzle:IsDrizzleTable') in t)
      .flatMap((t) => getTableConfig(t as typeof users).foreignKeys);
    const refs = fks.map((fk) => {
      const r = fk.reference();
      return `${getTableConfig(r.foreignTable).name}<-${r.columns[0].name}:${fk.onDelete}`;
    });
    expect(refs.sort()).toEqual([
      'connections<-connection_id:cascade',
      'post_items<-post_item_id:cascade',
      'posts<-post_id:cascade',
      'posts<-post_id:cascade',
      'users<-user_id:cascade',
      'users<-user_id:cascade',
      'users<-user_id:cascade',
      'users<-user_id:cascade',
    ]);
  });
});
