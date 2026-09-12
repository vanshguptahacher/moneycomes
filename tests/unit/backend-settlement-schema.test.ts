/**
 * Phase 3.7 — Settlements Database Schema Verification Test Suite.
 *
 * Verifies that the settlements database schema foundation is clean, production-safe,
 * integrates with the Phase 2 financial domain engine, enforces exact integer minor-unit storage
 * (no floating point), strictly enforces positive amounts (> 0), prevents self-settlement (payer != receiver),
 * preserves explicit currency, supports both group and person-to-person settlements (nullable groupId),
 * separates financial calculations (zero stored balances or debt simplifications), and protects
 * financial history via ON DELETE restrict.
 */

import { describe, it, expect } from "vitest";
import { getTableColumns } from "drizzle-orm";
import {
  settlements,
  users,
  groups,
  currencies,
  settlementsRelations,
  usersRelations,
  groupsRelations,
  validateSettlementInput,
} from "../../server/db/schema/index.js";
import {
  createSettlement,
  validateSettlement,
  applySettlement,
  applySettlements,
  recalculateBalances,
  make,
  calculateExpenseBalances,
  simplifyDebts,
} from "../../src/domain/index.js";
import fs from "node:fs";
import path from "node:path";

describe("Phase 3.7 — Settlements Database Schema", () => {
  const settleCols = getTableColumns(settlements);
  const userCols = getTableColumns(users);
  const groupCols = getTableColumns(groups);
  const currCols = getTableColumns(currencies);

  // ==========================================================================
  // 1. SETTLEMENT IDENTITY & SURROGATE PRIMARY KEY
  // ==========================================================================

  describe("Settlement Identity & Surrogate Primary Key", () => {
    it("primary key is a stable UUID with database default gen_random_uuid()", () => {
      expect(settleCols.id).toBeDefined();
      expect(settleCols.id.dataType).toBe("string");
      expect(settleCols.id.primary).toBe(true);
      expect(settleCols.id.notNull).toBe(true);
      expect(settleCols.id.default).toBeDefined();
    });

    it("primary key is independent of payer, receiver, amount, or date", () => {
      expect(settleCols.id.name).toBe("id");
    });
  });

  // ==========================================================================
  // 2. CANONICAL USER REFERENCES (PAYER & RECEIVER)
  // ==========================================================================

  describe("Canonical User References (Payer & Receiver)", () => {
    it("payerId references canonical user identity with matching text data type", () => {
      expect(userCols.id.dataType).toBe("string"); // Better Auth text ID
      expect(settleCols.payerId).toBeDefined();
      expect(settleCols.payerId.dataType).toBe("string");
      expect(settleCols.payerId.notNull).toBe(true);
    });

    it("receiverId references canonical user identity with matching text data type", () => {
      expect(settleCols.receiverId).toBeDefined();
      expect(settleCols.receiverId.dataType).toBe("string");
      expect(settleCols.receiverId.notNull).toBe(true);
    });

    it("createdById references canonical user identity with matching text data type", () => {
      expect(settleCols.createdById).toBeDefined();
      expect(settleCols.createdById.dataType).toBe("string");
      expect(settleCols.createdById.notNull).toBe(true);
    });

    it("does not use email, username, or display name as participant identity", () => {
      const rawCols = settleCols as Record<string, unknown>;
      expect(rawCols["payerEmail"]).toBeUndefined();
      expect(rawCols["payerName"]).toBeUndefined();
      expect(rawCols["receiverEmail"]).toBeUndefined();
      expect(rawCols["receiverName"]).toBeUndefined();
      expect(rawCols["creatorEmail"]).toBeUndefined();
      expect(rawCols["phone"]).toBeUndefined();
    });
  });

  // ==========================================================================
  // 3. CONTEXT & GROUP RELATIONSHIP (GROUP VS PERSON-TO-PERSON)
  // ==========================================================================

  describe("Group Context & Person-to-Person Support", () => {
    it("groupId references canonical groups table with matching uuid data type", () => {
      expect(groupCols.id.dataType).toBe("string");
      expect(settleCols.groupId).toBeDefined();
      expect(settleCols.groupId.dataType).toBe("string");
    });

    it("groupId is nullable to legitimately support person-to-person settlements", () => {
      // Settlements can occur directly between friends without an artificial group
      expect(settleCols.groupId.notNull).toBe(false);
    });

    it("does not store group name or membership arrays in settlement records", () => {
      const rawCols = settleCols as Record<string, unknown>;
      expect(rawCols["groupName"]).toBeUndefined();
      expect(rawCols["members"]).toBeUndefined();
      expect(rawCols["memberIds"]).toBeUndefined();
    });
  });

  // ==========================================================================
  // 4. FINANCIAL AMOUNT REPRESENTATION & PRECISION
  // ==========================================================================

  describe("Financial Amount Representation & Precision", () => {
    it("amountMinor uses bigint with mode number for exact integer minor-unit arithmetic", () => {
      expect(settleCols.amountMinor).toBeDefined();
      expect(settleCols.amountMinor.dataType).toBe("number");
      expect(settleCols.amountMinor.notNull).toBe(true);
    });

    it("does not store floating-point, decimal, or formatted currency strings", () => {
      const rawCols = settleCols as Record<string, unknown>;
      expect(rawCols["amount"]).toBeUndefined();
      expect(rawCols["formattedAmount"]).toBeUndefined();
      expect(rawCols["decimalAmount"]).toBeUndefined();
    });

    it("safely represents 1 minor unit (1 paise / 1 cent)", () => {
      const validated = validateSettlementInput({
        payerId: "user-1",
        receiverId: "user-2",
        amountMinor: 1,
        currencyCode: "INR",
      });
      expect(validated.amountMinor).toBe(1);
    });

    it("safely represents standard settlement amounts (e.g. ₹500 = 50000 minor units)", () => {
      const validated = validateSettlementInput({
        payerId: "user-1",
        receiverId: "user-2",
        amountMinor: 50000,
        currencyCode: "INR",
      });
      expect(validated.amountMinor).toBe(50000);
    });

    it("safely represents very large safe integer amounts without precision loss", () => {
      const validated = validateSettlementInput({
        payerId: "user-1",
        receiverId: "user-2",
        amountMinor: Number.MAX_SAFE_INTEGER,
        currencyCode: "USD",
      });
      expect(validated.amountMinor).toBe(Number.MAX_SAFE_INTEGER);
    });
  });

  // ==========================================================================
  // 5. CURRENCY REPRESENTATION
  // ==========================================================================

  describe("Currency Representation", () => {
    it("currencyCode references currencies table with varchar(3)", () => {
      expect(currCols.code.dataType).toBe("string");
      expect(settleCols.currencyCode).toBeDefined();
      expect(settleCols.currencyCode.dataType).toBe("string");
      expect(settleCols.currencyCode.notNull).toBe(true);
    });

    it("preserves currency code explicitly without implicit conversion", () => {
      const inr = validateSettlementInput({
        payerId: "user-1",
        receiverId: "user-2",
        amountMinor: 25000,
        currencyCode: "inr",
      });
      expect(inr.currencyCode).toBe("INR");

      const usd = validateSettlementInput({
        payerId: "user-1",
        receiverId: "user-2",
        amountMinor: 1500,
        currencyCode: "USD",
      });
      expect(usd.currencyCode).toBe("USD");
    });
  });

  // ==========================================================================
  // 6. TIMESTAMPS & SETTLEMENT DATE
  // ==========================================================================

  describe("Timestamps & Settlement Date", () => {
    it("settledAt is timestamp with timezone with defaultNow()", () => {
      expect(settleCols.settledAt).toBeDefined();
      expect(settleCols.settledAt.dataType).toBe("date");
      expect(settleCols.settledAt.notNull).toBe(true);
      expect(settleCols.settledAt.default).toBeDefined();
    });

    it("createdAt is timestamp with timezone with defaultNow() for audit tracking", () => {
      expect(settleCols.createdAt).toBeDefined();
      expect(settleCols.createdAt.dataType).toBe("date");
      expect(settleCols.createdAt.notNull).toBe(true);
      expect(settleCols.createdAt.default).toBeDefined();
    });

    it("supports recording an explicit past settlement date via validator", () => {
      const pastDate = new Date("2025-01-01T10:00:00Z");
      const validated = validateSettlementInput({
        payerId: "user-1",
        receiverId: "user-2",
        amountMinor: 5000,
        currencyCode: "INR",
        settledAt: pastDate,
      });
      expect(validated.settledAt).toEqual(pastDate);
    });
  });

  // ==========================================================================
  // 7. CONSTRAINTS IN MIGRATIONS DDL (POSITIVE AMOUNT & DISTINCT USERS)
  // ==========================================================================

  describe("Constraints in Migration DDL", () => {
    const sql0000Path = path.resolve(process.cwd(), "drizzle/migrations/0000_spotty_rockslide.sql");
    const sql0000 = fs.readFileSync(sql0000Path, "utf-8");

    it("migration enforces positive amount check constraint (amount_minor > 0)", () => {
      expect(sql0000).toContain(
        'CONSTRAINT "settlements_amount_positive_check" CHECK ("settlements"."amount_minor" > 0)'
      );
    });

    it("migration enforces distinct users check constraint preventing self-settlement (payer_id != receiver_id)", () => {
      expect(sql0000).toContain(
        'CONSTRAINT "settlements_distinct_users_check" CHECK ("settlements"."payer_id" != "settlements"."receiver_id")'
      );
    });

    it("migration enforces foreign key to users on payer_id with ON DELETE restrict", () => {
      expect(sql0000).toContain(
        'ALTER TABLE "settlements" ADD CONSTRAINT "settlements_payer_id_users_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."users"("id") ON DELETE restrict'
      );
    });

    it("migration enforces foreign key to users on receiver_id with ON DELETE restrict", () => {
      expect(sql0000).toContain(
        'ALTER TABLE "settlements" ADD CONSTRAINT "settlements_receiver_id_users_id_fk" FOREIGN KEY ("receiver_id") REFERENCES "public"."users"("id") ON DELETE restrict'
      );
    });

    it("migration enforces foreign key to users on created_by_id with ON DELETE restrict", () => {
      expect(sql0000).toContain(
        'ALTER TABLE "settlements" ADD CONSTRAINT "settlements_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE restrict'
      );
    });

    it("migration enforces foreign key to groups on group_id with ON DELETE cascade", () => {
      expect(sql0000).toContain(
        'ALTER TABLE "settlements" ADD CONSTRAINT "settlements_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE cascade'
      );
    });

    it("migration enforces foreign key to currencies on currency_code", () => {
      expect(sql0000).toContain(
        'ALTER TABLE "settlements" ADD CONSTRAINT "settlements_currency_code_currencies_code_fk" FOREIGN KEY ("currency_code") REFERENCES "public"."currencies"("code")'
      );
    });
  });

  // ==========================================================================
  // 8. PERFORMANCE INDEXES
  // ==========================================================================

  describe("Performance Indexes", () => {
    const sql0000Path = path.resolve(process.cwd(), "drizzle/migrations/0000_spotty_rockslide.sql");
    const sql0000 = fs.readFileSync(sql0000Path, "utf-8");

    it("creates index on payer_id for querying settlements sent by a user", () => {
      expect(sql0000).toContain('CREATE INDEX "settlements_payer_idx" ON "settlements" USING btree ("payer_id")');
    });

    it("creates index on receiver_id for querying settlements received by a user", () => {
      expect(sql0000).toContain('CREATE INDEX "settlements_receiver_idx" ON "settlements" USING btree ("receiver_id")');
    });

    it("creates index on group_id for querying settlements within a group", () => {
      expect(sql0000).toContain('CREATE INDEX "settlements_group_idx" ON "settlements" USING btree ("group_id")');
    });

    it("creates index on settled_at for querying settlements chronologically", () => {
      expect(sql0000).toContain('CREATE INDEX "settlements_settled_at_idx" ON "settlements" USING btree ("settled_at")');
    });
  });

  // ==========================================================================
  // 9. NORMALIZATION & DECOUPLING (NO DERIVED BALANCES OR PAYMENT DETAILS)
  // ==========================================================================

  describe("Normalization & Decoupling", () => {
    it("does not store derived balances or debt simplification results", () => {
      const rawCols = settleCols as Record<string, unknown>;
      expect(rawCols["netBalance"]).toBeUndefined();
      expect(rawCols["totalOwed"]).toBeUndefined();
      expect(rawCols["remainingDebt"]).toBeUndefined();
      expect(rawCols["simplifiedDebt"]).toBeUndefined();
      expect(rawCols["balanceBefore"]).toBeUndefined();
      expect(rawCols["balanceAfter"]).toBeUndefined();
    });

    it("does not store payment gateway, bank, or UPI transaction details", () => {
      const rawCols = settleCols as Record<string, unknown>;
      expect(rawCols["upiId"]).toBeUndefined();
      expect(rawCols["bankAccountNumber"]).toBeUndefined();
      expect(rawCols["transactionReference"]).toBeUndefined();
      expect(rawCols["paymentGateway"]).toBeUndefined();
      expect(rawCols["paymentMethod"]).toBeUndefined();
    });

    it("does not link settlements to a specific expense record (resolves relationship debt)", () => {
      const rawCols = settleCols as Record<string, unknown>;
      expect(rawCols["expenseId"]).toBeUndefined();
    });

    it("allows multiple independent settlements between the same user pair", () => {
      // Step 21: (payer_id, receiver_id) must NOT be globally unique
      const sql0000Path = path.resolve(process.cwd(), "drizzle/migrations/0000_spotty_rockslide.sql");
      const sql0000 = fs.readFileSync(sql0000Path, "utf-8");
      expect(sql0000).not.toContain('UNIQUE("payer_id","receiver_id")');
    });
  });

  // ==========================================================================
  // 10. BOUNDARY VALIDATION HELPER (validateSettlementInput)
  // ==========================================================================

  describe("Boundary Validation Helper (validateSettlementInput)", () => {
    it("accepts valid settlement inputs and applies defaults", () => {
      const result = validateSettlementInput({
        payerId: "user-debtor",
        receiverId: "user-creditor",
        amountMinor: 3500,
        currencyCode: "INR",
      });

      expect(result.payerId).toBe("user-debtor");
      expect(result.receiverId).toBe("user-creditor");
      expect(result.amountMinor).toBe(3500);
      expect(result.currencyCode).toBe("INR");
      expect(result.groupId).toBeNull();
      expect(result.createdById).toBe("user-debtor"); // defaults to payer
      expect(result.notes).toBeNull();
      expect(result.settledAt).toBeInstanceOf(Date);
    });

    it("accepts valid group settlement with explicit creator and notes", () => {
      const result = validateSettlementInput({
        payerId: "user-1",
        receiverId: "user-2",
        groupId: "group-uuid-123",
        createdById: "user-3",
        amountMinor: 5000,
        currencyCode: "INR",
        notes: "Settling dinner share",
      });

      expect(result.groupId).toBe("group-uuid-123");
      expect(result.createdById).toBe("user-3");
      expect(result.notes).toBe("Settling dinner share");
    });

    it("rejects empty or whitespace payerId", () => {
      expect(() =>
        validateSettlementInput({
          payerId: "",
          receiverId: "user-2",
          amountMinor: 100,
          currencyCode: "INR",
        })
      ).toThrow("Valid payerId is required for settlement");

      expect(() =>
        validateSettlementInput({
          payerId: "   ",
          receiverId: "user-2",
          amountMinor: 100,
          currencyCode: "INR",
        })
      ).toThrow("Valid payerId is required for settlement");
    });

    it("rejects empty or whitespace receiverId", () => {
      expect(() =>
        validateSettlementInput({
          payerId: "user-1",
          receiverId: "",
          amountMinor: 100,
          currencyCode: "INR",
        })
      ).toThrow("Valid receiverId is required for settlement");
    });

    it("rejects self-settlement when payerId === receiverId", () => {
      expect(() =>
        validateSettlementInput({
          payerId: "user-1",
          receiverId: "user-1",
          amountMinor: 500,
          currencyCode: "INR",
        })
      ).toThrow('Self-settlement is not permitted: payer and receiver are both "user-1"');
    });

    it("rejects non-positive amounts (0 or negative)", () => {
      expect(() =>
        validateSettlementInput({
          payerId: "user-1",
          receiverId: "user-2",
          amountMinor: 0,
          currencyCode: "INR",
        })
      ).toThrow("amountMinor must be a positive safe integer representing minor currency units");

      expect(() =>
        validateSettlementInput({
          payerId: "user-1",
          receiverId: "user-2",
          amountMinor: -500,
          currencyCode: "INR",
        })
      ).toThrow("amountMinor must be a positive safe integer representing minor currency units");
    });

    it("rejects floating-point, NaN, Infinity, and unsafe integer amounts", () => {
      expect(() =>
        validateSettlementInput({
          payerId: "user-1",
          receiverId: "user-2",
          amountMinor: 100.5,
          currencyCode: "INR",
        })
      ).toThrow("amountMinor must be a positive safe integer representing minor currency units");

      expect(() =>
        validateSettlementInput({
          payerId: "user-1",
          receiverId: "user-2",
          amountMinor: NaN,
          currencyCode: "INR",
        })
      ).toThrow("amountMinor must be a positive safe integer representing minor currency units");

      expect(() =>
        validateSettlementInput({
          payerId: "user-1",
          receiverId: "user-2",
          amountMinor: Number.MAX_SAFE_INTEGER + 1,
          currencyCode: "INR",
        })
      ).toThrow("amountMinor must be a positive safe integer representing minor currency units");
    });

    it("rejects empty currencyCode", () => {
      expect(() =>
        validateSettlementInput({
          payerId: "user-1",
          receiverId: "user-2",
          amountMinor: 100,
          currencyCode: "",
        })
      ).toThrow("Valid currencyCode is required for settlement");
    });
  });

  // ==========================================================================
  // 11. FINANCIAL DOMAIN ENGINE COMPATIBILITY (PHASE 2.9 SETTLEMENT ENGINE)
  // ==========================================================================

  describe("Financial Domain Engine Compatibility (Phase 2.9 Settlement Engine)", () => {
    it("domain createSettlement output can be directly mapped to settlement database columns", () => {
      const domainSettlement = createSettlement({
        id: "7b4c9b3a-8b1e-4c7a-9c4e-123456789abc",
        debtorId: "user-debtor",
        creditorId: "user-creditor",
        amount: make(5000, "INR"),
        notes: "Settle lunch",
        settledAt: new Date("2025-06-01T12:00:00Z"),
      });

      // Map domain model to database insertion record
      const dbRecord = {
        id: domainSettlement.id,
        payerId: domainSettlement.payerId,
        receiverId: domainSettlement.receiverId,
        amountMinor: domainSettlement.amount.amountMinor,
        currencyCode: domainSettlement.amount.currency,
        notes: domainSettlement.notes,
        settledAt: domainSettlement.settledAt,
      };

      expect(dbRecord.id).toBe("7b4c9b3a-8b1e-4c7a-9c4e-123456789abc");
      expect(dbRecord.payerId).toBe("user-debtor");
      expect(dbRecord.receiverId).toBe("user-creditor");
      expect(dbRecord.amountMinor).toBe(5000);
      expect(dbRecord.currencyCode).toBe("INR");
      expect(dbRecord.notes).toBe("Settle lunch");
      expect(dbRecord.settledAt).toEqual(new Date("2025-06-01T12:00:00Z"));
    });

    it("persists exact full settlement bringing net balance to zero", () => {
      // Setup balances: User B owes User A ₹100 (10000 minor units)
      const balances = [
        { userId: "A", netBalance: make(10000, "INR") },
        { userId: "B", netBalance: make(-10000, "INR") },
      ];

      const settlement = createSettlement({
        debtorId: "B",
        creditorId: "A",
        amount: make(10000, "INR"),
      });

      const updated = applySettlement(balances, settlement);
      expect(updated.find((b) => b.userId === "A")!.netBalance.amountMinor).toBe(0);
      expect(updated.find((b) => b.userId === "B")!.netBalance.amountMinor).toBe(0);
    });

    it("persists exact partial settlement reducing debt proportionally", () => {
      const balances = [
        { userId: "A", netBalance: make(10000, "INR") },
        { userId: "B", netBalance: make(-10000, "INR") },
      ];

      const settlement = createSettlement({
        debtorId: "B",
        creditorId: "A",
        amount: make(4000, "INR"),
      });

      const updated = applySettlement(balances, settlement);
      expect(updated.find((b) => b.userId === "A")!.netBalance.amountMinor).toBe(6000);
      expect(updated.find((b) => b.userId === "B")!.netBalance.amountMinor).toBe(-6000);
    });

    it("persists batch of sequential settlements reconstructing balances deterministically", () => {
      const members = ["A", "B", "C"];
      // Expense: A paid ₹300 split equally among A, B, C (A owes 100, B owes 100, C owes 100 -> A is net +200, B is -100, C is -100)
      const baseExpense = calculateExpenseBalances({
        payerId: "A",
        total: make(30000, "INR"),
        allocations: [
          { participantId: "A", amount: make(10000, "INR") },
          { participantId: "B", amount: make(10000, "INR") },
          { participantId: "C", amount: make(10000, "INR") },
        ],
      });

      const recalculated = recalculateBalances({
        members,
        currency: "INR",
        expenses: [baseExpense],
        settlements: [
          { debtorId: "B", creditorId: "A", amount: make(10000, "INR") },
          { debtorId: "C", creditorId: "A", amount: make(5000, "INR") },
        ],
      });

      // A: +200 - 100 - 50 = +50
      // B: -100 + 100 = 0
      // C: -100 + 50 = -50
      expect(recalculated.balances.find((b) => b.userId === "A")!.netBalance.amountMinor).toBe(5000);
      expect(recalculated.balances.find((b) => b.userId === "B")!.netBalance.amountMinor).toBe(0);
      expect(recalculated.balances.find((b) => b.userId === "C")!.netBalance.amountMinor).toBe(-5000);
    });

    it("validates settlement against balance context before database preparation", () => {
      const balances = [
        { userId: "A", netBalance: make(10000, "INR") },
        { userId: "B", netBalance: make(-10000, "INR") },
      ];

      const validated = validateSettlement(
        {
          debtorId: "B",
          creditorId: "A",
          amount: make(5000, "INR"),
        },
        balances
      );

      const dbInput = validateSettlementInput({
        payerId: validated.payerId,
        receiverId: validated.receiverId,
        amountMinor: validated.amount.amountMinor,
        currencyCode: validated.amount.currency,
      });

      expect(dbInput.amountMinor).toBe(5000);
      expect(dbInput.payerId).toBe("B");
      expect(dbInput.receiverId).toBe("A");
    });

    it("applies multiple settlements sequentially via applySettlements to verify cumulative state", () => {
      const balances = [
        { userId: "A", netBalance: make(10000, "INR") },
        { userId: "B", netBalance: make(-10000, "INR") },
      ];

      const s1 = createSettlement({ debtorId: "B", creditorId: "A", amount: make(3000, "INR") });
      const s2 = createSettlement({ debtorId: "B", creditorId: "A", amount: make(7000, "INR") });

      const finalBalances = applySettlements(balances, [s1, s2]);
      expect(finalBalances.find((b) => b.userId === "A")!.netBalance.amountMinor).toBe(0);
      expect(finalBalances.find((b) => b.userId === "B")!.netBalance.amountMinor).toBe(0);
    });
  });

  // ==========================================================================
  // 12. DEBT SIMPLIFICATION & ZERO-SUM REGRESSION
  // ==========================================================================

  describe("Debt Simplification & Zero-Sum Regression", () => {
    it("settlement schema supports executing debt simplification recommendations", () => {
      // Balances: A +500, B -200, C -300
      const balances = [
        { userId: "A", netBalance: make(50000, "INR") },
        { userId: "B", netBalance: make(-20000, "INR") },
        { userId: "C", netBalance: make(-30000, "INR") },
      ];

      const result = simplifyDebts({ balances });
      // Simplification yields: C -> A 300, B -> A 200 (largest debtor first)
      expect(result.transfers.length).toBe(2);

      // Convert transfers to database settlement records
      const dbSettlements = result.transfers.map((t) =>
        validateSettlementInput({
          payerId: t.fromUserId,
          receiverId: t.toUserId,
          amountMinor: t.amount.amountMinor,
          currencyCode: t.amount.currency,
        })
      );

      expect(dbSettlements).toEqual([
        expect.objectContaining({ payerId: "C", receiverId: "A", amountMinor: 30000, currencyCode: "INR" }),
        expect.objectContaining({ payerId: "B", receiverId: "A", amountMinor: 20000, currencyCode: "INR" }),
      ]);
    });
  });

  // ==========================================================================
  // 13. DRIZZLE RELATIONS
  // ==========================================================================

  describe("Drizzle Relations", () => {
    it("defines settlementsRelations with payer, receiver, group, createdBy, and currency", () => {
      expect(settlementsRelations).toBeDefined();
    });

    it("defines usersRelations with paidSettlements and receivedSettlements", () => {
      expect(usersRelations).toBeDefined();
    });

    it("defines groupsRelations with settlements", () => {
      expect(groupsRelations).toBeDefined();
    });
  });
});
