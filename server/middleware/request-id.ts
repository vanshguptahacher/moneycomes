import { createMiddleware } from "hono/factory";
import { randomUUID } from "node:crypto";

declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
  }
}

// Strictly allow only alphanumeric characters, underscores, and hyphens (max 64 chars)
// Prevents log injection, CRLF injection, and memory bloat from untrusted client headers.
const SAFE_REQUEST_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Middleware that establishes a traceable request ID for every incoming request.
 * - Preserves a client-supplied X-Request-Id ONLY if it matches strict sanitization rules.
 * - Generates a cryptographically secure UUID if missing or invalid.
 * - Returns the X-Request-Id in the response headers.
 */
export const requestId = () =>
  createMiddleware(async (c, next) => {
    const rawHeader = c.req.header("x-request-id");
    const isSafe = rawHeader && SAFE_REQUEST_ID_REGEX.test(rawHeader);
    const id = isSafe
      ? rawHeader
      : typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : randomUUID();

    c.set("requestId", id);
    c.header("X-Request-Id", id);

    await next();
  });
