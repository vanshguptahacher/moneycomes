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
