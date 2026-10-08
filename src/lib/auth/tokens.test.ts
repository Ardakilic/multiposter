import { describe, expect, it } from 'vitest';
import { db } from '../db/client';
import { emailTokens, users } from '../db/schema';
import { sha256 } from '../crypto';
import { consumeToken, createToken, TOKEN_TTL_MS } from './tokens';

async function makeUser() {
  const [u] = await db.insert(users).values({ email: 'a@example.com', passwordHash: 'x' }).returning();
  return u.id;
}

describe('email tokens', () => {
  it('round-trips once, storing only the hash with the purpose TTL', async () => {
    const id = await makeUser();
    const raw = await createToken(id, 'reset');
    const [row] = await db.select().from(emailTokens);
    expect(row).toMatchObject({ userId: id, purpose: 'reset', tokenHash: sha256(raw) });
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + TOKEN_TTL_MS.reset - 60_000);
    expect(row.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + TOKEN_TTL_MS.reset);
    expect(await consumeToken(raw, 'reset')).toBe(id);
    expect(await consumeToken(raw, 'reset')).toBeNull();
    expect(await db.select().from(emailTokens)).toHaveLength(0);
  });

  it('rejects the wrong purpose without consuming', async () => {
    const id = await makeUser();
    const raw = await createToken(id, 'verify');
    expect(await consumeToken(raw, 'reset')).toBeNull();
    expect(await consumeToken(raw, 'verify')).toBe(id);
  });

  it('rejects expired, unknown and malformed tokens', async () => {
    const id = await makeUser();
    await db.insert(emailTokens).values({ userId: id, purpose: 'verify', tokenHash: sha256('old'), expiresAt: new Date(Date.now() - 1000) });
    expect(await consumeToken('old', 'verify')).toBeNull();
    expect(await consumeToken('nope', 'verify')).toBeNull();
    expect(await consumeToken('', 'verify')).toBeNull();
    expect(await consumeToken(undefined as unknown as string, 'verify')).toBeNull();
  });

  it('replaces the previous token of the same purpose only', async () => {
    const id = await makeUser();
    const first = await createToken(id, 'verify');
    const reset = await createToken(id, 'reset');
    const second = await createToken(id, 'verify');
    expect(await db.select().from(emailTokens)).toHaveLength(2);
    expect(await consumeToken(first, 'verify')).toBeNull();
    expect(await consumeToken(second, 'verify')).toBe(id);
    expect(await consumeToken(reset, 'reset')).toBe(id);
  });
});
