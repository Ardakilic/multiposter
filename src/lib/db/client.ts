import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate as runMigrations } from 'drizzle-orm/node-postgres/migrator';
import path from 'node:path';
import { Pool } from 'pg';
import { getConfig } from '../config';
import * as schema from './schema';

type DB = NodePgDatabase<typeof schema> & { $client: Pool };

let instance: DB | undefined;

function getDb(): DB {
  instance ??= drizzle({ client: new Pool({ connectionString: getConfig().DATABASE_URL }), schema });
  return instance;
}

/** Lazy drizzle instance: the pool is created on first use, not at import. */
export const db = new Proxy({} as DB, {
  get(_, prop) {
    const real = getDb();
    const value = Reflect.get(real, prop);
    return typeof value === 'function' ? value.bind(real) : value;
  },
});

/** Apply `drizzle/` migrations; runs at startup from instrumentation. */
export async function migrate() {
  await runMigrations(getDb(), { migrationsFolder: path.join(process.cwd(), 'drizzle') });
}
