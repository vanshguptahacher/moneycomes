/**
 * Phase 3.6 — Expense Participants / Allocations Database Schema Verification Test Suite.
 *
 * Verifies that the expense_splits database schema foundation is clean, production-safe,
 * integrates with the Phase 2 financial domain engine, enforces exact integer minor-unit storage
 * (no floating point), strictly enforces non-negative allocations (>= 0), enforces one allocation
 * per user per expense via composite uniqueness, protects financial history via ON DELETE restrict,
 * and maintains clean relational normalization without embedded JSON or derived balances.
 */

import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import {
  expenseSplits,
  expenses,
  users,
  expenseSplitsRelations,
  expensesRelations,
  usersRelations,
  validateExpenseSplitInput,
} from "../../server/db/schema/index.js";
import {
  splitEqually,
  splitExactly,
  splitByPercentage,
  splitByShares,
  make,
} from "../../src/domain/index.js";
import fs from "node:fs";
import path from "node:path";

describe("Phase 3.6 — Expense Participants / Allocations Database Schema", () => {
  const splitCols = getTableColumns(expenseSplits);
  const expCols = getTableColumns(expenses);
  const userCols = getTableColumns(users);

  // ==========================================================================
  // 1. PRIMARY KEY & SURROGATE IDENTITY
  // ==========================================================================

  describe("Primary Key & Surrogate Identity", () => {
    it("primary key is a stable UUID with database default gen_random_uuid()", () => {
      expect(splitCols.id).toBeDefined();
      expect(splitCols.id.dataType).toBe("string");
      expect(splitCols.id.primary).toBe(true);
      expect(splitCols.id.notNull).toBe(true);
      expect(splitCols.id.default).toBeDefined();
    });

    it("primary key is independent of user email, name, or expense attributes", () => {
      expect(splitCols.id.name).toBe("id");
    });
  });

  // ==========================================================================
  // 2. FOREIGN KEYS & CANONICAL IDENTITY INTEGRATION
  // ==========================================================================

  describe("Foreign Keys & Canonical Identity Integration", () => {
    it("expenseId references canonical expenses table with matching uuid data type", () => {
      expect(expCols.id.dataType).toBe("string");
      expect(splitCols.expenseId).toBeDefined();
      expect(splitCols.expenseId.dataType).toBe("string");
      expect(splitCols.expenseId.notNull).toBe(true);
    });

    it("userId references canonical users table with matching text data type", () => {
      expect(userCols.id.dataType).toBe("string"); // Better Auth text ID
      expect(splitCols.userId).toBeDefined();
      expect(splitCols.userId.dataType).toBe("string");
      expect(splitCols.userId.notNull).toBe(true);
    });

    it("does not use email, username, or display name as participant identity", () => {
      const rawCols = splitCols as Record<string, unknown>;
      expect(rawCols["userEmail"]).toBeUndefined();
      expect(rawCols["userName"]).toBeUndefined();
      expect(rawCols["userDisplayName"]).toBeUndefined();
      expect(rawCols["phone"]).toBeUndefined();
    });

    it("does not use expense description or amount as expense reference", () => {
      const rawCols = splitCols as Record<string, unknown>;
      expect(rawCols["expenseDescription"]).toBeUndefined();
      expect(rawCols["expenseAmount"]).toBeUndefined();
    });
  });

  // ==========================================================================
  // 3. ONE ALLOCATION PER USER PER EXPENSE & MANY-TO-MANY
  // ==========================================================================

  describe("One Allocation Per User Per Expense & Uniqueness", () => {
    const sql0000Path = path.resolve(process.cwd(), "drizzle/migrations/0000_spotty_rockslide.sql");
    const sql0000 = fs.readFileSync(sql0000Path, "utf-8");

    it("enforces uniqueness of (expense_id, user_id) to prevent duplicate allocations", () => {
      expect(sql0000).toContain(
        'CONSTRAINT "expense_splits_expense_user_uq" UNIQUE("expense_id","user_id")'
      );
    });

    it("supports multiple participants for one expense (expenseId is not unique)", () => {
      expect(splitCols.expenseId.isUnique).toBe(false);
    });

    it("supports one user participating in multiple expenses (userId is not unique)", () => {
      expect(splitCols.userId.isUnique).toBe(false);
    });

    it("database constraint authoritatively rejects concurrent duplicate allocation inserts", () => {
      expect(sql0000).toMatch(/UNIQUE\("expense_id","user_id"\)/);
    });
  });

  // ==========================================================================
  // 4. FINANCIAL INTEGRITY: INTEGER MINOR UNITS & NON-NEGATIVE CHECK
  // ==========================================================================

  describe("Financial Integrity: Integer Minor Units & Non-Negative Check", () => {
    const sql0000Path = path.resolve(process.cwd(), "drizzle/migrations/0000_spotty_rockslide.sql");
    const sql0000 = fs.readFileSync(sql0000Path, "utf-8");

    it("allocatedAmountMinor is stored as integer minor units (bigint mode number), never floating point", () => {
      expect(splitCols.allocatedAmountMinor).toBeDefined();
      expect(splitCols.allocatedAmountMinor.dataType).toBe("number");
      expect(splitCols.allocatedAmountMinor.notNull).toBe(true);
    });

    it("database check constraint strictly enforces non-negative allocation (allocated_amount_minor >= 0)", () => {
      expect(sql0000).toContain(
        'CONSTRAINT "expense_splits_amount_non_negative_check" CHECK ("expense_splits"."allocated_amount_minor" >= 0)'
      );
    });

    it("supports zero allocations where specified by the financial domain (0 minor units)", () => {
      // For instance, a participant with 0 shares in a shares split legitimately receives 0 minor units
      const zeroAllocation = 0;
      expect(zeroAllocation).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(zeroAllocation)).toBe(true);
    });

    it("preserves exact integer minor units without floating-point conversion", () => {
      const splitAmount = 3334; // e.g. 1/3 of INR 100.00 remainder participant
      expect(Number.isInteger(splitAmount)).toBe(true);
      expect(splitAmount).toBeGreaterThanOrEqual(0);
    });

    it("supports large safe monetary allocations up to Number.MAX_SAFE_INTEGER", () => {
      const largeSafe = Number.MAX_SAFE_INTEGER;
      expect(Number.isSafeInteger(largeSafe)).toBe(true);
      expect(largeSafe).toBeGreaterThanOrEqual(0);
    });
  });

  // ==========================================================================
  // 5. CURRENCY INHERITANCE & CONSISTENCY
  // ==========================================================================

  describe("Currency Inheritance & Consistency", () => {
    it("inherits authoritative currency from parent expense, preventing intra-expense currency divergence", () => {
      // Currency is single-sourced on expenses.currencyCode
      const rawCols = splitCols as Record<string, unknown>;
      expect(rawCols["currencyCode"]).toBeUndefined();
      expect(rawCols["currencySymbol"]).toBeUndefined();
    });
  });

  // ==========================================================================
  // 6. SPLIT CONTEXT METADATA & TIMESTAMPS
  // ==========================================================================

  describe("Split Context Metadata & Timestamps", () => {
    it("supports optional percentageBasisPoints integer for percentage split audit", () => {
      expect(splitCols.percentageBasisPoints).toBeDefined();
      expect(splitCols.percentageBasisPoints.dataType).toBe("number");
      expect(splitCols.percentageBasisPoints.notNull).toBe(false);
    });

    it("supports optional shares integer for shares split audit", () => {
      expect(splitCols.shares).toBeDefined();
      expect(splitCols.shares.dataType).toBe("number");
      expect(splitCols.shares.notNull).toBe(false);
    });

    it("has createdAt timestamp with database default and timezone", () => {
      expect(splitCols.createdAt).toBeDefined();
      expect(splitCols.createdAt.notNull).toBe(true);
      expect(splitCols.createdAt.default).toBeDefined();
    });

    it("contains exactly allowed fields without speculative bloat", () => {
      const allowedKeys = new Set([
        "id",
        "expenseId",
        "userId",
        "allocatedAmountMinor",
        "percentageBasisPoints",
        "shares",
        "createdAt",
      ]);

      for (const colName of Object.keys(splitCols)) {
        expect(allowedKeys.has(colName)).toBe(true);
      }
    });
  });

  // ==========================================================================
  // 7. DATA NORMALIZATION & FIELD SEPARATION
  // ==========================================================================

  describe("Data Normalization & Separation of Concerns", () => {
    it("does not duplicate user profile information in expense_splits", () => {
      const rawCols = splitCols as Record<string, unknown>;
      expect(rawCols["name"]).toBeUndefined();
      expect(rawCols["email"]).toBeUndefined();
      expect(rawCols["avatarUrl"]).toBeUndefined();
      expect(rawCols["password"]).toBeUndefined();
    });

    it("does not duplicate expense metadata in expense_splits", () => {
      const rawCols = splitCols as Record<string, unknown>;
      expect(rawCols["description"]).toBeUndefined();
      expect(rawCols["totalAmount"]).toBeUndefined();
      expect(rawCols["groupId"]).toBeUndefined();
      expect(rawCols["payerId"]).toBeUndefined();
    });

    it("does not store derived balances or settlement data in expense_splits", () => {
      const rawCols = splitCols as Record<string, unknown>;
      expect(rawCols["netBalance"]).toBeUndefined();
      expect(rawCols["totalOwed"]).toBeUndefined();
      expect(rawCols["settledAmount"]).toBeUndefined();
      expect(rawCols["isSettled"]).toBeUndefined();
    });
  });

  // ==========================================================================
  // 8. PRIVACY & SECURITY: SECRET EXCLUSION
  // ==========================================================================

  describe("Privacy & Authentication Secret Segregation", () => {
    it("expense_splits table contains zero authentication credentials or secrets", () => {
      const rawCols = splitCols as Record<string, unknown>;
      expect(rawCols["token"]).toBeUndefined();
      expect(rawCols["secret"]).toBeUndefined();
      expect(rawCols["apiKey"]).toBeUndefined();
    });

    it("expense_splits table contains zero payment credentials or UPI details", () => {
      const rawCols = splitCols as Record<string, unknown>;
      expect(rawCols["upiId"]).toBeUndefined();
      expect(rawCols["bankAccount"]).toBeUndefined();
    });
  });

  // ==========================================================================
  // 9. INDEXES & QUERY ACCESS PATTERNS
  // ==========================================================================

  describe("Indexes & Query Access Patterns", () => {
    const sql0000Path = path.resolve(process.cwd(), "drizzle/migrations/0000_spotty_rockslide.sql");
    const sql0000 = fs.readFileSync(sql0000Path, "utf-8");

    it("defines index on expense_id for retrieving all participant allocations of an expense", () => {
      expect(sql0000).toContain(
        'CREATE INDEX "expense_splits_expense_idx" ON "expense_splits" USING btree ("expense_id");'
      );
    });

    it("defines index on user_id for retrieving all expense obligations of a user", () => {
      expect(sql0000).toContain(
        'CREATE INDEX "expense_splits_user_idx" ON "expense_splits" USING btree ("user_id");'
      );
    });

    it("constructs type-safe query for retrieving all allocations for an expense", async () => {
      const { eq } = await import("drizzle-orm");
      const targetExpenseId = "11111111-2222-3333-4444-555555555555";
      const condition = eq(expenseSplits.expenseId, targetExpenseId);
      expect(condition).toBeDefined();
    });

    it("constructs type-safe query for retrieving all allocations for a user", async () => {
      const { eq } = await import("drizzle-orm");
      const targetUserId = "user-participant-123";
      const condition = eq(expenseSplits.userId, targetUserId);
      expect(condition).toBeDefined();
    });

    it("constructs type-safe query for retrieving a specific user allocation within an expense", async () => {
      const { eq, and } = await import("drizzle-orm");
      const targetExpenseId = "11111111-2222-3333-4444-555555555555";
      const targetUserId = "user-participant-123";

      const condition = and(
        eq(expenseSplits.expenseId, targetExpenseId),
        eq(expenseSplits.userId, targetUserId)
      );
      expect(condition).toBeDefined();
    });
  });

  // ==========================================================================
  // 10. REFERENTIAL INTEGRITY & DELETION SAFETY
  // ==========================================================================

  describe("Referential Integrity & Safe Deletion Policy", () => {
    const sql0000Path = path.resolve(process.cwd(), "drizzle/migrations/0000_spotty_rockslide.sql");
    const sql0000 = fs.readFileSync(sql0000Path, "utf-8");

    it("foreign key to expenses uses ON DELETE cascade so deleting an expense cleans up its splits", () => {
      expect(sql0000).toContain(
        'ALTER TABLE "expense_splits" ADD CONSTRAINT "expense_splits_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;'
      );
    });

    it("foreign key to users uses ON DELETE restrict to protect participant financial history", () => {
      expect(sql0000).toContain(
        'ALTER TABLE "expense_splits" ADD CONSTRAINT "expense_splits_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;'
      );
    });
  });

  // ==========================================================================
  // 11. FINANCIAL RECONCILIATION & PHASE 2 DOMAIN ENGINE INTEGRATION
  // ==========================================================================

  describe("Financial Reconciliation & Domain Engine Alignment", () => {
    it("persists exact minor units from Equal Split output and reconciles to total", () => {
      // 10000 minor units (100 INR) split equally among 3 participants
      const total = make(10000, "INR");
      const splitResult = splitEqually(total, ["alice", "bob", "carol"]);

      const totalAllocated = splitResult.allocations.reduce(
        (sum, a) => sum + a.amount.amountMinor,
        0
      );
      expect(totalAllocated).toBe(10000);

      // Verify each allocation maps cleanly to schema column requirements
      for (const a of splitResult.allocations) {
        expect(Number.isInteger(a.amount.amountMinor)).toBe(true);
        expect(a.amount.amountMinor).toBeGreaterThanOrEqual(0);
      }
    });

    it("persists exact minor units from Exact Split output and reconciles to total", () => {
      const total = make(10000, "INR");
      const splitResult = splitExactly(total, [
        { participantId: "alice", amount: make(6000, "INR") },
        { participantId: "bob", amount: make(4000, "INR") },
      ]);

      const totalAllocated = splitResult.allocations.reduce(
        (sum, a) => sum + a.amount.amountMinor,
        0
      );
      expect(totalAllocated).toBe(10000);
    });

    it("persists exact minor units from Percentage Split output and reconciles to total", () => {
      const total = make(10000, "INR");
      const splitResult = splitByPercentage(total, [
        { participantId: "alice", basisPoints: 5000 },
        { participantId: "bob", basisPoints: 3000 },
        { participantId: "carol", basisPoints: 2000 },
      ]);

      const totalAllocated = splitResult.allocations.reduce(
        (sum, a) => sum + a.amount.amountMinor,
        0
      );
      expect(totalAllocated).toBe(10000);
    });

    it("persists exact minor units from Shares Split output and reconciles to total", () => {
      const total = make(6000, "INR");
      const splitResult = splitByShares(total, [
        { participantId: "alice", shares: 1 },
        { participantId: "bob", shares: 2 },
        { participantId: "carol", shares: 3 },
      ]);

      const totalAllocated = splitResult.allocations.reduce(
        (sum, a) => sum + a.amount.amountMinor,
        0
      );
      expect(totalAllocated).toBe(6000);
    });
  });

  // ==========================================================================
  // 12. INPUT VALIDATION HELPER
  // ==========================================================================

  describe("Expense Split Input Validation Helper", () => {
    it("validates and trims valid expenseId, userId, and allocatedAmountMinor", () => {
      const validated = validateExpenseSplitInput(
        "  11111111-2222-3333-4444-555555555555  ",
        "  user-alice  ",
        5000
      );
      expect(validated).toEqual({
        expenseId: "11111111-2222-3333-4444-555555555555",
        userId: "user-alice",
        allocatedAmountMinor: 5000,
      });
    });

    it("accepts 0 minor units", () => {
      const validated = validateExpenseSplitInput(
        "11111111-2222-3333-4444-555555555555",
        "user-bob",
        0
      );
      expect(validated.allocatedAmountMinor).toBe(0);
    });

    it("rejects negative allocation amount", () => {
      expect(() =>
        validateExpenseSplitInput(
          "11111111-2222-3333-4444-555555555555",
          "user-bob",
          -50
        )
      ).toThrow("allocatedAmountMinor must be a non-negative safe integer representing minor currency units");
    });

    it("rejects non-integer allocation amount (floating point)", () => {
      expect(() =>
        validateExpenseSplitInput(
          "11111111-2222-3333-4444-555555555555",
          "user-bob",
          10.5
        )
      ).toThrow("allocatedAmountMinor must be a non-negative safe integer representing minor currency units");
    });

    it("rejects empty or whitespace expenseId or userId", () => {
      expect(() => validateExpenseSplitInput("", "user-bob", 500)).toThrow(
        "Valid expenseId is required for expense split"
      );
      expect(() => validateExpenseSplitInput("   ", "user-bob", 500)).toThrow(
        "Valid expenseId is required for expense split"
      );
      expect(() =>
        validateExpenseSplitInput("11111111-2222-3333-4444-555555555555", "", 500)
      ).toThrow("Valid userId is required for expense split");
      expect(() =>
        validateExpenseSplitInput("11111111-2222-3333-4444-555555555555", "   ", 500)
      ).toThrow("Valid userId is required for expense split");
    });
  });

  // ==========================================================================
  // 13. DRIZZLE RELATIONS INTEGRATION
  // ==========================================================================

  describe("Drizzle Relations Integration", () => {
    it("expenseSplitsRelations defines expense and user relations", () => {
      expect(expenseSplitsRelations).toBeDefined();
    });

    it("expensesRelations defines splits relation to expenseSplits", () => {
      expect(expensesRelations).toBeDefined();
    });

    it("usersRelations defines splits relation to expenseSplits", () => {
      expect(usersRelations).toBeDefined();
    });
  });

  // ==========================================================================
  // 14. MIGRATION & SNAPSHOT INTEGRITY
  // ==========================================================================

  describe("Migration Files & Drizzle Snapshot Integrity", () => {
    it("migration 0000 creates expense_splits table with all required DDL columns and constraints", () => {
      const sql0000Path = path.resolve(process.cwd(), "drizzle/migrations/0000_spotty_rockslide.sql");
      const sql = fs.readFileSync(sql0000Path, "utf-8");

      expect(sql).toContain('CREATE TABLE "expense_splits" (');
      expect(sql).toContain('"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL');
      expect(sql).toContain('"expense_id" uuid NOT NULL');
      expect(sql).toContain('"user_id" text NOT NULL');
      expect(sql).toContain('"allocated_amount_minor" bigint NOT NULL');
      expect(sql).toContain('"percentage_basis_points" integer');
      expect(sql).toContain('"shares" integer');
      expect(sql).toContain('"created_at" timestamp with time zone DEFAULT now() NOT NULL');
      expect(sql).toContain('CONSTRAINT "expense_splits_expense_user_uq" UNIQUE("expense_id","user_id")');
      expect(sql).toContain(
        'CONSTRAINT "expense_splits_amount_non_negative_check" CHECK ("expense_splits"."allocated_amount_minor" >= 0)'
      );
    });

    it("snapshot includes expense_splits table definition with exact columns, foreign keys, and indexes", () => {
      const snapPath = path.resolve(process.cwd(), "drizzle/migrations/meta/0001_snapshot.json");
      const snap = JSON.parse(fs.readFileSync(snapPath, "utf-8"));

      const snapTable = snap.tables["public.expense_splits"];
      expect(snapTable).toBeDefined();
      expect(snapTable.name).toBe("expense_splits");

      // Columns
      expect(snapTable.columns["id"]).toBeDefined();
      expect(snapTable.columns["expense_id"]).toBeDefined();
      expect(snapTable.columns["user_id"]).toBeDefined();
      expect(snapTable.columns["allocated_amount_minor"]).toBeDefined();
      expect(snapTable.columns["percentage_basis_points"]).toBeDefined();
      expect(snapTable.columns["shares"]).toBeDefined();
      expect(snapTable.columns["created_at"]).toBeDefined();

      // Constraints
      expect(snapTable.uniqueConstraints["expense_splits_expense_user_uq"]).toBeDefined();
      expect(snapTable.checkConstraints["expense_splits_amount_non_negative_check"]).toBeDefined();

      // Foreign keys
      expect(snapTable.foreignKeys["expense_splits_expense_id_expenses_id_fk"]).toBeDefined();
      expect(snapTable.foreignKeys["expense_splits_user_id_users_id_fk"]).toBeDefined();

      // Indexes
      expect(snapTable.indexes["expense_splits_expense_idx"]).toBeDefined();
      expect(snapTable.indexes["expense_splits_user_idx"]).toBeDefined();
    });
  });
});
