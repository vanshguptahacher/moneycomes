import { describe, it, expect } from "vitest";
import {
  make,
  zero,
  MoneyError,
  // Percentage split
  splitByPercentage,
  percentageStringToBasisPoints,
  basisPointsToPercentageString,
  TOTAL_BASIS_POINTS,
  MIN_BASIS_POINTS,
  MAX_BASIS_POINTS,
  NegativePercentageError,
  InvalidPercentageError,
  PercentageTotalError,
  // Shared errors
  EmptyParticipantsError,
  DuplicateParticipantError,
  InvalidParticipantError,
  NegativeSplitTotalError,
  type PercentageAllocationInput,
  type PercentageSplitResult,
} from "../../src/domain/index.js";

// ============================================================================
// HELPERS
// ============================================================================

/** Helper to create PercentageAllocationInput. */
function pInput(participantId: string, basisPoints: number): PercentageAllocationInput {
  return { participantId, basisPoints };
}

/** Sum all allocation minor units. */
function sumAllocations(result: PercentageSplitResult): number {
  return result.allocations.reduce((acc, a) => acc + a.amount.amountMinor, 0);
}

/** Extract allocation amounts in order. */
function amounts(result: PercentageSplitResult): number[] {
  return result.allocations.map((a) => a.amount.amountMinor);
}

/** Extract participant IDs in order. */
function participantIds(result: PercentageSplitResult): string[] {
  return result.allocations.map((a) => a.participantId);
}

// ============================================================================
// NORMAL SPLIT CASES
// ============================================================================

describe("splitByPercentage — normal cases (Phase 2.4)", () => {
  it("exports constants representing percentage bounds", () => {
    expect(TOTAL_BASIS_POINTS).toBe(10000);
    expect(MIN_BASIS_POINTS).toBe(0);
    expect(MAX_BASIS_POINTS).toBe(10000);
  });

  it("50% / 50% on 100 INR -> 50, 50", () => {
    const result = splitByPercentage(make(100, "INR"), [
      pInput("alice", 5000),
      pInput("bob", 5000),
    ]);
    expect(amounts(result)).toEqual([50, 50]);
    expect(sumAllocations(result)).toBe(100);
    expect(result.participantCount).toBe(2);
  });

  it("25% / 25% / 50% on 100 INR -> 25, 25, 50", () => {
    const result = splitByPercentage(make(100, "INR"), [
      pInput("alice", 2500),
      pInput("bob", 2500),
      pInput("charlie", 5000),
    ]);
    expect(amounts(result)).toEqual([25, 25, 50]);
    expect(sumAllocations(result)).toBe(100);
  });

  it("33.33% / 33.33% / 33.34% on 100 INR -> 33, 33, 34", () => {
    const result = splitByPercentage(make(100, "INR"), [
      pInput("alice", 3333),
      pInput("bob", 3333),
      pInput("charlie", 3334),
    ]);
    expect(amounts(result)).toEqual([33, 33, 34]);
    expect(sumAllocations(result)).toBe(100);
  });

  it("33.34% / 33.33% / 33.33% on 100 INR -> 34, 33, 33 (preserves order)", () => {
    const result = splitByPercentage(make(100, "INR"), [
      pInput("alice", 3334),
      pInput("bob", 3333),
      pInput("charlie", 3333),
    ]);
    expect(amounts(result)).toEqual([34, 33, 33]);
    expect(sumAllocations(result)).toBe(100);
  });

  it("100% to single participant on 9999 USD", () => {
    const result = splitByPercentage(make(9999, "USD"), [
      pInput("solo", 10000),
    ]);
    expect(amounts(result)).toEqual([9999]);
    expect(sumAllocations(result)).toBe(9999);
  });

  it("10 participants at 10% each on 1000 INR", () => {
    const inputs = Array.from({ length: 10 }, (_, i) => pInput(`user_${i}`, 1000));
    const result = splitByPercentage(make(1000, "INR"), inputs);
    expect(amounts(result)).toEqual(new Array(10).fill(100));
    expect(sumAllocations(result)).toBe(1000);
  });

  it("100 participants at 1% each on 10000 INR", () => {
    const inputs = Array.from({ length: 100 }, (_, i) => pInput(`user_${i}`, 100));
    const result = splitByPercentage(make(10000, "INR"), inputs);
    expect(amounts(result)).toEqual(new Array(100).fill(100));
    expect(sumAllocations(result)).toBe(10000);
  });

  it("0% and 100% split on 500 EUR", () => {
    const result = splitByPercentage(make(500, "EUR"), [
      pInput("alice", 0),
      pInput("bob", 10000),
    ]);
    expect(amounts(result)).toEqual([0, 500]);
    expect(sumAllocations(result)).toBe(500);
  });
});

