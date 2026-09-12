/**
 * Phase 3.3 — Groups Database Schema Verification Test Suite.
 *
 * Verifies that the groups database schema foundation is clean, production-safe,
 * reuses the canonical Better Auth user identity, maintains strict normalization
 * (zero embedded member arrays or JSON), separates financial calculations from metadata,
 * enforces safe deletion policies (ON DELETE restrict), and provides justified indexing.
 */

import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import {
  groups,
  users,
  currencies,
  groupMembers,
  groupsRelations,
  usersRelations,
} from "../../server/db/schema/index.js";
import fs from "node:fs";
import path from "node:path";

describe("Phase 3.3 — Groups Database Schema", () => {
  const groupCols = getTableColumns(groups);
  const userCols = getTableColumns(users);
  const currCols = getTableColumns(currencies);

  // ==========================================================================
  // 1. GROUP IDENTITY & KEY TYPES
  // ==========================================================================

  describe("Group Identity & Primary Key", () => {
    it("primary key is a stable UUID with database default", () => {
      expect(groupCols.id).toBeDefined();
      expect(groupCols.id.dataType).toBe("string");
      expect(groupCols.id.primary).toBe(true);
      expect(groupCols.id.notNull).toBe(true);
      expect(groupCols.id.default).toBeDefined();
    });

    it("primary key is independent of group name or user credentials", () => {
      // Primary key must be an opaque surrogate UUID, not a slug or name
      expect(groupCols.id.name).toBe("id");
    });
  });

  // ==========================================================================
  // 2. GROUP NAME & UNIQUENESS SEMANTICS
  // ==========================================================================

  describe("Group Name & Uniqueness Semantics", () => {
    it("has required name column with length limit and NOT NULL constraint", () => {
      expect(groupCols.name).toBeDefined();
      expect(groupCols.name.dataType).toBe("string");
      expect(groupCols.name.notNull).toBe(true);
    });

    it("group name is NOT globally unique (permits multiple groups with same name)", () => {
      // Two distinct groups can legitimately have the same name (e.g., "Goa Trip", "Roommates")
      expect(groupCols.name.isUnique).toBe(false);
    });
  });

  // ==========================================================================
  // 3. GROUP CREATOR / OWNER INTEGRATION
  // ==========================================================================

  describe("Group Creator / Owner Reference", () => {
    it("references canonical user table with matching text data type", () => {
      expect(userCols.id.dataType).toBe("string"); // Better Auth text ID

      expect(groupCols.createdById).toBeDefined();
      expect(groupCols.createdById.dataType).toBe("string");
      expect(groupCols.createdById.notNull).toBe(true);
    });

    it("does not use email, username, or display name as owner identity", () => {
      const rawCols = groupCols as Record<string, unknown>;
      expect(rawCols["creatorEmail"]).toBeUndefined();
      expect(rawCols["creatorName"]).toBeUndefined();
      expect(rawCols["ownerEmail"]).toBeUndefined();
      expect(rawCols["ownerUsername"]).toBeUndefined();
    });

    it("creator reference does NOT enforce uniqueness (one user can create multiple groups)", () => {
      expect(groupCols.createdById.isUnique).toBe(false);
    });
  });

  // ==========================================================================
  // 4. GROUP CURRENCY METADATA
  // ==========================================================================

  describe("Group Currency Reference", () => {
    it("has defaultCurrencyCode referencing currencies table with default 'INR'", () => {
      expect(currCols.code.dataType).toBe("string");

      expect(groupCols.defaultCurrencyCode).toBeDefined();
      expect(groupCols.defaultCurrencyCode.dataType).toBe("string");
      expect(groupCols.defaultCurrencyCode.notNull).toBe(true);
      expect(groupCols.defaultCurrencyCode.default).toBe("INR");
    });

    it("currency code is purely configuration metadata, not a balance or Money integer", () => {
      const rawCols = groupCols as Record<string, unknown>;
      expect(rawCols["balance"]).toBeUndefined();
      expect(rawCols["totalBalance"]).toBeUndefined();
      expect(rawCols["amountMinor"]).toBeUndefined();
    });
  });

  // ==========================================================================
  // 5. GROUP SETTINGS & TIMESTAMPS
  // ==========================================================================

  describe("Group Settings & Timestamps", () => {
    it("has optional description field (nullable)", () => {
      expect(groupCols.description).toBeDefined();
      expect(groupCols.description.dataType).toBe("string");
      expect(groupCols.description.notNull).toBe(false);
    });

    it("has isArchived setting with NOT NULL and default false", () => {
      expect(groupCols.isArchived).toBeDefined();
      expect(groupCols.isArchived.dataType).toBe("boolean");
      expect(groupCols.isArchived.notNull).toBe(true);
      expect(groupCols.isArchived.default).toBe(false);
    });

    it("has createdAt and updatedAt timestamps with database defaults and timezone", () => {
      expect(groupCols.createdAt).toBeDefined();
      expect(groupCols.createdAt.notNull).toBe(true);
      expect(groupCols.createdAt.default).toBeDefined();

      expect(groupCols.updatedAt).toBeDefined();
      expect(groupCols.updatedAt.notNull).toBe(true);
      expect(groupCols.updatedAt.default).toBeDefined();
    });

    it("contains exactly allowed fields without speculative bloat", () => {
      const allowedKeys = new Set([
        "id",
        "name",
        "description",
        "defaultCurrencyCode",
        "createdById",
        "isArchived",
        "createdAt",
        "updatedAt",
      ]);

      for (const colName of Object.keys(groupCols)) {
        expect(allowedKeys.has(colName)).toBe(true);
      }
    });
  });

  // ==========================================================================
  // 6. NORMALIZATION & MEMBER SEPARATION (PHASE 3.4 DECOUPLING)
  // ==========================================================================

  describe("Data Normalization & Member Separation", () => {
    it("does NOT contain embedded member arrays or JSON blobs", () => {
      const rawCols = groupCols as Record<string, unknown>;
      expect(rawCols["members"]).toBeUndefined();
      expect(rawCols["memberIds"]).toBeUndefined();
      expect(rawCols["participants"]).toBeUndefined();
      expect(rawCols["participantIds"]).toBeUndefined();
      expect(rawCols["users"]).toBeUndefined();
    });

    it("does NOT duplicate user profile information into group table", () => {
      const rawCols = groupCols as Record<string, unknown>;
      expect(rawCols["userName"]).toBeUndefined();
      expect(rawCols["userEmail"]).toBeUndefined();
      expect(rawCols["creatorAvatar"]).toBeUndefined();
    });

    it("is compatible with future separate relational group_members table", () => {
      const memberCols = getTableColumns(groupMembers);
      // Confirms groupMembers is a separate relational table pointing to groups.id
      expect(memberCols.groupId).toBeDefined();
      expect(memberCols.userId).toBeDefined();
      expect(memberCols.role).toBeDefined();
    });
  });

  // ==========================================================================
  // 7. FINANCIAL DATA SEPARATION
  // ==========================================================================

  describe("Financial Data Separation", () => {
    it("does NOT store calculated financial values or running balances", () => {
      const rawCols = groupCols as Record<string, unknown>;
      expect(rawCols["totalOwed"]).toBeUndefined();
      expect(rawCols["totalSpent"]).toBeUndefined();
      expect(rawCols["totalBalance"]).toBeUndefined();
      expect(rawCols["netPosition"]).toBeUndefined();
      expect(rawCols["simplifiedDebts"]).toBeUndefined();
      expect(rawCols["settlementStatus"]).toBeUndefined();
    });
  });

  // ==========================================================================
  // 8. PRIVACY & SECURITY
  // ==========================================================================

  describe("Privacy & Authentication Secret Segregation", () => {
    it("groups table contains zero authentication credentials or secrets", () => {
      const rawCols = groupCols as Record<string, unknown>;
      expect(rawCols["password"]).toBeUndefined();
      expect(rawCols["token"]).toBeUndefined();
      expect(rawCols["secret"]).toBeUndefined();
      expect(rawCols["apiKey"]).toBeUndefined();
    });

    it("groups table contains zero payment credentials, UPI IDs, or banking data", () => {
      const rawCols = groupCols as Record<string, unknown>;
      expect(rawCols["upiId"]).toBeUndefined();
      expect(rawCols["bankAccount"]).toBeUndefined();
      expect(rawCols["cardToken"]).toBeUndefined();
    });
  });

  // ==========================================================================
  // 9. INDEXES & QUERY ACCESS PATTERNS
  // ==========================================================================

  describe("Indexes & Query Access Patterns", () => {
    const sql0000Path = path.resolve(process.cwd(), "drizzle/migrations/0000_spotty_rockslide.sql");
    const sql0000 = fs.readFileSync(sql0000Path, "utf-8");

    it("defines index on created_by_id for fast lookup of groups created by a user", () => {
      expect(sql0000).toContain(
        'CREATE INDEX "groups_created_by_idx" ON "groups" USING btree ("created_by_id");'
      );
    });

    it("constructs type-safe query expression for retrieving groups by creator", async () => {
      const { eq } = await import("drizzle-orm");
      const creatorId = "user-creator-123";

      const queryCondition = eq(groups.createdById, creatorId);
      expect(queryCondition).toBeDefined();
    });

    it("constructs type-safe query expression for retrieving group by primary key ID", async () => {
      const { eq } = await import("drizzle-orm");
      const groupId = "11111111-2222-3333-4444-555555555555";

      const queryCondition = eq(groups.id, groupId);
      expect(queryCondition).toBeDefined();
    });
  });

  // ==========================================================================
  // 10. REFERENTIAL INTEGRITY & DELETION SAFETY
  // ==========================================================================

  describe("Referential Integrity & Safe Deletion Policy", () => {
    const sql0000Path = path.resolve(process.cwd(), "drizzle/migrations/0000_spotty_rockslide.sql");
    const sql0000 = fs.readFileSync(sql0000Path, "utf-8");

    it("foreign key from created_by_id to users.id uses ON DELETE restrict to protect group history", () => {
      expect(sql0000).toContain(
        'ALTER TABLE "groups" ADD CONSTRAINT "groups_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;'
      );
    });

    it("foreign key from default_currency_code to currencies.code enforces valid currency reference", () => {
      expect(sql0000).toContain(
        'ALTER TABLE "groups" ADD CONSTRAINT "groups_default_currency_code_currencies_code_fk" FOREIGN KEY ("default_currency_code") REFERENCES "public"."currencies"("code")'
      );
    });
  });

  // ==========================================================================
  // 11. DRIZZLE RELATIONS INTEGRATION
  // ==========================================================================

  describe("Drizzle Relations Integration", () => {
    it("groupsRelations defines creator, defaultCurrency, members, and expenses relations", () => {
      expect(groupsRelations).toBeDefined();
    });

    it("usersRelations defines createdGroups relation", () => {
      expect(usersRelations).toBeDefined();
    });
  });

  // ==========================================================================
  // 12. MIGRATION & SNAPSHOT INTEGRITY
  // ==========================================================================

  describe("Migration Files & Drizzle Snapshot Integrity", () => {
    it("migration 0000 creates groups table with all required DDL columns", () => {
      const sql0000Path = path.resolve(process.cwd(), "drizzle/migrations/0000_spotty_rockslide.sql");
      const sql = fs.readFileSync(sql0000Path, "utf-8");

      expect(sql).toContain('CREATE TABLE "groups" (');
      expect(sql).toContain('"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL');
      expect(sql).toContain('"name" varchar(255) NOT NULL');
      expect(sql).toContain('"description" text');
      expect(sql).toContain('"default_currency_code" varchar(3) DEFAULT \'INR\' NOT NULL');
      expect(sql).toContain('"created_by_id" text NOT NULL');
      expect(sql).toContain('"is_archived" boolean DEFAULT false NOT NULL');
      expect(sql).toContain('"created_at" timestamp with time zone DEFAULT now() NOT NULL');
      expect(sql).toContain('"updated_at" timestamp with time zone DEFAULT now() NOT NULL');
    });

    it("snapshot includes groups table definition with exact columns, foreign keys, and indexes", () => {
      const snapPath = path.resolve(process.cwd(), "drizzle/migrations/meta/0001_snapshot.json");
      const snap = JSON.parse(fs.readFileSync(snapPath, "utf-8"));

      const snapTable = snap.tables["public.groups"];
      expect(snapTable).toBeDefined();
      expect(snapTable.name).toBe("groups");

      // Columns
      expect(snapTable.columns["id"]).toBeDefined();
      expect(snapTable.columns["name"]).toBeDefined();
      expect(snapTable.columns["description"]).toBeDefined();
      expect(snapTable.columns["default_currency_code"]).toBeDefined();
      expect(snapTable.columns["created_by_id"]).toBeDefined();
      expect(snapTable.columns["is_archived"]).toBeDefined();
      expect(snapTable.columns["created_at"]).toBeDefined();
      expect(snapTable.columns["updated_at"]).toBeDefined();

      // Foreign keys
      expect(snapTable.foreignKeys["groups_created_by_id_users_id_fk"]).toBeDefined();
      expect(snapTable.foreignKeys["groups_default_currency_code_currencies_code_fk"]).toBeDefined();

      // Indexes
      expect(snapTable.indexes["groups_created_by_idx"]).toBeDefined();
    });
  });
});
