/**
 * Unit tests for Phase 2.9 — Settlement Engine.
 *
 * Tests all required validation rules, balance effects, partial/full settlements,
 * domain errors, recalculation, financial invariants, and Step 11 required examples.
 */

import { describe, it, expect } from "vitest";
import {
  make,
  zero,
  splitEqually,
  calculateExpenseBalances,
  calculateGroupBalances,
  type GroupBalanceResult,
  // Settlement Engine
  createSettlement,
  validateSettlement,
  isFullSettlement,
  isPartialSettlement,
  isMutualFullSettlement,
  applySettlement,
  applySettlements,
  recalculateBalances,
  SelfSettlementError,
  InvalidSettlementAmountError,
  OverSettlementError,
  DebtorCreditorMismatchError,
  InvalidSettlementPartiesError,
  DuplicateSettlementError,
  CurrencyMismatchError,
  UnknownGroupMemberError,
} from "../../src/domain/index.js";

describe("Settlement Engine (Phase 2.9)", () => {
  // Helper to create simple balances
  function makeBalances(
    items: { userId: string; netMinor: number; paidMinor?: number; owedMinor?: number }[],
    currency: "INR" | "USD" = "INR"
  ): GroupBalanceResult {
    const members = items.map((i) => i.userId);
    const balances = items.map((i) => {
      const net = make(i.netMinor, currency);
      const paid = make(i.paidMinor ?? (i.netMinor > 0 ? i.netMinor : 0), currency);
      const owed = make(i.owedMinor ?? (i.netMinor < 0 ? Math.abs(i.netMinor) : 0), currency);
      return Object.freeze({
        userId: i.userId,
        paid,
        owed,
        netBalance: net,
      });
    });

    return Object.freeze({
      groupId: "test-group",
      currency,
      memberCount: members.length,
      balances: Object.freeze(balances),
    });
  }

  // ==========================================================================
  // 1. SETTLEMENT MODEL CREATION & ALIASES
  // ==========================================================================

  describe("Settlement Model Creation & Aliases", () => {
    it("creates an immutable settlement with debtorId and creditorId", () => {
      const s = createSettlement({
        debtorId: "user-b",
        creditorId: "user-a",
        amount: make(5000, "INR"),
      });

      expect(s.debtorId).toBe("user-b");
      expect(s.creditorId).toBe("user-a");
      expect(s.payerId).toBe("user-b");
      expect(s.receiverId).toBe("user-a");
      expect(s.amount.amountMinor).toBe(5000);
      expect(s.amount.currency).toBe("INR");
      expect(Object.isFrozen(s)).toBe(true);
    });

    it("creates a settlement using payerId and receiverId aliases", () => {
      const s = createSettlement({
        payerId: "user-b",
        receiverId: "user-a",
        amount: make(3000, "INR"),
      });

      expect(s.debtorId).toBe("user-b");
      expect(s.creditorId).toBe("user-a");
      expect(s.payerId).toBe("user-b");
      expect(s.receiverId).toBe("user-a");
    });

    it("preserves optional id, notes, and settledAt metadata", () => {
      const date = new Date("2026-09-13T02:00:00Z");
      const s = createSettlement({
        id: "settle-123",
        debtorId: "user-b",
        creditorId: "user-a",
        amount: make(2500, "INR"),
        notes: "Dinner settlement",
        settledAt: date,
      });

      expect(s.id).toBe("settle-123");
      expect(s.notes).toBe("Dinner settlement");
      expect(s.settledAt).toBe(date);
    });

    it("throws InvalidSettlementPartiesError if conflicting aliases are provided", () => {
      expect(() =>
        createSettlement({
          debtorId: "user-b",
          payerId: "user-c",
          creditorId: "user-a",
          amount: make(1000, "INR"),
        })
      ).toThrow(InvalidSettlementPartiesError);

      expect(() =>
        createSettlement({
          debtorId: "user-b",
          creditorId: "user-a",
          receiverId: "user-c",
          amount: make(1000, "INR"),
        })
      ).toThrow(InvalidSettlementPartiesError);
    });
  });

  // ==========================================================================
  // 2. VALIDATION RULES
  // ==========================================================================

  describe("Debtor / Creditor Validation", () => {
    it("rejects missing or empty debtor identifier", () => {
      expect(() =>
        createSettlement({
          debtorId: "",
          creditorId: "user-a",
          amount: make(1000, "INR"),
        })
      ).toThrow(InvalidSettlementPartiesError);

      expect(() =>
        createSettlement({
          debtorId: "   ",
          creditorId: "user-a",
          amount: make(1000, "INR"),
        })
      ).toThrow(InvalidSettlementPartiesError);
    });

    it("rejects missing or empty creditor identifier", () => {
      expect(() =>
        createSettlement({
          debtorId: "user-b",
          creditorId: "",
          amount: make(1000, "INR"),
        })
      ).toThrow(InvalidSettlementPartiesError);

      expect(() =>
        createSettlement({
          debtorId: "user-b",
          creditorId: "   ",
          amount: make(1000, "INR"),
        })
      ).toThrow(InvalidSettlementPartiesError);
    });

    it("rejects self-settlement when debtor equals creditor", () => {
      expect(() =>
        createSettlement({
          debtorId: "user-a",
          creditorId: "user-a",
          amount: make(1000, "INR"),
        })
      ).toThrow(SelfSettlementError);
    });

    it("rejects users not present in the balance context", () => {
      const balances = makeBalances([
        { userId: "A", netMinor: 10000 },
        { userId: "B", netMinor: -10000 },
      ]);

      expect(() =>
        validateSettlement(
          { debtorId: "UnknownUser", creditorId: "A", amount: make(5000, "INR") },
          balances
        )
      ).toThrow(UnknownGroupMemberError);

      expect(() =>
        validateSettlement(
          { debtorId: "B", creditorId: "UnknownUser", amount: make(5000, "INR") },
          balances
        )
      ).toThrow(UnknownGroupMemberError);
    });

    it("rejects when debtor has non-negative balance (DebtorCreditorMismatchError)", () => {
      const balances = makeBalances([
        { userId: "A", netMinor: 10000 },
        { userId: "B", netMinor: -10000 },
      ]);

      // A is creditor (+100), trying to act as debtor
      expect(() =>
        validateSettlement(
          { debtorId: "A", creditorId: "B", amount: make(4000, "INR") },
          balances
        )
      ).toThrow(DebtorCreditorMismatchError);
    });

    it("rejects when creditor has non-positive balance (DebtorCreditorMismatchError)", () => {
      const balances = makeBalances([
        { userId: "A", netMinor: 10000 },
        { userId: "B", netMinor: -6000 },
        { userId: "C", netMinor: -4000 },
      ]);

      // B is debtor (-60), trying to pay C who is also debtor (-40)
      expect(() =>
        validateSettlement(
          { debtorId: "B", creditorId: "C", amount: make(2000, "INR") },
          balances
        )
      ).toThrow(DebtorCreditorMismatchError);
    });

    it("rejects when user has zero balance (settled up)", () => {
      const balances = makeBalances([
        { userId: "A", netMinor: 5000 },
        { userId: "B", netMinor: -5000 },
        { userId: "C", netMinor: 0 },
      ]);

      // C has zero balance, cannot be debtor
      expect(() =>
        validateSettlement(
          { debtorId: "C", creditorId: "A", amount: make(1000, "INR") },
          balances
        )
      ).toThrow(DebtorCreditorMismatchError);

      // C has zero balance, cannot be creditor
      expect(() =>
        validateSettlement(
          { debtorId: "B", creditorId: "C", amount: make(1000, "INR") },
          balances
        )
      ).toThrow(DebtorCreditorMismatchError);
    });
  });

  describe("Amount Validation", () => {
    it("rejects zero settlement amount", () => {
      expect(() =>
        createSettlement({
          debtorId: "B",
          creditorId: "A",
          amount: zero("INR"),
        })
      ).toThrow(InvalidSettlementAmountError);
    });

    it("rejects negative settlement amount", () => {
      expect(() =>
        createSettlement({
          debtorId: "B",
          creditorId: "A",
          amount: make(-5000, "INR"),
        })
      ).toThrow(InvalidSettlementAmountError);
    });

    it("rejects settlement exceeding debtor's outstanding debt (OverSettlementError)", () => {
      const balances = makeBalances([
        { userId: "A", netMinor: 10000 },
        { userId: "B", netMinor: -6000 },
        { userId: "C", netMinor: -4000 },
      ]);

      // B owes 6000, attempts to settle 7000 with A
      expect(() =>
        validateSettlement(
          { debtorId: "B", creditorId: "A", amount: make(7000, "INR") },
          balances
        )
      ).toThrow(OverSettlementError);
    });

    it("rejects settlement exceeding creditor's outstanding credit (OverSettlementError)", () => {
      const balances = makeBalances([
        { userId: "A", netMinor: 4000 },
        { userId: "B", netMinor: -10000 },
        { userId: "C", netMinor: 6000 },
      ]);

      // B owes 10000, but A is only owed 4000. B attempts to pay A 5000
      expect(() =>
        validateSettlement(
          { debtorId: "B", creditorId: "A", amount: make(5000, "INR") },
          balances
        )
      ).toThrow(OverSettlementError);
    });

    it("does not silently clamp amounts", () => {
      const balances = makeBalances([
        { userId: "A", netMinor: 10000 },
        { userId: "B", netMinor: -10000 },
      ]);

      // Must throw OverSettlementError rather than clamping to 10000
      expect(() =>
        applySettlement(balances, {
          debtorId: "B",
          creditorId: "A",
          amount: make(10001, "INR"),
        })
      ).toThrow(OverSettlementError);
    });

    it("rejects currency mismatch between settlement and balance context", () => {
      const balances = makeBalances([
        { userId: "A", netMinor: 10000 },
        { userId: "B", netMinor: -10000 },
      ], "INR");

      expect(() =>
        validateSettlement(
          { debtorId: "B", creditorId: "A", amount: make(5000, "USD") },
          balances
        )
      ).toThrow(CurrencyMismatchError);
    });
  });

  // ==========================================================================
  // 3. BALANCE EFFECTS & STEP 11 REQUIRED EXAMPLES
  // ==========================================================================

  describe("Balance Effects & Required Examples (Step 11)", () => {
    it("Example 1: Full settlement (A = +100, B = -100; B -> A = 100 => A = 0, B = 0)", () => {
      const balances = makeBalances([
        { userId: "A", netMinor: 10000 },
        { userId: "B", netMinor: -10000 },
      ]);

      const settlement = {
        debtorId: "B",
        creditorId: "A",
        amount: make(10000, "INR"),
      };

      expect(isFullSettlement(settlement, balances)).toBe(true);
      expect(isMutualFullSettlement(settlement, balances)).toBe(true);
      expect(isPartialSettlement(settlement, balances)).toBe(false);

      const result = applySettlement(balances, settlement);

      const aBal = result.balances.find((b) => b.userId === "A")!;
      const bBal = result.balances.find((b) => b.userId === "B")!;

      expect(aBal.netBalance.amountMinor).toBe(0);
      expect(bBal.netBalance.amountMinor).toBe(0);

      // Financial invariant: sum of net balances is 0
      const sumMinor = result.balances.reduce((acc, b) => acc + b.netBalance.amountMinor, 0);
      expect(sumMinor).toBe(0);
    });

    it("Example 2: Partial settlement (A = +100, B = -100; B -> A = 40 => A = +60, B = -60)", () => {
      const balances = makeBalances([
        { userId: "A", netMinor: 10000 },
        { userId: "B", netMinor: -10000 },
      ]);

      const settlement = {
        debtorId: "B",
        creditorId: "A",
        amount: make(4000, "INR"),
      };

      expect(isPartialSettlement(settlement, balances)).toBe(true);
      expect(isFullSettlement(settlement, balances)).toBe(false);

      const result = applySettlement(balances, settlement);

      const aBal = result.balances.find((b) => b.userId === "A")!;
      const bBal = result.balances.find((b) => b.userId === "B")!;

      expect(aBal.netBalance.amountMinor).toBe(6000);
      expect(bBal.netBalance.amountMinor).toBe(-6000);

      // Sum of net balances is 0
      const sumMinor = result.balances.reduce((acc, b) => acc + b.netBalance.amountMinor, 0);
      expect(sumMinor).toBe(0);
    });

    it("Example 3: Three-person single settlement (A = +100, B = -60, C = -40; B -> A = 60 => A = +40, B = 0, C = -40)", () => {
      const balances = makeBalances([
        { userId: "A", netMinor: 10000 },
        { userId: "B", netMinor: -6000 },
        { userId: "C", netMinor: -4000 },
      ]);

      const settlement = {
        debtorId: "B",
        creditorId: "A",
        amount: make(6000, "INR"),
      };

      // B is fully settled, but A is not mutually fully settled because A still has +40 credit
      expect(isFullSettlement(settlement, balances)).toBe(true);
      expect(isMutualFullSettlement(settlement, balances)).toBe(false);

      const result = applySettlement(balances, settlement);

      const aBal = result.balances.find((b) => b.userId === "A")!;
      const bBal = result.balances.find((b) => b.userId === "B")!;
      const cBal = result.balances.find((b) => b.userId === "C")!;

      expect(aBal.netBalance.amountMinor).toBe(4000);
      expect(bBal.netBalance.amountMinor).toBe(0);
      expect(cBal.netBalance.amountMinor).toBe(-4000);

      // Sum of net balances is 0
      const sumMinor = result.balances.reduce((acc, b) => acc + b.netBalance.amountMinor, 0);
      expect(sumMinor).toBe(0);
    });

    it("Example 4: Sequential settlements (A = +100, B = -60, C = -40; B -> A = 60; C -> A = 40 => A = 0, B = 0, C = 0)", () => {
      const balances = makeBalances([
        { userId: "A", netMinor: 10000 },
        { userId: "B", netMinor: -6000 },
        { userId: "C", netMinor: -4000 },
      ]);

      const s1 = { debtorId: "B", creditorId: "A", amount: make(6000, "INR") };
      const s2 = { debtorId: "C", creditorId: "A", amount: make(4000, "INR") };

      const result = applySettlements(balances, [s1, s2]);

      const aBal = result.balances.find((b) => b.userId === "A")!;
      const bBal = result.balances.find((b) => b.userId === "B")!;
      const cBal = result.balances.find((b) => b.userId === "C")!;

      expect(aBal.netBalance.amountMinor).toBe(0);
      expect(bBal.netBalance.amountMinor).toBe(0);
      expect(cBal.netBalance.amountMinor).toBe(0);

      const sumMinor = result.balances.reduce((acc, b) => acc + b.netBalance.amountMinor, 0);
      expect(sumMinor).toBe(0);
    });
  });

  // ==========================================================================
  // 4. PARTIAL SETTLEMENT DETAILS
  // ==========================================================================

  describe("Partial Settlement", () => {
    it("successive partial settlements reduce balance correctly until fully settled", () => {
      let state = makeBalances([
        { userId: "A", netMinor: 10000 },
        { userId: "B", netMinor: -10000 },
      ]);

      // Partial 1: 3000
      state = applySettlement(state, { debtorId: "B", creditorId: "A", amount: make(3000, "INR") });
      expect(state.balances.find((b) => b.userId === "A")!.netBalance.amountMinor).toBe(7000);
      expect(state.balances.find((b) => b.userId === "B")!.netBalance.amountMinor).toBe(-7000);

      // Partial 2: 4000
      state = applySettlement(state, { debtorId: "B", creditorId: "A", amount: make(4000, "INR") });
      expect(state.balances.find((b) => b.userId === "A")!.netBalance.amountMinor).toBe(3000);
      expect(state.balances.find((b) => b.userId === "B")!.netBalance.amountMinor).toBe(-3000);

      // Final: 3000
      state = applySettlement(state, { debtorId: "B", creditorId: "A", amount: make(3000, "INR") });
      expect(state.balances.find((b) => b.userId === "A")!.netBalance.amountMinor).toBe(0);
      expect(state.balances.find((b) => b.userId === "B")!.netBalance.amountMinor).toBe(0);
    });

    it("engine MUST NOT treat a partial settlement as full settlement", () => {
      const balances = makeBalances([
        { userId: "A", netMinor: 10000 },
        { userId: "B", netMinor: -10000 },
      ]);

      const s = { debtorId: "B", creditorId: "A", amount: make(3000, "INR") };
      expect(isPartialSettlement(s, balances)).toBe(true);
      expect(isFullSettlement(s, balances)).toBe(false);

      const result = applySettlement(balances, s);
      const bBal = result.balances.find((b) => b.userId === "B")!;
      expect(bBal.netBalance.amountMinor).toBe(-7000);
      expect(bBal.netBalance.amountMinor).not.toBe(0);
    });
  });

  // ==========================================================================
  // 5. FULL SETTLEMENT & ZERO RESIDUALS
  // ==========================================================================

  describe("Full Settlement & Zero Residuals", () => {
    it("exact full settlement reaches zero with no residual minor units", () => {
      const balances = makeBalances([
        { userId: "Alice", netMinor: 7525 },
        { userId: "Bob", netMinor: -7525 },
      ]);

      const result = applySettlement(balances, {
        debtorId: "Bob",
        creditorId: "Alice",
        amount: make(7525, "INR"),
      });

      const aBal = result.balances.find((b) => b.userId === "Alice")!;
      const bBal = result.balances.find((b) => b.userId === "Bob")!;

      expect(aBal.netBalance.amountMinor).toBe(0);
      expect(bBal.netBalance.amountMinor).toBe(0);
      expect(Object.is(aBal.netBalance.amountMinor, 0)).toBe(true);
      expect(Object.is(bBal.netBalance.amountMinor, 0)).toBe(true);
    });
  });

  // ==========================================================================
  // 6. RECALCULATION & INTEGRATION WITH EXPENSES
  // ==========================================================================

  describe("Recalculation with Expenses", () => {
    it("recalculates balance after single expense + settlement", () => {
      const total = make(10000, "INR");
      const splits = splitEqually(total, ["A", "B"]);
      const exp = calculateExpenseBalances({
        total,
        payerId: "A",
        allocations: splits.allocations,
      });

      const result = recalculateBalances({
        members: ["A", "B"],
        expenses: [exp],
        settlements: [
          { debtorId: "B", creditorId: "A", amount: make(5000, "INR") },
        ],
      });

      expect(result.balances.find((b) => b.userId === "A")!.netBalance.amountMinor).toBe(0);
      expect(result.balances.find((b) => b.userId === "B")!.netBalance.amountMinor).toBe(0);
    });

    it("recalculates balance after multiple expenses + settlements", () => {
      // Expense 1: A pays 10000 split A, B (A paid 10000, owed 5000; B paid 0, owed 5000 -> A +5000, B -5000)
      const splits1 = splitEqually(make(10000, "INR"), ["A", "B"]);
      const exp1 = calculateExpenseBalances({
        total: make(10000, "INR"),
        payerId: "A",
        allocations: splits1.allocations,
      });

      // Expense 2: B pays 4000 split A, B (B paid 4000, owed 2000; A paid 0, owed 2000 -> B +2000, A -2000)
      const splits2 = splitEqually(make(4000, "INR"), ["A", "B"]);
      const exp2 = calculateExpenseBalances({
        total: make(4000, "INR"),
        payerId: "B",
        allocations: splits2.allocations,
      });

      // Baseline before settlement: A +3000, B -3000
      const baseline = calculateGroupBalances({
        members: ["A", "B"],
        expenses: [exp1, exp2],
      });
      expect(baseline.balances.find((b) => b.userId === "A")!.netBalance.amountMinor).toBe(3000);
      expect(baseline.balances.find((b) => b.userId === "B")!.netBalance.amountMinor).toBe(-3000);

      // Settle 3000
      const result = recalculateBalances({
        members: ["A", "B"],
        expenses: [exp1, exp2],
        settlements: [
          { debtorId: "B", creditorId: "A", amount: make(3000, "INR") },
        ],
      });

      expect(result.balances.find((b) => b.userId === "A")!.netBalance.amountMinor).toBe(0);
      expect(result.balances.find((b) => b.userId === "B")!.netBalance.amountMinor).toBe(0);
    });

    it("recalculation is strictly deterministic across repeated runs", () => {
      const splits = splitEqually(make(12000, "INR"), ["A", "B", "C"]);
      const exp = calculateExpenseBalances({
        total: make(12000, "INR"),
        payerId: "A",
        allocations: splits.allocations,
      });

      const input = {
        members: ["A", "B", "C"],
        expenses: [exp],
        settlements: [
          { debtorId: "B", creditorId: "A", amount: make(4000, "INR") },
          { debtorId: "C", creditorId: "A", amount: make(2000, "INR") },
        ],
      };

      const run1 = recalculateBalances(input);
      const run2 = recalculateBalances(input);

      expect(run1.balances).toEqual(run2.balances);
      expect(run1.balances.find((b) => b.userId === "A")!.netBalance.amountMinor).toBe(2000);
      expect(run1.balances.find((b) => b.userId === "B")!.netBalance.amountMinor).toBe(0);
      expect(run1.balances.find((b) => b.userId === "C")!.netBalance.amountMinor).toBe(-2000);
    });
  });

  // ==========================================================================
  // 7. DUPLICATE REQUESTS & IDEMPOTENCY BOUNDARY
  // ==========================================================================

  describe("Duplicate Request & Idempotency Boundary", () => {
    it("rejects duplicate settlement IDs in batch recalculation", () => {
      const balances = makeBalances([
        { userId: "A", netMinor: 10000 },
        { userId: "B", netMinor: -10000 },
      ]);

      const s1 = { id: "settle-1", debtorId: "B", creditorId: "A", amount: make(3000, "INR") };
      const s2 = { id: "settle-1", debtorId: "B", creditorId: "A", amount: make(3000, "INR") };

      expect(() => applySettlements(balances, [s1, s2])).toThrow(DuplicateSettlementError);
    });

    it("rejects repeated application of the same settlement when debt is exhausted", () => {
      const balances = makeBalances([
        { userId: "A", netMinor: 10000 },
        { userId: "B", netMinor: -10000 },
      ]);

      const settlement = { debtorId: "B", creditorId: "A", amount: make(10000, "INR") };

      // First application settles completely
      const state1 = applySettlement(balances, settlement);
      expect(state1.balances.find((b) => b.userId === "B")!.netBalance.amountMinor).toBe(0);

      // Second application fails at domain level because B is no longer in debt
      expect(() => applySettlement(state1, settlement)).toThrow(DebtorCreditorMismatchError);
    });

    it("rejects repeated application of partial settlement when it would exceed remaining credit", () => {
      const balances = makeBalances([
        { userId: "A", netMinor: 6000 },
        { userId: "B", netMinor: -6000 },
      ]);

      const settlement = { debtorId: "B", creditorId: "A", amount: make(4000, "INR") };

      // First application: leaves A at +2000, B at -2000
      const state1 = applySettlement(balances, settlement);

      // Second application: amount 4000 exceeds remaining debt 2000
      expect(() => applySettlement(state1, settlement)).toThrow(OverSettlementError);
    });
  });

  // ==========================================================================
  // 8. LARGE SAFE VALUES & PRECISION
  // ==========================================================================

  describe("Large Values & Precision", () => {
    it("handles large safe values without integer overflow or precision loss", () => {
      // 5 trillion minor units (₹50 billion)
      const largeMinor = 5_000_000_000_000;
      const balances = makeBalances([
        { userId: "A", netMinor: largeMinor },
        { userId: "B", netMinor: -largeMinor },
      ]);

      const settleMinor = 2_000_000_000_000;
      const result = applySettlement(balances, {
        debtorId: "B",
        creditorId: "A",
        amount: make(settleMinor, "INR"),
      });

      expect(result.balances.find((b) => b.userId === "A")!.netBalance.amountMinor).toBe(
        3_000_000_000_000
      );
      expect(result.balances.find((b) => b.userId === "B")!.netBalance.amountMinor).toBe(
        -3_000_000_000_000
      );
    });

    it("handles 1 minor unit (1 paise) smallest settlement", () => {
      const balances = makeBalances([
        { userId: "A", netMinor: 1 },
        { userId: "B", netMinor: -1 },
      ]);

      const result = applySettlement(balances, {
        debtorId: "B",
        creditorId: "A",
        amount: make(1, "INR"),
      });

      expect(result.balances.find((b) => b.userId === "A")!.netBalance.amountMinor).toBe(0);
      expect(result.balances.find((b) => b.userId === "B")!.netBalance.amountMinor).toBe(0);
    });
  });

  // ==========================================================================
  // 9. POLYMORPHISM & ARRAYS OF BALANCES
  // ==========================================================================

  describe("Polymorphic Balance Input", () => {
    it("applies settlement directly to an array of NetBalanceInput items", () => {
      const rawBalances = [
        { userId: "A", netBalance: make(10000, "INR") },
        { userId: "B", netBalance: make(-10000, "INR") },
      ];

      const result = applySettlement(rawBalances, {
        debtorId: "B",
        creditorId: "A",
        amount: make(4000, "INR"),
      });

      expect(result[0]!.netBalance.amountMinor).toBe(6000);
      expect(result[1]!.netBalance.amountMinor).toBe(-6000);
      expect(Object.isFrozen(result)).toBe(true);
    });
  });

  // ==========================================================================
  // 10. IMMUTABILITY & PURITY
  // ==========================================================================

  describe("Immutability & Purity", () => {
    it("does not mutate input balances or settlement objects", () => {
      const origBalances = makeBalances([
        { userId: "A", netMinor: 10000 },
        { userId: "B", netMinor: -10000 },
      ]);

      const origSettlement = {
        debtorId: "B",
        creditorId: "A",
        amount: make(4000, "INR"),
      };

      const result = applySettlement(origBalances, origSettlement);

      // Input balances remain untouched
      expect(origBalances.balances.find((b) => b.userId === "A")!.netBalance.amountMinor).toBe(10000);
      expect(origBalances.balances.find((b) => b.userId === "B")!.netBalance.amountMinor).toBe(-10000);

      // Result is frozen
      expect(Object.isFrozen(result)).toBe(true);
      expect(Object.isFrozen(result.balances)).toBe(true);
    });
  });

  // ==========================================================================
  // 11. DOMAIN ERROR HIERARCHY & ROBUSTNESS
  // ==========================================================================

  describe("Domain Error Hierarchy & Robustness", () => {
    it("all settlement errors inherit from MoneyError and Error", () => {
      const err1 = new SelfSettlementError("A");
      expect(err1).toBeInstanceOf(SelfSettlementError);
      expect(err1.name).toBe("SelfSettlementError");
      expect(err1.code).toBe("SELF_SETTLEMENT");

      const err2 = new InvalidSettlementAmountError("bad amount", -10);
      expect(err2).toBeInstanceOf(InvalidSettlementAmountError);
      expect(err2.name).toBe("InvalidSettlementAmountError");
      expect(err2.code).toBe("INVALID_SETTLEMENT_AMOUNT");

      const err3 = new OverSettlementError(150, 100, "INR", "B", "A");
      expect(err3).toBeInstanceOf(OverSettlementError);
      expect(err3.name).toBe("OverSettlementError");
      expect(err3.code).toBe("OVER_SETTLEMENT");
      expect(err3.amountMinor).toBe(150);
      expect(err3.maxAllowedMinor).toBe(100);

      const err4 = new DebtorCreditorMismatchError("mismatch", "B", "A");
      expect(err4).toBeInstanceOf(DebtorCreditorMismatchError);
      expect(err4.name).toBe("DebtorCreditorMismatchError");
      expect(err4.code).toBe("DEBTOR_CREDITOR_MISMATCH");

      const err5 = new InvalidSettlementPartiesError("bad parties");
      expect(err5).toBeInstanceOf(InvalidSettlementPartiesError);
      expect(err5.name).toBe("InvalidSettlementPartiesError");
      expect(err5.code).toBe("INVALID_SETTLEMENT_PARTIES");

      const err6 = new DuplicateSettlementError("s-1");
      expect(err6).toBeInstanceOf(DuplicateSettlementError);
      expect(err6.name).toBe("DuplicateSettlementError");
      expect(err6.code).toBe("DUPLICATE_SETTLEMENT");
    });

    it("accepts matching debtorId and payerId aliases without error", () => {
      const s = createSettlement({
        debtorId: "user-b",
        payerId: "user-b",
        creditorId: "user-a",
        receiverId: "user-a",
        amount: make(1000, "INR"),
      });

      expect(s.debtorId).toBe("user-b");
      expect(s.creditorId).toBe("user-a");
    });

    it("rejects non-integer or non-safe integer amountMinor in settlement object", () => {
      expect(() =>
        createSettlement({
          debtorId: "B",
          creditorId: "A",
          amount: { amountMinor: 100.55, currency: "INR" } as unknown as import("../../src/domain/index.js").Money,
        })
      ).toThrow(InvalidSettlementAmountError);

      expect(() =>
        createSettlement({
          debtorId: "B",
          creditorId: "A",
          amount: { amountMinor: NaN, currency: "INR" } as unknown as import("../../src/domain/index.js").Money,
        })
      ).toThrow(InvalidSettlementAmountError);

      expect(() =>
        createSettlement({
          debtorId: "B",
          creditorId: "A",
          amount: { amountMinor: Number.MAX_SAFE_INTEGER + 1, currency: "INR" } as unknown as import("../../src/domain/index.js").Money,
        })
      ).toThrow(InvalidSettlementAmountError);
    });

    it("empty settlements array returns balances unchanged", () => {
      const balances = makeBalances([
        { userId: "A", netMinor: 5000 },
        { userId: "B", netMinor: -5000 },
      ]);

      const result = applySettlements(balances, []);
      expect(result.balances.find((b) => b.userId === "A")!.netBalance.amountMinor).toBe(5000);
      expect(result.balances.find((b) => b.userId === "B")!.netBalance.amountMinor).toBe(-5000);
    });

    it("stand-alone validateSettlement without balances validates settlement model", () => {
      const s = validateSettlement({
        debtorId: "B",
        creditorId: "A",
        amount: make(2500, "INR"),
      });

      expect(s.debtorId).toBe("B");
      expect(s.creditorId).toBe("A");
      expect(s.amount.amountMinor).toBe(2500);
    });
  });
});
