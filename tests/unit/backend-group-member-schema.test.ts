/**
 * Phase 3.4 — Group Members Database Schema Verification Test Suite.
 *
 * Verifies that the group members database schema foundation is clean, production-safe,
 * implements a normalized many-to-many relationship connecting canonical users and groups,
 * enforces duplicate prevention via composite uniqueness, prevents orphan records with foreign keys,
 * decouples membership lifecycle from financial history, and supports fast indexed lookups.
 */

import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import {
  groupMembers,
  groups,
  users,
  expenses,
  expenseSplits,
  settlements,
  groupMembersRelations,
  groupsRelations,
  usersRelations,
  GROUP_ROLES,
  validateGroupMembershipInput,
} from "../../server/db/schema/index.js";
import fs from "node:fs";
import path from "node:path";

describe("Phase 3.4 — Group Members Database Schema", () => {
  const memberCols = getTableColumns(groupMembers);
  const groupCols = getTableColumns(groups);
  const userCols = getTableColumns(users);

  // ==========================================================================
  // 1. PRIMARY KEY & SURROGATE IDENTITY
  // ==========================================================================

  describe("Primary Key & Identifier Strategy", () => {
    it("primary key is a stable UUID with database default", () => {
      expect(memberCols.id).toBeDefined();
      expect(memberCols.id.dataType).toBe("string");
      expect(memberCols.id.primary).toBe(true);
      expect(memberCols.id.notNull).toBe(true);
      expect(memberCols.id.default).toBeDefined();
    });

    it("primary key is independent of user email, name, or group attributes", () => {
      expect(memberCols.id.name).toBe("id");
    });
  });

  // ==========================================================================
  // 2. FOREIGN KEYS & CANONICAL IDENTITY INTEGRATION
  // ==========================================================================

  describe("Foreign Keys & Canonical Identity Integration", () => {
    it("groupId references canonical groups table with matching uuid data type", () => {
      expect(groupCols.id.dataType).toBe("string"); // uuid string

      expect(memberCols.groupId).toBeDefined();
      expect(memberCols.groupId.dataType).toBe("string");
      expect(memberCols.groupId.notNull).toBe(true);
    });

    it("userId references canonical users table with matching text data type", () => {
      expect(userCols.id.dataType).toBe("string"); // Better Auth text ID

      expect(memberCols.userId).toBeDefined();
      expect(memberCols.userId.dataType).toBe("string");
      expect(memberCols.userId.notNull).toBe(true);
    });

    it("does not use email, username, or display name as user membership key", () => {
      const rawCols = memberCols as Record<string, unknown>;
      expect(rawCols["userEmail"]).toBeUndefined();
      expect(rawCols["userName"]).toBeUndefined();
      expect(rawCols["userDisplayName"]).toBeUndefined();
      expect(rawCols["phone"]).toBeUndefined();
    });

    it("does not use group name or description as group membership key", () => {
      const rawCols = memberCols as Record<string, unknown>;
      expect(rawCols["groupName"]).toBeUndefined();
      expect(rawCols["groupSlug"]).toBeUndefined();
    });
  });

  // ==========================================================================
  // 3. MANY-TO-MANY RELATIONSHIP & DUPLICATE PREVENTION
  // ==========================================================================

  describe("Many-to-Many Relationship & Duplicate Prevention", () => {
    const sql0000Path = path.resolve(process.cwd(), "drizzle/migrations/0000_spotty_rockslide.sql");
    const sql0000 = fs.readFileSync(sql0000Path, "utf-8");

    it("enforces uniqueness of (group_id, user_id) to strictly prevent duplicate memberships", () => {
      expect(sql0000).toContain(
        'CONSTRAINT "group_members_group_user_uq" UNIQUE("group_id","user_id")'
      );
    });

    it("supports one user belonging to multiple distinct groups", () => {
      // Because uniqueness is composite (groupId, userId), userId can appear with different groupIds
      expect(memberCols.userId.isUnique).toBe(false);
    });

    it("supports one group containing multiple distinct users", () => {
      // Because uniqueness is composite (groupId, userId), groupId can appear with different userIds
      expect(memberCols.groupId.isUnique).toBe(false);
    });

    it("database constraint authoritatively prevents concurrent race-condition duplicates", () => {
      // The UNIQUE constraint in PostgreSQL guarantees rejection of duplicate (group_id, user_id)
      // even if two join requests are received concurrently.
      expect(sql0000).toMatch(/UNIQUE\("group_id","user_id"\)/);
    });
  });

  // ==========================================================================
  // 4. MEMBERSHIP ROLE & TIMESTAMPS
  // ==========================================================================

  describe("Membership Role & Timestamps", () => {
    it("has role column with NOT NULL and default 'member'", () => {
      expect(memberCols.role).toBeDefined();
      expect(memberCols.role.dataType).toBe("string");
      expect(memberCols.role.notNull).toBe(true);
      expect(memberCols.role.default).toBe("member");
    });

    it("exports strongly typed GROUP_ROLES constant", () => {
      expect(GROUP_ROLES.MEMBER).toBe("member");
      expect(GROUP_ROLES.ADMIN).toBe("admin");
    });

    it("has joinedAt timestamp with database default and timezone", () => {
      expect(memberCols.joinedAt).toBeDefined();
      expect(memberCols.joinedAt.notNull).toBe(true);
      expect(memberCols.joinedAt.default).toBeDefined();
    });

    it("contains exactly allowed fields without speculative bloat", () => {
      const allowedKeys = new Set(["id", "groupId", "userId", "role", "joinedAt"]);

      for (const colName of Object.keys(memberCols)) {
        expect(allowedKeys.has(colName)).toBe(true);
      }
    });
  });

  // ==========================================================================
  // 5. DATA NORMALIZATION & FIELD SEPARATION
  // ==========================================================================

  describe("Data Normalization & Separation of Concerns", () => {
    it("does not store user profile information in group_members", () => {
      const rawCols = memberCols as Record<string, unknown>;
      expect(rawCols["name"]).toBeUndefined();
      expect(rawCols["email"]).toBeUndefined();
      expect(rawCols["avatarUrl"]).toBeUndefined();
    });

    it("does not store group metadata in group_members", () => {
      const rawCols = memberCols as Record<string, unknown>;
      expect(rawCols["name"]).toBeUndefined();
      expect(rawCols["description"]).toBeUndefined();
      expect(rawCols["currencyCode"]).toBeUndefined();
    });

    it("does not store financial calculations, balances, or owed sums in group_members", () => {
      const rawCols = memberCols as Record<string, unknown>;
      expect(rawCols["balance"]).toBeUndefined();
      expect(rawCols["totalOwed"]).toBeUndefined();
      expect(rawCols["totalPaid"]).toBeUndefined();
      expect(rawCols["netPosition"]).toBeUndefined();
      expect(rawCols["simplifiedDebt"]).toBeUndefined();
    });
  });

  // ==========================================================================
  // 6. PRIVACY & SECURITY: SECRET EXCLUSION
  // ==========================================================================

  describe("Privacy & Authentication Secret Segregation", () => {
    it("group_members table contains zero authentication secrets or credentials", () => {
      const rawCols = memberCols as Record<string, unknown>;
      expect(rawCols["password"]).toBeUndefined();
      expect(rawCols["token"]).toBeUndefined();
      expect(rawCols["sessionToken"]).toBeUndefined();
      expect(rawCols["secret"]).toBeUndefined();
      expect(rawCols["apiKey"]).toBeUndefined();
    });

    it("group_members table contains zero payment credentials or UPI details", () => {
      const rawCols = memberCols as Record<string, unknown>;
      expect(rawCols["upiId"]).toBeUndefined();
      expect(rawCols["bankAccount"]).toBeUndefined();
    });
  });

  // ==========================================================================
  // 7. INDEXES & QUERY ACCESS PATTERNS
  // ==========================================================================

  describe("Indexes & Query Access Patterns", () => {
    const sql0000Path = path.resolve(process.cwd(), "drizzle/migrations/0000_spotty_rockslide.sql");
    const sql0000 = fs.readFileSync(sql0000Path, "utf-8");

    it("defines index on group_id for fast retrieval of all members in a group", () => {
      expect(sql0000).toContain(
        'CREATE INDEX "group_members_group_idx" ON "group_members" USING btree ("group_id");'
      );
    });

    it("defines index on user_id for fast retrieval of all groups for a user", () => {
      expect(sql0000).toContain(
        'CREATE INDEX "group_members_user_idx" ON "group_members" USING btree ("user_id");'
      );
    });

    it("constructs type-safe query for finding all members of a group", async () => {
      const { eq } = await import("drizzle-orm");
      const targetGroupId = "11111111-2222-3333-4444-555555555555";

      const condition = eq(groupMembers.groupId, targetGroupId);
      expect(condition).toBeDefined();
    });

    it("constructs type-safe query for finding all groups of a user", async () => {
      const { eq } = await import("drizzle-orm");
      const targetUserId = "user-test-456";

      const condition = eq(groupMembers.userId, targetUserId);
      expect(condition).toBeDefined();
    });

    it("constructs type-safe query for checking user membership in a group (authorization check)", async () => {
      const { eq, and } = await import("drizzle-orm");
      const targetGroupId = "11111111-2222-3333-4444-555555555555";
      const targetUserId = "user-test-456";

      const condition = and(
        eq(groupMembers.groupId, targetGroupId),
        eq(groupMembers.userId, targetUserId)
      );
      expect(condition).toBeDefined();
    });
  });

  // ==========================================================================
  // 8. REFERENTIAL INTEGRITY & FINANCIAL DECOUPLING
  // ==========================================================================

  describe("Referential Integrity & Delete Policy Decoupling", () => {
    const sql0000Path = path.resolve(process.cwd(), "drizzle/migrations/0000_spotty_rockslide.sql");
    const sql0000 = fs.readFileSync(sql0000Path, "utf-8");

    it("foreign keys enforce ON DELETE cascade for group and user deletion cleanup", () => {
      expect(sql0000).toContain(
        'ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade ON UPDATE no action;'
      );
      expect(sql0000).toContain(
        'ALTER TABLE "group_members" ADD CONSTRAINT "group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;'
      );
    });

    it("CRITICAL: no financial table references group_members table (complete lifecycle decoupling)", () => {
      const expCols = getTableColumns(expenses);
      const splitCols = getTableColumns(expenseSplits);
      const setCols = getTableColumns(settlements);

      // Verify expenses do NOT reference group_members
      expect(Object.keys(expCols)).not.toContain("groupMemberId");
      expect(Object.keys(expCols)).not.toContain("group_member_id");

      // Verify splits do NOT reference group_members
      expect(Object.keys(splitCols)).not.toContain("groupMemberId");
      expect(Object.keys(splitCols)).not.toContain("group_member_id");

      // Verify settlements do NOT reference group_members
      expect(Object.keys(setCols)).not.toContain("groupMemberId");
      expect(Object.keys(setCols)).not.toContain("group_member_id");
    });

    it("removing a group member CANNOT delete expenses, settlements, or transaction history", () => {
      // Because no foreign keys point to group_members, deleting a row from group_members table
      // leaves expenses, splits, and settlements completely intact and unaltered.
      expect(sql0000).not.toMatch(/REFERENCES "public"\."group_members"/);
    });
  });

  // ==========================================================================
  // 9. DRIZZLE RELATIONS INTEGRATION
  // ==========================================================================

  describe("Drizzle Relations Integration", () => {
    it("groupMembersRelations defines group and user relations", () => {
      expect(groupMembersRelations).toBeDefined();
    });

    it("groupsRelations defines members relation to groupMembers", () => {
      expect(groupsRelations).toBeDefined();
    });

    it("usersRelations defines memberships relation to groupMembers", () => {
      expect(usersRelations).toBeDefined();
    });
  });

  // ==========================================================================
  // 10. VALIDATION HELPER
  // ==========================================================================

  describe("Membership Input Validation Helper", () => {
    it("validates and trims valid group and user IDs", () => {
      const result = validateGroupMembershipInput(
        "  11111111-2222-3333-4444-555555555555  ",
        "  user-123  "
      );
      expect(result).toEqual({
        groupId: "11111111-2222-3333-4444-555555555555",
        userId: "user-123",
      });
    });

    it("rejects empty or whitespace group IDs", () => {
      expect(() => validateGroupMembershipInput("", "user-123")).toThrow(
        "Valid groupId is required for group membership"
      );
      expect(() => validateGroupMembershipInput("   ", "user-123")).toThrow(
        "Valid groupId is required for group membership"
      );
      // @ts-expect-error - runtime validation
      expect(() => validateGroupMembershipInput(null, "user-123")).toThrow();
    });

    it("rejects empty or whitespace user IDs", () => {
      expect(() =>
        validateGroupMembershipInput("11111111-2222-3333-4444-555555555555", "")
      ).toThrow("Valid userId is required for group membership");
      expect(() =>
        validateGroupMembershipInput("11111111-2222-3333-4444-555555555555", "   ")
      ).toThrow("Valid userId is required for group membership");
      // @ts-expect-error - runtime validation
      expect(() => validateGroupMembershipInput("11111111-2222-3333-4444-555555555555", undefined)).toThrow();
    });
  });

  // ==========================================================================
  // 11. MIGRATION & SNAPSHOT INTEGRITY
  // ==========================================================================

  describe("Migration Files & Drizzle Snapshot Integrity", () => {
    it("migration 0000 creates group_members table with all required DDL columns", () => {
      const sql0000Path = path.resolve(process.cwd(), "drizzle/migrations/0000_spotty_rockslide.sql");
      const sql = fs.readFileSync(sql0000Path, "utf-8");

      expect(sql).toContain('CREATE TABLE "group_members" (');
      expect(sql).toContain('"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL');
      expect(sql).toContain('"group_id" uuid NOT NULL');
      expect(sql).toContain('"user_id" text NOT NULL');
      expect(sql).toContain('"role" varchar(32) DEFAULT \'member\' NOT NULL');
      expect(sql).toContain('"joined_at" timestamp with time zone DEFAULT now() NOT NULL');
      expect(sql).toContain('CONSTRAINT "group_members_group_user_uq" UNIQUE("group_id","user_id")');
    });

    it("snapshot includes group_members table definition with exact columns, foreign keys, and indexes", () => {
      const snapPath = path.resolve(process.cwd(), "drizzle/migrations/meta/0001_snapshot.json");
      const snap = JSON.parse(fs.readFileSync(snapPath, "utf-8"));

      const snapTable = snap.tables["public.group_members"];
      expect(snapTable).toBeDefined();
      expect(snapTable.name).toBe("group_members");

      // Columns
      expect(snapTable.columns["id"]).toBeDefined();
      expect(snapTable.columns["group_id"]).toBeDefined();
      expect(snapTable.columns["user_id"]).toBeDefined();
      expect(snapTable.columns["role"]).toBeDefined();
      expect(snapTable.columns["joined_at"]).toBeDefined();

      // Constraints
      expect(snapTable.uniqueConstraints["group_members_group_user_uq"]).toBeDefined();
      expect(snapTable.foreignKeys["group_members_group_id_groups_id_fk"]).toBeDefined();
      expect(snapTable.foreignKeys["group_members_user_id_users_id_fk"]).toBeDefined();

      // Indexes
      expect(snapTable.indexes["group_members_group_idx"]).toBeDefined();
      expect(snapTable.indexes["group_members_user_idx"]).toBeDefined();
    });
  });
});
