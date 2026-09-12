import { describe, it, expect } from "vitest";
import {
  make,
  zero,
  MoneyError,
  // Split engines
  splitEqually,
  splitExactly,
  splitByPercentage,
  splitByShares,
  // Balance engine
  calculateExpenseBalances,
  getUserBalance,
  InvalidPayerError,
  BalanceReconciliationError,
  // Shared domain errors
  EmptyParticipantsError,
  DuplicateParticipantError,
  InvalidParticipantError,
  NegativeSplitTotalError,
  AllocationCurrencyMismatchError,
  NegativeAllocationError,
  UnderAllocationError,
  OverAllocationError,
  type SplitAllocation,
  type ExpenseBalanceResult,
} from "../../src/domain/index.js";

// ============================================================================
// HELPERS
// ============================================================================

/** Helper to create a SplitAllocation quickly. */
function alloc(participantId: string, amountMinor: number, currency: "INR" | "USD" | "EUR" | "GBP" | "JPY" = "INR"): SplitAllocation {
  return { participantId, amount: make(amountMinor, currency) };
}

/** Sum all net balances. */
function sumNetBalances(result: ExpenseBalanceResult): number {
  return result.balances.reduce((acc, b) => acc + b.netBalance.amountMinor, 0);
}

/** Extract net balances as a map { [userId]: amountMinor }. */
function netBalanceMap(result: ExpenseBalanceResult): Record<string, number> {
  const map: Record<string, number> = {};
  for (const b of result.balances) {
    map[b.userId] = b.netBalance.amountMinor;
  }
  return map;
}

// ============================================================================
// PAYER IS PARTICIPANT (Phase 2.6)
// ============================================================================

describe("calculateExpenseBalances — payer is participant", () => {
  it("Expense = 100, A pays 100, A owes 50, B owes 50 -> A +50, B -50", () => {
    const total = make(100, "INR");
    const allocations = [alloc("alice", 50), alloc("bob", 50)];

    const result = calculateExpenseBalances(total, "alice", allocations);

    expect(netBalanceMap(result)).toEqual({
      alice: 50,
      bob: -50,
    });
    expect(sumNetBalances(result)).toBe(0);
    expect(result.balances.length).toBe(2);

    const aliceBal = getUserBalance(result, "alice")!;
    expect(aliceBal.paid.amountMinor).toBe(100);
    expect(aliceBal.owed.amountMinor).toBe(50);
    expect(aliceBal.netBalance.amountMinor).toBe(50);

    const bobBal = getUserBalance(result, "bob")!;
    expect(bobBal.paid.amountMinor).toBe(0);
    expect(bobBal.owed.amountMinor).toBe(50);
    expect(bobBal.netBalance.amountMinor).toBe(-50);
  });

  it("Expense = 100, A pays 100, A owes 100 (solo expense) -> A 0", () => {
    const total = make(100, "INR");
    const allocations = [alloc("alice", 100)];

    const result = calculateExpenseBalances(total, "alice", allocations);

    expect(netBalanceMap(result)).toEqual({ alice: 0 });
    expect(sumNetBalances(result)).toBe(0);

    const aliceBal = getUserBalance(result, "alice")!;
    expect(aliceBal.paid.amountMinor).toBe(100);
    expect(aliceBal.owed.amountMinor).toBe(100);
    expect(aliceBal.netBalance.amountMinor).toBe(0);
  });

  it("Expense = 100, A pays 100, A owes 33, B owes 33, C owes 34 -> A +67, B -33, C -34", () => {
    const total = make(100, "INR");
    const allocations = [
      alloc("alice", 33),
      alloc("bob", 33),
      alloc("charlie", 34),
    ];

    const result = calculateExpenseBalances(total, "alice", allocations);

    expect(netBalanceMap(result)).toEqual({
      alice: 67,
      bob: -33,
      charlie: -34,
    });
    expect(sumNetBalances(result)).toBe(0);
  });

  it("Expense = 100, B pays 100, A owes 50, B owes 50 -> B +50, A -50 (payer order)", () => {
    const total = make(100, "INR");
    const allocations = [alloc("alice", 50), alloc("bob", 50)];

    const result = calculateExpenseBalances(total, "bob", allocations);

    expect(netBalanceMap(result)).toEqual({
      alice: -50,
      bob: 50,
    });
    expect(sumNetBalances(result)).toBe(0);
    // Preserves allocation order for participants
    expect(result.balances[0]!.userId).toBe("alice");
    expect(result.balances[1]!.userId).toBe("bob");
  });

  it("accepts single ExpenseBalanceInput object argument", () => {
    const total = make(100, "INR");
    const result = calculateExpenseBalances({
      total,
      payerId: "alice",
      allocations: [alloc("alice", 60), alloc("bob", 40)],
    });

    expect(netBalanceMap(result)).toEqual({
      alice: 40,
      bob: -40,
    });
    expect(sumNetBalances(result)).toBe(0);
  });
});

