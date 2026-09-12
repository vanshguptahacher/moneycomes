/**
 * Phase 2.10 — Financial Domain Engine: Regression & Integration Test Suite.
 *
 * Validates that the entire financial domain layer functions cohesively,
 * deterministically, and accurately when Money, Currency, Equal Split, Exact Split,
 * Percentage Split, Shares Split, Balance Engine, Group Balance, Debt Simplification,
 * and Settlement Engine are combined.
 *
 * Enforces all 14 foundational financial invariants.
 */

import { describe, it, expect } from "vitest";
import {
  // Money & Currency
  make,
  zero,
  add,
  subtract,
  eq,
  compare,
  fromDecimal,
  CurrencyMismatchError,
  InvalidMoneyError,
  UnsafeIntegerError,
  // Split operations
  splitEqually,
  EmptyParticipantsError,
  DuplicateParticipantError,
  InvalidParticipantError,
  NegativeSplitTotalError,
  splitExactly,
  UnderAllocationError,
  OverAllocationError,
  NegativeAllocationError,
  AllocationCurrencyMismatchError,
  splitByPercentage,
  PercentageTotalError,
  NegativePercentageError,
  TOTAL_BASIS_POINTS,
  splitByShares,
  NegativeShareError,
  ZeroTotalSharesError,
  // Balance Engine
  calculateExpenseBalances,
  BalanceReconciliationError,
  // Group Balance
  calculateGroupBalances,
  UnknownGroupMemberError,
  // Debt Simplification
  simplifyDebts,
  EmptyBalancesError,
  UnreconciledBalancesError,
  // Settlement Engine
  createSettlement,
  validateSettlement,
  applySettlement,
  applySettlements,
  recalculateBalances,
  isFullSettlement,
  isPartialSettlement,
  isMutualFullSettlement,
  SelfSettlementError,
  InvalidSettlementAmountError,
  OverSettlementError,
  DebtorCreditorMismatchError,
  InvalidSettlementPartiesError,
  DuplicateSettlementError,
} from "../../src/domain/index.js";

