import { describe, it, expect } from "vitest";
import {
  make,
  MoneyError,
  CurrencyMismatchError,
  // Split engines
  splitEqually,
  // Balance engine
  calculateExpenseBalances,
  // Group Balance engine
  calculateGroupBalances,
  // Debt Simplification engine
  simplifyDebts,
  EmptyBalancesError,
  UnreconciledBalancesError,
  DuplicateParticipantError,
  InvalidParticipantError,
  type NetBalanceInput,
  type SimplifiedDebtsResult,
} from "../../src/domain/index.js";

// ============================================================================
// HELPERS
// ============================================================================

/** Helper to create NetBalanceInput quickly. */
function nBal(userId: string, amountMinor: number, currency: "INR" | "USD" | "EUR" | "GBP" | "JPY" = "INR"): NetBalanceInput {
  return { userId, netBalance: make(amountMinor, currency) };
}

/**
 * Verifies that the simplified transfers preserve every user's exact net position
 * and that applying all transfers leaves every user at exactly zero.
 */
function verifyTransferPreservation(
  inputs: readonly NetBalanceInput[],
  result: SimplifiedDebtsResult
): void {
  const userNetDeltas: Record<string, number> = {};

  for (const item of inputs) {
    userNetDeltas[item.userId] = 0;
  }

  for (const transfer of result.transfers) {
    expect(transfer.amount.amountMinor).toBeGreaterThan(0);
    expect(transfer.fromUserId).not.toBe(transfer.toUserId);
    expect(transfer.debtorId).toBe(transfer.fromUserId);
    expect(transfer.creditorId).toBe(transfer.toUserId);
    expect(transfer.amount.currency).toBe(result.currency);

    // Debtor paid money -> pays transfer.amount
    userNetDeltas[transfer.fromUserId] = (userNetDeltas[transfer.fromUserId] ?? 0) - transfer.amount.amountMinor;
    // Creditor received money -> receives transfer.amount
    userNetDeltas[transfer.toUserId] = (userNetDeltas[transfer.toUserId] ?? 0) + transfer.amount.amountMinor;
  }

  // Check that net received matches original net balance
  for (const item of inputs) {
    const delta = userNetDeltas[item.userId] ?? 0;
    // Debtor had -X, paid X -> delta is -X -> matches original netBalance!
    // Creditor had +Y, received Y -> delta is +Y -> matches original netBalance!
    expect(delta).toBe(item.netBalance.amountMinor);
  }
}

// ============================================================================
// REQUIRED EXAMPLES (Step 10) & BASIC TRANSFERS
// ============================================================================

describe("simplifyDebts — Step 10 Required Examples & basic transfers", () => {
  it("Required 1: A +50, B -50 -> B pays A 50", () => {
    const inputs = [nBal("alice", 50), nBal("bob", -50)];

    const result = simplifyDebts(inputs);

    expect(result.transferCount).toBe(1);
    expect(result.transfers[0]!.fromUserId).toBe("bob");
    expect(result.transfers[0]!.toUserId).toBe("alice");
    expect(result.transfers[0]!.amount.amountMinor).toBe(50);
    expect(result.currency).toBe("INR");
    verifyTransferPreservation(inputs, result);
  });

  it("Required 2: A +50, B -30, C -20 -> B pays A 30, C pays A 20", () => {
    const inputs = [nBal("alice", 50), nBal("bob", -30), nBal("charlie", -20)];

    const result = simplifyDebts(inputs);

    expect(result.transferCount).toBe(2);
    // B (30) > C (20), so B is processed first
    expect(result.transfers[0]!.fromUserId).toBe("bob");
    expect(result.transfers[0]!.toUserId).toBe("alice");
    expect(result.transfers[0]!.amount.amountMinor).toBe(30);

    expect(result.transfers[1]!.fromUserId).toBe("charlie");
    expect(result.transfers[1]!.toUserId).toBe("alice");
    expect(result.transfers[1]!.amount.amountMinor).toBe(20);

    verifyTransferPreservation(inputs, result);
  });

  it("Required 3: A +30, B +20, C -50 -> C pays A 30, C pays B 20", () => {
    const inputs = [nBal("alice", 30), nBal("bob", 20), nBal("charlie", -50)];

    const result = simplifyDebts(inputs);

    expect(result.transferCount).toBe(2);
    // A (30) > B (20), so A is matched first
    expect(result.transfers[0]!.fromUserId).toBe("charlie");
    expect(result.transfers[0]!.toUserId).toBe("alice");
    expect(result.transfers[0]!.amount.amountMinor).toBe(30);

    expect(result.transfers[1]!.fromUserId).toBe("charlie");
    expect(result.transfers[1]!.toUserId).toBe("bob");
    expect(result.transfers[1]!.amount.amountMinor).toBe(20);

    verifyTransferPreservation(inputs, result);
  });

  it("Required 4: A +70, B -40, C -30 -> B pays A 40, C pays A 30", () => {
    const inputs = [nBal("alice", 70), nBal("bob", -40), nBal("charlie", -30)];

    const result = simplifyDebts(inputs);

    expect(result.transferCount).toBe(2);
    expect(result.transfers[0]!.fromUserId).toBe("bob");
    expect(result.transfers[0]!.toUserId).toBe("alice");
    expect(result.transfers[0]!.amount.amountMinor).toBe(40);

    expect(result.transfers[1]!.fromUserId).toBe("charlie");
    expect(result.transfers[1]!.toUserId).toBe("alice");
    expect(result.transfers[1]!.amount.amountMinor).toBe(30);

    verifyTransferPreservation(inputs, result);
  });
});

