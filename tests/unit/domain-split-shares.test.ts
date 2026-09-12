import { describe, it, expect } from "vitest";
import {
  make,
  zero,
  MoneyError,
  // Shares split
  splitByShares,
  NegativeShareError,
  InvalidShareError,
  ZeroTotalSharesError,
  // Shared errors
  EmptyParticipantsError,
  DuplicateParticipantError,
  InvalidParticipantError,
  NegativeSplitTotalError,
  type ShareAllocationInput,
  type SharesSplitResult,
} from "../../src/domain/index.js";

// ============================================================================
// HELPERS
// ============================================================================

/** Helper to create ShareAllocationInput. */
function sInput(participantId: string, shares: number): ShareAllocationInput {
  return { participantId, shares };
}

/** Sum all allocation minor units. */
function sumAllocations(result: SharesSplitResult): number {
  return result.allocations.reduce((acc, a) => acc + a.amount.amountMinor, 0);
}

/** Extract allocation amounts in order. */
function amounts(result: SharesSplitResult): number[] {
  return result.allocations.map((a) => a.amount.amountMinor);
}

/** Extract participant IDs in order. */
function participantIds(result: SharesSplitResult): string[] {
  return result.allocations.map((a) => a.participantId);
}

// ============================================================================
// NORMAL RATIO CASES (Phase 2.5)
// ============================================================================

describe("splitByShares — normal ratio cases (Phase 2.5)", () => {
  it("1:1 on 100 INR -> 50, 50", () => {
    const result = splitByShares(make(100, "INR"), [
      sInput("alice", 1),
      sInput("bob", 1),
    ]);
    expect(amounts(result)).toEqual([50, 50]);
    expect(sumAllocations(result)).toBe(100);
    expect(result.totalShares).toBe(2);
    expect(result.participantCount).toBe(2);
  });

  it("1:2 on 300 INR -> 100, 200", () => {
    const result = splitByShares(make(300, "INR"), [
      sInput("alice", 1),
      sInput("bob", 2),
    ]);
    expect(amounts(result)).toEqual([100, 200]);
    expect(sumAllocations(result)).toBe(300);
    expect(result.totalShares).toBe(3);
  });

  it("1:2:3 on 600 INR -> 100, 200, 300 (PRD example)", () => {
    const result = splitByShares(make(600, "INR"), [
      sInput("alice", 1),
      sInput("bob", 2),
      sInput("charlie", 3),
    ]);
    expect(amounts(result)).toEqual([100, 200, 300]);
    expect(sumAllocations(result)).toBe(600);
    expect(result.totalShares).toBe(6);
    expect(result.participantCount).toBe(3);
  });

  it("2:3 on 500 INR -> 200, 300", () => {
    const result = splitByShares(make(500, "INR"), [
      sInput("alice", 2),
      sInput("bob", 3),
    ]);
    expect(amounts(result)).toEqual([200, 300]);
    expect(sumAllocations(result)).toBe(500);
    expect(result.totalShares).toBe(5);
  });

  it("equal shares (5:5:5) on 900 USD -> 300, 300, 300", () => {
    const result = splitByShares(make(900, "USD"), [
      sInput("p1", 5),
      sInput("p2", 5),
      sInput("p3", 5),
    ]);
    expect(amounts(result)).toEqual([300, 300, 300]);
    expect(sumAllocations(result)).toBe(900);
    expect(result.totalShares).toBe(15);
  });

  it("single participant with 5 shares on 1000 EUR -> 1000", () => {
    const result = splitByShares(make(1000, "EUR"), [sInput("solo", 5)]);
    expect(amounts(result)).toEqual([1000]);
    expect(sumAllocations(result)).toBe(1000);
    expect(result.totalShares).toBe(5);
  });

  it("many participants with varying shares", () => {
    const inputs: ShareAllocationInput[] = [
      sInput("p1", 1),
      sInput("p2", 2),
      sInput("p3", 3),
      sInput("p4", 4),
    ];
    // totalShares = 10. Total = 1000 INR -> 100, 200, 300, 400
    const result = splitByShares(make(1000, "INR"), inputs);
    expect(amounts(result)).toEqual([100, 200, 300, 400]);
    expect(sumAllocations(result)).toBe(1000);
    expect(result.totalShares).toBe(10);
  });
});

