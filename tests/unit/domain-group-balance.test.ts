import { describe, it, expect } from "vitest";
import {
  make,
  zero,
  MoneyError,
  CurrencyMismatchError,
  // Split engines
  splitEqually,
  splitByPercentage,
  splitByShares,
  // Balance engine
  calculateExpenseBalances,
  // Group Balance engine
  calculateGroupBalances,
  getMemberBalance,
  EmptyGroupMembersError,
  InvalidMemberError,
  DuplicateMemberError,
  UnknownGroupMemberError,
  InvalidSettlementError,
  type GroupBalanceResult,
} from "../../src/domain/index.js";

// ============================================================================
// HELPERS
// ============================================================================

/** Helper to sum all member net balances in a group result. */
function sumGroupNetBalances(result: GroupBalanceResult): number {
  return result.balances.reduce((acc, b) => acc + b.netBalance.amountMinor, 0);
}

/** Helper to extract net balances as a map { [userId]: amountMinor }. */
function groupBalanceMap(result: GroupBalanceResult): Record<string, number> {
  const map: Record<string, number> = {};
  for (const b of result.balances) {
    map[b.userId] = b.netBalance.amountMinor;
  }
  return map;
}

// ============================================================================
// BASIC & MULTIPLE EXPENSES (Phase 2.7)
// ============================================================================

describe("calculateGroupBalances — expense aggregation", () => {
  it("aggregates one expense correctly (A pays 100, A owes 50, B owes 50)", () => {
    const total = make(100, "INR");
    const exp1 = calculateExpenseBalances(total, "alice", [
      { participantId: "alice", amount: make(50, "INR") },
      { participantId: "bob", amount: make(50, "INR") },
    ]);

    const result = calculateGroupBalances({
      members: ["alice", "bob"],
      expenses: [exp1],
    });

    expect(groupBalanceMap(result)).toEqual({
      alice: 50,
      bob: -50,
    });
    expect(sumGroupNetBalances(result)).toBe(0);
    expect(result.memberCount).toBe(2);
    expect(result.currency).toBe("INR");
  });

  it("Step 10 Required Example: Expense 1 (A +50, B -50) + Expense 2 (B +30, C -30) -> A +50, B -20, C -30", () => {
    // Expense 1: A pays 100, A owes 50, B owes 50 -> A +50, B -50
    const exp1 = calculateExpenseBalances(make(100, "INR"), "alice", [
      { participantId: "alice", amount: make(50, "INR") },
      { participantId: "bob", amount: make(50, "INR") },
    ]);

    // Expense 2: B pays 60, B owes 30, C owes 30 -> B +30, C -30
    const exp2 = calculateExpenseBalances(make(60, "INR"), "bob", [
      { participantId: "bob", amount: make(30, "INR") },
      { participantId: "charlie", amount: make(30, "INR") },
    ]);

    const result = calculateGroupBalances({
      members: ["alice", "bob", "charlie"],
      expenses: [exp1, exp2],
    });

    // A: +50
    // B: -50 + 30 = -20
    // C: -30
    expect(groupBalanceMap(result)).toEqual({
      alice: 50,
      bob: -20,
      charlie: -30,
    });
    // Invariant: 50 + (-20) + (-30) === 0
    expect(sumGroupNetBalances(result)).toBe(0);
  });

  it("aggregates multiple expenses with diverse payers in a 4-person group", () => {
    // Exp 1: A pays 120, split equally between A, B, C, D (30 each)
    // A: +90, B: -30, C: -30, D: -30
    const exp1 = calculateExpenseBalances(
      make(120, "USD"),
      "alice",
      splitEqually(make(120, "USD"), ["alice", "bob", "charlie", "david"]).allocations
    );

    // Exp 2: B pays 40 for B and C (20 each)
    // B: +20, C: -20
    const exp2 = calculateExpenseBalances(
      make(40, "USD"),
      "bob",
      splitEqually(make(40, "USD"), ["bob", "charlie"]).allocations
    );

    // Exp 3: D pays 50 for Alice (50)
    // D: +50, Alice: -50
    const exp3 = calculateExpenseBalances(make(50, "USD"), "david", [
      { participantId: "alice", amount: make(50, "USD") },
    ]);

    const result = calculateGroupBalances({
      members: ["alice", "bob", "charlie", "david"],
      expenses: [exp1, exp2, exp3],
    });

    // Alice: +90 (exp1) + 0 (exp2) - 50 (exp3) = +40
    // Bob:   -30 (exp1) + 20 (exp2) + 0 (exp3) = -10
    // Charlie: -30 (exp1) - 20 (exp2) + 0 (exp3) = -50
    // David: -30 (exp1) + 0 (exp2) + 50 (exp3) = +20
    expect(groupBalanceMap(result)).toEqual({
      alice: 40,
      bob: -10,
      charlie: -50,
      david: 20,
    });
    expect(sumGroupNetBalances(result)).toBe(0);
  });
});

