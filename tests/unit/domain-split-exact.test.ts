import { describe, it, expect } from "vitest";
import {
  make,
  zero,
  MoneyError,
  // Exact split
  splitExactly,
  NegativeAllocationError,
  AllocationCurrencyMismatchError,
  UnderAllocationError,
  OverAllocationError,
  // Shared participant errors (re-exported by split-exact)
  EmptyParticipantsError,
  DuplicateParticipantError,
  InvalidParticipantError,
  type ExactAllocationInput,
  type ExactSplitResult,
} from "../../src/domain/index.js";

// ============================================================================
// HELPERS
// ============================================================================

/** Build an ExactAllocationInput quickly. */
function alloc(participantId: string, amountMinor: number, currency: "INR" | "USD" | "EUR" | "GBP" | "JPY" = "INR"): ExactAllocationInput {
  return { participantId, amount: make(amountMinor, currency) };
}

/** Sum all allocation minor units. */
function sumAllocations(result: ExactSplitResult): number {
  return result.allocations.reduce((acc, a) => acc + a.amount.amountMinor, 0);
}

/** Extract allocation amounts in order. */
function amounts(result: ExactSplitResult): number[] {
  return result.allocations.map((a) => a.amount.amountMinor);
}

// ============================================================================
// NORMAL CASES
// ============================================================================

describe("splitExactly — normal cases (Phase 2.3)", () => {
  it("100 = 50 + 50 (even split)", () => {
    const result = splitExactly(make(100, "INR"), [
      alloc("alice", 50),
      alloc("bob", 50),
    ]);
    expect(amounts(result)).toEqual([50, 50]);
    expect(sumAllocations(result)).toBe(100);
  });

  it("100 = 60 + 40", () => {
    const result = splitExactly(make(100, "INR"), [
      alloc("alice", 60),
      alloc("bob", 40),
    ]);
    expect(amounts(result)).toEqual([60, 40]);
    expect(sumAllocations(result)).toBe(100);
  });

  it("100 = 25 + 25 + 50 (three participants)", () => {
    const result = splitExactly(make(100, "INR"), [
      alloc("alice", 25),
      alloc("bob", 25),
      alloc("charlie", 50),
    ]);
    expect(amounts(result)).toEqual([25, 25, 50]);
    expect(sumAllocations(result)).toBe(100);
  });

  it("1 = 1 (single smallest unit, one participant)", () => {
    const result = splitExactly(make(1, "INR"), [alloc("solo", 1)]);
    expect(amounts(result)).toEqual([1]);
    expect(sumAllocations(result)).toBe(1);
  });

  it("zero total with single participant getting zero", () => {
    const result = splitExactly(zero("INR"), [alloc("solo", 0)]);
    expect(amounts(result)).toEqual([0]);
    expect(sumAllocations(result)).toBe(0);
  });

  it("one participant receives the whole amount", () => {
    const result = splitExactly(make(9999, "USD"), [alloc("only", 9999, "USD")]);
    expect(amounts(result)).toEqual([9999]);
    expect(sumAllocations(result)).toBe(9999);
  });

  it("many participants with asymmetric amounts", () => {
    const inputs: ExactAllocationInput[] = [
      alloc("p1", 10),
      alloc("p2", 20),
      alloc("p3", 30),
      alloc("p4", 40),
    ];
    const result = splitExactly(make(100, "INR"), inputs);
    expect(amounts(result)).toEqual([10, 20, 30, 40]);
    expect(sumAllocations(result)).toBe(100);
  });

  it("JPY (0 minor units): 500 = 200 + 300", () => {
    const result = splitExactly(make(500, "JPY"), [
      alloc("p1", 500 * 0, "JPY"), // trick: build manually
      alloc("p2", 500, "JPY"),
    ]);
    // actually let me redo this properly
    const result2 = splitExactly(make(500, "JPY"), [
      { participantId: "p1", amount: make(200, "JPY") },
      { participantId: "p2", amount: make(300, "JPY") },
    ]);
    expect(amounts(result2)).toEqual([200, 300]);
    expect(sumAllocations(result2)).toBe(500);
    // discard first result (JPY with 0 was just for setup)
    void result;
  });

  it("large safe values reconcile exactly", () => {
    const large = 999_999_900; // 9 crore paise = ₹90 lakh
    const result = splitExactly(make(large, "INR"), [
      alloc("rich", large),
    ]);
    expect(sumAllocations(result)).toBe(large);
  });
});

// ============================================================================
// UNDER / OVER ALLOCATION
// ============================================================================

