import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, getAuthUser } from "../middleware/auth.js";
import { validateQuery, getValidQuery } from "../middleware/validator.js";
import { balanceService } from "../services/balance.service.js";
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

export const balanceQuerySchema = z.object({
  currency: z
    .enum(["INR", "USD", "EUR", "GBP", "JPY"] as const, {
      message: "currency must be one of: INR, USD, EUR, GBP, JPY",
    })
    .optional(),
});

export const balancesRoutes = new Hono();

// All balance operations require an authenticated Better Auth session
balancesRoutes.use("*", requireAuth());

/**
 * GET /api/v1/groups/:groupId/balance
 * Returns per-member net balances for the specified group.
 * Group membership is strictly enforced.
 */
balancesRoutes.get("/", validateQuery(balanceQuerySchema), async (c) => {
  const actor = getAuthUser(c);
  const groupId = validateUuid(c.req.param("groupId") ?? c.req.param("id"), "groupId");
  const { currency } = getValidQuery<typeof balanceQuerySchema>(c);

  const balance = await balanceService.getGroupBalance(actor.id, groupId, currency);
  return sendSuccess(c, balance);
});

/**
 * GET /api/v1/groups/:groupId/balance/simplified
 * Returns the simplified debt settlement transfers for the group.
 * Preserves exact zero-sum invariant and minimizes transfer count.
 */
balancesRoutes.get("/simplified", validateQuery(balanceQuerySchema), async (c) => {
  const actor = getAuthUser(c);
  const groupId = validateUuid(c.req.param("groupId") ?? c.req.param("id"), "groupId");
  const { currency } = getValidQuery<typeof balanceQuerySchema>(c);

  const simplified = await balanceService.getGroupSimplifiedDebts(
    actor.id,
    groupId,
    currency
  );
  return sendSuccess(c, simplified);
});

/**
 * GET /api/v1/groups/:groupId/balance/me
 * Returns the authenticated user's personal net balance within the group.
 */
balancesRoutes.get("/me", validateQuery(balanceQuerySchema), async (c) => {
  const actor = getAuthUser(c);
  const groupId = validateUuid(c.req.param("groupId") ?? c.req.param("id"), "groupId");
  const { currency } = getValidQuery<typeof balanceQuerySchema>(c);

  const personalBalance = await balanceService.getUserGroupBalance(
    actor.id,
    groupId,
    currency
  );
  return sendSuccess(c, personalBalance);
});