// ============================================================================
// THREE-PERSON CHAIN & MULTI-PARTY SIMPLIFICATION
// ============================================================================

describe("simplifyDebts — chains and multi-party simplification", () => {
  it("Three-person chain: A owes B 500, B owes C 500 -> simplified to A pays C 500", () => {
    // In net balances: A: -500, B: 0, C: +500
    const inputs = [nBal("alice", -500), nBal("bob", 0), nBal("charlie", 500)];

    const result = simplifyDebts(inputs);

    expect(result.transferCount).toBe(1);
    expect(result.transfers[0]!.fromUserId).toBe("alice");
    expect(result.transfers[0]!.toUserId).toBe("charlie");
    expect(result.transfers[0]!.amount.amountMinor).toBe(500);
    verifyTransferPreservation(inputs, result);
  });

  it("Multiple debtors & multiple creditors: A +60, B +40, C -70, D -30", () => {
    const inputs = [
      nBal("alice", 60),
      nBal("bob", 40),
      nBal("charlie", -70),
      nBal("david", -30),
    ];

    const result = simplifyDebts(inputs);

    // C (70) pays A (60) 60 -> C has 10 left, A done
    // C (10) pays B (40) 10 -> C done, B has 30 left
    // D (30) pays B (30) 30 -> D done, B done
    expect(result.transferCount).toBe(3);
    expect(result.transfers[0]).toEqual(
      expect.objectContaining({ fromUserId: "charlie", toUserId: "alice", amount: make(60, "INR") })
    );
    expect(result.transfers[1]).toEqual(
      expect.objectContaining({ fromUserId: "charlie", toUserId: "bob", amount: make(10, "INR") })
    );
    expect(result.transfers[2]).toEqual(
      expect.objectContaining({ fromUserId: "david", toUserId: "bob", amount: make(30, "INR") })
    );

    verifyTransferPreservation(inputs, result);
  });

  it("Tie breaking by input order: A +60, B -30, C -30 -> B pays A 30, then C pays A 30", () => {
    const inputs = [nBal("alice", 60), nBal("bob", -30), nBal("charlie", -30)];

    const result = simplifyDebts(inputs);

    expect(result.transferCount).toBe(2);
    // B was at index 1, C at index 2 -> B is processed first
    expect(result.transfers[0]!.fromUserId).toBe("bob");
    expect(result.transfers[0]!.toUserId).toBe("alice");
    expect(result.transfers[0]!.amount.amountMinor).toBe(30);

    expect(result.transfers[1]!.fromUserId).toBe("charlie");
    expect(result.transfers[1]!.toUserId).toBe("alice");
    expect(result.transfers[1]!.amount.amountMinor).toBe(30);

    verifyTransferPreservation(inputs, result);
  });
});