// ============================================================================
// ROUNDING & REMAINDER RECONCILIATION
// ============================================================================

describe("splitByPercentage — rounding & remainder reconciliation", () => {
  it("50/50 on odd total 101 INR -> 51, 50 (tie-break goes to earlier participant)", () => {
    const result = splitByPercentage(make(101, "INR"), [
      pInput("alice", 5000),
      pInput("bob", 5000),
    ]);
    // 101 * 50% = 50.5. Both have frac = 5000. alice is first -> gets +1
    expect(amounts(result)).toEqual([51, 50]);
    expect(sumAllocations(result)).toBe(101);
  });

  it("50/50 on odd total 101 INR when participant order is swapped -> 51, 50 (order determines tie)", () => {
    const result = splitByPercentage(make(101, "INR"), [
      pInput("bob", 5000),
      pInput("alice", 5000),
    ]);
    // bob is first -> gets +1
    expect(amounts(result)).toEqual([51, 50]);
    expect(participantIds(result)).toEqual(["bob", "alice"]);
    expect(sumAllocations(result)).toBe(101);
  });

  it("33.33 / 33.33 / 33.34 on 1000 INR -> exactly 1000 INR total", () => {
    // 1000 * 3333 = 3333000 -> floor = 333, frac = 3000
    // 1000 * 3333 = 3333000 -> floor = 333, frac = 3000
    // 1000 * 3334 = 3334000 -> floor = 333, frac = 4000
    // floorSum = 999, shortfall = 1. charlie has frac 4000 > 3000 -> charlie gets +1
    const result = splitByPercentage(make(1000, "INR"), [
      pInput("alice", 3333),
      pInput("bob", 3333),
      pInput("charlie", 3334),
    ]);
    expect(amounts(result)).toEqual([333, 333, 334]);
    expect(sumAllocations(result)).toBe(1000);
  });

  it("33.33 / 33.33 / 33.34 on 100 INR -> 33, 33, 34", () => {
    const result = splitByPercentage(make(100, "INR"), [
      pInput("alice", 3333),
      pInput("bob", 3333),
      pInput("charlie", 3334),
    ]);
    expect(amounts(result)).toEqual([33, 33, 34]);
    expect(sumAllocations(result)).toBe(100);
  });

  it("1 paise total on 33.33 / 33.33 / 33.34 -> charlie (highest remainder) gets the 1 paise", () => {
    // 1 * 3333 = 3333, frac = 3333
    // 1 * 3333 = 3333, frac = 3333
    // 1 * 3334 = 3334, frac = 3334 (highest)
    // charlie gets the only unit
    const result = splitByPercentage(make(1, "INR"), [
      pInput("alice", 3333),
      pInput("bob", 3333),
      pInput("charlie", 3334),
    ]);
    expect(amounts(result)).toEqual([0, 0, 1]);
    expect(sumAllocations(result)).toBe(1);
  });

  it("1 paise total on 50 / 50 -> alice (earlier tie-break) gets the 1 paise", () => {
    const result = splitByPercentage(make(1, "INR"), [
      pInput("alice", 5000),
      pInput("bob", 5000),
    ]);
    expect(amounts(result)).toEqual([1, 0]);
    expect(sumAllocations(result)).toBe(1);
  });

  it("zero total with 50/50 split -> [0, 0], sum = 0", () => {
    const result = splitByPercentage(zero("INR"), [
      pInput("alice", 5000),
      pInput("bob", 5000),
    ]);
    expect(amounts(result)).toEqual([0, 0]);
    expect(sumAllocations(result)).toBe(0);
  });

  it("zero total with single participant getting 100% -> [0]", () => {
    const result = splitByPercentage(zero("USD"), [
      pInput("solo", 10000),
    ]);
    expect(amounts(result)).toEqual([0]);
    expect(sumAllocations(result)).toBe(0);
  });

  it("7 participants with uneven percentages reconciles exactly", () => {
    // 1428 * 6 = 8568, 10000 - 8568 = 1432
    const inputs: PercentageAllocationInput[] = [
      pInput("p1", 1428),
      pInput("p2", 1428),
      pInput("p3", 1428),
      pInput("p4", 1428),
      pInput("p5", 1428),
      pInput("p6", 1428),
      pInput("p7", 1432),
    ];
    const total = make(9999, "INR");
    const result = splitByPercentage(total, inputs);
    expect(sumAllocations(result)).toBe(9999);
    for (const alloc of result.allocations) {
      expect(alloc.amount.amountMinor).toBeGreaterThan(0);
    }
  });

  it("zero-bps participant never receives remainder when non-zero participants have remainder", () => {
    // Total = 1 paise, A=0%, B=50%, C=50%
    // A frac=0, B frac=5000, C frac=5000 -> shortfall=1, B gets 1, A gets 0
    const result = splitByPercentage(make(1, "INR"), [
      pInput("alice", 0),
      pInput("bob", 5000),
      pInput("charlie", 5000),
    ]);
    expect(amounts(result)).toEqual([0, 1, 0]);
    expect(sumAllocations(result)).toBe(1);
  });
});

