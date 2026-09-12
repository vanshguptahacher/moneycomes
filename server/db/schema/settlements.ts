import { pgTable, uuid, text, varchar, bigint, timestamp, check, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { currencies } from "./currencies.js";
import { groups } from "./groups.js";
import { users } from "./users.js";

export const settlements = pgTable(
  "settlements",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    payerId: text("payer_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    receiverId: text("receiver_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    groupId: uuid("group_id").references(() => groups.id, { onDelete: "cascade" }),
    amountMinor: bigint("amount_minor", { mode: "number" }).notNull(),
    currencyCode: varchar("currency_code", { length: 3 })
      .notNull()
      .references(() => currencies.code),
    settledAt: timestamp("settled_at", { withTimezone: true }).defaultNow().notNull(),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    check("settlements_amount_positive_check", sql`${table.amountMinor} > 0`),
    check("settlements_distinct_users_check", sql`${table.payerId} != ${table.receiverId}`),
    index("settlements_payer_idx").on(table.payerId),
    index("settlements_receiver_idx").on(table.receiverId),
    index("settlements_group_idx").on(table.groupId),
    index("settlements_settled_at_idx").on(table.settledAt),
  ]
);

export type Settlement = typeof settlements.$inferSelect;
export type NewSettlement = typeof settlements.$inferInsert;

/**
 * Validates settlement input parameters at the boundary.
 * Enforces:
 * - payerId and receiverId are non-empty strings.
 * - payerId !== receiverId (no self-settlements).
 * - amountMinor is a positive safe integer (> 0, <= Number.MAX_SAFE_INTEGER).
 * - currencyCode is a non-empty string.
 * - groupId is an optional non-empty string or null.
 * - createdById is a non-empty string (defaults to payerId if omitted).
 */
export function validateSettlementInput(input: {
  payerId: string;
  receiverId: string;
  amountMinor: number;
  currencyCode: string;
  groupId?: string | null;
  createdById?: string;
  notes?: string | null;
  settledAt?: Date | null;
}): {
  payerId: string;
  receiverId: string;
  amountMinor: number;
  currencyCode: string;
  groupId: string | null;
  createdById: string;
  notes: string | null;
  settledAt: Date;
} {
  if (!input) {
    throw new Error("Settlement input is required");
  }

  const { payerId, receiverId, amountMinor, currencyCode, groupId, createdById, notes, settledAt } = input;

  if (!payerId || typeof payerId !== "string" || !payerId.trim()) {
    throw new Error("Valid payerId is required for settlement");
  }
  const cleanPayerId = payerId.trim();

  if (!receiverId || typeof receiverId !== "string" || !receiverId.trim()) {
    throw new Error("Valid receiverId is required for settlement");
  }
  const cleanReceiverId = receiverId.trim();

  if (cleanPayerId === cleanReceiverId) {
    throw new Error(`Self-settlement is not permitted: payer and receiver are both "${cleanPayerId}"`);
  }

  if (
    typeof amountMinor !== "number" ||
    !Number.isInteger(amountMinor) ||
    amountMinor <= 0 ||
    amountMinor > Number.MAX_SAFE_INTEGER
  ) {
    throw new Error("amountMinor must be a positive safe integer representing minor currency units");
  }

  if (!currencyCode || typeof currencyCode !== "string" || !currencyCode.trim()) {
    throw new Error("Valid currencyCode is required for settlement");
  }
  const cleanCurrencyCode = currencyCode.trim().toUpperCase();

  const cleanGroupId = groupId && typeof groupId === "string" && groupId.trim() ? groupId.trim() : null;
  const cleanCreatedById =
    createdById && typeof createdById === "string" && createdById.trim()
      ? createdById.trim()
      : cleanPayerId;

  return {
    payerId: cleanPayerId,
    receiverId: cleanReceiverId,
    amountMinor,
    currencyCode: cleanCurrencyCode,
    groupId: cleanGroupId,
    createdById: cleanCreatedById,
    notes: notes ? notes.trim() : null,
    settledAt: settledAt instanceof Date ? settledAt : new Date(),
  };
}