// ============================================================================
// PAYER NOT PARTICIPANT
// ============================================================================

describe("calculateExpenseBalances — payer not participant", () => {
  it("Alice pays 100, Bob owes 50, Charlie owes 50 -> Alice +100, Bob -50, Charlie -50", () => {
    const total = make(100, "INR");
    const allocations = [alloc("bob", 50), alloc("charlie", 50)];

    const result = calculateExpenseBalances(total, "alice", allocations);

    expect(result.balances.length).toBe(3);
    expect(netBalanceMap(result)).toEqual({
      alice: 100,
      bob: -50,
      charlie: -50,
    });
    expect(sumNetBalances(result)).toBe(0);

    // Alice (payer not in allocations) is prepended with 0 owed
    const aliceBal = getUserBalance(result, "alice")!;
    expect(aliceBal.paid.amountMinor).toBe(100);
    expect(aliceBal.owed.amountMinor).toBe(0);
    expect(aliceBal.netBalance.amountMinor).toBe(100);

    const bobBal = getUserBalance(result, "bob")!;
    expect(bobBal.paid.amountMinor).toBe(0);
    expect(bobBal.owed.amountMinor).toBe(50);
    expect(bobBal.netBalance.amountMinor).toBe(-50);
  });

  it("Alice pays 100 for Bob's solo expense -> Alice +100, Bob -100", () => {
    const total = make(100, "USD");
    const allocations = [alloc("bob", 100, "USD")];

    const result = calculateExpenseBalances(total, "alice", allocations);

    expect(netBalanceMap(result)).toEqual({
      alice: 100,
      bob: -100,
    });
    expect(sumNetBalances(result)).toBe(0);
  });

  it("Payer is in allocations but owes 0 -> Payer receives full total", () => {
    const total = make(100, "INR");
    const allocations = [alloc("alice", 0), alloc("bob", 100)];

    const result = calculateExpenseBalances(total, "alice", allocations);

    expect(netBalanceMap(result)).toEqual({
      alice: 100,
      bob: -100,
    });
    expect(sumNetBalances(result)).toBe(0);
  });
});

// ============================================================================
// INTEGRATION WITH SPLIT ENGINES (Equal, Exact, Percentage, Shares)
// ============================================================================

