import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, getAuthUser } from "../middleware/auth.js";
import {
  validateJson,
  getValidJson,
  validateQuery,
  getValidQuery,
} from "../middleware/validator.js";
import { settlementService } from "../services/settlement.service.js";
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
 * Validation schema for creating a settlement.
 */
export const createSettlementSchema = z
  .object({
    payerId: z
      .string({ message: "payerId must be a string" })
      .trim()
      .min(1, "payerId cannot be empty"),
    receiverId: z
      .string({ message: "receiverId must be a string" })
      .trim()
      .min(1, "receiverId cannot be empty"),
    amountMinor: z
      .number({ message: "amountMinor must be a number" })
      .int("amountMinor must be an integer")
      .positive("amountMinor must be greater than zero"),
    currencyCode: z
      .enum(["INR", "USD", "EUR", "GBP", "JPY"] as const, {
        message: "currencyCode must be one of: INR, USD, EUR, GBP, JPY",
      })
      .optional(),
    settledAt: z
      .string()
      .refine((val) => !isNaN(Date.parse(val)), {
        message: "settledAt must be a valid ISO 8601 date string",
      })
      .optional(),
    notes: z
      .string({ message: "notes must be a string" })
      .trim()
      .max(1000, "notes cannot exceed 1000 characters")
      .nullable()
      .optional(),
  })
  .strict();

export type CreateSettlementInput = z.infer<typeof createSettlementSchema>;

/**
 * Validation schema for updating a settlement.
 */
export const updateSettlementSchema = z
  .object({
    amountMinor: z
      .number({ message: "amountMinor must be a number" })
      .int("amountMinor must be an integer")
      .positive("amountMinor must be greater than zero")
      .optional(),
    settledAt: z
      .string()
      .refine((val) => !isNaN(Date.parse(val)), {
        message: "settledAt must be a valid ISO 8601 date string",
      })
      .optional(),
    notes: z
      .string({ message: "notes must be a string" })
      .trim()
      .max(1000, "notes cannot exceed 1000 characters")
      .nullable()
      .optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.amountMinor !== undefined ||
      data.settledAt !== undefined ||
      data.notes !== undefined,
    {
      message: "At least one field must be provided for update",
    }
  );

export type UpdateSettlementInput = z.infer<typeof updateSettlementSchema>;

/**
 * Validation schema for query parameters when listing settlements.
 */
export const listSettlementsQuerySchema = z.object({
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
});

export const settlementsRoutes = new Hono();

// All settlement operations require an authenticated Better Auth session
settlementsRoutes.use("*", requireAuth());

/**
 * POST /api/v1/groups/:groupId/settlements
 * Records a settlement between two group members atomically.
 */
settlementsRoutes.post("/", validateJson(createSettlementSchema), async (c) => {
  const actor = getAuthUser(c);
  const groupId = validateUuid(c.req.param("groupId") ?? c.req.param("id"), "groupId");

  const idempotencyKey =
    c.req.header("Idempotency-Key") || c.req.header("X-Idempotency-Key");

  const body = getValidJson<typeof createSettlementSchema>(c);
  const settlement = await settlementService.createSettlement(
    actor.id,
    groupId,
    body,
    idempotencyKey
  );

  return sendSuccess(c, settlement, 201);
});

/**
 * GET /api/v1/groups/:groupId/settlements
 * Lists settlements for the specified group with deterministic ordering and pagination.
 */
settlementsRoutes.get("/", validateQuery(listSettlementsQuerySchema), async (c) => {
  const actor = getAuthUser(c);
  const groupId = validateUuid(c.req.param("groupId") ?? c.req.param("id"), "groupId");

  const query = getValidQuery<typeof listSettlementsQuerySchema>(c);
  const result = await settlementService.listGroupSettlements(
    actor.id,
    groupId,
    query
  );

  return sendSuccess(c, result.settlements, 200, {
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  });
});

/**
 * GET /api/v1/groups/:groupId/settlements/:settlementId
 * Retrieves a single settlement, verifying member authorization and IDOR boundary.
 */
settlementsRoutes.get("/:settlementId", async (c) => {
  const actor = getAuthUser(c);
  const groupId = validateUuid(c.req.param("groupId") ?? c.req.param("id"), "groupId");
  const settlementId = validateUuid(c.req.param("settlementId"), "settlementId");

  const settlement = await settlementService.getSettlementById(
    actor.id,
    groupId,
    settlementId
  );

  return sendSuccess(c, settlement);
});

/**
 * PATCH /api/v1/groups/:groupId/settlements/:settlementId
 * Updates settlement details (creator or group admin only).
 */
settlementsRoutes.patch(
  "/:settlementId",
  validateJson(updateSettlementSchema),
  async (c) => {
    const actor = getAuthUser(c);
    const groupId = validateUuid(c.req.param("groupId") ?? c.req.param("id"), "groupId");
    const settlementId = validateUuid(c.req.param("settlementId"), "settlementId");

    const updates = getValidJson<typeof updateSettlementSchema>(c);
    const updated = await settlementService.updateSettlement(
      actor.id,
      groupId,
      settlementId,
      updates
    );

    return sendSuccess(c, updated);
  }
);

/**
 * DELETE /api/v1/groups/:groupId/settlements/:settlementId
 * Deletes a settlement atomically with activity event (creator or group admin only).
 */
settlementsRoutes.delete("/:settlementId", async (c) => {
  const actor = getAuthUser(c);
  const groupId = validateUuid(c.req.param("groupId") ?? c.req.param("id"), "groupId");
  const settlementId = validateUuid(c.req.param("settlementId"), "settlementId");

  const result = await settlementService.deleteSettlement(
    actor.id,
    groupId,
    settlementId
  );

  return sendSuccess(c, result);
});