describe("splitExactly — under and over allocation (Phase 2.3)", () => {
  it("under-allocation by 1 minor unit throws UnderAllocationError", () => {
    expect(() =>
      splitExactly(make(100, "INR"), [
        alloc("alice", 60),
        alloc("bob", 39), // total = 99, short by 1
      ])
    ).toThrow(UnderAllocationError);
  });

  it("over-allocation by 1 minor unit throws OverAllocationError", () => {
    expect(() =>
      splitExactly(make(100, "INR"), [
        alloc("alice", 60),
        alloc("bob", 41), // total = 101, over by 1
      ])
    ).toThrow(OverAllocationError);
  });

  it("under-allocation by large amount throws UnderAllocationError", () => {
    expect(() =>
      splitExactly(make(100, "INR"), [
        alloc("alice", 30),
      ]) // sum = 30, total = 100, short by 70
    ).toThrow(UnderAllocationError);
  });

  it("over-allocation by large amount throws OverAllocationError", () => {
    expect(() =>
      splitExactly(make(100, "INR"), [
        alloc("alice", 200),
      ]) // sum = 200, over by 100
    ).toThrow(OverAllocationError);
  });

  it("all-zero allocations against non-zero total throws UnderAllocationError", () => {
    expect(() =>
      splitExactly(make(50, "INR"), [
        alloc("alice", 0),
        alloc("bob", 0),
      ])
    ).toThrow(UnderAllocationError);
  });

  it("UnderAllocationError has correct error code", () => {
    try {
      splitExactly(make(100, "INR"), [alloc("a", 99)]);
    } catch (e) {
      expect(e).toBeInstanceOf(UnderAllocationError);
      expect((e as UnderAllocationError).code).toBe("UNDER_ALLOCATION");
    }
  });

  it("OverAllocationError has correct error code", () => {
    try {
      splitExactly(make(100, "INR"), [alloc("a", 101)]);
    } catch (e) {
      expect(e).toBeInstanceOf(OverAllocationError);
      expect((e as OverAllocationError).code).toBe("OVER_ALLOCATION");
    }
  });
});

// ============================================================================
// NEGATIVE ALLOCATION
// ============================================================================

describe("splitExactly — negative allocation (Phase 2.3)", () => {
  it("throws NegativeAllocationError for a negative allocation", () => {
    expect(() =>
      splitExactly(make(100, "INR"), [
        alloc("alice", 150),
        alloc("bob", -50), // negative: rejected before sum check
      ])
    ).toThrow(NegativeAllocationError);
  });

  it("throws NegativeAllocationError for the only participant", () => {
    expect(() =>
      splitExactly(make(0, "INR"), [alloc("a", -1)])
    ).toThrow(NegativeAllocationError);
  });

  it("NegativeAllocationError has correct error code", () => {
    try {
      splitExactly(make(100, "INR"), [alloc("a", -100)]);
    } catch (e) {
      expect(e).toBeInstanceOf(NegativeAllocationError);
      expect((e as NegativeAllocationError).code).toBe("NEGATIVE_ALLOCATION");
    }
  });

  it("negative allocation is rejected even when sum would equal total", () => {
    // 150 + (-50) = 100 — still rejected because -50 is negative
    expect(() =>
      splitExactly(make(100, "INR"), [
        alloc("alice", 150),
        alloc("bob", -50),
      ])
    ).toThrow(NegativeAllocationError);
  });
});

// ============================================================================
// CURRENCY MISMATCH
// ============================================================================

describe("splitExactly — currency mismatch (Phase 2.3)", () => {
  it("throws AllocationCurrencyMismatchError when allocation currency differs from total", () => {
    expect(() =>
      splitExactly(make(100, "INR"), [
        alloc("alice", 50, "INR"),
        alloc("bob", 50, "USD"), // USD ≠ INR
      ])
    ).toThrow(AllocationCurrencyMismatchError);
  });

  it("AllocationCurrencyMismatchError has correct error code", () => {
    try {
      splitExactly(make(100, "INR"), [
        alloc("alice", 50, "INR"),
        { participantId: "bob", amount: make(50, "USD") },
      ]);
    } catch (e) {
      expect(e).toBeInstanceOf(AllocationCurrencyMismatchError);
      expect((e as AllocationCurrencyMismatchError).code).toBe("ALLOCATION_CURRENCY_MISMATCH");
    }
  });

  it("all allocations must match the total currency, not each other", () => {
    // first allocation is USD (wrong) — rejected even though second is also USD
    expect(() =>
      splitExactly(make(100, "INR"), [
        alloc("alice", 50, "USD"),
        alloc("bob", 50, "USD"),
      ])
    ).toThrow(AllocationCurrencyMismatchError);
  });
});

// ============================================================================
// INVALID PARTICIPANTS
// ============================================================================

