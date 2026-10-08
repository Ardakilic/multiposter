import { and, eq, gt } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { sha256 } from '../crypto';
import { db } from '../db/client';
import { emailTokens } from '../db/schema';

type Purpose = 'verify' | 'reset';

export const TOKEN_TTL_MS = { verify: 24 * 60 * 60 * 1000, reset: 60 * 60 * 1000 };

/** New single-use token for user+purpose (replacing any older one); only its SHA-256 is stored. */
export async function createToken(userId: string, purpose: Purpose): Promise<string> {
  const raw = randomBytes(32).toString('base64url');
  await db.delete(emailTokens).where(and(eq(emailTokens.userId, userId), eq(emailTokens.purpose, purpose)));
  await db
    .insert(emailTokens)
    .values({ userId, purpose, tokenHash: sha256(raw), expiresAt: new Date(Date.now() + TOKEN_TTL_MS[purpose]) });
  return raw;
}

/** userId of a valid, unexpired token of this purpose (deleting it), else null. */
export async function consumeToken(raw: string, purpose: Purpose): Promise<string | null> {
  if (typeof raw !== 'string' || !raw) return null;
  const [row] = await db
    .delete(emailTokens)
    .where(
      and(eq(emailTokens.tokenHash, sha256(raw)), eq(emailTokens.purpose, purpose), gt(emailTokens.expiresAt, new Date())),
    )
    .returning({ userId: emailTokens.userId });
  return row?.userId ?? null;
}
