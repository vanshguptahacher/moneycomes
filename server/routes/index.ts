import { Hono } from "hono";
import { authRoutes } from "./auth.js";
import { healthRoutes } from "./health.js";
import { usersRoutes } from "./users.js";

/**
 * Main API v1 Router (/api/v1).
 *
 * Domain subrouters mount here independently:
 * - /health: Health & readiness checks
 * - /auth: Authentication session verification
 * - /users: User profile management & identity
 * - (Future Phase 4.3+): /friends, /groups, /expenses, /settlements, /activity
 */
export const apiV1Routes = new Hono();

// Core infrastructure & identity routes
apiV1Routes.route("/health", healthRoutes);
apiV1Routes.route("/auth", authRoutes);
apiV1Routes.route("/users", usersRoutes);
