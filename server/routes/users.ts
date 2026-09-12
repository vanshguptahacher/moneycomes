import { Hono } from "hono";
import { z } from "zod";
import type { User } from "../db/schema/index.js";
import { requireAuth, getAuthUser } from "../middleware/auth.js";
import { validateJson, getValidJson } from "../middleware/validator.js";
import { userService } from "../services/user.service.js";
import { sendSuccess } from "../utils/response.js";

/**
 * Validation schema for updating user profile.
 * - Only safe, user-editable profile fields are permitted.
 * - Strict rejection of immutable identity fields (id, email, emailVerified, createdAt, password, etc.).
 * - At least one field must be provided.
 */
export const updateProfileSchema = z
  .object({
    name: z
      .string({ message: "Name must be a string" })
      .trim()
      .min(1, "Name cannot be empty")
      .max(255, "Name cannot exceed 255 characters")
      .optional(),
    image: z
      .string({ message: "Image URL must be a string" })
      .trim()
      .max(2048, "Image URL cannot exceed 2048 characters")
      .nullable()
      .optional(),
    defaultCurrencyCode: z
      .enum(["INR", "USD", "EUR", "GBP", "JPY"] as const, {
        message: "defaultCurrencyCode must be one of: INR, USD, EUR, GBP, JPY",
      })
      .optional(),
  })
  .strict()
  .refine(
    (data) => data.name !== undefined || data.image !== undefined || data.defaultCurrencyCode !== undefined,
    {
      message: "At least one profile field (name, image, defaultCurrencyCode) must be provided for update",
    }
  );

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * Safe public user profile response representation.
 * Explicitly segregates and omits any sensitive or authentication fields.
 */
export interface UserProfileResponse {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  defaultCurrencyCode: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Formats a database User record into a safe, serialized profile response.
 */
export function formatSafeUserProfile(user: User): UserProfileResponse {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    image: user.image ?? null,
    defaultCurrencyCode: user.defaultCurrencyCode,
    createdAt: user.createdAt instanceof Date ? user.createdAt.toISOString() : String(user.createdAt),
    updatedAt: user.updatedAt instanceof Date ? user.updatedAt.toISOString() : String(user.updatedAt),
  };
}

export const usersRoutes = new Hono();

// Enforce authentication on all user & profile routes
usersRoutes.use("*", requireAuth());

/**
 * GET /api/v1/users/me
 * Retrieves the current authenticated user's profile.
 */
usersRoutes.get("/me", async (c) => {
  const actor = getAuthUser(c);
  const profile = await userService.getUserById(actor.id, actor.id);
  return sendSuccess(c, formatSafeUserProfile(profile));
});

/**
 * PATCH /api/v1/users/me
 * Updates the current authenticated user's profile with validated attributes.
 */
usersRoutes.patch("/me", validateJson(updateProfileSchema), async (c) => {
  const actor = getAuthUser(c);
  const updates = getValidJson<typeof updateProfileSchema>(c);
  const updated = await userService.updateProfile(actor.id, actor.id, updates);
  return sendSuccess(c, formatSafeUserProfile(updated));
});

/**
 * GET /api/v1/users/:id
 * Retrieves a user profile by ID with strict authorization checks.
 * A user may access their own profile. Non-members or unauthorized actors are rejected with 403 Forbidden.
 */
usersRoutes.get("/:id", async (c) => {
  const actor = getAuthUser(c);
  const targetId = c.req.param("id");
  const profile = await userService.getUserById(actor.id, targetId);
  return sendSuccess(c, formatSafeUserProfile(profile));
});

/**
 * PATCH /api/v1/users/:id
 * Updates a user profile by ID with strict IDOR protection.
 * A user can only modify their own profile. Modifying another user is rejected with 403 Forbidden.
 */
usersRoutes.patch("/:id", validateJson(updateProfileSchema), async (c) => {
  const actor = getAuthUser(c);
  const targetId = c.req.param("id");
  const updates = getValidJson<typeof updateProfileSchema>(c);
  const updated = await userService.updateProfile(actor.id, targetId, updates);
  return sendSuccess(c, formatSafeUserProfile(updated));
});
