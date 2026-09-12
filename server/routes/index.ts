import { Hono } from "hono";
import { authRoutes } from "./auth.js";
import { healthRoutes } from "./health.js";

/**
 * Main API v1 Router (/api/v1).
 *
 * Domain subrouters mount here independently:
 * - /health: Health & readiness checks
 * - /auth: Authentication profile and session verification
 * - (Future Phase 3): /users, /friends
 * - (Future Phase 4): /groups
 * - (Future Phase 5): /expenses, /settlements, /activity
 */
export const apiV1Routes = new Hono();

// Core infrastructure routes
apiV1Routes.route("/health", healthRoutes);
apiV1Routes.route("/auth", authRoutes);
