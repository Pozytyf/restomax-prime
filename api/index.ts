import type { IncomingMessage, ServerResponse } from 'node:http';
import { createExpressApp } from '../src/server/app.ts';
import { getDb } from '../src/server/db.ts';
import { runKnexMigrations } from '../src/server/knex.ts';
import {
  checkSupabaseHealth,
  getSupabaseAdminClient,
} from '../src/server/lib/supabase.ts';

const app = createExpressApp();
let initPromise: Promise<void> | null = null;

async function ensureInitialized(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      getSupabaseAdminClient();
      const sbHealth = await checkSupabaseHealth();
      if (sbHealth.configured && sbHealth.postgresConnected === false) {
        console.warn(
          '[Vercel/API] Supabase PostgreSQL configured but initial ping failed; verify SUPABASE_DB_URL / DATABASE_URL.',
        );
      }
      const postgresCutover = process.env.RESTOMAX_POSTGRES_CUTOVER === 'true';
      if (postgresCutover) {
        if (!process.env.SUPABASE_DB_URL && !process.env.DATABASE_URL) {
          throw new Error('PostgreSQL cutover requested but DATABASE_URL / SUPABASE_DB_URL is missing.');
        }
        // Fail closed: never fall back to ephemeral SQLite after the cutover.
        await runKnexMigrations();
        return;
      }
      // Until explicit cutover, keep the legacy SQLite runtime unchanged.
      // Do not mutate PostgreSQL while the application is still using SQLite.
      getDb();
    })().catch((err) => {
      initPromise = null;
      throw err;
    });
  }
  return initPromise;
}

export default async function handler(
  req: IncomingMessage,
  res: ServerResponse,
) {
  await ensureInitialized();
  return app(req as Parameters<typeof app>[0], res as Parameters<typeof app>[1]);
}