// ============================================================================
// ZERO-BALANCE MEMBERS & FULLY BALANCED GROUPS
// ============================================================================

describe("calculateGroupBalances — zero-balance handling", () => {
  it("member with no expenses has 0 paid, 0 owed, 0 netBalance", () => {
    const exp1 = calculateExpenseBalances(make(100, "INR"), "alice", [
      { participantId: "alice", amount: make(50, "INR") },
      { participantId: "bob", amount: make(50, "INR") },
    ]);

    const result = calculateGroupBalances({
      members: ["alice", "bob", "silent_sam"],
      expenses: [exp1],
    });

    expect(groupBalanceMap(result)).toEqual({
      alice: 50,
      bob: -50,
      silent_sam: 0,
    });

    const samBal = getMemberBalance(result, "silent_sam")!;
    expect(samBal.paid.amountMinor).toBe(0);
    expect(samBal.owed.amountMinor).toBe(0);
    expect(samBal.netBalance.amountMinor).toBe(0);
    expect(sumGroupNetBalances(result)).toBe(0);
  });

  it("group with zero expenses resolves all members to 0 balance", () => {
    const result = calculateGroupBalances({
      members: ["alice", "bob", "charlie"],
      expenses: [],
    });

    expect(groupBalanceMap(result)).toEqual({
      alice: 0,
      bob: 0,
      charlie: 0,
    });
    expect(sumGroupNetBalances(result)).toBe(0);
    expect(result.currency).toBe("INR");
  });

  it("fully balanced group where counter-expenses cancel out to 0", () => {
    // Exp 1: Alice pays 50 for Bob
    const exp1 = calculateExpenseBalances(make(50, "INR"), "alice", [
      { participantId: "bob", amount: make(50, "INR") },
    ]);
    // Exp 2: Bob pays 50 for Alice
    const exp2 = calculateExpenseBalances(make(50, "INR"), "bob", [
      { participantId: "alice", amount: make(50, "INR") },
    ]);

    const result = calculateGroupBalances({
      members: ["alice", "bob"],
      expenses: [exp1, exp2],
    });

    expect(groupBalanceMap(result)).toEqual({
      alice: 0,
      bob: 0,
    });
    expect(sumGroupNetBalances(result)).toBe(0);
  });
});

// ============================================================================
// SETTLEMENT AGGREGATION
// ============================================================================

