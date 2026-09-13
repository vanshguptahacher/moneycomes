import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, getAuthUser } from "../middleware/auth.js";
import { validateQuery, getValidQuery } from "../middleware/validator.js";
import { notificationService } from "../services/notification.service.js";
import { sendSuccess } from "../utils/response.js";
import { BadRequestError } from "../errors/index.js";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateNotificationUuid(value: string | undefined): string {
  if (!value || !UUID_REGEX.test(value)) {
    throw new BadRequestError("Invalid notificationId format: must be a valid UUID");
  }
  return value;
}

/**
 * Validation schema for listing notifications.
 */
export const listNotificationsQuerySchema = z.object({
  limit: z
    .string()
    .regex(/^\d+$/, "limit must be a positive integer")
    .transform(Number)
    .optional(),
  offset: z
    .string()
    .regex(/^\d+$/, "offset must be a positive integer")
    .transform(Number)
    .optional(),
  unreadOnly: z
    .enum(["true", "false"])
    .transform((val) => val === "true")
    .optional(),
  type: z
    .string()
    .trim()
    .max(64, "type cannot exceed 64 characters")
    .optional(),
});

/**
 * Notifications Router (/api/v1/notifications).
 *
 * Enforces:
 * - Better Auth server-side identity (actor.id).
 * - Recipient-isolated queries (IDOR prevention).
 * - Read/unread state transitions.
 * - Deterministic ordering and bounded pagination.
 * - Strict read/mutation boundary: no client-side POST / or DELETE.
 */
export const notificationsRoutes = new Hono();
notificationsRoutes.use("*", requireAuth());

// GET /api/v1/notifications — List notifications for authenticated user
notificationsRoutes.get("/", validateQuery(listNotificationsQuerySchema), async (c) => {
  const actor = getAuthUser(c);
  const query = getValidQuery<typeof listNotificationsQuerySchema>(c);
  const result = await notificationService.getUserNotifications(actor.id, query);

  return sendSuccess(c, result.notifications, 200, {
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  });
});

// GET /api/v1/notifications/unread-count — Efficient unread count
notificationsRoutes.get("/unread-count", async (c) => {
  const actor = getAuthUser(c);
  const result = await notificationService.getUnreadCount(actor.id);
  return sendSuccess(c, result, 200);
});

// POST & PATCH /api/v1/notifications/read-all — Mark all unread as read
notificationsRoutes.post("/read-all", async (c) => {
  const actor = getAuthUser(c);
  const result = await notificationService.markAllAsRead(actor.id);
  return sendSuccess(c, result, 200);
});

notificationsRoutes.patch("/read-all", async (c) => {
  const actor = getAuthUser(c);
  const result = await notificationService.markAllAsRead(actor.id);
  return sendSuccess(c, result, 200);
});

// GET /api/v1/notifications/:notificationId — Get single notification
notificationsRoutes.get("/:notificationId", async (c) => {
  const actor = getAuthUser(c);
  const notificationId = validateNotificationUuid(c.req.param("notificationId"));
  const result = await notificationService.getNotificationById(actor.id, notificationId);
  return sendSuccess(c, result, 200);
});

// PATCH /api/v1/notifications/:notificationId/read — Mark single notification as read
notificationsRoutes.patch("/:notificationId/read", async (c) => {
  const actor = getAuthUser(c);
  const notificationId = validateNotificationUuid(c.req.param("notificationId"));
  const result = await notificationService.markAsRead(actor.id, notificationId);
  return sendSuccess(c, result, 200);
});

// PATCH /api/v1/notifications/:notificationId/unread — Mark single notification as unread
notificationsRoutes.patch("/:notificationId/unread", async (c) => {
  const actor = getAuthUser(c);
  const notificationId = validateNotificationUuid(c.req.param("notificationId"));
  const result = await notificationService.markAsUnread(actor.id, notificationId);
  return sendSuccess(c, result, 200);
});