// ============================================================================
// PERCENTAGE TOTAL VALIDATION (100% RULE)
// ============================================================================

describe("splitByPercentage — percentage total validation", () => {
  it("rejects 99% total (short by 100 bps)", () => {
    expect(() =>
      splitByPercentage(make(100, "INR"), [
        pInput("alice", 4900),
        pInput("bob", 5000),
      ])
    ).toThrow(PercentageTotalError);
  });

  it("rejects 101% total (over by 100 bps)", () => {
    expect(() =>
      splitByPercentage(make(100, "INR"), [
        pInput("alice", 5100),
        pInput("bob", 5000),
      ])
    ).toThrow(PercentageTotalError);
  });

  it("rejects 99.99% total (short by 1 bps)", () => {
    expect(() =>
      splitByPercentage(make(100, "INR"), [
        pInput("alice", 3333),
        pInput("bob", 3333),
        pInput("charlie", 3333),
      ])
    ).toThrow(PercentageTotalError);
  });

  it("rejects 100.01% total (over by 1 bps)", () => {
    expect(() =>
      splitByPercentage(make(100, "INR"), [
        pInput("alice", 5001),
        pInput("bob", 5000),
      ])
    ).toThrow(PercentageTotalError);
  });

  it("provides informative diff message in PercentageTotalError", () => {
    try {
      splitByPercentage(make(100, "INR"), [pInput("solo", 9900)]);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PercentageTotalError);
      expect((e as PercentageTotalError).code).toBe("PERCENTAGE_TOTAL_ERROR");
      expect((e as Error).message).toContain("100 bps under");
    }
  });
});

// ============================================================================
// NEGATIVE & INVALID PERCENTAGE VALIDATION
// ============================================================================

