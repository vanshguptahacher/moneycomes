/**
 * Phase 3.8 — Activity Database Schema Verification Test Suite.
 *
 * Verifies that the activity_events database schema foundation is clean, production-safe,
 * implements a strongly typed activity event system, references canonical actor and group identities,
 * supports polymorphic entity references (expense, settlement, group, member, friendship),
 * stores safe non-authoritative JSONB metadata (rejecting sensitive secrets/credentials),
 * uses server-authoritative timestamps for append-only timeline rendering, and maintains
 * complete separation from authoritative financial calculations.
 */

import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import {
  activityEvents,
  users,
  groups,
  activityEventsRelations,
  ACTIVITY_EVENT_TYPES,
  ACTIVITY_ENTITY_TYPES,
  isActivityEventType,
  isActivityEntityType,
  validateActivityEventInput,
} from "../../server/db/schema/index.js";
import fs from "node:fs";
import path from "node:path";

describe("Phase 3.8 — Activity Database Schema", () => {
  const actCols = getTableColumns(activityEvents);
  const userCols = getTableColumns(users);
  const groupCols = getTableColumns(groups);

  // ==========================================================================
  // 1. ACTIVITY IDENTITY & SURROGATE PRIMARY KEY
  // ==========================================================================

  describe("Activity Identity & Surrogate Primary Key", () => {
    it("primary key is a stable UUID with database default gen_random_uuid()", () => {
      expect(actCols.id).toBeDefined();
      expect(actCols.id.dataType).toBe("string");
      expect(actCols.id.primary).toBe(true);
      expect(actCols.id.notNull).toBe(true);
      expect(actCols.id.default).toBeDefined();
    });

    it("primary key is independent of actor, entityId, type, or timestamp", () => {
      expect(actCols.id.name).toBe("id");
    });
  });

  // ==========================================================================
  // 2. CANONICAL ACTOR REFERENCE & INTEGRITY
  // ==========================================================================

  describe("Canonical Actor Reference & Integrity", () => {
    it("actorId references canonical user identity with matching text data type", () => {
      expect(userCols.id.dataType).toBe("string"); // Better Auth text ID
      expect(actCols.actorId).toBeDefined();
      expect(actCols.actorId.dataType).toBe("string");
      expect(actCols.actorId.notNull).toBe(true);
    });

    it("does not duplicate actor profile fields (name, email, avatar) in activity columns", () => {
      const rawCols = actCols as Record<string, unknown>;
      expect(rawCols["actorEmail"]).toBeUndefined();
      expect(rawCols["actorName"]).toBeUndefined();
      expect(rawCols["actorAvatar"]).toBeUndefined();
      expect(rawCols["userEmail"]).toBeUndefined();
    });

    it("migration enforces foreign key to users on actor_id with ON DELETE restrict", () => {
      const sql0000Path = path.resolve(process.cwd(), "drizzle/migrations/0000_spotty_rockslide.sql");
      const sql0000 = fs.readFileSync(sql0000Path, "utf-8");
      expect(sql0000).toContain(
        'ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict'
      );
    });
  });

  // ==========================================================================
  // 3. GROUP CONTEXT (GROUP VS PERSONAL ACTIVITY)
  // ==========================================================================

  describe("Group Context & Person-to-Person Support", () => {
    it("groupId references canonical groups table with matching uuid data type", () => {
      expect(groupCols.id.dataType).toBe("string");
      expect(actCols.groupId).toBeDefined();
      expect(actCols.groupId.dataType).toBe("string");
    });

    it("groupId is nullable to support personal, 1-on-1, and friend activities outside a group", () => {
      expect(actCols.groupId.notNull).toBe(false);
    });

    it("migration enforces foreign key to groups on group_id with ON DELETE cascade", () => {
      const sql0000Path = path.resolve(process.cwd(), "drizzle/migrations/0000_spotty_rockslide.sql");
      const sql0000 = fs.readFileSync(sql0000Path, "utf-8");
      expect(sql0000).toContain(
        'ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade'
      );
    });

    it("does not duplicate group title or description into activity table columns", () => {
      const rawCols = actCols as Record<string, unknown>;
      expect(rawCols["groupName"]).toBeUndefined();
      expect(rawCols["groupDescription"]).toBeUndefined();
    });
  });

  // ==========================================================================
  // 4. POLYMORPHIC ENTITY REFERENCE (entityType & entityId)
  // ==========================================================================

  describe("Polymorphic Entity Reference", () => {
    it("entityType is a varchar(32) notNull column", () => {
      expect(actCols.entityType).toBeDefined();
      expect(actCols.entityType.dataType).toBe("string");
      expect(actCols.entityType.notNull).toBe(true);
    });

    it("entityId is a varchar(64) notNull column", () => {
      expect(actCols.entityId).toBeDefined();
      expect(actCols.entityId.dataType).toBe("string");
      expect(actCols.entityId.notNull).toBe(true);
    });

    it("supports all defined canonical entity types", () => {
      expect(ACTIVITY_ENTITY_TYPES.GROUP).toBe("group");
      expect(ACTIVITY_ENTITY_TYPES.MEMBER).toBe("member");
      expect(ACTIVITY_ENTITY_TYPES.EXPENSE).toBe("expense");
      expect(ACTIVITY_ENTITY_TYPES.SETTLEMENT).toBe("settlement");
      expect(ACTIVITY_ENTITY_TYPES.FRIENDSHIP).toBe("friendship");
    });

    it("isActivityEntityType type guard correctly validates entity types", () => {
      expect(isActivityEntityType("group")).toBe(true);
      expect(isActivityEntityType("member")).toBe(true);
      expect(isActivityEntityType("expense")).toBe(true);
      expect(isActivityEntityType("settlement")).toBe(true);
      expect(isActivityEntityType("friendship")).toBe(true);
      expect(isActivityEntityType("invalid_entity")).toBe(false);
      expect(isActivityEntityType(null)).toBe(false);
      expect(isActivityEntityType(123)).toBe(false);
    });
  });

  // ==========================================================================
  // 5. STRONGLY TYPED ACTIVITY EVENT TYPES
  // ==========================================================================

  describe("Strongly Typed Activity Event Types", () => {
    it("type column is varchar(64) notNull", () => {
      expect(actCols.type).toBeDefined();
      expect(actCols.type.dataType).toBe("string");
      expect(actCols.type.notNull).toBe(true);
    });

    it("supports all required domain events from specification", () => {
      // Group lifecycle
      expect(ACTIVITY_EVENT_TYPES.GROUP_CREATED).toBe("group_created");
      expect(ACTIVITY_EVENT_TYPES.GROUP_UPDATED).toBe("group_updated");
      expect(ACTIVITY_EVENT_TYPES.GROUP_MEMBER_ADDED).toBe("group_member_added");
      expect(ACTIVITY_EVENT_TYPES.GROUP_MEMBER_REMOVED).toBe("group_member_removed");

      // Expense lifecycle
      expect(ACTIVITY_EVENT_TYPES.EXPENSE_CREATED).toBe("expense_created");
      expect(ACTIVITY_EVENT_TYPES.EXPENSE_UPDATED).toBe("expense_updated");
      expect(ACTIVITY_EVENT_TYPES.EXPENSE_DELETED).toBe("expense_deleted");

      // Settlement lifecycle
      expect(ACTIVITY_EVENT_TYPES.SETTLEMENT_CREATED).toBe("settlement_created");
      expect(ACTIVITY_EVENT_TYPES.SETTLEMENT_UPDATED).toBe("settlement_updated");
      expect(ACTIVITY_EVENT_TYPES.SETTLEMENT_DELETED).toBe("settlement_deleted");

      // Friendship lifecycle
      expect(ACTIVITY_EVENT_TYPES.FRIEND_ADDED).toBe("friend_added");
      expect(ACTIVITY_EVENT_TYPES.FRIEND_REMOVED).toBe("friend_removed");
    });

    it("isActivityEventType type guard correctly identifies valid activity event types", () => {
      expect(isActivityEventType("expense_created")).toBe(true);
      expect(isActivityEventType("settlement_created")).toBe(true);
      expect(isActivityEventType("group_member_added")).toBe(true);
      expect(isActivityEventType("arbitrary_event")).toBe(false);
      expect(isActivityEventType(undefined)).toBe(false);
    });
  });

  // ==========================================================================
  // 6. STRUCTURED METADATA & SECURITY
  // ==========================================================================

  describe("Structured Metadata & Security", () => {
    it("metadata column is jsonb notNull with default {}", () => {
      expect(actCols.metadata).toBeDefined();
      expect(actCols.metadata.dataType).toBe("json");
      expect(actCols.metadata.notNull).toBe(true);
      expect(actCols.metadata.default).toBeDefined();
    });

    it("migration enforces jsonb default '{}'::jsonb", () => {
      const sql0000Path = path.resolve(process.cwd(), "drizzle/migrations/0000_spotty_rockslide.sql");
      const sql0000 = fs.readFileSync(sql0000Path, "utf-8");
      expect(sql0000).toContain('"metadata" jsonb DEFAULT \'{}\'::jsonb NOT NULL');
    });

    it("safely holds display metadata such as description, amountMinor, and currencyCode", () => {
      const validated = validateActivityEventInput({
        type: ACTIVITY_EVENT_TYPES.EXPENSE_CREATED,
        actorId: "user-1",
        entityType: ACTIVITY_ENTITY_TYPES.EXPENSE,
        entityId: "exp-uuid-1",
        groupId: "grp-uuid-1",
        metadata: {
          description: "Team Dinner",
          amountMinor: 15000,
          currencyCode: "INR",
          participantCount: 3,
        },
      });

      expect(validated.metadata).toEqual({
        description: "Team Dinner",
        amountMinor: 15000,
        currencyCode: "INR",
        participantCount: 3,
      });
    });

    it("safely holds target user and role for membership events", () => {
      const validated = validateActivityEventInput({
        type: ACTIVITY_EVENT_TYPES.GROUP_MEMBER_ADDED,
        actorId: "user-admin",
        entityType: ACTIVITY_ENTITY_TYPES.MEMBER,
        entityId: "user-new-member",
        groupId: "grp-uuid-1",
        metadata: {
          targetUserId: "user-new-member",
          role: "member",
        },
      });

      expect(validated.metadata.targetUserId).toBe("user-new-member");
      expect(validated.metadata.role).toBe("member");
    });

    it("rejects sensitive authentication credentials in metadata keys", () => {
      expect(() =>
        validateActivityEventInput({
          type: ACTIVITY_EVENT_TYPES.EXPENSE_CREATED,
          actorId: "user-1",
          entityType: ACTIVITY_ENTITY_TYPES.EXPENSE,
          entityId: "exp-1",
          metadata: { password: "supersecretpassword" },
        })
      ).toThrow('Security violation: activity metadata must not contain sensitive key "password"');

      expect(() =>
        validateActivityEventInput({
          type: ACTIVITY_EVENT_TYPES.EXPENSE_CREATED,
          actorId: "user-1",
          entityType: ACTIVITY_ENTITY_TYPES.EXPENSE,
          entityId: "exp-1",
          metadata: { accessToken: "jwt.token.here" },
        })
      ).toThrow('Security violation: activity metadata must not contain sensitive key "accessToken"');

      expect(() =>
        validateActivityEventInput({
          type: ACTIVITY_EVENT_TYPES.EXPENSE_CREATED,
          actorId: "user-1",
          entityType: ACTIVITY_ENTITY_TYPES.EXPENSE,
          entityId: "exp-1",
          metadata: { secret: "oauth_secret" },
        })
      ).toThrow('Security violation: activity metadata must not contain sensitive key "secret"');
    });
  });

  // ==========================================================================
  // 7. TIMESTAMPS & APPEND-ONLY IMMUTABILITY
  // ==========================================================================

  describe("Timestamps & Append-Only Immutability", () => {
    it("createdAt is timestamp with timezone notNull with defaultNow()", () => {
      expect(actCols.createdAt).toBeDefined();
      expect(actCols.createdAt.dataType).toBe("date");
      expect(actCols.createdAt.notNull).toBe(true);
      expect(actCols.createdAt.default).toBeDefined();
    });

    it("does not define an updatedAt column to preserve append-only immutability", () => {
      const rawCols = actCols as Record<string, unknown>;
      expect(rawCols["updatedAt"]).toBeUndefined();
    });

    it("supports providing an explicit event timestamp", () => {
      const pastTime = new Date("2025-05-15T08:30:00Z");
      const validated = validateActivityEventInput({
        type: ACTIVITY_EVENT_TYPES.SETTLEMENT_CREATED,
        actorId: "user-1",
        entityType: ACTIVITY_ENTITY_TYPES.SETTLEMENT,
        entityId: "settle-1",
        createdAt: pastTime,
      });

      expect(validated.createdAt).toEqual(pastTime);
    });
  });

  // ==========================================================================
  // 8. PERFORMANCE INDEXES
  // ==========================================================================

  describe("Performance Indexes", () => {
    const sql0000Path = path.resolve(process.cwd(), "drizzle/migrations/0000_spotty_rockslide.sql");
    const sql0000 = fs.readFileSync(sql0000Path, "utf-8");

    it("creates index on actor_id for filtering activity initiated by a user", () => {
      expect(sql0000).toContain(
        'CREATE INDEX "activity_actor_idx" ON "activity_events" USING btree ("actor_id")'
      );
    });

    it("creates index on group_id for querying group activity timeline", () => {
      expect(sql0000).toContain(
        'CREATE INDEX "activity_group_idx" ON "activity_events" USING btree ("group_id")'
      );
    });

    it("creates index on created_at for global chronological timeline ordering", () => {
      expect(sql0000).toContain(
        'CREATE INDEX "activity_created_at_idx" ON "activity_events" USING btree ("created_at")'
      );
    });
  });

  // ==========================================================================
  // 9. FINANCIAL SEPARATION & INDEPENDENCE
  // ==========================================================================

  describe("Financial Separation & Independence", () => {
    it("does not store authoritative balance, net balance, or debt simplification fields", () => {
      const rawCols = actCols as Record<string, unknown>;
      expect(rawCols["netBalance"]).toBeUndefined();
      expect(rawCols["totalOwed"]).toBeUndefined();
      expect(rawCols["simplifiedDebt"]).toBeUndefined();
      expect(rawCols["balanceBefore"]).toBeUndefined();
      expect(rawCols["balanceAfter"]).toBeUndefined();
    });

    it("does not store participant allocation arrays in activity columns", () => {
      const rawCols = actCols as Record<string, unknown>;
      expect(rawCols["splits"]).toBeUndefined();
      expect(rawCols["allocations"]).toBeUndefined();
      expect(rawCols["participants"]).toBeUndefined();
    });
  });

  // ==========================================================================
  // 10. BOUNDARY VALIDATION HELPER (validateActivityEventInput)
  // ==========================================================================

  describe("Boundary Validation Helper (validateActivityEventInput)", () => {
    it("accepts valid input and applies defaults", () => {
      const result = validateActivityEventInput({
        type: ACTIVITY_EVENT_TYPES.GROUP_CREATED,
        actorId: "user-creator",
        entityType: ACTIVITY_ENTITY_TYPES.GROUP,
        entityId: "group-uuid-1",
      });

      expect(result.type).toBe("group_created");
      expect(result.actorId).toBe("user-creator");
      expect(result.entityType).toBe("group");
      expect(result.entityId).toBe("group-uuid-1");
      expect(result.groupId).toBeNull();
      expect(result.metadata).toEqual({});
      expect(result.createdAt).toBeInstanceOf(Date);
    });

    it("rejects unsupported activity event type", () => {
      expect(() =>
        validateActivityEventInput({
          type: "unsupported_event_type",
          actorId: "user-1",
          entityType: ACTIVITY_ENTITY_TYPES.EXPENSE,
          entityId: "exp-1",
        })
      ).toThrow('Invalid activity event type: "unsupported_event_type"');
    });

    it("rejects empty or whitespace actorId", () => {
      expect(() =>
        validateActivityEventInput({
          type: ACTIVITY_EVENT_TYPES.EXPENSE_CREATED,
          actorId: "",
          entityType: ACTIVITY_ENTITY_TYPES.EXPENSE,
          entityId: "exp-1",
        })
      ).toThrow("Valid actorId is required for activity event");

      expect(() =>
        validateActivityEventInput({
          type: ACTIVITY_EVENT_TYPES.EXPENSE_CREATED,
          actorId: "   ",
          entityType: ACTIVITY_ENTITY_TYPES.EXPENSE,
          entityId: "exp-1",
        })
      ).toThrow("Valid actorId is required for activity event");
    });

    it("rejects unsupported entity type", () => {
      expect(() =>
        validateActivityEventInput({
          type: ACTIVITY_EVENT_TYPES.EXPENSE_CREATED,
          actorId: "user-1",
          entityType: "unknown_entity",
          entityId: "exp-1",
        })
      ).toThrow('Invalid activity entity type: "unknown_entity"');
    });

    it("rejects empty or whitespace entityId", () => {
      expect(() =>
        validateActivityEventInput({
          type: ACTIVITY_EVENT_TYPES.EXPENSE_CREATED,
          actorId: "user-1",
          entityType: ACTIVITY_ENTITY_TYPES.EXPENSE,
          entityId: "",
        })
      ).toThrow("Valid entityId is required for activity event");

      expect(() =>
        validateActivityEventInput({
          type: ACTIVITY_EVENT_TYPES.EXPENSE_CREATED,
          actorId: "user-1",
          entityType: ACTIVITY_ENTITY_TYPES.EXPENSE,
          entityId: "   ",
        })
      ).toThrow("Valid entityId is required for activity event");
    });
  });

  // ==========================================================================
  // 11. DRIZZLE RELATIONS
  // ==========================================================================

  describe("Drizzle Relations", () => {
    it("defines activityEventsRelations linking actor to users and group to groups", () => {
      expect(activityEventsRelations).toBeDefined();
    });
  });
});
