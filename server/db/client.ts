import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import { config } from "../config/index.js";
import * as schema from "./schema/index.js";

const { Pool } = pg;

// Node.js pool — used in development and test environments only.
export const pool = new Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Node.js Drizzle instance — the default for development and test.
const _nodeDb: NodePgDatabase<typeof schema> = drizzle(pool, { schema });

// Workers-injected override — set by worker.ts via setDb() before first request.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _dbOverride: any | null = null;

/**
 * Inject a Workers-compatible database instance.
 *
 * Call this from the Cloudflare Workers entry point (worker.ts) before
 * handling any requests. The Proxy below will delegate all `db` access to
 * this instance once it is set.
 *
 * Example (worker.ts):
 *   import { setDb } from "./server/db/client.js";
 *   import { createWorkersDb } from "./server/db/client.workers.js";
 *   setDb(createWorkersDb(env.HYPERDRIVE));
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setDb(instance: any): void {
  _dbOverride = instance;
}

/**
 * The authoritative application database handle.
 *
 * - Node.js (dev/test): backed by pg.Pool → DATABASE_URL.
 * - Cloudflare Workers (production): backed by the Hyperdrive-powered instance
 *   injected via setDb() in worker.ts.
 *
 * All existing service/repository imports of `db` work without modification.
 */
export const db: NodePgDatabase<typeof schema> = new Proxy(_nodeDb, {
  get(target, prop, receiver) {
    const source = _dbOverride ?? target;
    const value = Reflect.get(source, prop, receiver);
    return typeof value === "function" ? value.bind(source) : value;
  },
});

/**
 * Verifies whether the database connection is alive.
 *
 * In Node.js: acquires a pool client and runs SELECT 1.
 * In Workers: executes SELECT 1 through the injected db instance.
 * Returns true if successful, false otherwise.
 */
export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    if (_dbOverride) {
      // Workers path — use the injected Drizzle instance directly.
      await _dbOverride.execute(sql`SELECT 1`);
      return true;
    }
    // Node.js path — use the pg pool.
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
      return true;
    } finally {
      client.release();
    }
  } catch (error) {
    console.warn("Database connection check failed:", (error as Error).message);
    return false;
  }
}