// ============================================================================
// SETTLED & ZERO-BALANCE STATES
// ============================================================================

describe("simplifyDebts — settled states and zero balances", () => {
  it("all zero balances produces empty transfer list without error", () => {
    const inputs = [nBal("alice", 0), nBal("bob", 0), nBal("charlie", 0)];

    const result = simplifyDebts(inputs);

    expect(result.transferCount).toBe(0);
    expect(result.transfers).toEqual([]);
    expect(result.currency).toBe("INR");
  });

  it("zero-balance users are ignored in transfer generation", () => {
    const inputs = [
      nBal("alice", 50),
      nBal("neutral", 0),
      nBal("bob", -50),
    ];

    const result = simplifyDebts(inputs);

    expect(result.transferCount).toBe(1);
    expect(result.transfers[0]!.fromUserId).toBe("bob");
    expect(result.transfers[0]!.toUserId).toBe("alice");
    expect(result.transfers[0]!.amount.amountMinor).toBe(50);
    verifyTransferPreservation(inputs, result);
  });
});

// ============================================================================
// DIRECT INTEGRATION WITH PHASE 2.6 & 2.7 RESULTS
// ============================================================================

describe("simplifyDebts — integration with Balance and Group Balance engines", () => {
  it("consumes ExpenseBalanceResult directly", () => {
    const total = make(100, "INR");
    const allocations = splitEqually(total, ["alice", "bob", "charlie"]).allocations;
    const expResult = calculateExpenseBalances(total, "alice", allocations);

    const result = simplifyDebts(expResult);

    expect(result.transferCount).toBeGreaterThan(0);
    expect(result.currency).toBe("INR");
    for (const t of result.transfers) {
      expect(t.amount.amountMinor).toBeGreaterThan(0);
    }
  });

  it("consumes GroupBalanceResult directly", () => {
    const total = make(100, "USD");
    const allocations = splitEqually(total, ["alice", "bob"]).allocations;
    const expResult = calculateExpenseBalances(total, "alice", allocations);

    const groupResult = calculateGroupBalances({
      members: ["alice", "bob"],
      expenses: [expResult],
    });

    const result = simplifyDebts(groupResult);

    expect(result.transferCount).toBe(1);
    expect(result.transfers[0]!.fromUserId).toBe("bob");
    expect(result.transfers[0]!.toUserId).toBe("alice");
    expect(result.transfers[0]!.amount.amountMinor).toBe(50);
    expect(result.currency).toBe("USD");
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe("simplifyDebts — edge cases", () => {
  it("handles smallest indivisible unit (1 paise)", () => {
    const inputs = [nBal("alice", 1), nBal("bob", -1)];

    const result = simplifyDebts(inputs);

    expect(result.transferCount).toBe(1);
    expect(result.transfers[0]!.amount.amountMinor).toBe(1);
    verifyTransferPreservation(inputs, result);
  });

  it("handles MAX_SAFE_INTEGER balance without overflow", () => {
    const inputs = [
      nBal("alice", Number.MAX_SAFE_INTEGER),
      nBal("bob", -Number.MAX_SAFE_INTEGER),
    ];

    const result = simplifyDebts(inputs);

    expect(result.transferCount).toBe(1);
    expect(result.transfers[0]!.amount.amountMinor).toBe(Number.MAX_SAFE_INTEGER);
    verifyTransferPreservation(inputs, result);
  });
});

// ============================================================================
// VALIDATION & ERROR HANDLING
// ============================================================================

describe("simplifyDebts — validation & error handling", () => {
  it("rejects empty balances array with EmptyBalancesError", () => {
    expect(() => simplifyDebts([])).toThrow(EmptyBalancesError);
  });

  it("EmptyBalancesError has code EMPTY_BALANCES", () => {
    try {
      simplifyDebts([]);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(EmptyBalancesError);
      expect((e as EmptyBalancesError).code).toBe("EMPTY_BALANCES");
    }
  });

  it("rejects unreconciled balances (sum !== 0) with UnreconciledBalancesError", () => {
    const inputs = [nBal("alice", 50), nBal("bob", -40)]; // sum = 10

    expect(() => simplifyDebts(inputs)).toThrow(UnreconciledBalancesError);
  });

  it("UnreconciledBalancesError includes discrepancy and code", () => {
    try {
      simplifyDebts([nBal("alice", 100), nBal("bob", -90)]);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(UnreconciledBalancesError);
      expect((e as UnreconciledBalancesError).code).toBe("UNRECONCILED_BALANCES");
      expect((e as Error).message).toContain("10 minor units");
    }
  });

  it("rejects blank userId with InvalidParticipantError", () => {
    expect(() =>
      simplifyDebts([nBal("", 50), nBal("bob", -50)])
    ).toThrow(InvalidParticipantError);
  });

  it("rejects whitespace-only userId with InvalidParticipantError", () => {
    expect(() =>
      simplifyDebts([nBal("   ", 50), nBal("bob", -50)])
    ).toThrow(InvalidParticipantError);
  });

  it("rejects duplicate user with DuplicateParticipantError", () => {
    expect(() =>
      simplifyDebts([nBal("alice", 50), nBal("alice", -50)])
    ).toThrow(DuplicateParticipantError);
  });

  it("rejects mixed currencies with CurrencyMismatchError", () => {
    expect(() =>
      simplifyDebts([nBal("alice", 50, "INR"), nBal("bob", -50, "USD")])
    ).toThrow(CurrencyMismatchError);
  });
});

// ============================================================================
// DETERMINISM & IMMUTABILITY
// ============================================================================

describe("simplifyDebts — determinism & immutability", () => {
  it("multiple calls with identical input produce identical transfers", () => {
    const inputs = [
      nBal("alice", 50),
      nBal("bob", -30),
      nBal("charlie", -20),
    ];

    const res1 = simplifyDebts(inputs);
    const res2 = simplifyDebts(inputs);

    expect(res1.transfers).toEqual(res2.transfers);
  });

  it("does not mutate input array or objects", () => {
    const b1 = nBal("alice", 50);
    const b2 = nBal("bob", -50);
    const inputs = [b1, b2];

    simplifyDebts(inputs);

    expect(inputs.length).toBe(2);
    expect(inputs[0]).toBe(b1);
    expect(inputs[1]).toBe(b2);
    expect(b1.netBalance.amountMinor).toBe(50);
  });

  it("freezes result and transfers array and each transfer object", () => {
    const result = simplifyDebts([nBal("alice", 50), nBal("bob", -50)]);

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.transfers)).toBe(true);
    expect(Object.isFrozen(result.transfers[0])).toBe(true);
  });
});

// ============================================================================
// FINANCIAL INVARIANTS AUDIT
// ============================================================================

describe("simplifyDebts — Financial Invariants Audit", () => {
  it("Invariant: Preserves all currencies (INR, USD, EUR, GBP, JPY)", () => {
    for (const currency of ["INR", "USD", "EUR", "GBP", "JPY"] as const) {
      const inputs = [nBal("alice", 50, currency), nBal("bob", -50, currency)];
      const result = simplifyDebts(inputs);

      expect(result.currency).toBe(currency);
      expect(result.transfers[0]!.amount.currency).toBe(currency);
      verifyTransferPreservation(inputs, result);
    }
  });

  it("Invariant: Error hierarchy extends MoneyError -> Error", () => {
    expect(new EmptyBalancesError()).toBeInstanceOf(MoneyError);
    expect(new EmptyBalancesError()).toBeInstanceOf(Error);

    expect(new UnreconciledBalancesError(5)).toBeInstanceOf(MoneyError);
    expect(new UnreconciledBalancesError(5)).toBeInstanceOf(Error);
  });

  it("Invariant: Total transferred amount equals total credit / debt sum", () => {
    const inputs = [
      nBal("p1", 100),
      nBal("p2", 200),
      nBal("p3", -150),
      nBal("p4", -150),
    ];
    const result = simplifyDebts(inputs);

    const totalTransferred = result.transfers.reduce((acc, t) => acc + t.amount.amountMinor, 0);
    expect(totalTransferred).toBe(300);
    verifyTransferPreservation(inputs, result);
  });
});