// ============================================================================
// ROUNDING & REMAINDER RECONCILIATION
// ============================================================================

describe("splitByShares — rounding & remainder reconciliation", () => {
  it("100 divided by shares 1:3 -> 25, 75 (exact division)", () => {
    const result = splitByShares(make(100, "INR"), [
      sInput("alice", 1),
      sInput("bob", 3),
    ]);
    expect(amounts(result)).toEqual([25, 75]);
    expect(sumAllocations(result)).toBe(100);
  });

  it("100 divided by shares 1:2 -> 33, 67 (bob has higher remainder, receives +1)", () => {
    // 100 * 1 = 100 -> floor = 33, frac = 1
    // 100 * 2 = 200 -> floor = 66, frac = 2
    // floorSum = 99, shortfall = 1. bob has frac 2 > 1 -> bob gets +1
    const result = splitByShares(make(100, "INR"), [
      sInput("alice", 1),
      sInput("bob", 2),
    ]);
    expect(amounts(result)).toEqual([33, 67]);
    expect(sumAllocations(result)).toBe(100);
  });

  it("100 divided by 1:1:1 -> 34, 33, 33 (equal remainder tie-break to first participant)", () => {
    // 100 * 1 = 100 -> floor = 33, frac = 1 for all 3
    // shortfall = 1. alice is index 0 -> alice gets +1
    const result = splitByShares(make(100, "INR"), [
      sInput("alice", 1),
      sInput("bob", 1),
      sInput("charlie", 1),
    ]);
    expect(amounts(result)).toEqual([34, 33, 33]);
    expect(sumAllocations(result)).toBe(100);
  });

  it("100 divided by 1:1:1 when bob is first in input -> bob gets 34 (stable ordering)", () => {
    const result = splitByShares(make(100, "INR"), [
      sInput("bob", 1),
      sInput("alice", 1),
      sInput("charlie", 1),
    ]);
    expect(amounts(result)).toEqual([34, 33, 33]);
    expect(participantIds(result)).toEqual(["bob", "alice", "charlie"]);
    expect(sumAllocations(result)).toBe(100);
  });

  it("1 minor unit divided by 1:2 -> [0, 1] (bob has higher remainder)", () => {
    // 1 * 1 = 1 -> floor = 0, frac = 1
    // 1 * 2 = 2 -> floor = 0, frac = 2
    // bob has frac 2 > 1 -> bob receives the 1 minor unit
    const result = splitByShares(make(1, "INR"), [
      sInput("alice", 1),
      sInput("bob", 2),
    ]);
    expect(amounts(result)).toEqual([0, 1]);
    expect(sumAllocations(result)).toBe(1);
  });

  it("1 minor unit divided by 1:1 -> [1, 0] (tie break goes to earlier participant)", () => {
    const result = splitByShares(make(1, "INR"), [
      sInput("alice", 1),
      sInput("bob", 1),
    ]);
    expect(amounts(result)).toEqual([1, 0]);
    expect(sumAllocations(result)).toBe(1);
  });

  it("zero total with shares 1:2 -> [0, 0], sum = 0", () => {
    const result = splitByShares(zero("INR"), [
      sInput("alice", 1),
      sInput("bob", 2),
    ]);
    expect(amounts(result)).toEqual([0, 0]);
    expect(sumAllocations(result)).toBe(0);
  });

  it("uneven total 9999 with 7 participants and shares 1..7 reconciles exactly", () => {
    const inputs = Array.from({ length: 7 }, (_, i) => sInput(`p${i + 1}`, i + 1));
    const result = splitByShares(make(9999, "INR"), inputs);
    expect(sumAllocations(result)).toBe(9999);
    expect(result.totalShares).toBe(28); // 1+2+3+4+5+6+7 = 28
  });
});

