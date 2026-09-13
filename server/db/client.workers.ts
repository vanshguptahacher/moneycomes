/**
 * Cloudflare Workers — Database Client
 *
 * Creates a Drizzle ORM instance backed by postgres.js over Cloudflare Hyperdrive.
 *
 * ARCHITECTURE:
 *   Cloudflare Workers → Hyperdrive (connection pooler)
 *                         → Supabase PostgreSQL Transaction Pooler (port 6543)
 *                           → Supabase PostgreSQL (port 5432)
 *
 * WHY HYPERDRIVE?
 *   Cloudflare Workers cannot open raw TCP connections to external PostgreSQL
 *   servers using the standard pg (node-postgres) driver. Hyperdrive acts as a
 *   TCP-over-HTTP proxy, enabling postgres.js to connect to Supabase from Workers.
 *
 * SETUP (one-time, per Cloudflare project):
 *   1. Get your Supabase Transaction Pooler connection string from:
 *        Supabase Dashboard → Project Settings → Database → Connection Pooling
 *        (use port 6543 / Transaction mode)
 *
 *   2. Create the Hyperdrive instance:
 *        npx wrangler hyperdrive create moneycomes-db \
 *          --connection-string "postgresql://postgres.[REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres"
 *
 *   3. Copy the returned Hyperdrive ID into wrangler.toml:
 *        [[hyperdrive]]
 *        binding = "HYPERDRIVE"
 *        id = "<returned-id>"
 *
 *   4. Deploy:
 *        npx wrangler deploy
 *
 * IMPORTANT: `prepare: false` is required for Hyperdrive/PgBouncer compatibility
 *   (prepared statements are not supported in transaction-pooling mode).
 */

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema/index.js";

export interface HyperdriveBinding {
  connectionString: string;
}

/**
 * Factory function called once from worker.ts before the first request.
 *
 * @param hyperdrive - The Cloudflare Hyperdrive binding from Workers env.
 * @returns A Drizzle ORM instance that is fully Workers-compatible.
 */
export function createWorkersDb(
  hyperdrive: HyperdriveBinding
): PostgresJsDatabase<typeof schema> {
  const client = postgres(hyperdrive.connectionString, {
    // Hyperdrive manages the actual connection pool externally.
    max: 5,
    // REQUIRED for PgBouncer/Hyperdrive in transaction pooling mode.
    prepare: false,
  });

  return drizzle(client, { schema });
}
