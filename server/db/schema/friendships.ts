import { pgTable, uuid, text, varchar, timestamp, unique, check, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users.js";

export const friendships = pgTable(
  "friendships",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId1: text("user_id_1")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userId2: text("user_id_2")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: varchar("status", { length: 32 }).default("active").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("friendships_users_uq").on(table.userId1, table.userId2),
    check("friendships_canonical_order_check", sql`${table.userId1} < ${table.userId2}`),
    index("friendships_user1_idx").on(table.userId1),
    index("friendships_user2_idx").on(table.userId2),
  ]
);

export type Friendship = typeof friendships.$inferSelect;
export type NewFriendship = typeof friendships.$inferInsert;
