import { Hono } from "hono";
import { z } from "zod";
import { requireAuth, getAuthUser } from "../middleware/auth.js";
import {
  validateJson,
  getValidJson,
  validateQuery,
  getValidQuery,
} from "../middleware/validator.js";
import { expenseService } from "../services/expense.service.js";
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

export const expenseSplitInputSchema = z
  .object({
    userId: z
      .string({ message: "userId must be a string" })
      .trim()
      .min(1, "userId cannot be empty"),
    amountMinor: z
      .number({ message: "amountMinor must be a number" })
      .int("amountMinor must be an integer")
      .nonnegative("amountMinor must be non-negative")
      .optional(),
    splitPercentage: z
      .number({ message: "splitPercentage must be a number" })
      .min(0, "splitPercentage cannot be negative")
      .max(100, "splitPercentage cannot exceed 100")
      .optional(),
    splitShares: z
      .number({ message: "splitShares must be a number" })
      .int("splitShares must be an integer")
      .min(1, "splitShares must be at least 1")
      .optional(),
  })
  .strict();

export const createExpenseSchema = z
  .object({
    description: z
      .string({ message: "description must be a string" })
      .trim()
      .min(1, "description cannot be empty")
      .max(255, "description cannot exceed 255 characters"),
    amountMinor: z
      .number({ message: "amountMinor must be a number" })
      .int("amountMinor must be an integer")
      .positive("amountMinor must be greater than zero"),
    currencyCode: z
      .enum(["INR", "USD", "EUR", "GBP", "JPY"] as const, {
        message: "currencyCode must be one of: INR, USD, EUR, GBP, JPY",
      })
      .default("INR")
      .optional(),
    paidByUserId: z
      .string({ message: "paidByUserId must be a string" })
      .trim()
      .min(1, "paidByUserId cannot be empty"),
    splitType: z
      .enum(["EQUAL", "EXACT", "PERCENTAGE", "SHARES"] as const, {
        message: "splitType must be EQUAL, EXACT, PERCENTAGE, or SHARES",
      })
      .default("EQUAL")
      .optional(),
    date: z
      .string()
      .refine((val) => !isNaN(Date.parse(val)), {
        message: "date must be a valid ISO 8601 date string",
      })
      .optional(),
    category: z
      .string({ message: "category must be a string" })
      .trim()
      .max(50, "category cannot exceed 50 characters")
      .nullable()
      .optional(),
    notes: z
      .string({ message: "notes must be a string" })
      .trim()
      .max(1000, "notes cannot exceed 1000 characters")
      .nullable()
      .optional(),
    splits: z
      .array(expenseSplitInputSchema)
      .min(1, "At least one participant split must be provided")
      .optional(),
  })
  .strict();

export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const updateExpenseSchema = z
  .object({
    description: z
      .string({ message: "description must be a string" })
      .trim()
      .min(1, "description cannot be empty")
      .max(255, "description cannot exceed 255 characters")
      .optional(),
    amountMinor: z
      .number({ message: "amountMinor must be a number" })
      .int("amountMinor must be an integer")
      .positive("amountMinor must be greater than zero")
      .optional(),
    currencyCode: z
      .enum(["INR", "USD", "EUR", "GBP", "JPY"] as const, {
        message: "currencyCode must be one of: INR, USD, EUR, GBP, JPY",
      })
      .optional(),
    paidByUserId: z
      .string({ message: "paidByUserId must be a string" })
      .trim()
      .min(1, "paidByUserId cannot be empty")
      .optional(),
    splitType: z
      .enum(["EQUAL", "EXACT", "PERCENTAGE", "SHARES"] as const, {
        message: "splitType must be EQUAL, EXACT, PERCENTAGE, or SHARES",
      })
      .optional(),
    date: z
      .string()
      .refine((val) => !isNaN(Date.parse(val)), {
        message: "date must be a valid ISO 8601 date string",
      })
      .optional(),
    category: z
      .string({ message: "category must be a string" })
      .trim()
      .max(50, "category cannot exceed 50 characters")
      .nullable()
      .optional(),
    notes: z
      .string({ message: "notes must be a string" })
      .trim()
      .max(1000, "notes cannot exceed 1000 characters")
      .nullable()
      .optional(),
    splits: z
      .array(expenseSplitInputSchema)
      .min(1, "At least one participant split must be provided")
      .optional(),
  })
  .strict()
  .refine(
    (data) =>
      data.description !== undefined ||
      data.amountMinor !== undefined ||
      data.currencyCode !== undefined ||
      data.paidByUserId !== undefined ||
      data.splitType !== undefined ||
      data.date !== undefined ||
      data.category !== undefined ||
      data.notes !== undefined ||
      data.splits !== undefined,
    {
      message: "At least one field must be provided for update",
    }
  );

