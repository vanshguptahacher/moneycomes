import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { secureHeaders } from "hono/secure-headers";
import { auth } from "./auth/index.js";
import { config } from "./config/index.js";
import { errorHandler, notFoundHandler } from "./middleware/error-handler.js";
import { structuredLogger } from "./middleware/logger.js";
import { requestId } from "./middleware/request-id.js";
import { healthRoutes } from "./routes/health.js";
import { apiV1Routes } from "./routes/index.js";
import { sendError } from "./utils/response.js";

export const app = new Hono();

// ============================================================================
// MIDDLEWARE PIPELINE (Order is deliberate and strictly enforced)
// 1. Request ID: Establish sanitized correlation identifier
// 2. Structured Logger: Capture method, path, timing, status, and requestId
// 3. Security Headers: Set protective HTTP headers (nosniff, frameguard, etc.)
// 4. CORS: Cross-origin resource sharing with credentials & allowed origins
// 5. Body Limit: Mitigate Denial of Service from oversized payloads (1MB max)
// ============================================================================

// 1. Traceable request correlation ID
app.use("*", requestId());

// 2. Structured JSON logging
app.use("*", structuredLogger());

// 3. HTTP Security Headers (X-Content-Type-Options, X-Frame-Options, Referrer-Policy, etc.)
app.use("*", secureHeaders());

// 4. Controlled Cross-Origin Resource Sharing
app.use(
  "*",
  cors({
    origin: config.CORS_ORIGIN === "*" ? "*" : config.CORS_ORIGIN.split(",").map((o) => o.trim()),
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
    credentials: true,
    maxAge: 86400,
  })
);

// 5. Request payload size guard (1MB limit)
app.use(
  "*",
  bodyLimit({
    maxSize: 1024 * 1024,
    onError: (c) => {
      return sendError(
        c,
        "PAYLOAD_TOO_LARGE",
        "Request payload exceeds maximum allowed size of 1MB",
        413
      );
    },
  })
);

// ============================================================================
// ROUTING
// ============================================================================

// Better Auth handler endpoints
app.on(["POST", "GET"], "/api/auth/**", (c) => {
  return auth.handler(c.req.raw);
});

// Health check endpoints (available at root /health and /api/v1/health)
app.route("/health", healthRoutes);

// Versioned API routes (/api/v1/...)
app.route("/api/v1", apiV1Routes);

// ============================================================================
// CENTRALIZED ERROR & 404 HANDLERS
// ============================================================================
app.onError(errorHandler);
app.notFound(notFoundHandler);