describe("calculateExpenseBalances — integration with split engines", () => {
  it("consumes splitEqually allocations (100 INR among 3 people)", () => {
    const total = make(100, "INR");
    const split = splitEqually(total, ["alice", "bob", "charlie"]);
    // alice receives 34 (remainder), bob 33, charlie 33
    const result = calculateExpenseBalances(total, "alice", split.allocations);

    // alice paid 100, owes 34 -> +66
    // bob paid 0, owes 33 -> -33
    // charlie paid 0, owes 33 -> -33
    expect(netBalanceMap(result)).toEqual({
      alice: 66,
      bob: -33,
      charlie: -33,
    });
    expect(sumNetBalances(result)).toBe(0);
  });

  it("consumes splitExactly allocations (250 USD among 3 people)", () => {
    const total = make(250, "USD");
    const split = splitExactly(total, [
      { participantId: "alice", amount: make(50, "USD") },
      { participantId: "bob", amount: make(100, "USD") },
      { participantId: "charlie", amount: make(100, "USD") },
    ]);

    const result = calculateExpenseBalances(total, "bob", split.allocations);

    // bob paid 250, owes 100 -> +150
    // alice paid 0, owes 50 -> -50
    // charlie paid 0, owes 100 -> -100
    expect(netBalanceMap(result)).toEqual({
      alice: -50,
      bob: 150,
      charlie: -100,
    });
    expect(sumNetBalances(result)).toBe(0);
  });

  it("consumes splitByPercentage allocations (100 EUR on 33.33/33.33/33.34)", () => {
    const total = make(100, "EUR");
    const split = splitByPercentage(total, [
      { participantId: "alice", basisPoints: 3333 },
      { participantId: "bob", basisPoints: 3333 },
      { participantId: "charlie", basisPoints: 3334 },
    ]);

    const result = calculateExpenseBalances(total, "charlie", split.allocations);

    // charlie owes 34, paid 100 -> +66
    // alice owes 33, paid 0 -> -33
    // bob owes 33, paid 0 -> -33
    expect(netBalanceMap(result)).toEqual({
      alice: -33,
      bob: -33,
      charlie: 66,
    });
    expect(sumNetBalances(result)).toBe(0);
  });

  it("consumes splitByShares allocations (600 GBP on 1:2:3 shares)", () => {
    const total = make(600, "GBP");
    const split = splitByShares(total, [
      { participantId: "alice", shares: 1 },
      { participantId: "bob", shares: 2 },
      { participantId: "charlie", shares: 3 },
    ]);

    const result = calculateExpenseBalances(total, "alice", split.allocations);

    // alice paid 600, owes 100 -> +500
    // bob paid 0, owes 200 -> -200
    // charlie paid 0, owes 300 -> -300
    expect(netBalanceMap(result)).toEqual({
      alice: 500,
      bob: -200,
      charlie: -300,
    });
    expect(sumNetBalances(result)).toBe(0);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe("calculateExpenseBalances — edge cases", () => {
  it("zero total expense produces all zero net balances", () => {
    const total = zero("INR");
    const allocations = [alloc("alice", 0), alloc("bob", 0)];

    const result = calculateExpenseBalances(total, "alice", allocations);

    expect(netBalanceMap(result)).toEqual({ alice: 0, bob: 0 });
    expect(sumNetBalances(result)).toBe(0);
  });

  it("1 paise total where payer owes the 1 paise -> settled (0)", () => {
    const total = make(1, "INR");
    const allocations = [alloc("alice", 1), alloc("bob", 0)];

    const result = calculateExpenseBalances(total, "alice", allocations);

    expect(netBalanceMap(result)).toEqual({ alice: 0, bob: 0 });
    expect(sumNetBalances(result)).toBe(0);
  });

  it("1 paise total where other owes the 1 paise -> A +1, B -1", () => {
    const total = make(1, "INR");
    const allocations = [alloc("alice", 0), alloc("bob", 1)];

    const result = calculateExpenseBalances(total, "alice", allocations);

    expect(netBalanceMap(result)).toEqual({ alice: 1, bob: -1 });
    expect(sumNetBalances(result)).toBe(0);
  });

  it("handles MAX_SAFE_INTEGER total without precision loss", () => {
    const total = make(Number.MAX_SAFE_INTEGER, "INR");
    const half = Math.floor(Number.MAX_SAFE_INTEGER / 2);
    const halfPlusOne = half + 1;
    const allocations = [alloc("alice", halfPlusOne), alloc("bob", half)];

    const result = calculateExpenseBalances(total, "alice", allocations);

    // alice paid MAX_SAFE_INTEGER, owes halfPlusOne -> net: half
    // bob paid 0, owes half -> net: -half
    expect(getUserBalance(result, "alice")!.netBalance.amountMinor).toBe(half);
    expect(getUserBalance(result, "bob")!.netBalance.amountMinor).toBe(-half);
    expect(sumNetBalances(result)).toBe(0);
  });

  it("handles many participants (10 users)", () => {
    const total = make(1000, "INR");
    const allocations = Array.from({ length: 10 }, (_, i) => alloc(`user_${i}`, 100));

    const result = calculateExpenseBalances(total, "user_0", allocations);

    // user_0 paid 1000, owes 100 -> +900
    // users 1..9 paid 0, owe 100 -> -100 each
    expect(getUserBalance(result, "user_0")!.netBalance.amountMinor).toBe(900);
    for (let i = 1; i < 10; i++) {
      expect(getUserBalance(result, `user_${i}`)!.netBalance.amountMinor).toBe(-100);
    }
    expect(sumNetBalances(result)).toBe(0);
  });
});

// ============================================================================
// VALIDATION & ERROR HANDLING
// ============================================================================

describe("calculateExpenseBalances — validation & error handling", () => {
  it("rejects negative total with NegativeSplitTotalError", () => {
    expect(() =>
      calculateExpenseBalances(make(-100, "INR"), "alice", [alloc("alice", -100)])
    ).toThrow(NegativeSplitTotalError);
  });

  it("rejects blank string payer with InvalidPayerError", () => {
    expect(() =>
      calculateExpenseBalances(make(100, "INR"), "", [alloc("alice", 100)])
    ).toThrow(InvalidPayerError);
  });

  it("rejects whitespace-only payer with InvalidPayerError", () => {
    expect(() =>
      calculateExpenseBalances(make(100, "INR"), "   ", [alloc("alice", 100)])
    ).toThrow(InvalidPayerError);
  });

  it("InvalidPayerError has code INVALID_PAYER", () => {
    try {
      calculateExpenseBalances(make(100, "INR"), "  ", [alloc("alice", 100)]);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidPayerError);
      expect((e as InvalidPayerError).code).toBe("INVALID_PAYER");
    }
  });

  it("rejects empty allocations list with EmptyParticipantsError", () => {
    expect(() =>
      calculateExpenseBalances(make(100, "INR"), "alice", [])
    ).toThrow(EmptyParticipantsError);
  });

  it("rejects blank participant ID with InvalidParticipantError", () => {
    expect(() =>
      calculateExpenseBalances(make(100, "INR"), "alice", [
        alloc("alice", 50),
        alloc("", 50),
      ])
    ).toThrow(InvalidParticipantError);
  });

  it("rejects whitespace-only participant ID with InvalidParticipantError", () => {
    expect(() =>
      calculateExpenseBalances(make(100, "INR"), "alice", [
        alloc("   ", 50),
        alloc("bob", 50),
      ])
    ).toThrow(InvalidParticipantError);
  });

  it("rejects duplicate participant IDs with DuplicateParticipantError", () => {
    expect(() =>
      calculateExpenseBalances(make(100, "INR"), "alice", [
        alloc("bob", 50),
        alloc("bob", 50),
      ])
    ).toThrow(DuplicateParticipantError);
  });

  it("rejects allocation currency mismatch with AllocationCurrencyMismatchError", () => {
    expect(() =>
      calculateExpenseBalances(make(100, "INR"), "alice", [
        alloc("alice", 50, "INR"),
        alloc("bob", 50, "USD"),
      ])
    ).toThrow(AllocationCurrencyMismatchError);
  });

  it("rejects negative allocation amount with NegativeAllocationError", () => {
    expect(() =>
      calculateExpenseBalances(make(100, "INR"), "alice", [
        alloc("alice", 150),
        alloc("bob", -50),
      ])
    ).toThrow(NegativeAllocationError);
  });

  it("rejects under-allocated total with UnderAllocationError", () => {
    expect(() =>
      calculateExpenseBalances(make(100, "INR"), "alice", [
        alloc("alice", 40),
        alloc("bob", 50),
      ])
    ).toThrow(UnderAllocationError);
  });

  it("rejects over-allocated total with OverAllocationError", () => {
    expect(() =>
      calculateExpenseBalances(make(100, "INR"), "alice", [
        alloc("alice", 60),
        alloc("bob", 50),
      ])
    ).toThrow(OverAllocationError);
  });
});

// ============================================================================
// DETERMINISM & IMMUTABILITY
// ============================================================================

describe("calculateExpenseBalances — determinism & immutability", () => {
  it("identical inputs produce identical results across calls", () => {
    const total = make(100, "INR");
    const allocations = [alloc("alice", 60), alloc("bob", 40)];

    const res1 = calculateExpenseBalances(total, "alice", allocations);
    const res2 = calculateExpenseBalances(total, "alice", allocations);

    expect(netBalanceMap(res1)).toEqual(netBalanceMap(res2));
  });

  it("does not mutate input allocations or objects", () => {
    const alloc1 = alloc("alice", 50);
    const alloc2 = alloc("bob", 50);
    const allocations = [alloc1, alloc2];

    calculateExpenseBalances(make(100, "INR"), "alice", allocations);

    expect(allocations.length).toBe(2);
    expect(allocations[0]).toBe(alloc1);
    expect(allocations[1]).toBe(alloc2);
    expect(alloc1.amount.amountMinor).toBe(50);
  });

  it("freezes the result and balances array", () => {
    const result = calculateExpenseBalances(make(100, "INR"), "alice", [
      alloc("alice", 50),
      alloc("bob", 50),
    ]);

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.balances)).toBe(true);
    expect(Object.isFrozen(result.balances[0])).toBe(true);
  });
});

// ============================================================================
// CURRENCY PRESERVATION
// ============================================================================

describe("calculateExpenseBalances — currency preservation", () => {
  it.each(["INR", "USD", "EUR", "GBP", "JPY"] as const)(
    "preserves %s currency across all net balances",
    (currency) => {
      const total = make(100, currency);
      const allocations = [alloc("alice", 60, currency), alloc("bob", 40, currency)];

      const result = calculateExpenseBalances(total, "alice", allocations);

      expect(result.total.currency).toBe(currency);
      for (const b of result.balances) {
        expect(b.paid.currency).toBe(currency);
        expect(b.owed.currency).toBe(currency);
        expect(b.netBalance.currency).toBe(currency);
      }
      expect(sumNetBalances(result)).toBe(0);
    }
  );
});

// ============================================================================
// FINANCIAL INVARIANTS AUDIT
// ============================================================================

describe("calculateExpenseBalances — Financial Invariants Audit", () => {
  it("Invariant: Zero-sum balance rule across a comprehensive matrix", () => {
    const testCases: [number, number[]][] = [
      [100, [50, 50]],
      [100, [33, 33, 34]],
      [1000, [250, 250, 250, 250]],
      [1, [1, 0]],
      [1, [0, 1]],
      [0, [0, 0]],
      [9999, [1000, 2000, 3000, 3999]],
      [1000000, [1000000]],
    ];

    for (const [totalAmount, amountsList] of testCases) {
      const allocations = amountsList.map((amt, i) => alloc(`user_${i}`, amt));
      const result = calculateExpenseBalances(make(totalAmount, "INR"), "user_0", allocations);
      expect(sumNetBalances(result)).toBe(0);
    }
  });

  it("Invariant: Error hierarchy extends MoneyError -> Error", () => {
    expect(new InvalidPayerError()).toBeInstanceOf(MoneyError);
    expect(new InvalidPayerError()).toBeInstanceOf(Error);

    expect(new BalanceReconciliationError(5)).toBeInstanceOf(MoneyError);
    expect(new BalanceReconciliationError(5)).toBeInstanceOf(Error);
  });

  it("Invariant: getUserBalance returns undefined for unknown user", () => {
    const result = calculateExpenseBalances(make(100, "INR"), "alice", [
      alloc("alice", 50),
      alloc("bob", 50),
    ]);
    expect(getUserBalance(result, "unknown_user")).toBeUndefined();
    expect(getUserBalance(result, "alice")).toBeDefined();
  });
});