describe("calculateGroupBalances — settlement aggregation", () => {
  it("expense + settlement brings users to fully settled state (0)", () => {
    // Alice pays 100, split 50/50 with Bob -> Alice +50, Bob -50
    const exp1 = calculateExpenseBalances(make(100, "INR"), "alice", [
      { participantId: "alice", amount: make(50, "INR") },
      { participantId: "bob", amount: make(50, "INR") },
    ]);

    // Bob settles by paying Alice 50
    const settlement = {
      payerId: "bob",
      receiverId: "alice",
      amount: make(50, "INR"),
    };

    const result = calculateGroupBalances({
      members: ["alice", "bob"],
      expenses: [exp1],
      settlements: [settlement],
    });

    // Alice: +50 (exp) - 50 (settlement received) = 0
    // Bob:   -50 (exp) + 50 (settlement paid) = 0
    expect(groupBalanceMap(result)).toEqual({
      alice: 0,
      bob: 0,
    });
    expect(sumGroupNetBalances(result)).toBe(0);

    const aliceBal = getMemberBalance(result, "alice")!;
    expect(aliceBal.paid.amountMinor).toBe(100);
    expect(aliceBal.owed.amountMinor).toBe(100); // 50 exp owed + 50 settlement received
    expect(aliceBal.netBalance.amountMinor).toBe(0);

    const bobBal = getMemberBalance(result, "bob")!;
    expect(bobBal.paid.amountMinor).toBe(50); // 0 exp paid + 50 settlement paid
    expect(bobBal.owed.amountMinor).toBe(50);
    expect(bobBal.netBalance.amountMinor).toBe(0);
  });

  it("partial settlement reduces debt correctly", () => {
    // Alice pays 100, split 50/50 with Bob -> Alice +50, Bob -50
    const exp1 = calculateExpenseBalances(make(100, "INR"), "alice", [
      { participantId: "alice", amount: make(50, "INR") },
      { participantId: "bob", amount: make(50, "INR") },
    ]);

    // Bob settles partially: 20 INR
    const settlement = {
      payerId: "bob",
      receiverId: "alice",
      amount: make(20, "INR"),
    };

    const result = calculateGroupBalances({
      members: ["alice", "bob"],
      expenses: [exp1],
      settlements: [settlement],
    });

    // Alice: +50 - 20 = +30
    // Bob:   -50 + 20 = -30
    expect(groupBalanceMap(result)).toEqual({
      alice: 30,
      bob: -30,
    });
    expect(sumGroupNetBalances(result)).toBe(0);
  });
});

// ============================================================================
// INTEGRATION WITH COMPLEX SPLITS (Percentages, Shares)
// ============================================================================

describe("calculateGroupBalances — complex split integration", () => {
  it("aggregates percentage split with remainder reconciliation", () => {
    // 100 EUR on 33.33 / 33.33 / 33.34
    const split = splitByPercentage(make(100, "EUR"), [
      { participantId: "alice", basisPoints: 3333 },
      { participantId: "bob", basisPoints: 3333 },
      { participantId: "charlie", basisPoints: 3334 },
    ]);
    const exp = calculateExpenseBalances(make(100, "EUR"), "alice", split.allocations);

    const result = calculateGroupBalances({
      members: ["alice", "bob", "charlie"],
      expenses: [exp],
    });

    // Alice paid 100, owes 33 -> +67
    // Bob owes 33 -> -33
    // Charlie owes 34 -> -34
    expect(groupBalanceMap(result)).toEqual({
      alice: 67,
      bob: -33,
      charlie: -34,
    });
    expect(sumGroupNetBalances(result)).toBe(0);
  });

  it("aggregates shares split with remainder reconciliation", () => {
    // 600 GBP on 1:2:3 shares
    const split = splitByShares(make(600, "GBP"), [
      { participantId: "alice", shares: 1 },
      { participantId: "bob", shares: 2 },
      { participantId: "charlie", shares: 3 },
    ]);
    const exp = calculateExpenseBalances(make(600, "GBP"), "bob", split.allocations);

    const result = calculateGroupBalances({
      members: ["alice", "bob", "charlie"],
      expenses: [exp],
    });

    // Bob paid 600, owes 200 -> +400
    // Alice owes 100 -> -100
    // Charlie owes 300 -> -300
    expect(groupBalanceMap(result)).toEqual({
      alice: -100,
      bob: 400,
      charlie: -300,
    });
    expect(sumGroupNetBalances(result)).toBe(0);
  });
});

// ============================================================================
// VALIDATION & ERROR HANDLING
// ============================================================================