export type UpdateExpenseInput = z.infer<typeof updateExpenseSchema>;

export const listExpensesQuerySchema = z.object({
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

export const expensesRoutes = new Hono();

// All expense operations require an authenticated Better Auth session
expensesRoutes.use("*", requireAuth());

/**
 * POST /api/v1/groups/:groupId/expenses
 * Records an expense with split validation and activity event atomically.
 */
expensesRoutes.post("/", validateJson(createExpenseSchema), async (c) => {
  const actor = getAuthUser(c);
  const groupId = validateUuid(c.req.param("groupId") ?? c.req.param("id"), "groupId");

  const idempotencyKey =
    c.req.header("Idempotency-Key") || c.req.header("X-Idempotency-Key");

  const body = getValidJson<typeof createExpenseSchema>(c);
  const expense = await expenseService.createExpense(
    actor.id,
    groupId,
    body,
    idempotencyKey
  );

  return sendSuccess(c, expense, 201);
});

/**
 * GET /api/v1/groups/:groupId/expenses
 * Lists expenses for the specified group with deterministic ordering and pagination.
 */
expensesRoutes.get("/", validateQuery(listExpensesQuerySchema), async (c) => {
  const actor = getAuthUser(c);
  const groupId = validateUuid(c.req.param("groupId") ?? c.req.param("id"), "groupId");

  const query = getValidQuery<typeof listExpensesQuerySchema>(c);
  const result = await expenseService.listGroupExpenses(actor.id, groupId, query);

  return sendSuccess(c, result.expenses, 200, {
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  });
});

/**
 * GET /api/v1/groups/:groupId/expenses/:expenseId
 * Retrieves a single expense with splits, verifying member authorization and IDOR boundary.
 */
expensesRoutes.get("/:expenseId", async (c) => {
  const actor = getAuthUser(c);
  const groupId = validateUuid(c.req.param("groupId") ?? c.req.param("id"), "groupId");
  const expenseId = validateUuid(c.req.param("expenseId"), "expenseId");

  const expense = await expenseService.getExpenseById(actor.id, groupId, expenseId);

  return sendSuccess(c, expense);
});

/**
 * PATCH /api/v1/groups/:groupId/expenses/:expenseId
 * Updates expense details and recalculates splits (creator or group admin only).
 */
expensesRoutes.patch(
  "/:expenseId",
  validateJson(updateExpenseSchema),
  async (c) => {
    const actor = getAuthUser(c);
    const groupId = validateUuid(c.req.param("groupId") ?? c.req.param("id"), "groupId");
    const expenseId = validateUuid(c.req.param("expenseId"), "expenseId");

    const updates = getValidJson<typeof updateExpenseSchema>(c);
    const updated = await expenseService.updateExpense(
      actor.id,
      groupId,
      expenseId,
      updates
    );

    return sendSuccess(c, updated);
  }
);

/**
 * DELETE /api/v1/groups/:groupId/expenses/:expenseId
 * Soft-deletes an expense atomically with activity event (creator or group admin only).
 */
expensesRoutes.delete("/:expenseId", async (c) => {
  const actor = getAuthUser(c);
  const groupId = validateUuid(c.req.param("groupId") ?? c.req.param("id"), "groupId");
  const expenseId = validateUuid(c.req.param("expenseId"), "expenseId");

  const result = await expenseService.deleteExpense(actor.id, groupId, expenseId);

  return sendSuccess(c, result);
});
