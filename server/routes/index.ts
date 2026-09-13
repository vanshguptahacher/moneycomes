import { Hono } from "hono";
import { authRoutes } from "./auth.js";
import { friendsRoutes } from "./friends.js";
import { groupsRoutes } from "./groups.js";
import { healthRoutes } from "./health.js";
import { usersRoutes } from "./users.js";
import { activityRoutes } from "./activity.js";
import { notificationsRoutes } from "./notifications.js";
import { attachmentsRoutes } from "./attachments.js";
import { expensesRoutes } from "./expenses.js";
import { settlementsRoutes } from "./settlements.js";
import { balancesRoutes } from "./balances.js";

/**
 * Main API v1 Router (/api/v1).
 *
 * Domain subrouters mount here independently:
 * - /health: Health & readiness checks
 * - /auth: Authentication session verification
 * - /users: User profile management & identity
 * - /friends: Friendships, user search & bilateral balances (Phase 4.3)
 * - /groups: Group CRUD, membership management & authorization (Phase 4.4)
 * - /activity: Activity history & event feed (Phase 4.7)
 * - /notifications: Notifications, unread counts & read states (Phase 4.8)
 * - /groups/:groupId/expenses: Group expenses & split calculations (Phase 4.5/4.10)
 * - /groups/:groupId/expenses/:expenseId/attachments: Attachments & receipt uploads (Phase 4.9)
 * - /groups/:groupId/settlements: Group settlements & payment records (Phase 4.6/4.7)
 * - /groups/:groupId/balance: Group balance summary & simplified debts (Phase 4.6)
 */
export const apiV1Routes = new Hono();

// Core infrastructure & identity routes
apiV1Routes.route("/health", healthRoutes);
apiV1Routes.route("/auth", authRoutes);
apiV1Routes.route("/users", usersRoutes);
apiV1Routes.route("/friends", friendsRoutes);
apiV1Routes.route("/groups", groupsRoutes);
apiV1Routes.route("/activity", activityRoutes);
apiV1Routes.route("/notifications", notificationsRoutes);

// Group-scoped resource routes
apiV1Routes.route("/groups/:groupId/expenses", expensesRoutes);
apiV1Routes.route("/groups/:groupId/expenses/:expenseId/attachments", attachmentsRoutes);
apiV1Routes.route("/groups/:groupId/settlements", settlementsRoutes);
apiV1Routes.route("/groups/:groupId/balance", balancesRoutes);