// ============================================================================
// ZERO SHARES POLICY
// ============================================================================

describe("splitByShares — zero-shares policy", () => {
  it("participant with 0 shares gets exactly 0 minor units when others have positive shares", () => {
    const result = splitByShares(make(100, "INR"), [
      sInput("alice", 0),
      sInput("bob", 1),
      sInput("charlie", 1),
    ]);
    expect(amounts(result)).toEqual([0, 50, 50]);
    expect(sumAllocations(result)).toBe(100);
    expect(result.totalShares).toBe(2);
  });

  it("zero-share participant never receives remainder units even if shortfall exists", () => {
    // 101 INR divided by alice: 0, bob: 1, charlie: 1
    // totalShares = 2. shortfall = 1.
    // alice has frac = 0. bob has frac = 1. charlie has frac = 1.
    // bob is index 1, gets +1 (51). charlie gets 50. alice gets 0.
    const result = splitByShares(make(101, "INR"), [
      sInput("alice", 0),
      sInput("bob", 1),
      sInput("charlie", 1),
    ]);
    expect(amounts(result)).toEqual([0, 51, 50]);
    expect(sumAllocations(result)).toBe(101);
  });

  it("zero-share participant with 1 minor unit total gets 0", () => {
    const result = splitByShares(make(1, "INR"), [
      sInput("alice", 0),
      sInput("bob", 1),
    ]);
    expect(amounts(result)).toEqual([0, 1]);
    expect(sumAllocations(result)).toBe(1);
  });

  it("rejects when ALL participants have 0 shares (ZeroTotalSharesError)", () => {
    expect(() =>
      splitByShares(make(100, "INR"), [
        sInput("alice", 0),
        sInput("bob", 0),
      ])
    ).toThrow(ZeroTotalSharesError);
  });

  it("ZeroTotalSharesError has code ZERO_TOTAL_SHARES", () => {
    try {
      splitByShares(make(100, "INR"), [sInput("alice", 0)]);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ZeroTotalSharesError);
      expect((e as ZeroTotalSharesError).code).toBe("ZERO_TOTAL_SHARES");
    }
  });
});

// ============================================================================
// SHARE VALIDATION
// ============================================================================

describe("splitByShares — share validation", () => {
  it("rejects negative share count with NegativeShareError", () => {
    expect(() =>
      splitByShares(make(100, "INR"), [
        sInput("alice", -1),
        sInput("bob", 2),
      ])
    ).toThrow(NegativeShareError);
  });

  it("NegativeShareError contains participantId and code", () => {
    try {
      splitByShares(make(100, "INR"), [
        sInput("alice", 1),
        sInput("bad_user", -5),
      ]);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(NegativeShareError);
      expect((e as NegativeShareError).code).toBe("NEGATIVE_SHARE");
      expect((e as Error).message).toContain("bad_user");
      expect((e as Error).message).toContain("-5");
    }
  });

  it("rejects non-integer share count (e.g. 1.5)", () => {
    expect(() =>
      splitByShares(make(100, "INR"), [
        sInput("alice", 1.5),
        sInput("bob", 2),
      ])
    ).toThrow(InvalidShareError);
  });

  it("rejects NaN share count", () => {
    expect(() =>
      splitByShares(make(100, "INR"), [
        sInput("alice", NaN),
        sInput("bob", 1),
      ])
    ).toThrow(InvalidShareError);
  });

  it("rejects Infinity share count", () => {
    expect(() =>
      splitByShares(make(100, "INR"), [
        sInput("alice", Infinity),
        sInput("bob", 1),
      ])
    ).toThrow(InvalidShareError);
  });

  it("InvalidShareError has code INVALID_SHARE and mentions participantId", () => {
    try {
      splitByShares(make(100, "INR"), [sInput("alice", 2.3)]);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidShareError);
      expect((e as InvalidShareError).code).toBe("INVALID_SHARE");
      expect((e as Error).message).toContain("alice");
    }
  });
});

