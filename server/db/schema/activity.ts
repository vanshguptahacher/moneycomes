import { pgTable, uuid, text, varchar, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { groups } from "./groups.js";
import { users } from "./users.js";

export const activityEvents = pgTable(
  "activity_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: varchar("type", { length: 64 }).notNull(),
    actorId: text("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    groupId: uuid("group_id").references(() => groups.id, { onDelete: "cascade" }),
    entityType: varchar("entity_type", { length: 32 }).notNull(),
    entityId: varchar("entity_id", { length: 64 }).notNull(),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("activity_actor_idx").on(table.actorId),
    index("activity_group_idx").on(table.groupId),
    index("activity_created_at_idx").on(table.createdAt),
  ]
);

export type ActivityEvent = typeof activityEvents.$inferSelect;
export type NewActivityEvent = typeof activityEvents.$inferInsert;

export const ACTIVITY_EVENT_TYPES = {
  GROUP_CREATED: "group_created",
  GROUP_UPDATED: "group_updated",
  GROUP_MEMBER_ADDED: "group_member_added",
  GROUP_MEMBER_REMOVED: "group_member_removed",
  EXPENSE_CREATED: "expense_created",
  EXPENSE_UPDATED: "expense_updated",
  EXPENSE_DELETED: "expense_deleted",
  SETTLEMENT_CREATED: "settlement_created",
  SETTLEMENT_UPDATED: "settlement_updated",
  SETTLEMENT_DELETED: "settlement_deleted",
  FRIEND_ADDED: "friend_added",
  FRIEND_REMOVED: "friend_removed",
} as const;

export type ActivityEventType =
  (typeof ACTIVITY_EVENT_TYPES)[keyof typeof ACTIVITY_EVENT_TYPES];

export function isActivityEventType(value: unknown): value is ActivityEventType {
  return (
    typeof value === "string" &&
    Object.values(ACTIVITY_EVENT_TYPES).includes(value as ActivityEventType)
  );
}

export const ACTIVITY_ENTITY_TYPES = {
  GROUP: "group",
  MEMBER: "member",
  EXPENSE: "expense",
  SETTLEMENT: "settlement",
  FRIENDSHIP: "friendship",
} as const;

export type ActivityEntityType =
  (typeof ACTIVITY_ENTITY_TYPES)[keyof typeof ACTIVITY_ENTITY_TYPES];

export function isActivityEntityType(value: unknown): value is ActivityEntityType {
  return (
    typeof value === "string" &&
    Object.values(ACTIVITY_ENTITY_TYPES).includes(value as ActivityEntityType)
  );
}

export interface ActivityMetadata {
  description?: string;
  amountMinor?: number;
  currencyCode?: string;
  targetUserId?: string;
  role?: string;
  splitMethod?: string;
  participantCount?: number;
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
 * Validates an activity event input at the boundary.
 * Enforces:
 * - type is a valid, supported ActivityEventType.
 * - actorId is a non-empty string referencing the canonical user who performed the action.
 * - entityType is a valid ActivityEntityType.
 * - entityId is a non-empty string referencing the target entity.
 * - groupId is an optional UUID string or null.
 * - metadata is a safe JSON-serializable object without sensitive authentication secrets.
 */
export function validateActivityEventInput(input: {
  type: string;
  actorId: string;
  entityType: string;
  entityId: string;
  groupId?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt?: Date | null;
}): {
  type: ActivityEventType;
  actorId: string;
  entityType: ActivityEntityType;
  entityId: string;
  groupId: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
} {
  if (!input) {
    throw new Error("Activity event input is required");
  }

  const { type, actorId, entityType, entityId, groupId, metadata, createdAt } = input;

  if (!type || typeof type !== "string" || !isActivityEventType(type)) {
    throw new Error(`Invalid activity event type: "${type}"`);
  }

  if (!actorId || typeof actorId !== "string" || !actorId.trim()) {
    throw new Error("Valid actorId is required for activity event");
  }

  if (!entityType || typeof entityType !== "string" || !isActivityEntityType(entityType)) {
    throw new Error(`Invalid activity entity type: "${entityType}"`);
  }

  if (!entityId || typeof entityId !== "string" || !entityId.trim()) {
    throw new Error("Valid entityId is required for activity event");
  }

  const cleanGroupId =
    groupId && typeof groupId === "string" && groupId.trim() ? groupId.trim() : null;

  const cleanMetadata: Record<string, unknown> = metadata ? { ...metadata } : {};

  // Verify no forbidden authentication secrets exist in metadata keys
  for (const key of Object.keys(cleanMetadata)) {
    const normalizedKey = key.toLowerCase().replace(/[-_]/g, "");
    if (FORBIDDEN_METADATA_KEYS.has(normalizedKey)) {
      throw new Error(
        `Security violation: activity metadata must not contain sensitive key "${key}"`
      );
    }
  }

  return {
    type,
    actorId: actorId.trim(),
    entityType,
    entityId: entityId.trim(),
    groupId: cleanGroupId,
    metadata: cleanMetadata,
    createdAt: createdAt instanceof Date ? createdAt : new Date(),
  };
}

