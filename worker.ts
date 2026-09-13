/**
 * Cloudflare Workers Entry Point — MoneyComes API
 *
 * This file is the production entry point for Cloudflare Workers.
 * It is SEPARATE from server/index.ts (the Node.js development runner).
 *
 * RUNTIME FLOW:
 *   1. Worker module is loaded. Config reads from process.env (Workers env bindings
 *      are available via process.env with the nodejs_compat flag).
 *   2. On the FIRST request, createWorkersDb() injects a Hyperdrive-backed
 *      Drizzle instance via setDb(), replacing the Node.js pg.Pool default.
 *   3. All subsequent requests use the injected Workers-compatible DB client.
 *   4. The Hono app (server/app.ts) handles the request identically to Node.js.
 *
 * DEPLOYMENT:
 *   npx wrangler deploy
 *
 * LOCAL DEVELOPMENT (Workers runtime simulation):
 *   npx wrangler dev   ← uses wrangler.toml dev overrides
 *
 * LOCAL DEVELOPMENT (Node.js, recommended for active development):
 *   npm run server:dev  ← uses server/index.ts, faster iteration
 */

import { app } from "./server/app.js";
import { setDb } from "./server/db/client.js";
import { createWorkersDb, type HyperdriveBinding } from "./server/db/client.workers.js";

export interface Env {
  // ── Cloudflare Hyperdrive binding ──────────────────────────────────────────
  // Proxies TCP PostgreSQL connections to Supabase from the Workers runtime.
  // Configure via: npx wrangler hyperdrive create moneycomes-db --connection-string "..."
  HYPERDRIVE: HyperdriveBinding;

  // ── Plain string environment variables (set as Workers secrets or vars) ───
  NODE_ENV: string;
  DATABASE_URL: string;       // Fallback reference — actual connections use HYPERDRIVE
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  CORS_ORIGIN: string;
  TRUSTED_ORIGINS: string;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  SUPABASE_STORAGE_BUCKET: string;
}

// DB is injected once per Worker isolate lifetime (not per-request).
// Cloudflare Workers re-use isolates across requests, so this is safe.
let dbInitialized = false;

export default {
  async fetch(
    request: Request,
    env: Env,
    _ctx: unknown
  ): Promise<Response> {
    // ── Inject Workers-compatible DB on first request ──────────────────────
    // setDb() swaps the Proxy target from the pg.Pool to the Hyperdrive client.
    // This is a one-time operation per isolate (not per-request overhead).
    if (!dbInitialized) {
      setDb(createWorkersDb(env.HYPERDRIVE));
      dbInitialized = true;
    }

    return app.fetch(request);
  },
};
