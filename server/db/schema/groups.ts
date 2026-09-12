import { pgTable, uuid, varchar, text, boolean, timestamp, unique, index } from "drizzle-orm/pg-core";
import { currencies } from "./currencies.js";
import { users } from "./users.js";

export const groups = pgTable(
  "groups",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    defaultCurrencyCode: varchar("default_currency_code", { length: 3 })
      .default("INR")
      .notNull()
      .references(() => currencies.code),
    createdById: text("created_by_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    isArchived: boolean("is_archived").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("groups_created_by_idx").on(table.createdById),
  ]
);

export const groupMembers = pgTable(
  "group_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 32 }).default("member").notNull(),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    unique("group_members_group_user_uq").on(table.groupId, table.userId),
    index("group_members_group_idx").on(table.groupId),
    index("group_members_user_idx").on(table.userId),
  ]
);

export const GROUP_ROLES = {
  MEMBER: "member",
  ADMIN: "admin",
} as const;

export type GroupRole = (typeof GROUP_ROLES)[keyof typeof GROUP_ROLES];

/**
 * Validates group membership input IDs.
 * Enforces non-empty string IDs for both group and user.
 */
export function validateGroupMembershipInput(
  groupId: string,
  userId: string
): { groupId: string; userId: string } {
  if (!groupId || typeof groupId !== "string" || !groupId.trim()) {
    throw new Error("Valid groupId is required for group membership");
  }
  const trimmedGroupId = groupId.trim();

  if (!userId || typeof userId !== "string" || !userId.trim()) {
    throw new Error("Valid userId is required for group membership");
  }
  const trimmedUserId = userId.trim();

  return { groupId: trimmedGroupId, userId: trimmedUserId };
}

export type Group = typeof groups.$inferSelect;
export type NewGroup = typeof groups.$inferInsert;
export type GroupMember = typeof groupMembers.$inferSelect;
export type NewGroupMember = typeof groupMembers.$inferInsert;
