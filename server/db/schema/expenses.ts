import { pgTable, uuid, text, varchar, bigint, integer, boolean, timestamp, check, unique, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { categories } from "./categories.js";
import { currencies } from "./currencies.js";
import { groups } from "./groups.js";
import { users } from "./users.js";

export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id").references(() => groups.id, { onDelete: "cascade" }),
    payerId: text("payer_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    description: varchar("description", { length: 255 }).notNull(),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currencyCode: varchar("currency_code", { length: 3 })
      .notNull()
      .references(() => currencies.code),
    splitMethod: varchar("split_method", { length: 32 }).notNull(),
    date: timestamp("date", { withTimezone: true }).defaultNow().notNull(),
    notes: text("notes"),
    receiptUrl: text("receipt_url"),
    isDeleted: boolean("is_deleted").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("expenses_amount_positive_check", sql`${table.amountMinor} > 0`),
    index("expenses_group_idx").on(table.groupId),
    index("expenses_payer_idx").on(table.payerId),
    index("expenses_created_by_idx").on(table.createdById),
    index("expenses_date_idx").on(table.date),
  ]
);

export const expenseSplits = pgTable(
  "expense_splits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    allocatedAmountMinor: bigint("allocated_amount_minor", { mode: "number" }).notNull(),
    percentageBasisPoints: integer("percentage_basis_points"),
    shares: integer("shares"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("expense_splits_expense_user_uq").on(table.expenseId, table.userId),
    check("expense_splits_amount_non_negative_check", sql`${table.allocatedAmountMinor} >= 0`),
    index("expense_splits_expense_idx").on(table.expenseId),
    index("expense_splits_user_idx").on(table.userId),
  ]
);

export const SPLIT_METHODS = {
  EQUAL: "equal",
  EXACT: "exact",
  PERCENTAGE: "percentage",
  SHARES: "shares",
} as const;

export type SplitMethod = (typeof SPLIT_METHODS)[keyof typeof SPLIT_METHODS];

export function isSplitMethod(value: unknown): value is SplitMethod {
  return typeof value === "string" && Object.values(SPLIT_METHODS).includes(value as SplitMethod);
}

export type Expense = typeof expenses.$inferSelect;
export type NewExpense = typeof expenses.$inferInsert;
export type ExpenseSplit = typeof expenseSplits.$inferSelect;
export type NewExpenseSplit = typeof expenseSplits.$inferInsert;

/**
 * Validates an expense split allocation input at the boundary.
 * Enforces non-empty IDs and non-negative safe integer minor units.
 */
export function validateExpenseSplitInput(
  expenseId: string,
  userId: string,
  allocatedAmountMinor: number
): { expenseId: string; userId: string; allocatedAmountMinor: number } {
  if (!expenseId || typeof expenseId !== "string" || !expenseId.trim()) {
    throw new Error("Valid expenseId is required for expense split");
  }
  if (!userId || typeof userId !== "string" || !userId.trim()) {
    throw new Error("Valid userId is required for expense split");
  }
  if (
    typeof allocatedAmountMinor !== "number" ||
    !Number.isInteger(allocatedAmountMinor) ||
    allocatedAmountMinor < 0 ||
    allocatedAmountMinor > Number.MAX_SAFE_INTEGER
  ) {
    throw new Error(
      "allocatedAmountMinor must be a non-negative safe integer representing minor currency units"
    );
  }
  return {
    expenseId: expenseId.trim(),
    userId: userId.trim(),
    allocatedAmountMinor,
  };
}
