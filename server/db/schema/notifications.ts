import { pgTable, uuid, text, varchar, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { groups } from "./groups.js";
import { expenses } from "./expenses.js";
import { settlements } from "./settlements.js";
import { activityEvents } from "./activity.js";

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recipientId: text("recipient_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => users.id, { onDelete: "set null" }),
    type: varchar("type", { length: 64 }).notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    message: text("message").notNull(),
    groupId: uuid("group_id").references(() => groups.id, { onDelete: "set null" }),
    expenseId: uuid("expense_id").references(() => expenses.id, { onDelete: "set null" }),
    settlementId: uuid("settlement_id").references(() => settlements.id, { onDelete: "set null" }),
    activityId: uuid("activity_id").references(() => activityEvents.id, { onDelete: "set null" }),
    metadata: jsonb("metadata").default({}).notNull(),
    readAt: timestamp("read_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("notifications_recipient_created_at_idx").on(table.recipientId, table.createdAt),
    index("notifications_recipient_read_at_idx").on(table.recipientId, table.readAt),
    index("notifications_group_idx").on(table.groupId),
    index("notifications_expense_idx").on(table.expenseId),
    index("notifications_settlement_idx").on(table.settlementId),
    index("notifications_activity_idx").on(table.activityId),
  ]
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

export const NOTIFICATION_TYPES = {
  GROUP_MEMBER_ADDED: "group_member_added",
  GROUP_MEMBER_REMOVED: "group_member_removed",
  EXPENSE_CREATED: "expense_created",
  EXPENSE_UPDATED: "expense_updated",
  EXPENSE_DELETED: "expense_deleted",
  SETTLEMENT_CREATED: "settlement_created",
  SETTLEMENT_UPDATED: "settlement_updated",
  BALANCE_REMINDER: "balance_reminder",
  FRIEND_ADDED: "friend_added",
} as const;

export type NotificationType =
  (typeof NOTIFICATION_TYPES)[keyof typeof NOTIFICATION_TYPES];

export function isNotificationType(value: unknown): value is NotificationType {
  return (
    typeof value === "string" &&
    Object.values(NOTIFICATION_TYPES).includes(value as NotificationType)
  );
}

export interface NotificationMetadata {
  deepLink?: string;
  amountMinor?: number;
  currencyCode?: string;
  role?: string;
  [key: string]: unknown;
}

const FORBIDDEN_METADATA_KEYS = new Set([
  "password",
  "passwordhash",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "secret",
  "apikey",
  "sessionid",
  "credentials",
]);

/**
 * Validates a notification input at the boundary.
 * Enforces:
 * - recipientId is a non-empty string referencing the target user.
 * - type is a valid, supported NotificationType.
 * - title and message are non-empty strings.
 * - actorId, groupId, expenseId, settlementId, activityId are optional strings or null.
 * - metadata is a safe JSON-serializable object without sensitive credentials.
 * - readAt is an optional Date or null.
 * - createdAt defaults to current time if omitted.
 */
export function validateNotificationInput(input: {
  recipientId: string;
  type: string;
  title: string;
  message: string;
  actorId?: string | null;
  groupId?: string | null;
  expenseId?: string | null;
  settlementId?: string | null;
  activityId?: string | null;
  metadata?: Record<string, unknown> | null;
  readAt?: Date | null;
  createdAt?: Date | null;
}): {
  recipientId: string;
  type: NotificationType;
  title: string;
  message: string;
  actorId: string | null;
  groupId: string | null;
  expenseId: string | null;
  settlementId: string | null;
  activityId: string | null;
  metadata: Record<string, unknown>;
  readAt: Date | null;
  createdAt: Date;
} {
  if (!input) {
    throw new Error("Notification input is required");
  }

  const {
    recipientId,
    type,
    title,
    message,
    actorId,
    groupId,
    expenseId,
    settlementId,
    activityId,
    metadata,
    readAt,
    createdAt,
  } = input;

  if (!recipientId || typeof recipientId !== "string" || !recipientId.trim()) {
    throw new Error("Valid recipientId is required for notification");
  }

  if (!type || typeof type !== "string" || !isNotificationType(type)) {
    throw new Error(`Invalid notification type: "${type}"`);
  }

  if (!title || typeof title !== "string" || !title.trim()) {
    throw new Error("Valid title is required for notification");
  }

  if (!message || typeof message !== "string" || !message.trim()) {
    throw new Error("Valid message is required for notification");
  }

  const cleanActorId =
    actorId && typeof actorId === "string" && actorId.trim() ? actorId.trim() : null;
  const cleanGroupId =
    groupId && typeof groupId === "string" && groupId.trim() ? groupId.trim() : null;
  const cleanExpenseId =
    expenseId && typeof expenseId === "string" && expenseId.trim() ? expenseId.trim() : null;
  const cleanSettlementId =
    settlementId && typeof settlementId === "string" && settlementId.trim()
      ? settlementId.trim()
      : null;
  const cleanActivityId =
    activityId && typeof activityId === "string" && activityId.trim()
      ? activityId.trim()
      : null;

  const cleanMetadata: Record<string, unknown> = metadata ? { ...metadata } : {};

  // Check for forbidden sensitive keys
  for (const key of Object.keys(cleanMetadata)) {
    const normalizedKey = key.toLowerCase().replace(/[-_]/g, "");
    if (FORBIDDEN_METADATA_KEYS.has(normalizedKey)) {
      throw new Error(
        `Security violation: notification metadata must not contain sensitive key "${key}"`
      );
    }
  }

  return {
    recipientId: recipientId.trim(),
    type,
    title: title.trim(),
    message: message.trim(),
    actorId: cleanActorId,
    groupId: cleanGroupId,
    expenseId: cleanExpenseId,
    settlementId: cleanSettlementId,
    activityId: cleanActivityId,
    metadata: cleanMetadata,
    readAt: readAt instanceof Date ? readAt : null,
    createdAt: createdAt instanceof Date ? createdAt : new Date(),
  };
}
