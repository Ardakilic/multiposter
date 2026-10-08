/**
 * Drizzle schema. A post has ordered items (thread parts) with media, and one target row per connection.
 * `posts.published_at` doubles as the worker's claim stamp while status is 'publishing'.
 */

import { boolean, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const postStatus = pgEnum('post_status', ['scheduled', 'publishing', 'published', 'partial', 'failed', 'cancelled']);
export const targetStatus = pgEnum('target_status', ['pending', 'published', 'failed']);
export const emailTokenPurpose = pgEnum('email_token_purpose', ['verify', 'reset']);

export const users = pgTable('users', {
  id: id(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
  createdAt: createdAt(),
});

export const sessions = pgTable('sessions', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const emailTokens = pgTable('email_tokens', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  purpose: emailTokenPurpose('purpose').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
});

export const connections = pgTable(
  'connections',
  {
    id: id(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    connector: text('connector').notNull(),
    label: text('label').notNull(),
    accountName: text('account_name').notNull(),
    credentials: text('credentials').notNull(), // AES-GCM encrypted JSON (src/lib/crypto.ts)
    settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.userId, t.label)],
);

export const posts = pgTable('posts', {
  id: id(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  status: postStatus('status').notNull().default('scheduled'),
  autoThread: boolean('auto_thread').notNull().default(false),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
  createdAt: createdAt(),
  publishedAt: timestamp('published_at', { withTimezone: true }),
});

export const postItems = pgTable('post_items', {
  id: id(),
  postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  text: text('text').notNull(),
});

export const media = pgTable('media', {
  id: id(),
  postItemId: uuid('post_item_id').notNull().references(() => postItems.id, { onDelete: 'cascade' }),
  position: integer('position').notNull(),
  storageKey: text('storage_key').notNull(),
  mime: text('mime').notNull(),
  size: integer('size').notNull(),
  alt: text('alt'),
});

export const postTargets = pgTable('post_targets', {
  id: id(),
  postId: uuid('post_id').notNull().references(() => posts.id, { onDelete: 'cascade' }),
  connectionId: uuid('connection_id').notNull().references(() => connections.id, { onDelete: 'cascade' }),
  status: targetStatus('status').notNull().default('pending'),
  result: jsonb('result').$type<{ id: string; url?: string }[]>().notNull().default([]),
  error: text('error'),
});