// ============================================================================
// PARTICIPANT VALIDATION
// ============================================================================

describe("splitByShares — participant validation", () => {
  it("rejects empty participant list with EmptyParticipantsError", () => {
    expect(() => splitByShares(make(100, "INR"), [])).toThrow(
      EmptyParticipantsError
    );
  });

  it("rejects duplicate participant ID with DuplicateParticipantError", () => {
    expect(() =>
      splitByShares(make(100, "INR"), [
        sInput("alice", 1),
        sInput("alice", 2),
      ])
    ).toThrow(DuplicateParticipantError);
  });

  it("DuplicateParticipantError contains participantId and code", () => {
    try {
      splitByShares(make(100, "INR"), [
        sInput("dup_user", 1),
        sInput("dup_user", 2),
      ]);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DuplicateParticipantError);
      expect((e as DuplicateParticipantError).code).toBe("DUPLICATE_PARTICIPANT");
      expect((e as Error).message).toContain("dup_user");
    }
  });

  it("rejects blank string participant ID", () => {
    expect(() =>
      splitByShares(make(100, "INR"), [
        sInput("", 1),
        sInput("bob", 1),
      ])
    ).toThrow(InvalidParticipantError);
  });

  it("rejects whitespace-only participant ID", () => {
    expect(() =>
      splitByShares(make(100, "INR"), [
        sInput("   ", 1),
        sInput("bob", 1),
      ])
    ).toThrow(InvalidParticipantError);
  });

  it("InvalidParticipantError identifies the failing index and code", () => {
    try {
      splitByShares(make(100, "INR"), [
        sInput("alice", 1),
        sInput("   ", 1),
      ]);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidParticipantError);
      expect((e as InvalidParticipantError).code).toBe("INVALID_PARTICIPANT");
      expect((e as Error).message).toContain("index 1");
    }
  });
});

// ============================================================================
// TOTAL VALIDATION
// ============================================================================

describe("splitByShares — total validation", () => {
  it("rejects negative total with NegativeSplitTotalError", () => {
    expect(() =>
      splitByShares(make(-100, "INR"), [
        sInput("alice", 1),
        sInput("bob", 1),
      ])
    ).toThrow(NegativeSplitTotalError);
  });
});

// ============================================================================
// DETERMINISM & IMMUTABILITY
// ============================================================================

describe("splitByShares — determinism & immutability", () => {
  it("same inputs produce identical outputs across multiple calls", () => {
    const total = make(1000, "INR");
    const inputs = [sInput("p1", 1), sInput("p2", 2), sInput("p3", 3)];

    const res1 = splitByShares(total, inputs);
    const res2 = splitByShares(total, inputs);

    expect(amounts(res1)).toEqual(amounts(res2));
    expect(participantIds(res1)).toEqual(participantIds(res2));
  });

  it("does not mutate caller's input array or objects", () => {
    const input1 = sInput("alice", 1);
    const input2 = sInput("bob", 2);
    const inputs = [input1, input2];

    splitByShares(make(100, "INR"), inputs);

    expect(inputs.length).toBe(2);
    expect(inputs[0]).toBe(input1);
    expect(inputs[1]).toBe(input2);
    expect(input1.shares).toBe(1);
  });

  it("freezes the result and allocations array", () => {
    const result = splitByShares(make(100, "INR"), [
      sInput("alice", 1),
      sInput("bob", 2),
    ]);

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.allocations)).toBe(true);
  });
});

// ============================================================================
// CURRENCY PRESERVATION
// ============================================================================

