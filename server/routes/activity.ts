import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, getAuthUser } from "../middleware/auth.js";
import { validateQuery, getValidQuery } from "../middleware/validator.js";
import { activityService } from "../services/activity.service.js";
import { sendSuccess } from "../utils/response.js";
import { BadRequestError } from "../errors/index.js";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUuid(value: string | undefined, paramName: string): string {
  if (!value || !UUID_REGEX.test(value)) {
    throw new BadRequestError(`Invalid ${paramName} format: must be a valid UUID`);
  }
  return value;
}

/**
 * Validation schema for listing activity events.
 */
export const listActivityQuerySchema = z.object({
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
  type: z
    .string()
    .trim()
    .max(64, "type cannot exceed 64 characters")
    .optional(),
  entityType: z
    .string()
    .trim()
    .max(32, "entityType cannot exceed 32 characters")
    .optional(),
});

/**
 * Global User Activity Router (/api/v1/activity).
 * Returns chronological activity feed across all user's authorized groups.
 * Strict read-only: no client-side POST, PATCH, or DELETE.
 */
export const activityRoutes = new Hono();
activityRoutes.use("*", requireAuth());

activityRoutes.get("/", validateQuery(listActivityQuerySchema), async (c) => {
  const actor = getAuthUser(c);
  const query = getValidQuery<typeof listActivityQuerySchema>(c);
  const result = await activityService.getUserActivity(actor.id, query);

  return sendSuccess(c, result.activities, 200, {
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  });
});

/**
 * Group Activity Router (/api/v1/groups/:groupId/activity).
 * Returns chronological activity feed scoped to the requested group.
 * Requires active group membership; enforces IDOR protection.
 */
export const groupActivityRoutes = new Hono();
groupActivityRoutes.use("*", requireAuth());

groupActivityRoutes.get("/", validateQuery(listActivityQuerySchema), async (c) => {
  const actor = getAuthUser(c);
  const groupId = validateUuid(c.req.param("groupId") ?? c.req.param("id"), "groupId");
  const query = getValidQuery<typeof listActivityQuerySchema>(c);
  const result = await activityService.getGroupActivity(actor.id, groupId, query);

  return sendSuccess(c, result.activities, 200, {
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  });
});
