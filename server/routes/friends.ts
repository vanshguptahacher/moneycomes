import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, getAuthUser } from "../middleware/auth.js";
import {
  validateJson,
  getValidJson,
  validateQuery,
  getValidQuery,
} from "../middleware/validator.js";
import { friendService } from "../services/friend.service.js";
import { userService } from "../services/user.service.js";
import { formatSafeUserProfile } from "./users.js";
import { sendSuccess } from "../utils/response.js";

/**
 * Validation schema for creating a friendship.
 * Accepts friendId (or userId as alias).
 */
export const createFriendshipSchema = z
  .object({
    friendId: z
      .string({ message: "friendId must be a string" })
      .trim()
      .min(1, "friendId cannot be empty")
      .optional(),
    userId: z
      .string({ message: "userId must be a string" })
      .trim()
      .min(1, "userId cannot be empty")
      .optional(),
  })
  .strict()
  .refine((data) => data.friendId !== undefined || data.userId !== undefined, {
    message: "Either friendId or userId must be provided to create a friendship",
  });

export type CreateFriendshipInput = z.infer<typeof createFriendshipSchema>;

/**
 * Validation schema for friends list query filtering.
 */
export const listFriendsQuerySchema = z.object({
  q: z
    .string()
    .trim()
    .max(100, "Search query cannot exceed 100 characters")
    .optional(),
});

export type ListFriendsQuery = z.infer<typeof listFriendsQuerySchema>;

/**
 * Validation schema for user search.
 */
export const searchFriendsQuerySchema = z.object({
  q: z
    .string({ message: "Search query 'q' must be a string" })
    .trim()
    .min(2, "Search query must be at least 2 characters long")
    .max(100, "Search query cannot exceed 100 characters"),
  limit: z
    .string()
    .optional()
    .transform((val) => (val ? parseInt(val, 10) : 20))
    .refine((val) => !isNaN(val) && val >= 1 && val <= 50, {
      message: "Limit must be an integer between 1 and 50",
    }),
});

export const friendsRoutes = new Hono();

// All friends endpoints require authenticated session
friendsRoutes.use("*", requireAuth());

/**
 * GET /api/v1/friends
 * Retrieves the current authenticated user's friends list with bilateral balances.
 * Supports optional `?q=` search query for filtering by name or email.
 */
friendsRoutes.get("/", validateQuery(listFriendsQuerySchema), async (c) => {
  const actor = getAuthUser(c);
  const { q } = getValidQuery<typeof listFriendsQuerySchema>(c);
  const friends = await friendService.getFriends(actor.id, q);
  return sendSuccess(c, friends);
});

/**
 * POST /api/v1/friends
 * Creates a mutual friendship between the authenticated actor and another user.
 * Identity is derived strictly from the Better Auth session.
 */
friendsRoutes.post("/", validateJson(createFriendshipSchema), async (c) => {
  const actor = getAuthUser(c);
  const body = getValidJson<typeof createFriendshipSchema>(c);
  const targetFriendId = (body.friendId ?? body.userId)!;
  const created = await friendService.createFriendship(actor.id, targetFriendId);
  return sendSuccess(c, created, 201);
});

/**
 * GET /api/v1/friends/search
 * User discovery/search endpoint mounted under friends namespace for convenience.
 */
friendsRoutes.get("/search", validateQuery(searchFriendsQuerySchema), async (c) => {
  const actor = getAuthUser(c);
  const { q, limit } = getValidQuery<typeof searchFriendsQuerySchema>(c);
  const matchedUsers = await userService.searchUsers(actor.id, q, limit);
  return sendSuccess(c, matchedUsers.map(formatSafeUserProfile));
});

/**
 * GET /api/v1/friends/:id/balance
 * Retrieves the bilateral balance between the authenticated actor and the specified friend.
 */
friendsRoutes.get("/:id/balance", async (c) => {
  const actor = getAuthUser(c);
  const targetId = c.req.param("id");
  const balance = await friendService.getBilateralBalance(actor.id, targetId);
  return sendSuccess(c, balance);
});

/**
 * GET /api/v1/friends/:id
 * Retrieves a friendship relationship detail and bilateral balance.
 * Strictly protected against IDOR: only involved parties can view the relationship.
 */
friendsRoutes.get("/:id", async (c) => {
  const actor = getAuthUser(c);
  const targetId = c.req.param("id");
  const friendship = await friendService.getFriendship(actor.id, targetId);
  return sendSuccess(c, friendship);
});

/**
 * DELETE /api/v1/friends/:id
 * Removes a friendship relationship.
 * Strictly protected against IDOR: only an involved party can delete the relationship.
 * Preserves all underlying expenses, splits, and settlements intact.
 */
friendsRoutes.delete("/:id", async (c) => {
  const actor = getAuthUser(c);
  const targetId = c.req.param("id");
  const result = await friendService.removeFriendship(actor.id, targetId);
  return sendSuccess(c, result);
});
