import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, getAuthUser } from "../middleware/auth.js";
import {
  validateJson,
  getValidJson,
  validateQuery,
  getValidQuery,
} from "../middleware/validator.js";
import { groupService } from "../services/group.service.js";
import { settlementsRoutes } from "./settlements.js";
import { groupActivityRoutes } from "./activity.js";
import { attachmentsRoutes } from "./attachments.js";
import { expensesRoutes } from "./expenses.js";
import { sendSuccess } from "../utils/response.js";

/**
 * Validation schema for creating a new group.
 */
export const createGroupSchema = z
  .object({
    name: z
      .string({ message: "Group name must be a string" })
      .trim()
      .min(1, "Group name cannot be empty")
      .max(255, "Group name cannot exceed 255 characters"),
    description: z
      .string({ message: "Description must be a string" })
      .trim()
      .max(1000, "Description cannot exceed 1000 characters")
      .nullable()
      .optional(),
    defaultCurrencyCode: z
      .enum(["INR", "USD", "EUR", "GBP", "JPY"] as const, {
        message: "defaultCurrencyCode must be one of: INR, USD, EUR, GBP, JPY",
      })
      .default("INR")
      .optional(),
    memberUserIds: z
      .array(z.string().trim().min(1, "Member user ID cannot be empty"))
      .max(50, "A group cannot exceed 50 initial members")
      .optional(),
  })
  .strict();

export type CreateGroupInput = z.infer<typeof createGroupSchema>;

/**
 * Validation schema for updating an existing group.
 */
export const updateGroupSchema = z
  .object({
    name: z
      .string({ message: "Group name must be a string" })
      .trim()
      .min(1, "Group name cannot be empty")
      .max(255, "Group name cannot exceed 255 characters")
      .optional(),
    description: z
      .string({ message: "Description must be a string" })
      .trim()
      .max(1000, "Description cannot exceed 1000 characters")
      .nullable()
      .optional(),
    defaultCurrencyCode: z
      .enum(["INR", "USD", "EUR", "GBP", "JPY"] as const, {
        message: "defaultCurrencyCode must be one of: INR, USD, EUR, GBP, JPY",
      })
      .optional(),
    isArchived: z.boolean().optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.name !== undefined ||
      data.description !== undefined ||
      data.defaultCurrencyCode !== undefined ||
      data.isArchived !== undefined,
    {
      message: "At least one field must be provided for update",
    }
  );

export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;

/**
 * Validation schema for adding a member to a group.
 */
export const addGroupMemberSchema = z
  .object({
    userId: z
      .string({ message: "userId must be a string" })
      .trim()
      .min(1, "userId is required"),
    role: z.enum(["member", "admin"] as const).default("member").optional(),
  })
  .strict();

export type AddGroupMemberInput = z.infer<typeof addGroupMemberSchema>;

/**
 * Validation schema for listing user groups.
 */
export const listGroupsQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(100, "Search query cannot exceed 100 characters")
    .optional(),
});

export const groupsRoutes = new Hono();

// All group endpoints require an authenticated Better Auth session
groupsRoutes.use("*", requireAuth());

/**
 * POST /api/v1/groups
 * Creates a group and automatically registers the creator as an admin member.
 */
groupsRoutes.post("/", validateJson(createGroupSchema), async (c) => {
  const actor = getAuthUser(c);
  const body = getValidJson<typeof createGroupSchema>(c);
  const group = await groupService.createGroup(actor.id, body);
  return sendSuccess(c, group, 201);
});

/**
 * GET /api/v1/groups
 * Retrieves all groups where the authenticated user is a member.
 */
groupsRoutes.get("/", validateQuery(listGroupsQuerySchema), async (c) => {
  const actor = getAuthUser(c);
  const { q } = getValidQuery<typeof listGroupsQuerySchema>(c);
  const groups = await groupService.getGroupsForUser(actor.id, q);
  return sendSuccess(c, groups);
});

/**
 * GET /api/v1/groups/:id
 * Retrieves group details, verifying member authorization.
 */
groupsRoutes.get("/:id", async (c) => {
  const actor = getAuthUser(c);
  const groupId = c.req.param("id");
  const group = await groupService.getGroupById(actor.id, groupId);
  return sendSuccess(c, group);
});

/**
 * PATCH /api/v1/groups/:id
 * Updates group details, requiring admin/creator role.
 */
groupsRoutes.patch("/:id", validateJson(updateGroupSchema), async (c) => {
  const actor = getAuthUser(c);
  const groupId = c.req.param("id");
  const updates = getValidJson<typeof updateGroupSchema>(c);
  const updated = await groupService.updateGroup(actor.id, groupId, updates);
  return sendSuccess(c, updated);
});

/**
 * GET /api/v1/groups/:id/members
 * Lists all members of a group with their roles and safe profiles.
 */
groupsRoutes.get("/:id/members", async (c) => {
  const actor = getAuthUser(c);
  const groupId = c.req.param("id");
  const members = await groupService.getGroupMembers(actor.id, groupId);
  return sendSuccess(c, members);
});

/**
 * POST /api/v1/groups/:id/members
 * Adds an existing user to a group.
 */
groupsRoutes.post("/:id/members", validateJson(addGroupMemberSchema), async (c) => {
  const actor = getAuthUser(c);
  const groupId = c.req.param("id");
  const body = getValidJson<typeof addGroupMemberSchema>(c);
  const member = await groupService.addMember(actor.id, groupId, body.userId, body.role);
  return sendSuccess(c, member, 201);
});

/**
 * DELETE /api/v1/groups/:id/members/:userId
 * Removes a member from a group (leaving or admin removal).
 */
groupsRoutes.delete("/:id/members/:userId", async (c) => {
  const actor = getAuthUser(c);
  const groupId = c.req.param("id");
  const targetUserId = c.req.param("userId");
  const result = await groupService.removeMember(actor.id, groupId, targetUserId);
  return sendSuccess(c, result);
});

// Mount settlements subrouter for group settlements (Phase 4.6)
groupsRoutes.route("/:groupId/settlements", settlementsRoutes);
groupsRoutes.route("/:id/settlements", settlementsRoutes);

// Mount activity subrouter for group activity (Phase 4.7)
groupsRoutes.route("/:groupId/activity", groupActivityRoutes);
groupsRoutes.route("/:id/activity", groupActivityRoutes);

// Mount expenses subrouter for group expenses (Phase 4.5/4.10)
groupsRoutes.route("/:groupId/expenses", expensesRoutes);
groupsRoutes.route("/:id/expenses", expensesRoutes);

// Mount attachments subrouter for expense receipts (Phase 4.9)
groupsRoutes.route("/:groupId/expenses/:expenseId/attachments", attachmentsRoutes);
groupsRoutes.route("/:id/expenses/:expenseId/attachments", attachmentsRoutes);