describe("splitByShares — currency preservation", () => {
  it.each(["INR", "USD", "EUR", "GBP", "JPY"] as const)(
    "preserves %s currency on all allocations",
    (currency) => {
      const result = splitByShares(make(100, currency), [
        sInput("alice", 1),
        sInput("bob", 2),
        sInput("charlie", 3),
      ]);

      expect(result.total.currency).toBe(currency);
      for (const alloc of result.allocations) {
        expect(alloc.amount.currency).toBe(currency);
      }
      expect(sumAllocations(result)).toBe(100);
    }
  );
});

// ============================================================================
// LARGE SAFE VALUES & LARGE SHARES
// ============================================================================

describe("splitByShares — large safe values & large shares", () => {
  it("handles MAX_SAFE_INTEGER total without precision loss", () => {
    const total = make(Number.MAX_SAFE_INTEGER, "INR");
    const result = splitByShares(total, [
      sInput("alice", 1),
      sInput("bob", 1),
    ]);

    expect(sumAllocations(result)).toBe(Number.MAX_SAFE_INTEGER);
    // alice gets +1 due to tie break
    expect(result.allocations[0]!.amount.amountMinor).toBe(
      Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1
    );
    expect(result.allocations[1]!.amount.amountMinor).toBe(
      Math.floor(Number.MAX_SAFE_INTEGER / 2)
    );
  });

  it("handles very large share counts (e.g. 1,000,000 shares each)", () => {
    const result = splitByShares(make(1000, "INR"), [
      sInput("alice", 1_000_000),
      sInput("bob", 2_000_000),
    ]);
    expect(amounts(result)).toEqual([333, 667]);
    expect(sumAllocations(result)).toBe(1000);
    expect(result.totalShares).toBe(3_000_000);
  });
});

// ============================================================================
// FINANCIAL INVARIANTS AUDIT
// ============================================================================

describe("splitByShares — Financial Invariants Audit", () => {
  it("Invariant: Exact total reconciliation matrix across diverse shares & totals", () => {
    const testCases: [number, number[]][] = [
      [100, [1, 1]],
      [100, [1, 2]],
      [100, [1, 2, 3]],
      [100, [2, 3]],
      [1, [1, 2]],
      [1, [1, 1]],
      [2, [1, 1, 1]],
      [7, [1, 2, 3, 4, 5, 6, 7]],
      [999999, [1, 3, 7]],
      [1000000, [10]],
      [0, [1, 2]],
    ];

    for (const [totalAmount, sharesList] of testCases) {
      const inputs = sharesList.map((s, i) => sInput(`user_${i}`, s));
      const res = splitByShares(make(totalAmount, "INR"), inputs);
      expect(sumAllocations(res)).toBe(totalAmount);
    }
  });

  it("Invariant: Error hierarchy extends MoneyError -> Error", () => {
    expect(new NegativeShareError("p1", -1)).toBeInstanceOf(MoneyError);
    expect(new NegativeShareError("p1", -1)).toBeInstanceOf(Error);

    expect(new InvalidShareError("p1", NaN)).toBeInstanceOf(MoneyError);
    expect(new InvalidShareError("p1", NaN)).toBeInstanceOf(Error);

    expect(new ZeroTotalSharesError()).toBeInstanceOf(MoneyError);
    expect(new ZeroTotalSharesError()).toBeInstanceOf(Error);
  });

  it("Invariant: No floating-point contamination in allocations", () => {
    const result = splitByShares(make(100, "INR"), [
      sInput("alice", 1),
      sInput("bob", 2),
      sInput("charlie", 3),
    ]);
    for (const alloc of result.allocations) {
      expect(Number.isInteger(alloc.amount.amountMinor)).toBe(true);
      expect(Number.isSafeInteger(alloc.amount.amountMinor)).toBe(true);
    }
  });

  it("Invariant: One allocation per participant with matching IDs", () => {
    const result = splitByShares(make(100, "INR"), [
      sInput("alice", 2),
      sInput("bob", 3),
      sInput("charlie", 5),
    ]);
    expect(result.allocations.length).toBe(3);
    expect(participantIds(result)).toEqual(["alice", "bob", "charlie"]);
  });
});
