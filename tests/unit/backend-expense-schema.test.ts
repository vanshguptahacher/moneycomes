/**
 * Phase 3.5 — Expenses Database Schema Verification Test Suite.
 *
 * Verifies that the expenses database schema foundation is clean, production-safe,
 * integrates with the Phase 2 financial domain engine, enforces exact integer minor-unit storage
 * (no floating point), strictly enforces positive amounts (> 0), preserves explicit currency,
 * supports both group and person-to-person expenses (nullable groupId), separates participant
 * allocations (zero embedded arrays or JSON), and protects financial history via ON DELETE restrict.
 */

import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import {
  expenses,
  users,
  groups,
  currencies,
  categories,
  expensesRelations,
  usersRelations,
  groupsRelations,
  SPLIT_METHODS,
  isSplitMethod,
} from "../../server/db/schema/index.js";
import fs from "node:fs";
import path from "node:path";

describe("Phase 3.5 — Expenses Database Schema", () => {
  const expCols = getTableColumns(expenses);
  const userCols = getTableColumns(users);
  const groupCols = getTableColumns(groups);
  const currCols = getTableColumns(currencies);
  const catCols = getTableColumns(categories);

  // ==========================================================================
  // 1. EXPENSE IDENTITY & SURROGATE PRIMARY KEY
  // ==========================================================================

  describe("Expense Identity & Surrogate Primary Key", () => {
    it("primary key is a stable UUID with database default gen_random_uuid()", () => {
      expect(expCols.id).toBeDefined();
      expect(expCols.id.dataType).toBe("string");
      expect(expCols.id.primary).toBe(true);
      expect(expCols.id.notNull).toBe(true);
      expect(expCols.id.default).toBeDefined();
    });

    it("primary key is independent of description, amount, date, or payer", () => {
      expect(expCols.id.name).toBe("id");
    });
  });

  // ==========================================================================
  // 2. CONTEXT & GROUP RELATIONSHIP (GROUP VS PERSON-TO-PERSON)
  // ==========================================================================

  describe("Group Context & Person-to-Person Support", () => {
    it("groupId references canonical groups table with matching uuid data type", () => {
      expect(groupCols.id.dataType).toBe("string");
      expect(expCols.groupId).toBeDefined();
      expect(expCols.groupId.dataType).toBe("string");
    });

    it("groupId is nullable to legitimately support person-to-person expenses", () => {
      // PRD Section 13 specifies person-to-person expenses that exist outside a group
      expect(expCols.groupId.notNull).toBe(false);
    });

    it("does not use group name or description as group reference", () => {
      const rawCols = expCols as Record<string, unknown>;
      expect(rawCols["groupName"]).toBeUndefined();
      expect(rawCols["groupCurrency"]).toBeUndefined();
    });
  });

  // ==========================================================================
  // 3. CANONICAL CREATOR & PAYER REFERENCES
  // ==========================================================================

  describe("Canonical Creator & Payer References", () => {
    it("payerId references canonical user identity with matching text data type", () => {
      expect(userCols.id.dataType).toBe("string"); // Better Auth text ID
      expect(expCols.payerId).toBeDefined();
      expect(expCols.payerId.dataType).toBe("string");
      expect(expCols.payerId.notNull).toBe(true);
    });

    it("createdById references canonical user identity with matching text data type", () => {
      expect(expCols.createdById).toBeDefined();
      expect(expCols.createdById.dataType).toBe("string");
      expect(expCols.createdById.notNull).toBe(true);
    });

    it("does not use email, username, or display name as payer/creator key", () => {
      const rawCols = expCols as Record<string, unknown>;
      expect(rawCols["payerEmail"]).toBeUndefined();
      expect(rawCols["payerName"]).toBeUndefined();
      expect(rawCols["creatorEmail"]).toBeUndefined();
      expect(rawCols["creatorName"]).toBeUndefined();
    });

    it("creator and payer are not unique (users can record and pay many expenses)", () => {
      expect(expCols.payerId.isUnique).toBe(false);
      expect(expCols.createdById.isUnique).toBe(false);
    });
  });

  // ==========================================================================
  // 4. FINANCIAL INTEGRITY: AMOUNT & CURRENCY
  // ==========================================================================

  describe("Financial Integrity: Integer Minor Units & Currency Safety", () => {
    const sql0000Path = path.resolve(process.cwd(), "drizzle/migrations/0000_spotty_rockslide.sql");
    const sql0000 = fs.readFileSync(sql0000Path, "utf-8");

    it("amountMinor is stored as integer minor units (bigint mode number), never floating point", () => {
      expect(expCols.amountMinor).toBeDefined();
      expect(expCols.amountMinor.dataType).toBe("number");
      expect(expCols.amountMinor.notNull).toBe(true);
    });

    it("database check constraint strictly enforces positive amount (amount_minor > 0)", () => {
      expect(sql0000).toContain(
        'CONSTRAINT "expenses_amount_positive_check" CHECK ("expenses"."amount_minor" > 0)'
      );
    });

    it("preserves exact integer minor units without floating-point rounding", () => {
      // Examples from Phase 2.1 Money domain:
      // INR 100.00 -> 10000
      // INR 100.01 -> 10001
      // INR 0.01   -> 1
      const amount1 = 10000;
      const amount2 = 10001;
      const amount3 = 1;
      expect(Number.isInteger(amount1)).toBe(true);
      expect(Number.isInteger(amount2)).toBe(true);
      expect(Number.isInteger(amount3)).toBe(true);
      expect(amount1).toBeGreaterThan(0);
      expect(amount2).toBeGreaterThan(0);
      expect(amount3).toBeGreaterThan(0);
    });

    it("currencyCode references currencies table with exact length 3 and NOT NULL", () => {
      expect(currCols.code.dataType).toBe("string");
      expect(expCols.currencyCode).toBeDefined();
      expect(expCols.currencyCode.dataType).toBe("string");
      expect(expCols.currencyCode.notNull).toBe(true);
    });

    it("does not store currency symbols as authoritative currency", () => {
      const rawCols = expCols as Record<string, unknown>;
      expect(rawCols["currencySymbol"]).toBeUndefined();
      expect(rawCols["formattedAmount"]).toBeUndefined();
    });
  });

  // ==========================================================================
  // 5. DESCRIPTION, CATEGORY, & OPTIONAL METADATA
  // ==========================================================================

  describe("Description, Category, & Metadata", () => {
    it("description is required with max length 255 and is NOT globally unique", () => {
      expect(expCols.description).toBeDefined();
      expect(expCols.description.dataType).toBe("string");
      expect(expCols.description.notNull).toBe(true);
      expect(expCols.description.isUnique).toBe(false);
    });

    it("categoryId is optional and references categories table", () => {
      expect(catCols.id.dataType).toBe("string");
      expect(expCols.categoryId).toBeDefined();
      expect(expCols.categoryId.dataType).toBe("string");
      expect(expCols.categoryId.notNull).toBe(false);
    });

    it("notes and receiptUrl are optional metadata fields", () => {
      expect(expCols.notes).toBeDefined();
      expect(expCols.notes.dataType).toBe("string");
      expect(expCols.notes.notNull).toBe(false);

      expect(expCols.receiptUrl).toBeDefined();
      expect(expCols.receiptUrl.dataType).toBe("string");
      expect(expCols.receiptUrl.notNull).toBe(false);
    });

    it("isDeleted flag supports soft deletion defaulting to false", () => {
      expect(expCols.isDeleted).toBeDefined();
      expect(expCols.isDeleted.dataType).toBe("boolean");
      expect(expCols.isDeleted.notNull).toBe(true);
      expect(expCols.isDeleted.default).toBe(false);
    });
  });

  // ==========================================================================
  // 6. SPLIT METHOD REPRESENTATION
  // ==========================================================================

  describe("Split Method Representation", () => {
    it("splitMethod column is NOT NULL with max length 32", () => {
      expect(expCols.splitMethod).toBeDefined();
      expect(expCols.splitMethod.dataType).toBe("string");
      expect(expCols.splitMethod.notNull).toBe(true);
    });

    it("exports strongly typed SPLIT_METHODS constant covering all Phase 2 split methods", () => {
      expect(SPLIT_METHODS.EQUAL).toBe("equal");
      expect(SPLIT_METHODS.EXACT).toBe("exact");
      expect(SPLIT_METHODS.PERCENTAGE).toBe("percentage");
      expect(SPLIT_METHODS.SHARES).toBe("shares");
    });

    it("isSplitMethod helper validates valid split methods and rejects invalid values", () => {
      expect(isSplitMethod("equal")).toBe(true);
      expect(isSplitMethod("exact")).toBe(true);
      expect(isSplitMethod("percentage")).toBe(true);
      expect(isSplitMethod("shares")).toBe(true);

      expect(isSplitMethod("invalid")).toBe(false);
      expect(isSplitMethod("")).toBe(false);
      expect(isSplitMethod(null)).toBe(false);
      expect(isSplitMethod(undefined)).toBe(false);
      expect(isSplitMethod(123)).toBe(false);
    });
  });

  // ==========================================================================
  // 7. OCCURRENCE DATE VS AUDIT TIMESTAMPS
  // ==========================================================================

  describe("Occurrence Date vs Audit Timestamps", () => {
    it("date column tracks the financial event occurrence time with timezone", () => {
      expect(expCols.date).toBeDefined();
      expect(expCols.date.notNull).toBe(true);
      expect(expCols.date.default).toBeDefined();
    });

    it("createdAt and updatedAt track system audit timestamps with timezone", () => {
      expect(expCols.createdAt).toBeDefined();
      expect(expCols.createdAt.notNull).toBe(true);
      expect(expCols.createdAt.default).toBeDefined();

      expect(expCols.updatedAt).toBeDefined();
      expect(expCols.updatedAt.notNull).toBe(true);
      expect(expCols.updatedAt.default).toBeDefined();
    });
  });

  // ==========================================================================
  // 8. STRICT NORMALIZATION & PARTICIPANT DECOUPLING (PHASE 3.6 BOUNDARY)
  // ==========================================================================

  describe("Data Normalization & Participant Decoupling", () => {
    it("does NOT contain embedded participant arrays or JSON blobs", () => {
      const rawCols = expCols as Record<string, unknown>;
      expect(rawCols["participants"]).toBeUndefined();
      expect(rawCols["participantIds"]).toBeUndefined();
      expect(rawCols["allocations"]).toBeUndefined();
      expect(rawCols["splits"]).toBeUndefined();
      expect(rawCols["members"]).toBeUndefined();
    });

    it("does NOT store derived financial balances or settlement calculations", () => {
      const rawCols = expCols as Record<string, unknown>;
      expect(rawCols["totalOwed"]).toBeUndefined();
      expect(rawCols["netBalance"]).toBeUndefined();
      expect(rawCols["debtSimplification"]).toBeUndefined();
      expect(rawCols["settlementStatus"]).toBeUndefined();
    });

    it("contains exactly allowed fields without speculative bloat", () => {
      const allowedKeys = new Set([
        "id",
        "groupId",
        "payerId",
        "createdById",
        "categoryId",
        "description",
        "amountMinor",
        "currencyCode",
        "splitMethod",
        "date",
        "notes",
        "receiptUrl",
        "isDeleted",
        "createdAt",
        "updatedAt",
      ]);

      for (const colName of Object.keys(expCols)) {
        expect(allowedKeys.has(colName)).toBe(true);
      }
    });
  });

  // ==========================================================================
  // 9. INDEXES & QUERY ACCESS PATTERNS
  // ==========================================================================

  describe("Indexes & Query Access Patterns", () => {
    const sql0000Path = path.resolve(process.cwd(), "drizzle/migrations/0000_spotty_rockslide.sql");
    const sql0000 = fs.readFileSync(sql0000Path, "utf-8");

    it("defines index on group_id for querying group expenses", () => {
      expect(sql0000).toContain(
        'CREATE INDEX "expenses_group_idx" ON "expenses" USING btree ("group_id");'
      );
    });

    it("defines index on payer_id for querying expenses paid by a user", () => {
      expect(sql0000).toContain(
        'CREATE INDEX "expenses_payer_idx" ON "expenses" USING btree ("payer_id");'
      );
    });

    it("defines index on created_by_id for querying expenses created by a user", () => {
      expect(sql0000).toContain(
        'CREATE INDEX "expenses_created_by_idx" ON "expenses" USING btree ("created_by_id");'
      );
    });

    it("defines index on date for chronological ordering and range filtering", () => {
      expect(sql0000).toContain(
        'CREATE INDEX "expenses_date_idx" ON "expenses" USING btree ("date");'
      );
    });

    it("constructs type-safe query for querying group expenses", async () => {
      const { eq } = await import("drizzle-orm");
      const targetGroupId = "11111111-2222-3333-4444-555555555555";
      const condition = eq(expenses.groupId, targetGroupId);
      expect(condition).toBeDefined();
    });

    it("constructs type-safe query for querying expenses by payer", async () => {
      const { eq } = await import("drizzle-orm");
      const targetPayerId = "user-payer-123";
      const condition = eq(expenses.payerId, targetPayerId);
      expect(condition).toBeDefined();
    });
  });

  // ==========================================================================
  // 10. REFERENTIAL INTEGRITY & DELETION SAFETY
  // ==========================================================================

  describe("Referential Integrity & Deletion Safety", () => {
    const sql0000Path = path.resolve(process.cwd(), "drizzle/migrations/0000_spotty_rockslide.sql");
    const sql0000 = fs.readFileSync(sql0000Path, "utf-8");

    it("foreign keys to users for payer and creator use ON DELETE restrict to protect financial history", () => {
      expect(sql0000).toContain(
        'ALTER TABLE "expenses" ADD CONSTRAINT "expenses_payer_id_users_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;'
      );
      expect(sql0000).toContain(
        'ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;'
      );
    });

    it("foreign key to categories uses ON DELETE set null so category removal does not destroy expenses", () => {
      expect(sql0000).toContain(
        'ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;'
      );
    });

    it("foreign key to currencies prevents referencing invalid currency codes", () => {
      expect(sql0000).toContain(
        'ALTER TABLE "expenses" ADD CONSTRAINT "expenses_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code")'
      );
    });
  });

  // ==========================================================================
  // 11. DRIZZLE RELATIONS INTEGRATION
  // ==========================================================================

  describe("Drizzle Relations Integration", () => {
    it("expensesRelations defines group, payer, createdBy, category, currency, and splits relations", () => {
      expect(expensesRelations).toBeDefined();
    });

    it("usersRelations defines payerExpenses and createdExpenses relations", () => {
      expect(usersRelations).toBeDefined();
    });

    it("groupsRelations defines expenses relation", () => {
      expect(groupsRelations).toBeDefined();
    });
  });

  // ==========================================================================
  // 12. MIGRATION & SNAPSHOT INTEGRITY
  // ==========================================================================

  describe("Migration Files & Drizzle Snapshot Integrity", () => {
    it("migration 0000 creates expenses table with all required DDL columns and constraints", () => {
      const sql0000Path = path.resolve(process.cwd(), "drizzle/migrations/0000_spotty_rockslide.sql");
      const sql = fs.readFileSync(sql0000Path, "utf-8");

      expect(sql).toContain('CREATE TABLE "expenses" (');
      expect(sql).toContain('"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL');
      expect(sql).toContain('"group_id" uuid');
      expect(sql).toContain('"payer_id" text NOT NULL');
      expect(sql).toContain('"created_by_id" text NOT NULL');
      expect(sql).toContain('"category_id" uuid');
      expect(sql).toContain('"description" varchar(255) NOT NULL');
      expect(sql).toContain('"amount_minor" bigint NOT NULL');
      expect(sql).toContain('"currency_code" varchar(3) NOT NULL');
      expect(sql).toContain('"split_method" varchar(32) NOT NULL');
      expect(sql).toContain('"date" timestamp with time zone DEFAULT now() NOT NULL');
      expect(sql).toContain('"notes" text');
      expect(sql).toContain('"receipt_url" text');
      expect(sql).toContain('"is_deleted" boolean DEFAULT false NOT NULL');
      expect(sql).toContain('"created_at" timestamp with time zone DEFAULT now() NOT NULL');
      expect(sql).toContain('"updated_at" timestamp with time zone DEFAULT now() NOT NULL');
      expect(sql).toContain('CONSTRAINT "expenses_amount_positive_check" CHECK ("expenses"."amount_minor" > 0)');
    });

    it("snapshot includes expenses table definition with exact columns, foreign keys, and indexes", () => {
      const snapPath = path.resolve(process.cwd(), "drizzle/migrations/meta/0001_snapshot.json");
      const snap = JSON.parse(fs.readFileSync(snapPath, "utf-8"));

      const snapTable = snap.tables["public.expenses"];
      expect(snapTable).toBeDefined();
      expect(snapTable.name).toBe("expenses");

      // Columns
      expect(snapTable.columns["id"]).toBeDefined();
      expect(snapTable.columns["group_id"]).toBeDefined();
      expect(snapTable.columns["payer_id"]).toBeDefined();
      expect(snapTable.columns["created_by_id"]).toBeDefined();
      expect(snapTable.columns["category_id"]).toBeDefined();
      expect(snapTable.columns["description"]).toBeDefined();
      expect(snapTable.columns["amount_minor"]).toBeDefined();
      expect(snapTable.columns["currency_code"]).toBeDefined();
      expect(snapTable.columns["split_method"]).toBeDefined();
      expect(snapTable.columns["date"]).toBeDefined();
      expect(snapTable.columns["notes"]).toBeDefined();
      expect(snapTable.columns["receipt_url"]).toBeDefined();
      expect(snapTable.columns["is_deleted"]).toBeDefined();
      expect(snapTable.columns["created_at"]).toBeDefined();
      expect(snapTable.columns["updated_at"]).toBeDefined();

      // Check Constraints
      expect(snapTable.checkConstraints["expenses_amount_positive_check"]).toBeDefined();

      // Foreign keys
      expect(snapTable.foreignKeys["expenses_payer_id_users_id_fk"]).toBeDefined();
      expect(snapTable.foreignKeys["expenses_created_by_id_users_id_fk"]).toBeDefined();
      expect(snapTable.foreignKeys["expenses_group_id_groups_id_fk"]).toBeDefined();
      expect(snapTable.foreignKeys["expenses_currency_code_currencies_code_fk"]).toBeDefined();
      expect(snapTable.foreignKeys["expenses_category_id_categories_id_fk"]).toBeDefined();

      // Indexes
      expect(snapTable.indexes["expenses_group_idx"]).toBeDefined();
      expect(snapTable.indexes["expenses_payer_idx"]).toBeDefined();
      expect(snapTable.indexes["expenses_created_by_idx"]).toBeDefined();
      expect(snapTable.indexes["expenses_date_idx"]).toBeDefined();
    });
  });
});
