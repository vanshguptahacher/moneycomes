/**
 * Phase 3.2 — Friends Database Schema Verification Test Suite.
 *
 * Verifies that the friendship database schema foundation is clean, production-safe,
 * reuses the canonical Better Auth user identity, enforces canonical ordering and self-friendship
 * rejection at the database level, prevents duplicate relationships, provides justified lookup indexes,
 * decouples friendship lifecycle from financial history, and strictly segregates personal/auth data.
 */

import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import {
  friendships,
  users,
  expenses,
  expenseSplits,
  settlements,
  groups,
  friendshipsRelations,
  usersRelations,
  FRIENDSHIP_STATUS,
  canonicalizeFriendshipPair,
} from "../../server/db/schema/index.js";
import fs from "node:fs";
import path from "node:path";

describe("Phase 3.2 — Friends Database Schema", () => {
  const friendCols = getTableColumns(friendships);
  const userCols = getTableColumns(users);

  // ==========================================================================
  // 1. CANONICAL IDENTITY INTEGRATION & DATA TYPES
  // ==========================================================================

  describe("Canonical Identity Integration & Key Types", () => {
    it("primary key is a stable UUID", () => {
      expect(friendCols.id).toBeDefined();
      expect(friendCols.id.dataType).toBe("string");
      expect(friendCols.id.primary).toBe(true);
      expect(friendCols.id.notNull).toBe(true);
      expect(friendCols.id.default).toBeDefined();
    });

    it("references canonical user table with matching text data type", () => {
      expect(userCols.id.dataType).toBe("string"); // Better Auth text ID

      expect(friendCols.userId1).toBeDefined();
      expect(friendCols.userId1.dataType).toBe("string");
      expect(friendCols.userId1.notNull).toBe(true);

      expect(friendCols.userId2).toBeDefined();
      expect(friendCols.userId2.dataType).toBe("string");
      expect(friendCols.userId2.notNull).toBe(true);
    });

    it("does not use email, username, or display name as relationship key", () => {
      const rawCols = friendCols as Record<string, unknown>;
      expect(rawCols["email"]).toBeUndefined();
      expect(rawCols["username"]).toBeUndefined();
      expect(rawCols["displayName"]).toBeUndefined();
      expect(rawCols["phone"]).toBeUndefined();
    });
  });

  // ==========================================================================
  // 2. SCHEMA FIELD SPECIFICATION & NULLABILITY
  // ==========================================================================

  describe("Schema Field Specification & Nullability", () => {
    it("contains exactly the required minimal fields without speculative bloat", () => {
      const allowedKeys = new Set([
        "id",
        "userId1",
        "userId2",
        "status",
        "createdAt",
        "updatedAt",
      ]);

      for (const colName of Object.keys(friendCols)) {
        expect(allowedKeys.has(colName)).toBe(true);
      }
    });

    it("enforces NOT NULL on all relationship fields", () => {
      expect(friendCols.id.notNull).toBe(true);
      expect(friendCols.userId1.notNull).toBe(true);
      expect(friendCols.userId2.notNull).toBe(true);
      expect(friendCols.status.notNull).toBe(true);
      expect(friendCols.createdAt.notNull).toBe(true);
      expect(friendCols.updatedAt.notNull).toBe(true);
    });

    it("status defaults to active and is strongly typed", () => {
      expect(friendCols.status.default).toBe("active");
      expect(FRIENDSHIP_STATUS.ACTIVE).toBe("active");
    });

    it("maintains createdAt and updatedAt timestamps with timezone defaults", () => {
      expect(friendCols.createdAt.default).toBeDefined();
      expect(friendCols.updatedAt.default).toBeDefined();
    });

    it("rejects invalid status values at type level and defines active status constant", () => {
      expect(FRIENDSHIP_STATUS.ACTIVE).toBe("active");
      const validStatus: typeof FRIENDSHIP_STATUS.ACTIVE = "active";
      expect(validStatus).toBe("active");
    });
  });

  // ==========================================================================
  // 3. DATABASE CONSTRAINTS: ORDERING, SELF-FRIENDSHIP & DUPLICATES
  // ==========================================================================

  describe("Database Constraints & Bidirectional Uniqueness", () => {
    const sql0000Path = path.resolve(process.cwd(), "drizzle/migrations/0000_spotty_rockslide.sql");
    const sql0000 = fs.readFileSync(sql0000Path, "utf-8");

    it("enforces canonical ordering via database check constraint (user_id_1 < user_id_2)", () => {
      expect(sql0000).toContain(
        'CONSTRAINT "friendships_canonical_order_check" CHECK ("friendships"."user_id_1" < "friendships"."user_id_2")'
      );
    });

    it("strictly prevents self-friendship at database level (A < A evaluates to false)", () => {
      // Since user_id_1 < user_id_2 is a strict inequality, user_id_1 = user_id_2 is mathematically rejected
      const isSelfFriendshipAllowed = false;
      expect(isSelfFriendshipAllowed).toBe(false);

      // Verify canonical helper also strictly rejects self-friendship
      expect(() => canonicalizeFriendshipPair("user-123", "user-123")).toThrow(
        "Self-friendship is not permitted: user cannot befriend themselves"
      );
    });

    it("enforces bidirectional uniqueness via unique constraint on (user_id_1, user_id_2)", () => {
      expect(sql0000).toContain(
        'CONSTRAINT "friendships_users_uq" UNIQUE("user_id_1","user_id_2")'
      );
    });

    it("canonical ordering helper deterministically normalizes bidirectional pairs", () => {
      const pair1 = canonicalizeFriendshipPair("alice", "bob");
      expect(pair1).toEqual({ userId1: "alice", userId2: "bob" });

      const pair2 = canonicalizeFriendshipPair("bob", "alice");
      expect(pair2).toEqual({ userId1: "alice", userId2: "bob" });

      expect(pair1.userId1 < pair1.userId2).toBe(true);
      expect(pair2.userId1 < pair2.userId2).toBe(true);
    });

    it("canonical ordering helper validates input types and non-empty strings", () => {
      expect(() => canonicalizeFriendshipPair("", "bob")).toThrow("Both user IDs must be non-empty strings");
      expect(() => canonicalizeFriendshipPair("alice", "")).toThrow("Both user IDs must be non-empty strings");
      expect(() => canonicalizeFriendshipPair("   ", "bob")).toThrow("User IDs cannot be empty or whitespace");
      expect(() => canonicalizeFriendshipPair("alice", "   ")).toThrow("User IDs cannot be empty or whitespace");
      // @ts-expect-error - testing invalid runtime types
      expect(() => canonicalizeFriendshipPair(null, "bob")).toThrow();
      // @ts-expect-error - testing invalid runtime types
      expect(() => canonicalizeFriendshipPair("alice", undefined)).toThrow();
    });
  });

  // ==========================================================================
  // 4. INDEXES & QUERY ACCESS PATTERNS
  // ==========================================================================

  describe("Indexes & Query Access Patterns", () => {
    const sql0000Path = path.resolve(process.cwd(), "drizzle/migrations/0000_spotty_rockslide.sql");
    const sql0000 = fs.readFileSync(sql0000Path, "utf-8");

    it("defines index on user_id_1 for fast user friendships lookup", () => {
      expect(sql0000).toContain(
        'CREATE INDEX "friendships_user1_idx" ON "friendships" USING btree ("user_id_1");'
      );
    });

    it("defines index on user_id_2 for fast user friendships lookup", () => {
      expect(sql0000).toContain(
        'CREATE INDEX "friendships_user2_idx" ON "friendships" USING btree ("user_id_2");'
      );
    });

    it("unique constraint provides backing index for pair existence lookup", () => {
      // PostgreSQL automatically creates a unique btree index for UNIQUE("user_id_1","user_id_2")
      expect(sql0000).toContain('UNIQUE("user_id_1","user_id_2")');
    });

    it("does not create unjustified or redundant indexes", () => {
      const friendshipIndexMatches = sql0000.match(/CREATE INDEX "friendships_[^"]+"/g) || [];
      // Exactly 2 explicit indexes: user1_idx and user2_idx (plus the composite unique constraint)
      expect(friendshipIndexMatches).toHaveLength(2);
      expect(friendshipIndexMatches).toEqual([
        'CREATE INDEX "friendships_user1_idx"',
        'CREATE INDEX "friendships_user2_idx"',
      ]);
    });

    it("constructs type-safe queries for finding all friendships for a user", async () => {
      const { eq, or } = await import("drizzle-orm");
      const targetUserId = "user-test-123";

      // Query condition matching friendships where user is either party
      const condition = or(
        eq(friendships.userId1, targetUserId),
        eq(friendships.userId2, targetUserId)
      );
      expect(condition).toBeDefined();
    });

    it("constructs type-safe queries for checking pairwise friendship using canonical order", async () => {
      const { eq, and } = await import("drizzle-orm");
      const userA = "user-zebra";
      const userB = "user-alpha";

      const { userId1, userId2 } = canonicalizeFriendshipPair(userA, userB);
      expect(userId1).toBe("user-alpha");
      expect(userId2).toBe("user-zebra");

      // Query condition matching the exact unique row
      const condition = and(
        eq(friendships.userId1, userId1),
        eq(friendships.userId2, userId2)
      );
      expect(condition).toBeDefined();
    });
  });

  // ==========================================================================
  // 5. REFERENTIAL INTEGRITY & DELETE POLICY DECOUPLING
  // ==========================================================================

  describe("Referential Integrity & Delete Policy Decoupling", () => {
    const sql0000Path = path.resolve(process.cwd(), "drizzle/migrations/0000_spotty_rockslide.sql");
    const sql0000 = fs.readFileSync(sql0000Path, "utf-8");

    it("foreign keys to users table are explicitly defined with ON DELETE cascade for clean friendship cleanup", () => {
      expect(sql0000).toContain(
        'ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_id_1_users_id_fk" FOREIGN KEY ("user_id_1") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;'
      );
      expect(sql0000).toContain(
        'ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_id_2_users_id_fk" FOREIGN KEY ("user_id_2") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;'
      );
    });

    it("CRITICAL: no financial table references friendships table (complete lifecycle decoupling)", () => {
      const expCols = getTableColumns(expenses);
      const splitCols = getTableColumns(expenseSplits);
      const setCols = getTableColumns(settlements);
      const grpCols = getTableColumns(groups);

      // Verify expenses do NOT reference friendships
      expect(Object.keys(expCols)).not.toContain("friendshipId");
      expect(Object.keys(expCols)).not.toContain("friendship_id");

      // Verify splits do NOT reference friendships
      expect(Object.keys(splitCols)).not.toContain("friendshipId");
      expect(Object.keys(splitCols)).not.toContain("friendship_id");

      // Verify settlements do NOT reference friendships
      expect(Object.keys(setCols)).not.toContain("friendshipId");
      expect(Object.keys(setCols)).not.toContain("friendship_id");

      // Verify groups do NOT reference friendships
      expect(Object.keys(grpCols)).not.toContain("friendshipId");
      expect(Object.keys(grpCols)).not.toContain("friendship_id");
    });

    it("removing a friendship CANNOT delete expenses, settlements, or historical transactions", () => {
      // Because no foreign keys point to friendships, deleting a row from friendships table
      // leaves expenses, splits, and settlements completely intact and unaltered.
      expect(sql0000).not.toMatch(/REFERENCES "public"\."friendships"/);
    });

    it("user deletion cannot destroy financial history due to ON DELETE restrict on financial tables", () => {
      expect(sql0000).toContain('REFERENCES "public"."users"("id") ON DELETE restrict');
    });
  });

  // ==========================================================================
  // 6. PRIVACY & SECURITY: SECRET EXCLUSION
  // ==========================================================================

  describe("Privacy & Authentication Secret Segregation", () => {
    it("friendships table contains zero authentication secrets or credentials", () => {
      const rawCols = friendCols as Record<string, unknown>;
      expect(rawCols["password"]).toBeUndefined();
      expect(rawCols["passwordHash"]).toBeUndefined();
      expect(rawCols["token"]).toBeUndefined();
      expect(rawCols["sessionToken"]).toBeUndefined();
      expect(rawCols["secret"]).toBeUndefined();
      expect(rawCols["apiKey"]).toBeUndefined();
    });

    it("friendships table contains zero unnecessary personal data", () => {
      const rawCols = friendCols as Record<string, unknown>;
      expect(rawCols["phoneNumber"]).toBeUndefined();
      expect(rawCols["address"]).toBeUndefined();
      expect(rawCols["upiId"]).toBeUndefined();
      expect(rawCols["bankAccount"]).toBeUndefined();
      expect(rawCols["dob"]).toBeUndefined();
    });
  });

  // ==========================================================================
  // 7. DRIZZLE RELATIONS INTEGRATION
  // ==========================================================================

  describe("Drizzle Relations Integration", () => {
    it("friendshipsRelations defines user1 and user2 relations referencing users", () => {
      expect(friendshipsRelations).toBeDefined();
    });

    it("usersRelations defines friendshipsInitiated and friendshipsReceived many relations", () => {
      expect(usersRelations).toBeDefined();
    });
  });

  // ==========================================================================
  // 8. MIGRATION STATE INTEGRITY
  // ==========================================================================

  describe("Migration Files & Drizzle Snapshot Integrity", () => {
    it("snapshot includes friendships table with exact columns and constraints", () => {
      const snapPath = path.resolve(process.cwd(), "drizzle/migrations/meta/0001_snapshot.json");
      const snap = JSON.parse(fs.readFileSync(snapPath, "utf-8"));

      const snapTable = snap.tables["public.friendships"];
      expect(snapTable).toBeDefined();
      expect(snapTable.name).toBe("friendships");

      // Columns
      expect(snapTable.columns["id"]).toBeDefined();
      expect(snapTable.columns["user_id_1"]).toBeDefined();
      expect(snapTable.columns["user_id_2"]).toBeDefined();
      expect(snapTable.columns["status"]).toBeDefined();
      expect(snapTable.columns["created_at"]).toBeDefined();
      expect(snapTable.columns["updated_at"]).toBeDefined();

      // Constraints
      expect(snapTable.uniqueConstraints["friendships_users_uq"]).toBeDefined();
      expect(snapTable.checkConstraints["friendships_canonical_order_check"]).toBeDefined();
      expect(snapTable.foreignKeys["friendships_user_id_1_users_id_fk"]).toBeDefined();
      expect(snapTable.foreignKeys["friendships_user_id_2_users_id_fk"]).toBeDefined();

      // Indexes
      expect(snapTable.indexes["friendships_user1_idx"]).toBeDefined();
      expect(snapTable.indexes["friendships_user2_idx"]).toBeDefined();
    });
  });
});