describe("calculateGroupBalances — validation & error handling", () => {
  it("rejects empty group members list with EmptyGroupMembersError", () => {
    expect(() =>
      calculateGroupBalances({
        members: [],
        expenses: [],
      })
    ).toThrow(EmptyGroupMembersError);
  });

  it("rejects blank member ID with InvalidMemberError", () => {
    expect(() =>
      calculateGroupBalances({
        members: ["alice", ""],
        expenses: [],
      })
    ).toThrow(InvalidMemberError);
  });

  it("rejects whitespace member ID with InvalidMemberError", () => {
    expect(() =>
      calculateGroupBalances({
        members: ["alice", "   "],
        expenses: [],
      })
    ).toThrow(InvalidMemberError);
  });

  it("rejects duplicate member ID with DuplicateMemberError", () => {
    expect(() =>
      calculateGroupBalances({
        members: ["alice", "bob", "alice"],
        expenses: [],
      })
    ).toThrow(DuplicateMemberError);
  });

  it("DuplicateMemberError includes duplicate member ID", () => {
    try {
      calculateGroupBalances({
        members: ["alice", "alice"],
        expenses: [],
      }) ;
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DuplicateMemberError);
      expect((e as DuplicateMemberError).code).toBe("DUPLICATE_MEMBER");
      expect((e as Error).message).toContain("alice");
    }
  });

  it("rejects expense referencing user outside the group with UnknownGroupMemberError", () => {
    const exp = calculateExpenseBalances(make(100, "INR"), "alice", [
      { participantId: "alice", amount: make(50, "INR") },
      { participantId: "stranger", amount: make(50, "INR") },
    ]);

    expect(() =>
      calculateGroupBalances({
        members: ["alice", "bob"],
        expenses: [exp],
      })
    ).toThrow(UnknownGroupMemberError);
  });

  it("rejects settlement referencing non-member with UnknownGroupMemberError", () => {
    expect(() =>
      calculateGroupBalances({
        members: ["alice", "bob"],
        expenses: [],
        settlements: [
          { payerId: "alice", receiverId: "stranger", amount: make(50, "INR") },
        ],
      })
    ).toThrow(UnknownGroupMemberError);
  });

  it("rejects settlement where payer equals receiver with InvalidSettlementError", () => {
    expect(() =>
      calculateGroupBalances({
        members: ["alice", "bob"],
        expenses: [],
        settlements: [
          { payerId: "alice", receiverId: "alice", amount: make(50, "INR") },
        ],
      })
    ).toThrow(InvalidSettlementError);
  });

  it("rejects settlement with zero amount with InvalidSettlementError", () => {
    expect(() =>
      calculateGroupBalances({
        members: ["alice", "bob"],
        expenses: [],
        settlements: [
          { payerId: "alice", receiverId: "bob", amount: zero("INR") },
        ],
      })
    ).toThrow(InvalidSettlementError);
  });

  it("rejects mixed currencies across expenses with CurrencyMismatchError", () => {
    const exp1 = calculateExpenseBalances(make(100, "INR"), "alice", [
      { participantId: "alice", amount: make(50, "INR") },
      { participantId: "bob", amount: make(50, "INR") },
    ]);
    const exp2 = calculateExpenseBalances(make(50, "USD"), "alice", [
      { participantId: "alice", amount: make(25, "USD") },
      { participantId: "bob", amount: make(25, "USD") },
    ]);

    expect(() =>
      calculateGroupBalances({
        members: ["alice", "bob"],
        expenses: [exp1, exp2],
      })
    ).toThrow(CurrencyMismatchError);
  });

  it("rejects settlement currency mismatch with CurrencyMismatchError", () => {
    const exp1 = calculateExpenseBalances(make(100, "INR"), "alice", [
      { participantId: "alice", amount: make(50, "INR") },
      { participantId: "bob", amount: make(50, "INR") },
    ]);

    expect(() =>
      calculateGroupBalances({
        members: ["alice", "bob"],
        expenses: [exp1],
        settlements: [
          { payerId: "bob", receiverId: "alice", amount: make(50, "USD") },
        ],
      })
    ).toThrow(CurrencyMismatchError);
  });
});

