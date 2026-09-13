import type { Context, MiddlewareHandler } from "hono";
import { sendError } from "../utils/response.js";

export interface RateLimiterOptions {
  windowMs?: number;
  maxRequests?: number;
  keyGenerator?: (c: Context) => string;
  skip?: (c: Context) => boolean;
}

interface ClientRecord {
  timestamps: number[];
}

/**
 * Sliding window in-memory rate limiter safe for edge runtime and standard Node.js.
 * Automatically cleans up stale entries to prevent memory exhaustion.
 */
export function rateLimiter(options: RateLimiterOptions = {}): MiddlewareHandler {
  const windowMs = options.windowMs ?? 60 * 1000; // 1 minute default
  const maxRequests = options.maxRequests ?? 120; // 120 requests per minute default
  const clients = new Map<string, ClientRecord>();

  // Cleanup helper to purge dead IPs/keys periodically
  let lastCleanup = Date.now();
  const cleanupInterval = Math.max(windowMs, 60 * 1000);

  function purgeExpired(now: number): void {
    if (now - lastCleanup < cleanupInterval) return;
    lastCleanup = now;
    const expiry = now - windowMs;
    for (const [key, record] of clients.entries()) {
      record.timestamps = record.timestamps.filter((ts) => ts > expiry);
      if (record.timestamps.length === 0) {
        clients.delete(key);
      }
    }
  }

  return async function rateLimitMiddleware(c, next) {
    if (options.skip && options.skip(c)) {
      return next();
    }

    const now = Date.now();
    purgeExpired(now);

    const clientKey = options.keyGenerator
      ? options.keyGenerator(c)
      : c.req.header("cf-connecting-ip") ||
        c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
        c.req.header("x-real-ip") ||
        "anonymous";

    let record = clients.get(clientKey);
    if (!record) {
      record = { timestamps: [] };
      clients.set(clientKey, record);
    }

    // Filter to timestamps within current sliding window
    const windowStart = now - windowMs;
    record.timestamps = record.timestamps.filter((ts) => ts > windowStart);

    if (record.timestamps.length >= maxRequests) {
      const oldestTimestamp = record.timestamps[0] ?? now;
      const resetSeconds = Math.ceil((oldestTimestamp + windowMs - now) / 1000);

      c.header("Retry-After", String(Math.max(1, resetSeconds)));
      c.header("X-RateLimit-Limit", String(maxRequests));
      c.header("X-RateLimit-Remaining", "0");
      c.header("X-RateLimit-Reset", String(Math.ceil((oldestTimestamp + windowMs) / 1000)));

      return sendError(
        c,
        "TOO_MANY_REQUESTS",
        "Rate limit exceeded. Please try again later.",
        429
      );
    }

    // Record this request
    record.timestamps.push(now);

    const remaining = Math.max(0, maxRequests - record.timestamps.length);
    c.header("X-RateLimit-Limit", String(maxRequests));
    c.header("X-RateLimit-Remaining", String(remaining));

    return next();
  };
}