describe("splitByPercentage — invalid percentages", () => {
  it("rejects negative percentage", () => {
    expect(() =>
      splitByPercentage(make(100, "INR"), [
        pInput("alice", -1000),
        pInput("bob", 11000),
      ])
    ).toThrow(NegativePercentageError);
  });

  it("NegativePercentageError includes participant ID and code", () => {
    try {
      splitByPercentage(make(100, "INR"), [
        pInput("alice", -500),
        pInput("bob", 10500),
      ]);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(NegativePercentageError);
      expect((e as NegativePercentageError).code).toBe("NEGATIVE_PERCENTAGE");
      expect((e as Error).message).toContain("alice");
      expect((e as Error).message).toContain("-500");
    }
  });

  it("rejects non-integer basis points (e.g. 5000.5)", () => {
    expect(() =>
      splitByPercentage(make(100, "INR"), [
        pInput("alice", 5000.5),
        pInput("bob", 4999.5),
      ])
    ).toThrow(InvalidPercentageError);
  });

  it("rejects NaN basis points", () => {
    expect(() =>
      splitByPercentage(make(100, "INR"), [
        pInput("alice", NaN),
        pInput("bob", 10000),
      ])
    ).toThrow(InvalidPercentageError);
  });

  it("rejects Infinity basis points", () => {
    expect(() =>
      splitByPercentage(make(100, "INR"), [
        pInput("alice", Infinity),
        pInput("bob", 10000),
      ])
    ).toThrow(InvalidPercentageError);
  });
});

// ============================================================================
// PARTICIPANT VALIDATION
// ============================================================================