// ============================================================================
// DETERMINISM, IMMUTABILITY & ORDERING
// ============================================================================

describe("calculateGroupBalances — determinism & ordering", () => {
  it("output balances match members input order exactly", () => {
    const exp = calculateExpenseBalances(make(100, "INR"), "charlie", [
      { participantId: "alice", amount: make(50, "INR") },
      { participantId: "charlie", amount: make(50, "INR") },
    ]);

    // Input order: bob, charlie, alice
    const result = calculateGroupBalances({
      members: ["bob", "charlie", "alice"],
      expenses: [exp],
    });

    expect(result.balances.map((b) => b.userId)).toEqual([
      "bob",
      "charlie",
      "alice",
    ]);
  });

  it("identical inputs produce identical results across calls", () => {
    const exp = calculateExpenseBalances(make(100, "INR"), "alice", [
      { participantId: "alice", amount: make(50, "INR") },
      { participantId: "bob", amount: make(50, "INR") },
    ]);

    const res1 = calculateGroupBalances({ members: ["alice", "bob"], expenses: [exp] });
    const res2 = calculateGroupBalances({ members: ["alice", "bob"], expenses: [exp] });

    expect(groupBalanceMap(res1)).toEqual(groupBalanceMap(res2));
  });

  it("does not mutate inputs and freezes result", () => {
    const members = ["alice", "bob"];
    const exp = calculateExpenseBalances(make(100, "INR"), "alice", [
      { participantId: "alice", amount: make(50, "INR") },
      { participantId: "bob", amount: make(50, "INR") },
    ]);
    const expenses = [exp];

    const result = calculateGroupBalances({ members, expenses });

    expect(members.length).toBe(2);
    expect(expenses.length).toBe(1);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.balances)).toBe(true);
    expect(Object.isFrozen(result.balances[0])).toBe(true);
  });
});

// ============================================================================
// FINANCIAL INVARIANTS AUDIT
// ============================================================================

describe("calculateGroupBalances — Financial Invariants Audit", () => {
  it("Invariant: Zero-sum rule holds across all tested currencies", () => {
    for (const currency of ["INR", "USD", "EUR", "GBP", "JPY"] as const) {
      const exp = calculateExpenseBalances(make(100, currency), "alice", [
        { participantId: "alice", amount: make(40, currency) },
        { participantId: "bob", amount: make(60, currency) },
      ]);

      const result = calculateGroupBalances({
        currency,
        members: ["alice", "bob"],
        expenses: [exp],
      });

      expect(result.currency).toBe(currency);
      expect(sumGroupNetBalances(result)).toBe(0);
    }
  });

  it("Invariant: Error hierarchy extends MoneyError -> Error", () => {
    expect(new EmptyGroupMembersError()).toBeInstanceOf(MoneyError);
    expect(new EmptyGroupMembersError()).toBeInstanceOf(Error);

    expect(new InvalidMemberError(0)).toBeInstanceOf(MoneyError);
    expect(new InvalidMemberError(0)).toBeInstanceOf(Error);

    expect(new DuplicateMemberError("x")).toBeInstanceOf(MoneyError);
    expect(new DuplicateMemberError("x")).toBeInstanceOf(Error);

    expect(new UnknownGroupMemberError("x")).toBeInstanceOf(MoneyError);
    expect(new UnknownGroupMemberError("x")).toBeInstanceOf(Error);

    expect(new InvalidSettlementError("err")).toBeInstanceOf(MoneyError);
    expect(new InvalidSettlementError("err")).toBeInstanceOf(Error);
  });

  it("Invariant: getMemberBalance helper returns correct record or undefined", () => {
    const result = calculateGroupBalances({
      members: ["alice", "bob"],
      expenses: [],
    });

    expect(getMemberBalance(result, "alice")).toBeDefined();
    expect(getMemberBalance(result, "alice")!.userId).toBe("alice");
    expect(getMemberBalance(result, "ghost")).toBeUndefined();
  });
});
