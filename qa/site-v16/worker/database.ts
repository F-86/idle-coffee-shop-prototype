import type { D1Database } from '@cloudflare/workers-types';
export function database(env: { DB?: D1Database }): D1Database {
  if (!env.DB) throw new Error('Database binding unavailable');
  return env.DB;
}