describe("splitByPercentage — participant validation", () => {
  it("rejects empty participants list", () => {
    expect(() => splitByPercentage(make(100, "INR"), [])).toThrow(
      EmptyParticipantsError
    );
  });

  it("rejects duplicate participant ID", () => {
    expect(() =>
      splitByPercentage(make(100, "INR"), [
        pInput("alice", 5000),
        pInput("alice", 5000),
      ])
    ).toThrow(DuplicateParticipantError);
  });

  it("DuplicateParticipantError contains participantId in message and correct code", () => {
    try {
      splitByPercentage(make(100, "INR"), [
        pInput("alice", 5000),
        pInput("alice", 5000),
      ]);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(DuplicateParticipantError);
      expect((e as DuplicateParticipantError).code).toBe("DUPLICATE_PARTICIPANT");
      expect((e as Error).message).toContain("alice");
    }
  });

  it("rejects blank string participant ID", () => {
    expect(() =>
      splitByPercentage(make(100, "INR"), [
        pInput("", 5000),
        pInput("bob", 5000),
      ])
    ).toThrow(InvalidParticipantError);
  });

  it("rejects whitespace-only participant ID", () => {
    expect(() =>
      splitByPercentage(make(100, "INR"), [
        pInput("   ", 5000),
        pInput("bob", 5000),
      ])
    ).toThrow(InvalidParticipantError);
  });

  it("InvalidParticipantError identifies the failing index in message and correct code", () => {
    try {
      splitByPercentage(make(100, "INR"), [
        pInput("alice", 5000),
        pInput("   ", 5000),
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

describe("splitByPercentage — total validation", () => {
  it("rejects negative total with NegativeSplitTotalError", () => {
    expect(() =>
      splitByPercentage(make(-100, "INR"), [
        pInput("alice", 5000),
        pInput("bob", 5000),
      ])
    ).toThrow(NegativeSplitTotalError);
  });
});

// ============================================================================
// DETERMINISM & IMMUTABILITY
// ============================================================================

describe("splitByPercentage — determinism & immutability", () => {
  it("same inputs produce identical outputs across multiple calls", () => {
    const total = make(1000, "INR");
    const inputs = [
      pInput("p1", 3333),
      pInput("p2", 3333),
      pInput("p3", 3334),
    ];

    const res1 = splitByPercentage(total, inputs);
    const res2 = splitByPercentage(total, inputs);

    expect(amounts(res1)).toEqual(amounts(res2));
    expect(participantIds(res1)).toEqual(participantIds(res2));
  });

  it("does not mutate caller's input array or objects", () => {
    const input1 = pInput("alice", 5000);
    const input2 = pInput("bob", 5000);
    const inputs = [input1, input2];

    splitByPercentage(make(100, "INR"), inputs);

    expect(inputs.length).toBe(2);
    expect(inputs[0]).toBe(input1);
    expect(inputs[1]).toBe(input2);
    expect(input1.basisPoints).toBe(5000);
  });

  it("freezes the result and allocations array", () => {
    const result = splitByPercentage(make(100, "INR"), [
      pInput("alice", 5000),
      pInput("bob", 5000),
    ]);

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.allocations)).toBe(true);
  });
});

// ============================================================================
// CURRENCY PRESERVATION
// ============================================================================

describe("splitByPercentage — currency preservation", () => {
  it.each(["INR", "USD", "EUR", "GBP", "JPY"] as const)(
    "preserves %s currency on all allocations",
    (currency) => {
      const result = splitByPercentage(make(100, currency), [
        pInput("alice", 3333),
        pInput("bob", 3333),
        pInput("charlie", 3334),
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
// SAFE INTEGERS & LARGE VALUES
// ============================================================================

describe("splitByPercentage — safe integers & large values", () => {
  it("handles MAX_SAFE_INTEGER without precision loss", () => {
    // Number.MAX_SAFE_INTEGER = 9_007_199_254_740_991 (odd)
    // 50/50 split on MAX_SAFE_INTEGER
    const total = make(Number.MAX_SAFE_INTEGER, "INR");
    const result = splitByPercentage(total, [
      pInput("alice", 5000),
      pInput("bob", 5000),
    ]);

    expect(sumAllocations(result)).toBe(Number.MAX_SAFE_INTEGER);
    // alice gets +1 due to tie-break (first index)
    expect(result.allocations[0]!.amount.amountMinor).toBe(
      Math.floor(Number.MAX_SAFE_INTEGER / 2) + 1
    );
    expect(result.allocations[1]!.amount.amountMinor).toBe(
      Math.floor(Number.MAX_SAFE_INTEGER / 2)
    );
  });
});

// ============================================================================
// UTILITIES: percentageStringToBasisPoints & basisPointsToPercentageString
// ============================================================================

describe("percentageStringToBasisPoints", () => {
  it("parses whole percentage strings", () => {
    expect(percentageStringToBasisPoints("50")).toBe(5000);
    expect(percentageStringToBasisPoints("100")).toBe(10000);
    expect(percentageStringToBasisPoints("0")).toBe(0);
    expect(percentageStringToBasisPoints("1")).toBe(100);
  });

  it("parses decimal percentage strings", () => {
    expect(percentageStringToBasisPoints("50.00")).toBe(5000);
    expect(percentageStringToBasisPoints("33.33")).toBe(3333);
    expect(percentageStringToBasisPoints("33.34")).toBe(3334);
    expect(percentageStringToBasisPoints("0.01")).toBe(1);
    expect(percentageStringToBasisPoints("0.5")).toBe(50);
    expect(percentageStringToBasisPoints("12.5")).toBe(1250);
  });

  it("ignores surrounding whitespace and optional leading plus", () => {
    expect(percentageStringToBasisPoints("  50.00  ")).toBe(5000);
    expect(percentageStringToBasisPoints("+50.00")).toBe(5000);
  });

  it("rejects more than 2 decimal places", () => {
    expect(() => percentageStringToBasisPoints("33.333")).toThrow(
      InvalidPercentageError
    );
    expect(() => percentageStringToBasisPoints("0.001")).toThrow(
      InvalidPercentageError
    );
  });

  it("rejects non-numeric input", () => {
    expect(() => percentageStringToBasisPoints("abc")).toThrow(
      InvalidPercentageError
    );
    expect(() => percentageStringToBasisPoints("50%")).toThrow(
      InvalidPercentageError
    );
    expect(() => percentageStringToBasisPoints("")).toThrow(
      InvalidPercentageError
    );
    expect(() => percentageStringToBasisPoints("   ")).toThrow(
      InvalidPercentageError
    );
  });

  it("rejects special floating-point values", () => {
    expect(() => percentageStringToBasisPoints("NaN")).toThrow(
      InvalidPercentageError
    );
    expect(() => percentageStringToBasisPoints("Infinity")).toThrow(
      InvalidPercentageError
    );
    expect(() => percentageStringToBasisPoints("-Infinity")).toThrow(
      InvalidPercentageError
    );
  });

  it("rejects multiple decimal points", () => {
    expect(() => percentageStringToBasisPoints("1.2.3")).toThrow(
      InvalidPercentageError
    );
  });

  it("rejects negative percentages with NegativePercentageError", () => {
    expect(() => percentageStringToBasisPoints("-50")).toThrow(
      NegativePercentageError
    );
    expect(() => percentageStringToBasisPoints("-0.01")).toThrow(
      NegativePercentageError
    );
  });

  it("parses -0 and -0.00 as 0 without throwing negative error", () => {
    expect(percentageStringToBasisPoints("-0")).toBe(0);
    expect(percentageStringToBasisPoints("-0.00")).toBe(0);
  });
});

describe("basisPointsToPercentageString", () => {
  it("formats basis points as two-decimal percentage string", () => {
    expect(basisPointsToPercentageString(5000)).toBe("50.00");
    expect(basisPointsToPercentageString(3333)).toBe("33.33");
    expect(basisPointsToPercentageString(1)).toBe("0.01");
    expect(basisPointsToPercentageString(10000)).toBe("100.00");
    expect(basisPointsToPercentageString(0)).toBe("0.00");
    expect(basisPointsToPercentageString(50)).toBe("0.50");
  });

  it("formats negative basis points with leading minus", () => {
    expect(basisPointsToPercentageString(-5000)).toBe("-50.00");
    expect(basisPointsToPercentageString(-1)).toBe("-0.01");
  });

  it("rejects non-integer basis points", () => {
    expect(() => basisPointsToPercentageString(50.5)).toThrow(
      InvalidPercentageError
    );
    expect(() => basisPointsToPercentageString(NaN)).toThrow(
      InvalidPercentageError
    );
  });
});

// ============================================================================
// FINANCIAL INVARIANTS AUDIT
// ============================================================================

describe("splitByPercentage — Financial Invariants Audit", () => {
  it("Invariant: Exact total reconciliation matrix across edge cases", () => {
    const testCases: [number, number[]][] = [
      [100, [5000, 5000]],
      [100, [3333, 3333, 3334]],
      [1000, [2500, 2500, 2500, 2500]],
      [1, [5000, 5000]],
      [2, [3333, 3333, 3334]],
      [3, [3333, 3333, 3334]],
      [7, [1428, 1428, 1428, 1428, 1428, 1428, 1432]],
      [999999, [3333, 3333, 3334]],
      [1000000, [10000]],
      [0, [5000, 5000]],
    ];

    for (const [totalAmount, bpsList] of testCases) {
      const inputs = bpsList.map((bps, i) => pInput(`user_${i}`, bps));
      const res = splitByPercentage(make(totalAmount, "INR"), inputs);
      expect(sumAllocations(res)).toBe(totalAmount);
    }
  });

  it("Invariant: Error hierarchy extends MoneyError -> Error", () => {
    expect(new NegativePercentageError("p1", -1)).toBeInstanceOf(MoneyError);
    expect(new NegativePercentageError("p1", -1)).toBeInstanceOf(Error);

    expect(new InvalidPercentageError("p1", NaN)).toBeInstanceOf(MoneyError);
    expect(new InvalidPercentageError("p1", NaN)).toBeInstanceOf(Error);

    expect(new PercentageTotalError(9900)).toBeInstanceOf(MoneyError);
    expect(new PercentageTotalError(9900)).toBeInstanceOf(Error);
  });

  it("Invariant: No floating-point contamination in allocations", () => {
    const result = splitByPercentage(make(100, "INR"), [
      pInput("alice", 3333),
      pInput("bob", 3333),
      pInput("charlie", 3334),
    ]);
    for (const alloc of result.allocations) {
      expect(Number.isInteger(alloc.amount.amountMinor)).toBe(true);
      expect(Number.isSafeInteger(alloc.amount.amountMinor)).toBe(true);
    }
  });

  it("Invariant: One allocation per participant", () => {
    const result = splitByPercentage(make(100, "INR"), [
      pInput("alice", 3000),
      pInput("bob", 3000),
      pInput("charlie", 4000),
    ]);
    expect(result.allocations.length).toBe(3);
    expect(participantIds(result)).toEqual(["alice", "bob", "charlie"]);
  });
});