describe("splitExactly — invalid participant inputs (Phase 2.3)", () => {
  it("throws EmptyParticipantsError for empty input array", () => {
    expect(() => splitExactly(make(100, "INR"), [])).toThrow(EmptyParticipantsError);
  });

  it("throws DuplicateParticipantError for duplicate IDs", () => {
    expect(() =>
      splitExactly(make(100, "INR"), [
        alloc("alice", 50),
        alloc("alice", 50), // duplicate
      ])
    ).toThrow(DuplicateParticipantError);
  });

  it("throws InvalidParticipantError for blank participant ID", () => {
    expect(() =>
      splitExactly(make(100, "INR"), [
        alloc("alice", 60),
        { participantId: "", amount: make(40, "INR") },
      ])
    ).toThrow(InvalidParticipantError);
  });

  it("throws InvalidParticipantError for whitespace-only ID", () => {
    expect(() =>
      splitExactly(make(100, "INR"), [
        { participantId: "   ", amount: make(100, "INR") },
      ])
    ).toThrow(InvalidParticipantError);
  });

  it("does NOT silently remove duplicates", () => {
    expect(() =>
      splitExactly(make(100, "INR"), [
        alloc("x", 50),
        alloc("x", 50),
      ])
    ).toThrow(DuplicateParticipantError);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe("splitExactly — edge cases (Phase 2.3)", () => {
  it("zero total, zero allocations for all participants", () => {
    const result = splitExactly(zero("INR"), [
      alloc("p1", 0),
      alloc("p2", 0),
      alloc("p3", 0),
    ]);
    expect(amounts(result)).toEqual([0, 0, 0]);
    expect(sumAllocations(result)).toBe(0);
  });

  it("total 1 with one participant getting 1", () => {
    const result = splitExactly(make(1, "INR"), [alloc("p1", 1)]);
    expect(amounts(result)).toEqual([1]);
    expect(sumAllocations(result)).toBe(1);
  });

  it("total 1 with one participant getting 0 → under-allocation", () => {
    expect(() =>
      splitExactly(make(1, "INR"), [alloc("p1", 0)])
    ).toThrow(UnderAllocationError);
  });

  it("allocation sum exactly equal to total (1 minor unit above exact: OverAllocation)", () => {
    expect(() =>
      splitExactly(make(100, "INR"), [alloc("p1", 101)])
    ).toThrow(OverAllocationError);
  });

  it("allocation sum exactly one below total (UnderAllocation)", () => {
    expect(() =>
      splitExactly(make(100, "INR"), [alloc("p1", 99)])
    ).toThrow(UnderAllocationError);
  });

  it("many participants with very small allocations", () => {
    const inputs: ExactAllocationInput[] = Array.from({ length: 10 }, (_, i) =>
      alloc(`p${i + 1}`, i === 0 ? 10 : 10) // 10 participants × 10 = 100
    );
    const result = splitExactly(make(100, "INR"), inputs);
    expect(sumAllocations(result)).toBe(100);
    expect(result.allocations.length).toBe(10);
  });
});

// ============================================================================
// DETERMINISM AND IMMUTABILITY
// ============================================================================

describe("splitExactly — determinism and immutability (Phase 2.3)", () => {
  it("same inputs always produce the same output", () => {
    const total = make(300, "INR");
    const inputs = [alloc("a", 100), alloc("b", 100), alloc("c", 100)];
    const r1 = splitExactly(total, inputs);
    const r2 = splitExactly(total, inputs);
    expect(amounts(r1)).toEqual(amounts(r2));
    expect(r1.allocations.map((a) => a.participantId)).toEqual(
      r2.allocations.map((a) => a.participantId)
    );
  });

  it("preserves input participant order in output", () => {
    const inputs = [alloc("z", 10), alloc("a", 30), alloc("m", 60)];
    const result = splitExactly(make(100, "INR"), inputs);
    expect(result.allocations.map((a) => a.participantId)).toEqual(["z", "a", "m"]);
  });

  it("does not mutate the input allocation objects", () => {
    const inputs = [alloc("alice", 60), alloc("bob", 40)];
    const originalAmounts = inputs.map((i) => i.amount.amountMinor);
    splitExactly(make(100, "INR"), inputs);
    // amounts must be unchanged
    expect(inputs.map((i) => i.amount.amountMinor)).toEqual(originalAmounts);
  });

  it("output result is frozen (immutable)", () => {
    const result = splitExactly(make(100, "INR"), [alloc("a", 60), alloc("b", 40)]);
    expect(() => {
      // @ts-expect-error testing immutability
      result.participantCount = 99;
    }).toThrow();
  });
});

// ============================================================================
// RESULT STRUCTURE
// ============================================================================

describe("splitExactly — result structure (Phase 2.3)", () => {
  it("result contains the original total", () => {
    const total = make(200, "INR");
    const result = splitExactly(total, [alloc("a", 100), alloc("b", 100)]);
    expect(result.total.amountMinor).toBe(200);
    expect(result.total.currency).toBe("INR");
  });

  it("result has correct participantCount", () => {
    const result = splitExactly(make(30, "INR"), [
      alloc("p1", 10), alloc("p2", 10), alloc("p3", 10),
    ]);
    expect(result.participantCount).toBe(3);
    expect(result.allocations.length).toBe(3);
  });

  it("each allocation carries the correct participantId", () => {
    const result = splitExactly(make(100, "INR"), [
      alloc("user-a", 70), alloc("user-b", 30),
    ]);
    expect(result.allocations[0]!.participantId).toBe("user-a");
    expect(result.allocations[1]!.participantId).toBe("user-b");
  });

  it("all allocation amounts are non-negative integers", () => {
    const result = splitExactly(make(100, "INR"), [
      alloc("p1", 33), alloc("p2", 33), alloc("p3", 34),
    ]);
    for (const a of result.allocations) {
      expect(Number.isInteger(a.amount.amountMinor)).toBe(true);
      expect(a.amount.amountMinor).toBeGreaterThanOrEqual(0);
    }
  });
});

// ============================================================================
// CURRENCY PRESERVATION
// ============================================================================

describe("splitExactly — currency preservation (Phase 2.3)", () => {
  it("all allocations carry total's currency (INR)", () => {
    const result = splitExactly(make(100, "INR"), [alloc("a", 60), alloc("b", 40)]);
    for (const a of result.allocations) {
      expect(a.amount.currency).toBe("INR");
    }
  });

  it("all allocations carry total's currency (EUR)", () => {
    const result = splitExactly(make(1000, "EUR"), [
      { participantId: "a", amount: make(500, "EUR") },
      { participantId: "b", amount: make(500, "EUR") },
    ]);
    for (const a of result.allocations) {
      expect(a.amount.currency).toBe("EUR");
    }
  });
});

// ============================================================================
// FINANCIAL INVARIANTS
// ============================================================================

describe("splitExactly — financial invariants (Phase 2.3)", () => {
  it("Invariant: sum of allocations always equals total", () => {
    const cases: [number, number[]][] = [
      [100, [50, 50]],
      [100, [60, 40]],
      [100, [25, 25, 50]],
      [1, [1]],
      [0, [0, 0]],
      [999, [333, 333, 333]],
      [10000, [1, 2, 3, 9994]],
    ];
    for (const [total, parts] of cases) {
      const inputs = parts.map((v, i) => alloc(`p${i}`, v));
      const result = splitExactly(make(total, "INR"), inputs);
      expect(sumAllocations(result)).toBe(total);
    }
  });

  it("Invariant: all amounts are safe integers", () => {
    const result = splitExactly(make(300, "INR"), [
      alloc("a", 100), alloc("b", 100), alloc("c", 100),
    ]);
    for (const a of result.allocations) {
      expect(Number.isSafeInteger(a.amount.amountMinor)).toBe(true);
    }
  });

  it("Invariant: all amounts use the input total's currency", () => {
    for (const currency of ["INR", "USD", "EUR", "GBP", "JPY"] as const) {
      const result = splitExactly(make(100, currency), [
        { participantId: "a", amount: make(40, currency) },
        { participantId: "b", amount: make(60, currency) },
      ]);
      for (const a of result.allocations) {
        expect(a.amount.currency).toBe(currency);
      }
    }
  });

  it("Invariant: no floating-point in result amounts", () => {
    const result = splitExactly(make(100, "INR"), [alloc("a", 60), alloc("b", 40)]);
    for (const a of result.allocations) {
      expect(Number.isInteger(a.amount.amountMinor)).toBe(true);
    }
  });

  it("Invariant: each participant appears exactly once", () => {
    const result = splitExactly(make(100, "INR"), [
      alloc("alice", 60), alloc("bob", 40),
    ]);
    const ids = result.allocations.map((a) => a.participantId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("Invariant: split errors are MoneyError subclasses", () => {
    const errors = [
      new NegativeAllocationError("x", -1),
      new AllocationCurrencyMismatchError("x", "INR", "USD"),
      new UnderAllocationError(100, 90, "INR"),
      new OverAllocationError(100, 110, "INR"),
    ];
    for (const e of errors) {
      expect(e).toBeInstanceOf(MoneyError);
      expect(e).toBeInstanceOf(Error);
      expect(typeof e.code).toBe("string");
    }
  });

  it("Invariant: no automatic correction of invalid totals", () => {
    // Under-allocation is never silently fixed
    expect(() =>
      splitExactly(make(100, "INR"), [alloc("a", 50)])
    ).toThrow(UnderAllocationError);

    // Over-allocation is never silently fixed
    expect(() =>
      splitExactly(make(100, "INR"), [alloc("a", 150)])
    ).toThrow(OverAllocationError);
  });
});