describe("Phase 2.10 — Financial Domain Engine: Regression & Integration", () => {
  // ==========================================================================
  // 1. COMPLETE FINANCIAL FLOW (STEP 2)
  // ==========================================================================

  describe("Complete Financial Lifecycle Flow", () => {
    it("Expense -> Equal Split -> Balances -> Group -> Debt Simplification -> Settlement -> Recalculation", () => {
      const members = ["Alice", "Bob", "Charlie"];
      const currency = "INR";
      const total = make(9000, currency); // ₹90.00

      // 1. Split
      const splitResult = splitEqually(total, members);
      expect(splitResult.allocations).toHaveLength(3);
      const allocSum = splitResult.allocations.reduce((acc, a) => acc + a.amount.amountMinor, 0);
      expect(allocSum).toBe(total.amountMinor);

      // 2. Per-user Expense Balance (Alice pays for all 3)
      const expense = calculateExpenseBalances({
        total,
        payerId: "Alice",
        allocations: splitResult.allocations,
      });
      expect(expense.balances).toHaveLength(3);
      const expSum = expense.balances.reduce((acc, b) => acc + b.netBalance.amountMinor, 0);
      expect(expSum).toBe(0);

      // 3. Group Balance Aggregation
      const groupResult = calculateGroupBalances({
        members,
        expenses: [expense],
      });
      expect(groupResult.balances.find((b) => b.userId === "Alice")!.netBalance.amountMinor).toBe(6000);
      expect(groupResult.balances.find((b) => b.userId === "Bob")!.netBalance.amountMinor).toBe(-3000);
      expect(groupResult.balances.find((b) => b.userId === "Charlie")!.netBalance.amountMinor).toBe(-3000);

      // 4. Debt Simplification
      const simplification = simplifyDebts(groupResult);
      expect(simplification.transferCount).toBe(2);
      expect(simplification.transfers).toEqual([
        {
          fromUserId: "Bob",
          toUserId: "Alice",
          debtorId: "Bob",
          creditorId: "Alice",
          amount: make(3000, currency),
        },
        {
          fromUserId: "Charlie",
          toUserId: "Alice",
          debtorId: "Charlie",
          creditorId: "Alice",
          amount: make(3000, currency),
        },
      ]);

      // 5. Apply Simplified Transfers as Settlements
      const settlements = simplification.transfers.map((t, idx) =>
        createSettlement({
          id: `settle-${idx + 1}`,
          debtorId: t.debtorId,
          creditorId: t.creditorId,
          amount: t.amount,
        })
      );

      const settledBalances = applySettlements(groupResult, settlements);
      for (const b of settledBalances.balances) {
        expect(b.netBalance.amountMinor).toBe(0);
      }

      // 6. Recalculation from Source Expenses + Settlements
      const recalculated = recalculateBalances({
        members,
        expenses: [expense],
        settlements,
      });

      expect(recalculated.balances).toEqual(settledBalances.balances);
      for (const b of recalculated.balances) {
        expect(b.netBalance.amountMinor).toBe(0);
      }
    });
  });

  // ==========================================================================
  // 2. SPLIT METHOD REGRESSION (STEP 3)
  // ==========================================================================

  describe("Split Method Regression & Verification", () => {
    const members = ["A", "B", "C", "D"];
    const currency = "INR";

    it("Equal Split lifecycle with remainder distribution", () => {
      // 100 paise split among 3 members: 34, 33, 33
      const total = make(100, currency);
      const participants = ["A", "B", "C"];
      const split = splitEqually(total, participants);

      expect(split.allocations[0]!.amount.amountMinor).toBe(34);
      expect(split.allocations[1]!.amount.amountMinor).toBe(33);
      expect(split.allocations[2]!.amount.amountMinor).toBe(33);

      const expense = calculateExpenseBalances({
        total,
        payerId: "A",
        allocations: split.allocations,
      });

      const group = calculateGroupBalances({ members: participants, expenses: [expense] });
      expect(group.balances.find((b) => b.userId === "A")!.netBalance.amountMinor).toBe(66);
      expect(group.balances.find((b) => b.userId === "B")!.netBalance.amountMinor).toBe(-33);
      expect(group.balances.find((b) => b.userId === "C")!.netBalance.amountMinor).toBe(-33);

      const debts = simplifyDebts(group);
      expect(debts.transfers).toHaveLength(2);
      expect(debts.transfers[0]!.amount.amountMinor).toBe(33);
      expect(debts.transfers[1]!.amount.amountMinor).toBe(33);
    });

    it("Exact Split lifecycle", () => {
      const total = make(10000, currency);
      const split = splitExactly(total, [
        { participantId: "A", amount: make(1000, currency) },
        { participantId: "B", amount: make(4000, currency) },
        { participantId: "C", amount: make(2500, currency) },
        { participantId: "D", amount: make(2500, currency) },
      ]);

      const expense = calculateExpenseBalances({
        total,
        payerId: "B",
        allocations: split.allocations,
      });

      const group = calculateGroupBalances({ members, expenses: [expense] });
      expect(group.balances.find((b) => b.userId === "A")!.netBalance.amountMinor).toBe(-1000);
      expect(group.balances.find((b) => b.userId === "B")!.netBalance.amountMinor).toBe(6000);
      expect(group.balances.find((b) => b.userId === "C")!.netBalance.amountMinor).toBe(-2500);
      expect(group.balances.find((b) => b.userId === "D")!.netBalance.amountMinor).toBe(-2500);

      const debts = simplifyDebts(group);
      const totalTransferred = debts.transfers.reduce((acc, t) => acc + t.amount.amountMinor, 0);
      expect(totalTransferred).toBe(6000);
    });

    it("Percentage Split lifecycle with Largest Remainder rounding", () => {
      // 1000 INR split 33.33%, 33.33%, 33.34% (3333, 3333, 3334 bps)
      const total = make(1000, currency);
      const participants = ["A", "B", "C"];
      const split = splitByPercentage(total, [
        { participantId: "A", basisPoints: 3333 },
        { participantId: "B", basisPoints: 3333 },
        { participantId: "C", basisPoints: 3334 },
      ]);

      const allocSum = split.allocations.reduce((acc, a) => acc + a.amount.amountMinor, 0);
      expect(allocSum).toBe(1000);

      const expense = calculateExpenseBalances({
        total,
        payerId: "C",
        allocations: split.allocations,
      });

      const group = calculateGroupBalances({ members: participants, expenses: [expense] });
      const debts = simplifyDebts(group);
      const simplifiedBal = applySettlements(group, debts.transfers);
      for (const b of simplifiedBal.balances) {
        expect(b.netBalance.amountMinor).toBe(0);
      }
    });

    it("Shares Split lifecycle with proportional allocation", () => {
      // ₹600 split 1:2:3 shares -> ₹100, ₹200, ₹300
      const total = make(60000, currency);
      const participants = ["A", "B", "C"];
      const split = splitByShares(total, [
        { participantId: "A", shares: 1 },
        { participantId: "B", shares: 2 },
        { participantId: "C", shares: 3 },
      ]);

      expect(split.allocations[0]!.amount.amountMinor).toBe(10000);
      expect(split.allocations[1]!.amount.amountMinor).toBe(20000);
      expect(split.allocations[2]!.amount.amountMinor).toBe(30000);

      const expense = calculateExpenseBalances({
        total,
        payerId: "A",
        allocations: split.allocations,
      });

      const group = calculateGroupBalances({ members: participants, expenses: [expense] });
      expect(group.balances.find((b) => b.userId === "A")!.netBalance.amountMinor).toBe(50000);
      expect(group.balances.find((b) => b.userId === "B")!.netBalance.amountMinor).toBe(-20000);
      expect(group.balances.find((b) => b.userId === "C")!.netBalance.amountMinor).toBe(-30000);
    });

    it("Combined Multi-Expense Group with all 4 split types simultaneously", () => {
      const groupMembers = ["Alice", "Bob", "Charlie", "Dave", "Eve"];

      // Exp 1: Equal Split (₹5,000 paid by Alice)
      const exp1Splits = splitEqually(make(5000, currency), groupMembers);
      const exp1 = calculateExpenseBalances({
        total: make(5000, currency),
        payerId: "Alice",
        allocations: exp1Splits.allocations,
      });

      // Exp 2: Exact Split (₹4,000 paid by Bob: Charlie 2000, Dave 2000)
      const exp2Splits = splitExactly(make(4000, currency), [
        { participantId: "Charlie", amount: make(2000, currency) },
        { participantId: "Dave", amount: make(2000, currency) },
      ]);
      const exp2 = calculateExpenseBalances({
        total: make(4000, currency),
        payerId: "Bob",
        allocations: exp2Splits.allocations,
      });

      // Exp 3: Percentage Split (₹6,000 paid by Charlie: Alice 30%, Bob 30%, Charlie 20%, Dave 10%, Eve 10%)
      const exp3Splits = splitByPercentage(make(6000, currency), [
        { participantId: "Alice", basisPoints: 3000 },
        { participantId: "Bob", basisPoints: 3000 },
        { participantId: "Charlie", basisPoints: 2000 },
        { participantId: "Dave", basisPoints: 1000 },
        { participantId: "Eve", basisPoints: 1000 },
      ]);
      const exp3 = calculateExpenseBalances({
        total: make(6000, currency),
        payerId: "Charlie",
        allocations: exp3Splits.allocations,
      });

      // Exp 4: Shares Split (₹3,000 paid by Dave: Alice 1, Bob 1, Charlie 1, Dave 0, Eve 3 -> 6 total shares)
      const exp4Splits = splitByShares(make(3000, currency), [
        { participantId: "Alice", shares: 1 },
        { participantId: "Bob", shares: 1 },
        { participantId: "Charlie", shares: 1 },
        { participantId: "Dave", shares: 0 },
        { participantId: "Eve", shares: 3 },
      ]);
      const exp4 = calculateExpenseBalances({
        total: make(3000, currency),
        payerId: "Dave",
        allocations: exp4Splits.allocations,
      });

      // Aggregate Group Balances
      const groupBalances = calculateGroupBalances({
        members: groupMembers,
        expenses: [exp1, exp2, exp3, exp4],
      });

      // Invariant: sum of all member balances is exactly 0
      const groupSumMinor = groupBalances.balances.reduce((acc, b) => acc + b.netBalance.amountMinor, 0);
      expect(groupSumMinor).toBe(0);

      // Simplify Debts
      const simplification = simplifyDebts(groupBalances);

      // Apply all transfers as settlements
      const finalResult = applySettlements(groupBalances, simplification.transfers);
      for (const b of finalResult.balances) {
        expect(b.netBalance.amountMinor).toBe(0);
      }

      // Authoritative recalculation produces identical zero balances
      const recalculated = recalculateBalances({
        members: groupMembers,
        expenses: [exp1, exp2, exp3, exp4],
        settlements: simplification.transfers,
      });

      expect(recalculated.balances).toEqual(finalResult.balances);
    });
  });

  // ==========================================================================
  // 3. LARGE VALUES & SAFE INTEGER BOUNDS (STEP 4)
  // ==========================================================================

  describe("Large Values & Precision Bounds", () => {
    const currency = "INR";

    it("handles large safe values in split, balances, simplification, and settlements", () => {
      // ₹10 billion (1,000,000,000,000 paise)
      const largeTotal = make(1_000_000_000_000, currency);
      const members = ["TitanA", "TitanB", "TitanC", "TitanD"];

      const split = splitEqually(largeTotal, members);
      for (const a of split.allocations) {
        expect(a.amount.amountMinor).toBe(250_000_000_000);
      }

      const expense = calculateExpenseBalances({
        total: largeTotal,
        payerId: "TitanA",
        allocations: split.allocations,
      });

      const group = calculateGroupBalances({ members, expenses: [expense] });
      expect(group.balances.find((b) => b.userId === "TitanA")!.netBalance.amountMinor).toBe(750_000_000_000);

      const simplification = simplifyDebts(group);
      expect(simplification.transferCount).toBe(3);

      const settled = applySettlements(group, simplification.transfers);
      for (const b of settled.balances) {
        expect(b.netBalance.amountMinor).toBe(0);
      }
    });

    it("rejects numbers exceeding safe integer range during Money creation", () => {
      expect(() => make(Number.MAX_SAFE_INTEGER + 1, currency)).toThrow(UnsafeIntegerError);
    });
  });

  // ==========================================================================
  // 4. MANY PARTICIPANTS (STEP 5)
  // ==========================================================================

  describe("Large Participant Count Scenarios", () => {
    it("handles 50 participants with equal split and exact remainder distribution", () => {
      const count = 50;
      const participants = Array.from({ length: count }, (_, i) => `user_${String(i).padStart(3, "0")}`);
      // ₹100.01 (10001 paise) -> 10001 % 50 = 1 remainder
      const total = make(10001, "INR");

      const split = splitEqually(total, participants);
      expect(split.allocations[0]!.amount.amountMinor).toBe(201); // 200 + 1
      for (let i = 1; i < count; i++) {
        expect(split.allocations[i]!.amount.amountMinor).toBe(200);
      }

      const expense = calculateExpenseBalances({
        total,
        payerId: participants[0]!,
        allocations: split.allocations,
      });

      const group = calculateGroupBalances({ members: participants, expenses: [expense] });
      const sumMinor = group.balances.reduce((acc, b) => acc + b.netBalance.amountMinor, 0);
      expect(sumMinor).toBe(0);

      const simplification = simplifyDebts(group);
      expect(simplification.transferCount).toBe(49);

      const settled = applySettlements(group, simplification.transfers);
      for (const b of settled.balances) {
        expect(b.netBalance.amountMinor).toBe(0);
      }
    });

    it("handles 25 participants with shares split and exact reconciliation", () => {
      const count = 25;
      const participants = Array.from({ length: count }, (_, i) => `member_${i}`);
      const allocations = participants.map((p, idx) => ({
        participantId: p,
        shares: (idx % 5) + 1, // shares between 1 and 5
      }));

      const total = make(100000, "INR"); // ₹1,000.00
      const split = splitByShares(total, allocations);

      const sumAllocs = split.allocations.reduce((acc, a) => acc + a.amount.amountMinor, 0);
      expect(sumAllocs).toBe(total.amountMinor);

      const expense = calculateExpenseBalances({
        total,
        payerId: participants[0]!,
        allocations: split.allocations,
      });

      const group = calculateGroupBalances({ members: participants, expenses: [expense] });
      const simplification = simplifyDebts(group);
      const settled = applySettlements(group, simplification.transfers);

      for (const b of settled.balances) {
        expect(b.netBalance.amountMinor).toBe(0);
      }
    });
  });

  // ==========================================================================
  // 5. RETRY & DETERMINISM SCENARIOS (STEP 6 & STEP 11)
  // ==========================================================================

  describe("Retry & Deterministic Invariance", () => {
    it("identical multi-step calculations produce bit-for-bit identical results across 20 iterations", () => {
      const members = ["User1", "User2", "User3", "User4"];
      const currency = "INR";

      const runPipeline = () => {
        const exp1Splits = splitEqually(make(10000, currency), members);
        const exp1 = calculateExpenseBalances({
          total: make(10000, currency),
          payerId: "User1",
          allocations: exp1Splits.allocations,
        });

        const exp2Splits = splitByPercentage(make(6000, currency), [
          { participantId: "User1", basisPoints: 2500 },
          { participantId: "User2", basisPoints: 2500 },
          { participantId: "User3", basisPoints: 2500 },
          { participantId: "User4", basisPoints: 2500 },
        ]);
        const exp2 = calculateExpenseBalances({
          total: make(6000, currency),
          payerId: "User2",
          allocations: exp2Splits.allocations,
        });

        const group = calculateGroupBalances({ members, expenses: [exp1, exp2] });
        const simplification = simplifyDebts(group);

        const partialSettlement = createSettlement({
          debtorId: simplification.transfers[0]!.debtorId,
          creditorId: simplification.transfers[0]!.creditorId,
          amount: make(1000, currency),
        });

        const partialBalances = applySettlement(group, partialSettlement);
        return { group, simplification, partialBalances };
      };

      const baseline = runPipeline();

      for (let i = 0; i < 20; i++) {
        const nextRun = runPipeline();
        expect(nextRun.group.balances).toEqual(baseline.group.balances);
        expect(nextRun.simplification.transfers).toEqual(baseline.simplification.transfers);
        expect(nextRun.partialBalances.balances).toEqual(baseline.partialBalances.balances);
      }
    });

    it("inputs are not mutated during operations", () => {
      const total = make(5000, "INR");
      const participants = Object.freeze(["Alice", "Bob"]);
      const split = splitEqually(total, participants);

      expect(Object.isFrozen(participants)).toBe(true);
      expect(total.amountMinor).toBe(5000);

      const expense = calculateExpenseBalances({
        total,
        payerId: "Alice",
        allocations: split.allocations,
      });

      expect(split.allocations[0]!.amount.amountMinor).toBe(2500);
      expect(split.allocations[1]!.amount.amountMinor).toBe(2500);
      expect(Object.isFrozen(expense.balances)).toBe(true);
    });
  });

  // ==========================================================================
  // 6. COMPLETE SETTLEMENT REGRESSION (STEP 7)
  // ==========================================================================

  describe("Settlement Regression & Sequence Validation", () => {
    it("partial settlements reduce debt correctly; full settlement reaches zero", () => {
      const members = ["A", "B"];
      const total = make(10000, "INR");
      const exp = calculateExpenseBalances({
        total,
        payerId: "A",
        allocations: splitEqually(total, members).allocations,
      });

      let state = calculateGroupBalances({ members, expenses: [exp] });
      expect(state.balances.find((b) => b.userId === "A")!.netBalance.amountMinor).toBe(5000);
      expect(state.balances.find((b) => b.userId === "B")!.netBalance.amountMinor).toBe(-5000);

      // Settle 2000 (partial)
      const s1 = createSettlement({ debtorId: "B", creditorId: "A", amount: make(2000, "INR") });
      expect(isPartialSettlement(s1, state)).toBe(true);
      state = applySettlement(state, s1);
      expect(state.balances.find((b) => b.userId === "A")!.netBalance.amountMinor).toBe(3000);
      expect(state.balances.find((b) => b.userId === "B")!.netBalance.amountMinor).toBe(-3000);

      // Settle 3000 (full)
      const s2 = createSettlement({ debtorId: "B", creditorId: "A", amount: make(3000, "INR") });
      expect(isFullSettlement(s2, state)).toBe(true);
      expect(isMutualFullSettlement(s2, state)).toBe(true);
      state = applySettlement(state, s2);
      expect(state.balances.find((b) => b.userId === "A")!.netBalance.amountMinor).toBe(0);
      expect(state.balances.find((b) => b.userId === "B")!.netBalance.amountMinor).toBe(0);
    });

    it("recalculation handles interleaved expenses and multiple settlements", () => {
      const members = ["A", "B", "C"];

      // Exp 1: A pays 6000 split A, B, C (each owes 2000)
      const exp1 = calculateExpenseBalances({
        total: make(6000, "INR"),
        payerId: "A",
        allocations: splitEqually(make(6000, "INR"), members).allocations,
      });

      // Exp 2: B pays 3000 split A, B, C (each owes 1000)
      const exp2 = calculateExpenseBalances({
        total: make(3000, "INR"),
        payerId: "B",
        allocations: splitEqually(make(3000, "INR"), members).allocations,
      });

      // Baseline before settlements:
      // A: +4000 - 1000 = +3000
      // B: -2000 + 2000 = 0
      // C: -2000 - 1000 = -3000
      const baseline = calculateGroupBalances({ members, expenses: [exp1, exp2] });
      expect(baseline.balances.find((b) => b.userId === "A")!.netBalance.amountMinor).toBe(3000);
      expect(baseline.balances.find((b) => b.userId === "B")!.netBalance.amountMinor).toBe(0);
      expect(baseline.balances.find((b) => b.userId === "C")!.netBalance.amountMinor).toBe(-3000);

      // C settles 3000 with A
      const settlement = createSettlement({ debtorId: "C", creditorId: "A", amount: make(3000, "INR") });

      const finalGroup = recalculateBalances({
        members,
        expenses: [exp1, exp2],
        settlements: [settlement],
      });

      for (const b of finalGroup.balances) {
        expect(b.netBalance.amountMinor).toBe(0);
      }
    });
  });

  // ==========================================================================
  // 7. ALL 14 FINANCIAL INVARIANTS (STEP 8)
  // ==========================================================================

  describe("Enforcement of 14 Foundational Financial Invariants", () => {
    it("Invariant 1: Money is exact integer minor units", () => {
      const m = make(1050, "INR");
      expect(m.amountMinor).toBe(1050);
      expect(Number.isInteger(m.amountMinor)).toBe(true);
    });

    it("Invariant 2: Currency is explicit and supported", () => {
      const m = make(500, "USD");
      expect(m.currency).toBe("USD");
    });

    it("Invariant 3: No implicit currency conversion", () => {
      const inr = make(100, "INR");
      const usd = make(100, "USD");
      expect(() => add(inr, usd)).toThrow(CurrencyMismatchError);
      expect(() => subtract(inr, usd)).toThrow(CurrencyMismatchError);
      expect(() => compare(inr, usd)).toThrow(CurrencyMismatchError);
    });

    it("Invariant 4: Split allocations reconcile to expense total", () => {
      const total = make(1000, "INR");
      const split = splitEqually(total, ["A", "B", "C"]);
      const sum = split.allocations.reduce((acc, a) => acc + a.amount.amountMinor, 0);
      expect(sum).toBe(total.amountMinor);
    });

    it("Invariant 5: Group balances reconcile to zero", () => {
      const total = make(10000, "INR");
      const exp = calculateExpenseBalances({
        total,
        payerId: "A",
        allocations: splitEqually(total, ["A", "B", "C", "D"]).allocations,
      });
      const group = calculateGroupBalances({ members: ["A", "B", "C", "D"], expenses: [exp] });
      const sum = group.balances.reduce((acc, b) => acc + b.netBalance.amountMinor, 0);
      expect(sum).toBe(0);
    });

    it("Invariant 6: Debt simplification preserves net positions", () => {
      const group = calculateGroupBalances({
        members: ["A", "B", "C"],
        expenses: [
          calculateExpenseBalances({
            total: make(6000, "INR"),
            payerId: "A",
            allocations: splitEqually(make(6000, "INR"), ["A", "B", "C"]).allocations,
          }),
        ],
      });

      const debts = simplifyDebts(group);
      for (const member of group.balances) {
        const received = debts.transfers
          .filter((t) => t.toUserId === member.userId)
          .reduce((acc, t) => acc + t.amount.amountMinor, 0);
        const paid = debts.transfers
          .filter((t) => t.fromUserId === member.userId)
          .reduce((acc, t) => acc + t.amount.amountMinor, 0);

        expect(received - paid).toBe(member.netBalance.amountMinor);
      }
    });

    it("Invariant 7: Settlement cannot exceed outstanding debt", () => {
      const group = calculateGroupBalances({
        members: ["A", "B"],
        expenses: [
          calculateExpenseBalances({
            total: make(2000, "INR"),
            payerId: "A",
            allocations: splitEqually(make(2000, "INR"), ["A", "B"]).allocations,
          }),
        ],
      });

      // B owes 1000, cannot settle 1001
      expect(() =>
        applySettlement(group, {
          debtorId: "B",
          creditorId: "A",
          amount: make(1001, "INR"),
        })
      ).toThrow(OverSettlementError);
    });

    it("Invariant 8: Full settlement reaches zero", () => {
      const group = calculateGroupBalances({
        members: ["A", "B"],
        expenses: [
          calculateExpenseBalances({
            total: make(2000, "INR"),
            payerId: "A",
            allocations: splitEqually(make(2000, "INR"), ["A", "B"]).allocations,
          }),
        ],
      });

      const settled = applySettlement(group, {
        debtorId: "B",
        creditorId: "A",
        amount: make(1000, "INR"),
      });

      expect(settled.balances.find((b) => b.userId === "A")!.netBalance.amountMinor).toBe(0);
      expect(settled.balances.find((b) => b.userId === "B")!.netBalance.amountMinor).toBe(0);
    });

    it("Invariant 9: Partial settlement reduces debt correctly", () => {
      const group = calculateGroupBalances({
        members: ["A", "B"],
        expenses: [
          calculateExpenseBalances({
            total: make(2000, "INR"),
            payerId: "A",
            allocations: splitEqually(make(2000, "INR"), ["A", "B"]).allocations,
          }),
        ],
      });

      const settled = applySettlement(group, {
        debtorId: "B",
        creditorId: "A",
        amount: make(400, "INR"),
      });

      expect(settled.balances.find((b) => b.userId === "A")!.netBalance.amountMinor).toBe(600);
      expect(settled.balances.find((b) => b.userId === "B")!.netBalance.amountMinor).toBe(-600);
    });

    it("Invariant 10: No floating-point arithmetic is authoritative", () => {
      const decimalMoney = fromDecimal("10.50", "INR");
      expect(decimalMoney.amountMinor).toBe(1050);
      expect(Number.isInteger(decimalMoney.amountMinor)).toBe(true);
    });

    it("Invariant 11: Results are deterministic", () => {
      const res1 = splitEqually(make(100, "INR"), ["A", "B", "C"]);
      const res2 = splitEqually(make(100, "INR"), ["A", "B", "C"]);
      expect(res1.allocations).toEqual(res2.allocations);
    });

    it("Invariant 12: Inputs are not unexpectedly mutated", () => {
      const members = ["A", "B"];
      const total = make(1000, "INR");
      splitEqually(total, members);
      expect(members).toEqual(["A", "B"]);
      expect(total.amountMinor).toBe(1000);
    });

    it("Invariant 13 & 14: No money is created or destroyed", () => {
      const total = make(5000, "INR");
      const splits = splitEqually(total, ["A", "B", "C", "D", "E"]);
      const sumAllocs = splits.allocations.reduce((acc, a) => acc + a.amount.amountMinor, 0);
      expect(sumAllocs).toBe(total.amountMinor);

      const exp = calculateExpenseBalances({ total, payerId: "A", allocations: splits.allocations });
      const group = calculateGroupBalances({ members: ["A", "B", "C", "D", "E"], expenses: [exp] });
      const sumNet = group.balances.reduce((acc, b) => acc + b.netBalance.amountMinor, 0);
      expect(sumNet).toBe(0);
    });
  });

  // ==========================================================================
  // 8. FAILURE CASES (STEP 10)
  // ==========================================================================

  describe("Failure Case Guardrails", () => {
    it("rejects invalid money amounts", () => {
      expect(() => make(NaN, "INR")).toThrow(InvalidMoneyError);
      expect(() => make(10.5, "INR")).toThrow(InvalidMoneyError);
    });

    it("rejects currency mismatch across split allocations", () => {
      expect(() =>
        splitExactly(make(1000, "INR"), [
          { participantId: "A", amount: make(500, "INR") },
          { participantId: "B", amount: make(500, "USD") },
        ])
      ).toThrow(AllocationCurrencyMismatchError);
    });

    it("rejects duplicate or invalid participants in splits", () => {
      expect(() => splitEqually(make(1000, "INR"), ["A", "A"])).toThrow(DuplicateParticipantError);
      expect(() => splitEqually(make(1000, "INR"), ["A", "   "])).toThrow(InvalidParticipantError);
      expect(() => splitEqually(make(1000, "INR"), [])).toThrow(EmptyParticipantsError);
    });

    it("rejects negative split totals", () => {
      expect(() => splitEqually(make(-100, "INR"), ["A", "B"])).toThrow(NegativeSplitTotalError);
    });

    it("rejects invalid percentage allocations", () => {
      expect(() =>
        splitByPercentage(make(1000, "INR"), [
          { participantId: "A", basisPoints: 5000 },
          { participantId: "B", basisPoints: 4999 }, // 9999 bps != 10000
        ])
      ).toThrow(PercentageTotalError);

      expect(() =>
        splitByPercentage(make(1000, "INR"), [
          { participantId: "A", basisPoints: -100 },
          { participantId: "B", basisPoints: 10100 },
        ])
      ).toThrow(NegativePercentageError);
    });

    it("rejects invalid shares allocations", () => {
      expect(() =>
        splitByShares(make(1000, "INR"), [
          { participantId: "A", shares: -1 },
          { participantId: "B", shares: 2 },
        ])
      ).toThrow(NegativeShareError);

      expect(() =>
        splitByShares(make(1000, "INR"), [
          { participantId: "A", shares: 0 },
          { participantId: "B", shares: 0 },
        ])
      ).toThrow(ZeroTotalSharesError);
    });

    it("rejects self-settlement, zero settlement, and over-settlement", () => {
      expect(() =>
        createSettlement({
          debtorId: "A",
          creditorId: "A",
          amount: make(500, "INR"),
        })
      ).toThrow(SelfSettlementError);

      expect(() =>
        createSettlement({
          debtorId: "A",
          creditorId: "B",
          amount: zero("INR"),
        })
      ).toThrow(InvalidSettlementAmountError);

      const balances = calculateGroupBalances({
        members: ["A", "B"],
        expenses: [
          calculateExpenseBalances({
            total: make(2000, "INR"),
            payerId: "A",
            allocations: splitEqually(make(2000, "INR"), ["A", "B"]).allocations,
          }),
        ],
      });

      expect(() =>
        applySettlement(balances, {
          debtorId: "B",
          creditorId: "A",
          amount: make(2000, "INR"), // debt is only 1000
        })
      ).toThrow(OverSettlementError);

      expect(() =>
        applySettlement(balances, {
          debtorId: "A", // A is creditor (+1000), not debtor
          creditorId: "B",
          amount: make(500, "INR"),
        })
      ).toThrow(DebtorCreditorMismatchError);
    });

    it("rejects unknown group members in settlements", () => {
      const balances = calculateGroupBalances({
        members: ["A", "B"],
        expenses: [
          calculateExpenseBalances({
            total: make(2000, "INR"),
            payerId: "A",
            allocations: splitEqually(make(2000, "INR"), ["A", "B"]).allocations,
          }),
        ],
      });

      expect(() =>
        applySettlement(balances, {
          debtorId: "Unknown",
          creditorId: "A",
          amount: make(500, "INR"),
        })
      ).toThrow(UnknownGroupMemberError);

      expect(() =>
        createSettlement({
          debtorId: "   ",
          creditorId: "A",
          amount: make(500, "INR"),
        })
      ).toThrow(InvalidSettlementPartiesError);

      expect(() =>
        applySettlements(balances, [
          { id: "s-dup", debtorId: "B", creditorId: "A", amount: make(100, "INR") },
          { id: "s-dup", debtorId: "B", creditorId: "A", amount: make(100, "INR") },
        ])
      ).toThrow(DuplicateSettlementError);

      const validated = validateSettlement(
        createSettlement({ debtorId: "B", creditorId: "A", amount: make(500, "INR") }),
        balances
      );
      expect(validated.debtorId).toBe("B");
      expect(validated.creditorId).toBe("A");
    });

    it("rejects under-allocation, over-allocation, and negative allocations in exact splits", () => {
      expect(() =>
        splitExactly(make(1000, "INR"), [
          { participantId: "A", amount: make(800, "INR") },
        ])
      ).toThrow(UnderAllocationError);

      expect(() =>
        splitExactly(make(1000, "INR"), [
          { participantId: "A", amount: make(1200, "INR") },
        ])
      ).toThrow(OverAllocationError);

      expect(() =>
        splitExactly(make(1000, "INR"), [
          { participantId: "A", amount: make(-200, "INR") },
          { participantId: "B", amount: make(1200, "INR") },
        ])
      ).toThrow(NegativeAllocationError);
    });

    it("verifies basis points constant and rejects empty or unreconciled debt simplifications", () => {
      expect(TOTAL_BASIS_POINTS).toBe(10000);

      expect(() => simplifyDebts([])).toThrow(EmptyBalancesError);

      expect(() =>
        simplifyDebts([
          { userId: "A", netBalance: make(100, "INR") },
          { userId: "B", netBalance: make(-50, "INR") },
        ])
      ).toThrow(UnreconciledBalancesError);

      expect(eq(make(500, "INR"), make(500, "INR"))).toBe(true);
      expect(eq(make(500, "INR"), make(600, "INR"))).toBe(false);
    });

    it("rejects unreconciled expense balances violating group zero-sum invariant", () => {
      // Create a corrupted ExpenseBalanceResult where net balances do not sum to zero
      const corruptedExpense = {
        total: make(1000, "INR"),
        payerId: "A",
        balances: [
          {
            userId: "A",
            paid: make(1000, "INR"),
            owed: make(500, "INR"),
            netBalance: make(500, "INR"),
          },
          {
            userId: "B",
            paid: make(0, "INR"),
            owed: make(400, "INR"),
            netBalance: make(-400, "INR"), // 500 - 400 = 100 != 0
          },
        ],
      };

      expect(() =>
        calculateGroupBalances({
          members: ["A", "B"],
          expenses: [corruptedExpense as unknown as import("../../src/domain/index.js").ExpenseBalanceResult],
        })
      ).toThrow(BalanceReconciliationError);
    });
  });
});
