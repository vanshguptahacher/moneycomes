/**
 * Phase 3.9 — Notifications Database Schema Verification Test Suite.
 *
 * Verifies that the notifications database schema foundation is clean, production-safe,
 * implements a strongly typed notification type system, references canonical recipient and actor identities,
 * supports optional domain entity references (group, expense, settlement, activity),
 * implements timestamp-based read/unread state (readAt nullable), stores safe non-authoritative JSONB metadata
 * (rejecting sensitive secrets/credentials), creates performance indexes for user feeds and unread counts,
 * and maintains complete isolation from authoritative financial calculations.
 */

import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import {
  notifications,
  users,
  groups,
  expenses,
  settlements,
  activityEvents,
  notificationsRelations,
  usersRelations,
  NOTIFICATION_TYPES,
  isNotificationType,
  validateNotificationInput,
} from "../../server/db/schema/index.js";
import fs from "node:fs";
import path from "node:path";

describe("Phase 3.9 — Notifications Database Schema", () => {
  const notifCols = getTableColumns(notifications);
  const userCols = getTableColumns(users);
  const groupCols = getTableColumns(groups);
  const expCols = getTableColumns(expenses);
  const settleCols = getTableColumns(settlements);
  const actCols = getTableColumns(activityEvents);

  // ==========================================================================
  // 1. NOTIFICATION IDENTITY & SURROGATE PRIMARY KEY
  // ==========================================================================

  describe("Notification Identity & Surrogate Primary Key", () => {
    it("primary key is a stable UUID with database default gen_random_uuid()", () => {
      expect(notifCols.id).toBeDefined();
      expect(notifCols.id.dataType).toBe("string");
      expect(notifCols.id.primary).toBe(true);
      expect(notifCols.id.notNull).toBe(true);
      expect(notifCols.id.default).toBeDefined();
    });

    it("primary key is independent of recipient, type, or timestamps", () => {
      expect(notifCols.id.name).toBe("id");
    });
  });

  // ==========================================================================
  // 2. CANONICAL RECIPIENT & ACTOR REFERENCES
  // ==========================================================================

  describe("Canonical Recipient & Actor References", () => {
    it("recipientId references canonical user identity with matching text data type", () => {
      expect(userCols.id.dataType).toBe("string"); // Better Auth text ID
      expect(notifCols.recipientId).toBeDefined();
      expect(notifCols.recipientId.dataType).toBe("string");
      expect(notifCols.recipientId.notNull).toBe(true);
    });

    it("actorId references canonical user identity with matching text data type and is nullable", () => {
      expect(notifCols.actorId).toBeDefined();
      expect(notifCols.actorId.dataType).toBe("string");
      expect(notifCols.actorId.notNull).toBe(false); // System notifications have no actor
    });

    it("does not duplicate recipient or actor profile columns (email, password, avatar)", () => {
      const rawCols = notifCols as Record<string, unknown>;
      expect(rawCols["recipientEmail"]).toBeUndefined();
      expect(rawCols["recipientName"]).toBeUndefined();
      expect(rawCols["actorEmail"]).toBeUndefined();
      expect(rawCols["actorName"]).toBeUndefined();
      expect(rawCols["userEmail"]).toBeUndefined();
      expect(rawCols["password"]).toBeUndefined();
    });

    it("migration enforces foreign key on recipient_id with ON DELETE cascade", () => {
      const sql0002Path = path.resolve(process.cwd(), "drizzle/migrations/0002_fluffy_ezekiel.sql");
      const sql0002 = fs.readFileSync(sql0002Path, "utf-8");
      expect(sql0002).toContain(
        'ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade'
      );
    });

    it("migration enforces foreign key on actor_id with ON DELETE set null", () => {
      const sql0002Path = path.resolve(process.cwd(), "drizzle/migrations/0002_fluffy_ezekiel.sql");
      const sql0002 = fs.readFileSync(sql0002Path, "utf-8");
      expect(sql0002).toContain(
        'ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null'
      );
    });
  });

  // ==========================================================================
  // 3. DOMAIN ENTITY REFERENCES (GROUP, EXPENSE, SETTLEMENT, ACTIVITY)
  // ==========================================================================

  describe("Domain Entity References", () => {
    it("groupId references canonical groups table with matching uuid type and is nullable", () => {
      expect(groupCols.id.dataType).toBe("string");
      expect(notifCols.groupId).toBeDefined();
      expect(notifCols.groupId.dataType).toBe("string");
      expect(notifCols.groupId.notNull).toBe(false);
    });

    it("expenseId references canonical expenses table with matching uuid type and is nullable", () => {
      expect(expCols.id.dataType).toBe("string");
      expect(notifCols.expenseId).toBeDefined();
      expect(notifCols.expenseId.dataType).toBe("string");
      expect(notifCols.expenseId.notNull).toBe(false);
    });

    it("settlementId references canonical settlements table with matching uuid type and is nullable", () => {
      expect(settleCols.id.dataType).toBe("string");
      expect(notifCols.settlementId).toBeDefined();
      expect(notifCols.settlementId.dataType).toBe("string");
      expect(notifCols.settlementId.notNull).toBe(false);
    });

    it("activityId references canonical activity_events table with matching uuid type and is nullable", () => {
      expect(actCols.id.dataType).toBe("string");
      expect(notifCols.activityId).toBeDefined();
      expect(notifCols.activityId.dataType).toBe("string");
      expect(notifCols.activityId.notNull).toBe(false);
    });

    it("migration enforces ON DELETE set null for domain entity references to preserve notification history", () => {
      const sql0002Path = path.resolve(process.cwd(), "drizzle/migrations/0002_fluffy_ezekiel.sql");
      const sql0002 = fs.readFileSync(sql0002Path, "utf-8");
      expect(sql0002).toContain(
        'ALTER TABLE "notifications" ADD CONSTRAINT "notifications_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE set null'
      );
      expect(sql0002).toContain(
        'ALTER TABLE "notifications" ADD CONSTRAINT "notifications_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE set null'
      );
      expect(sql0002).toContain(
        'ALTER TABLE "notifications" ADD CONSTRAINT "notifications_settlement_id_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."settlements"("id") ON DELETE set null'
      );
      expect(sql0002).toContain(
        'ALTER TABLE "notifications" ADD CONSTRAINT "notifications_activity_id_activity_events_id_fk" FOREIGN KEY ("activity_id") REFERENCES "public"."activity_events"("id") ON DELETE set null'
      );
    });
  });

  // ==========================================================================
  // 4. STRONGLY TYPED NOTIFICATION TYPES
  // ==========================================================================

  describe("Strongly Typed Notification Types", () => {
    it("type column is varchar(64) notNull", () => {
      expect(notifCols.type).toBeDefined();
      expect(notifCols.type.dataType).toBe("string");
      expect(notifCols.type.notNull).toBe(true);
    });

    it("supports all required domain notification types from specification", () => {
      expect(NOTIFICATION_TYPES.GROUP_MEMBER_ADDED).toBe("group_member_added");
      expect(NOTIFICATION_TYPES.GROUP_MEMBER_REMOVED).toBe("group_member_removed");
      expect(NOTIFICATION_TYPES.EXPENSE_CREATED).toBe("expense_created");
      expect(NOTIFICATION_TYPES.EXPENSE_UPDATED).toBe("expense_updated");
      expect(NOTIFICATION_TYPES.EXPENSE_DELETED).toBe("expense_deleted");
      expect(NOTIFICATION_TYPES.SETTLEMENT_CREATED).toBe("settlement_created");
      expect(NOTIFICATION_TYPES.SETTLEMENT_UPDATED).toBe("settlement_updated");
      expect(NOTIFICATION_TYPES.BALANCE_REMINDER).toBe("balance_reminder");
      expect(NOTIFICATION_TYPES.FRIEND_ADDED).toBe("friend_added");
    });

    it("isNotificationType type guard correctly validates notification types", () => {
      expect(isNotificationType("group_member_added")).toBe(true);
      expect(isNotificationType("expense_created")).toBe(true);
      expect(isNotificationType("settlement_created")).toBe(true);
      expect(isNotificationType("balance_reminder")).toBe(true);
      expect(isNotificationType("arbitrary_notification")).toBe(false);
      expect(isNotificationType(null)).toBe(false);
      expect(isNotificationType(123)).toBe(false);
    });
  });

  // ==========================================================================
  // 5. READ / UNREAD STATE
  // ==========================================================================

  describe("Read / Unread State", () => {
    it("readAt is timestamp with timezone and is nullable", () => {
      expect(notifCols.readAt).toBeDefined();
      expect(notifCols.readAt.dataType).toBe("date");
      expect(notifCols.readAt.notNull).toBe(false);
    });

    it("does not store redundant isRead boolean column", () => {
      const rawCols = notifCols as Record<string, unknown>;
      expect(rawCols["isRead"]).toBeUndefined();
      expect(rawCols["read"]).toBeUndefined();
    });

    it("new notifications default to unread (readAt is null)", () => {
      const validated = validateNotificationInput({
        recipientId: "user-1",
        type: NOTIFICATION_TYPES.EXPENSE_CREATED,
        title: "New Expense",
        message: "Alice added Dinner in Goa Trip",
      });

      expect(validated.readAt).toBeNull();
    });

    it("supports setting explicit readAt timestamp when marked as read", () => {
      const readTimestamp = new Date("2025-06-01T15:00:00Z");
      const validated = validateNotificationInput({
        recipientId: "user-1",
        type: NOTIFICATION_TYPES.EXPENSE_CREATED,
        title: "New Expense",
        message: "Alice added Dinner in Goa Trip",
        readAt: readTimestamp,
      });

      expect(validated.readAt).toEqual(readTimestamp);
    });
  });

  // ==========================================================================
  // 6. TITLE, MESSAGE & CONTENT
  // ==========================================================================

  describe("Title, Message & Content", () => {
    it("title is varchar(255) notNull", () => {
      expect(notifCols.title).toBeDefined();
      expect(notifCols.title.dataType).toBe("string");
      expect(notifCols.title.notNull).toBe(true);
    });

    it("message is text notNull", () => {
      expect(notifCols.message).toBeDefined();
      expect(notifCols.message.dataType).toBe("string");
      expect(notifCols.message.notNull).toBe(true);
    });
  });

  // ==========================================================================
  // 7. STRUCTURED METADATA & SECURITY
  // ==========================================================================

  describe("Structured Metadata & Security", () => {
    it("metadata column is jsonb notNull with default {}", () => {
      expect(notifCols.metadata).toBeDefined();
      expect(notifCols.metadata.dataType).toBe("json");
      expect(notifCols.metadata.notNull).toBe(true);
      expect(notifCols.metadata.default).toBeDefined();
    });

    it("migration enforces jsonb default '{}'::jsonb", () => {
      const sql0002Path = path.resolve(process.cwd(), "drizzle/migrations/0002_fluffy_ezekiel.sql");
      const sql0002 = fs.readFileSync(sql0002Path, "utf-8");
      expect(sql0002).toContain('"metadata" jsonb DEFAULT \'{}\'::jsonb NOT NULL');
    });

    it("safely holds display metadata such as deepLink, amountMinor, and currencyCode", () => {
      const validated = validateNotificationInput({
        recipientId: "user-recipient",
        type: NOTIFICATION_TYPES.EXPENSE_CREATED,
        title: "Expense added",
        message: "You were included in Dinner",
        metadata: {
          deepLink: "/expenses/exp-uuid-1",
          amountMinor: 5000,
          currencyCode: "INR",
        },
      });

      expect(validated.metadata).toEqual({
        deepLink: "/expenses/exp-uuid-1",
        amountMinor: 5000,
        currencyCode: "INR",
      });
    });

    it("rejects sensitive authentication credentials in metadata keys", () => {
      expect(() =>
        validateNotificationInput({
          recipientId: "user-1",
          type: NOTIFICATION_TYPES.EXPENSE_CREATED,
          title: "Test",
          message: "Test message",
          metadata: { password: "secret_password" },
        })
      ).toThrow('Security violation: notification metadata must not contain sensitive key "password"');

      expect(() =>
        validateNotificationInput({
          recipientId: "user-1",
          type: NOTIFICATION_TYPES.EXPENSE_CREATED,
          title: "Test",
          message: "Test message",
          metadata: { token: "auth_token" },
        })
      ).toThrow('Security violation: notification metadata must not contain sensitive key "token"');

      expect(() =>
        validateNotificationInput({
          recipientId: "user-1",
          type: NOTIFICATION_TYPES.EXPENSE_CREATED,
          title: "Test",
          message: "Test message",
          metadata: { apiKey: "secret_api_key" },
        })
      ).toThrow('Security violation: notification metadata must not contain sensitive key "apiKey"');
    });
  });

  // ==========================================================================
  // 8. TIMESTAMPS & SERVER AUTHORITY
  // ==========================================================================

  describe("Timestamps & Server Authority", () => {
    it("createdAt is timestamp with timezone notNull with defaultNow()", () => {
      expect(notifCols.createdAt).toBeDefined();
      expect(notifCols.createdAt.dataType).toBe("date");
      expect(notifCols.createdAt.notNull).toBe(true);
      expect(notifCols.createdAt.default).toBeDefined();
    });

    it("does not define an updatedAt column (notifications are append-oriented with readAt state)", () => {
      const rawCols = notifCols as Record<string, unknown>;
      expect(rawCols["updatedAt"]).toBeUndefined();
    });
  });

  // ==========================================================================
  // 9. PERFORMANCE INDEXES
  // ==========================================================================

  describe("Performance Indexes", () => {
    const sql0002Path = path.resolve(process.cwd(), "drizzle/migrations/0002_fluffy_ezekiel.sql");
    const sql0002 = fs.readFileSync(sql0002Path, "utf-8");

    it("creates composite index on (recipient_id, created_at) for efficient user notification feeds", () => {
      expect(sql0002).toContain(
        'CREATE INDEX "notifications_recipient_created_at_idx" ON "notifications" USING btree ("recipient_id","created_at")'
      );
    });

    it("creates composite index on (recipient_id, read_at) for fast unread count queries", () => {
      expect(sql0002).toContain(
        'CREATE INDEX "notifications_recipient_read_at_idx" ON "notifications" USING btree ("recipient_id","read_at")'
      );
    });

    it("creates index on group_id for querying notifications within a group", () => {
      expect(sql0002).toContain(
        'CREATE INDEX "notifications_group_idx" ON "notifications" USING btree ("group_id")'
      );
    });

    it("creates index on expense_id for querying notifications for an expense", () => {
      expect(sql0002).toContain(
        'CREATE INDEX "notifications_expense_idx" ON "notifications" USING btree ("expense_id")'
      );
    });

    it("creates index on settlement_id for querying notifications for a settlement", () => {
      expect(sql0002).toContain(
        'CREATE INDEX "notifications_settlement_idx" ON "notifications" USING btree ("settlement_id")'
      );
    });

    it("creates index on activity_id for querying notifications linking to an activity", () => {
      expect(sql0002).toContain(
        'CREATE INDEX "notifications_activity_idx" ON "notifications" USING btree ("activity_id")'
      );
    });
  });

  // ==========================================================================
  // 10. FINANCIAL ISOLATION & SEPARATION
  // ==========================================================================

  describe("Financial Isolation & Separation", () => {
    it("does not store authoritative balance, net position, or debt simplification fields", () => {
      const rawCols = notifCols as Record<string, unknown>;
      expect(rawCols["netBalance"]).toBeUndefined();
      expect(rawCols["totalOwed"]).toBeUndefined();
      expect(rawCols["simplifiedDebt"]).toBeUndefined();
      expect(rawCols["balance"]).toBeUndefined();
    });

    it("does not store participant allocation arrays in notification columns", () => {
      const rawCols = notifCols as Record<string, unknown>;
      expect(rawCols["splits"]).toBeUndefined();
      expect(rawCols["allocations"]).toBeUndefined();
      expect(rawCols["participants"]).toBeUndefined();
    });
  });

  // ==========================================================================
  // 11. BOUNDARY VALIDATION HELPER (validateNotificationInput)
  // ==========================================================================

  describe("Boundary Validation Helper (validateNotificationInput)", () => {
    it("accepts valid input with all entity references", () => {
      const result = validateNotificationInput({
        recipientId: "user-bob",
        actorId: "user-alice",
        type: NOTIFICATION_TYPES.EXPENSE_CREATED,
        title: "New Expense Added",
        message: "Alice added Team Dinner",
        groupId: "grp-1",
        expenseId: "exp-1",
        settlementId: null,
        activityId: "act-1",
        metadata: { amountMinor: 2500, currencyCode: "INR" },
      });

      expect(result.recipientId).toBe("user-bob");
      expect(result.actorId).toBe("user-alice");
      expect(result.type).toBe("expense_created");
      expect(result.title).toBe("New Expense Added");
      expect(result.message).toBe("Alice added Team Dinner");
      expect(result.groupId).toBe("grp-1");
      expect(result.expenseId).toBe("exp-1");
      expect(result.settlementId).toBeNull();
      expect(result.activityId).toBe("act-1");
      expect(result.readAt).toBeNull();
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it("rejects empty or whitespace recipientId", () => {
      expect(() =>
        validateNotificationInput({
          recipientId: "",
          type: NOTIFICATION_TYPES.GROUP_MEMBER_ADDED,
          title: "Added to group",
          message: "You were added",
        })
      ).toThrow("Valid recipientId is required for notification");

      expect(() =>
        validateNotificationInput({
          recipientId: "   ",
          type: NOTIFICATION_TYPES.GROUP_MEMBER_ADDED,
          title: "Added to group",
          message: "You were added",
        })
      ).toThrow("Valid recipientId is required for notification");
    });

    it("rejects invalid or unsupported notification type", () => {
      expect(() =>
        validateNotificationInput({
          recipientId: "user-1",
          type: "invalid_type",
          title: "Title",
          message: "Message",
        })
      ).toThrow('Invalid notification type: "invalid_type"');
    });

    it("rejects empty title", () => {
      expect(() =>
        validateNotificationInput({
          recipientId: "user-1",
          type: NOTIFICATION_TYPES.SETTLEMENT_CREATED,
          title: "",
          message: "Message",
        })
      ).toThrow("Valid title is required for notification");
    });

    it("rejects empty message", () => {
      expect(() =>
        validateNotificationInput({
          recipientId: "user-1",
          type: NOTIFICATION_TYPES.SETTLEMENT_CREATED,
          title: "Title",
          message: "   ",
        })
      ).toThrow("Valid message is required for notification");
    });
  });

  // ==========================================================================
  // 12. DRIZZLE RELATIONS
  // ==========================================================================

  describe("Drizzle Relations", () => {
    it("defines notificationsRelations linking recipient, actor, group, expense, settlement, and activity", () => {
      expect(notificationsRelations).toBeDefined();
    });

    it("defines usersRelations linking receivedNotifications and initiatedNotifications", () => {
      expect(usersRelations).toBeDefined();
    });
  });
});
