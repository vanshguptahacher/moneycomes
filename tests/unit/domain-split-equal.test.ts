import { describe, it, expect } from "vitest";
import {
  make,
  zero,
  MoneyError,
  splitEqually,
  EmptyParticipantsError,
  DuplicateParticipantError,
  InvalidParticipantError,
  NegativeSplitTotalError,
  type EqualSplitResult,
} from "../../src/domain/index.js";

// ============================================================================
// HELPERS
// ============================================================================

/** Sum all allocated minor units and return the total. */
function sumAllocations(result: EqualSplitResult): number {
  return result.allocations.reduce((acc, a) => acc + a.amount.amountMinor, 0);
}

/** Extract allocation amounts in order. */
function amounts(result: EqualSplitResult): number[] {
  return result.allocations.map((a) => a.amount.amountMinor);
}

/** Build a simple participant list: ["p1", "p2", ..., "pN"] */
function participants(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `p${i + 1}`);
}

// ============================================================================
// BASIC CASES
// ============================================================================

describe("splitEqually — basic cases (Phase 2.2)", () => {
  it("splits 100 INR among 2 participants evenly", () => {
    const result = splitEqually(make(100, "INR"), ["alice", "bob"]);
    expect(amounts(result)).toEqual([50, 50]);
    expect(sumAllocations(result)).toBe(100);
  });

  it("splits 100 INR among 3 participants (remainder 1 to first)", () => {
    const result = splitEqually(make(100, "INR"), ["p1", "p2", "p3"]);
    // 100 / 3 = base 33, remainder 1 → p1 gets 34, p2 and p3 get 33
    expect(amounts(result)).toEqual([34, 33, 33]);
    expect(sumAllocations(result)).toBe(100);
  });

  it("splits 0 INR among 2 participants (all zero)", () => {
    const result = splitEqually(zero("INR"), ["alice", "bob"]);
    expect(amounts(result)).toEqual([0, 0]);
    expect(sumAllocations(result)).toBe(0);
  });

  it("splits 999 INR among 3 participants evenly", () => {
    const result = splitEqually(make(999, "INR"), ["p1", "p2", "p3"]);
    // 999 / 3 = 333 exactly
    expect(amounts(result)).toEqual([333, 333, 333]);
    expect(sumAllocations(result)).toBe(999);
  });

  it("splits 100 INR among 4 participants evenly", () => {
    const result = splitEqually(make(100, "INR"), ["p1", "p2", "p3", "p4"]);
    expect(amounts(result)).toEqual([25, 25, 25, 25]);
    expect(sumAllocations(result)).toBe(100);
  });

  it("splits 101 INR among 4 participants (remainder 1 to first)", () => {
    const result = splitEqually(make(101, "INR"), ["p1", "p2", "p3", "p4"]);
    // 101 / 4 = base 25, remainder 1 → p1 gets 26
    expect(amounts(result)).toEqual([26, 25, 25, 25]);
    expect(sumAllocations(result)).toBe(101);
  });

  it("splits among 1 participant (whole total)", () => {
    const result = splitEqually(make(500, "INR"), ["solo"]);
    expect(amounts(result)).toEqual([500]);
    expect(sumAllocations(result)).toBe(500);
  });
});

// ============================================================================
// REMAINDER CASES
// ============================================================================

describe("splitEqually — remainder cases (Phase 2.2)", () => {
  it("1 / 3 → [1, 0, 0] (smallest possible total, remainder goes to first)", () => {
    const result = splitEqually(make(1, "INR"), ["p1", "p2", "p3"]);
    // 1 / 3 = base 0, remainder 1 → p1 gets 1
    expect(amounts(result)).toEqual([1, 0, 0]);
    expect(sumAllocations(result)).toBe(1);
  });

  it("2 / 3 → [1, 1, 0] (remainder 2)", () => {
    const result = splitEqually(make(2, "INR"), ["p1", "p2", "p3"]);
    // 2 / 3 = base 0, remainder 2 → p1 and p2 get 1
    expect(amounts(result)).toEqual([1, 1, 0]);
    expect(sumAllocations(result)).toBe(2);
  });

  it("total equal to participant count (each gets 1)", () => {
    const result = splitEqually(make(4, "INR"), ["p1", "p2", "p3", "p4"]);
    expect(amounts(result)).toEqual([1, 1, 1, 1]);
    expect(sumAllocations(result)).toBe(4);
  });

  it("total less than participant count (first get 1, rest get 0)", () => {
    // 2 INR (minor) among 5 participants
    const result = splitEqually(make(2, "INR"), ["p1", "p2", "p3", "p4", "p5"]);
    // base = 0, remainder = 2
    expect(amounts(result)).toEqual([1, 1, 0, 0, 0]);
    expect(sumAllocations(result)).toBe(2);
  });

  it("maximum remainder case: total = n-1 among n (all but last get 1, last gets 0)", () => {
    // 3 minor units among 4 participants → base 0, remainder 3
    const result = splitEqually(make(3, "INR"), ["p1", "p2", "p3", "p4"]);
    expect(amounts(result)).toEqual([1, 1, 1, 0]);
    expect(sumAllocations(result)).toBe(3);
  });

  it("10001 among 3 (remainder 2)", () => {
    // 10001 / 3 = 3333 r2 → first two get 3334, last gets 3333
    const result = splitEqually(make(10001, "INR"), ["p1", "p2", "p3"]);
    expect(amounts(result)).toEqual([3334, 3334, 3333]);
    expect(sumAllocations(result)).toBe(10001);
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe("splitEqually — edge cases (Phase 2.2)", () => {
  it("zero total among many participants (all zero)", () => {
    const result = splitEqually(zero("INR"), participants(10));
    expect(amounts(result)).toEqual(new Array(10).fill(0));
    expect(sumAllocations(result)).toBe(0);
  });

  it("large number of participants with zero total", () => {
    const result = splitEqually(zero("INR"), participants(100));
    expect(sumAllocations(result)).toBe(0);
    expect(result.allocations.length).toBe(100);
  });

  it("large safe total split among 10 participants", () => {
    // 1_000_000_000 (1 crore minor units = ₹10 lakh) / 10 = 100_000_000 each
    const total = make(1_000_000_000, "INR");
    const result = splitEqually(total, participants(10));
    expect(sumAllocations(result)).toBe(1_000_000_000);
    expect(amounts(result)).toEqual(new Array(10).fill(100_000_000));
  });

  it("1 participant gets the full amount", () => {
    const total = make(9999, "USD");
    const result = splitEqually(total, ["only-one"]);
    expect(result.allocations[0]!.amount.amountMinor).toBe(9999);
    expect(sumAllocations(result)).toBe(9999);
  });

  it("JPY (0 minor units) splits evenly", () => {
    // JPY has no sub-unit; 500 JPY / 2 = 250 each
    const result = splitEqually(make(500, "JPY"), ["alice", "bob"]);
    expect(amounts(result)).toEqual([250, 250]);
    expect(sumAllocations(result)).toBe(500);
  });

  it("JPY with remainder", () => {
    // 500 / 3 = base 166, remainder 2 → 167, 167, 166
    const result = splitEqually(make(500, "JPY"), ["p1", "p2", "p3"]);
    expect(amounts(result)).toEqual([167, 167, 166]);
    expect(sumAllocations(result)).toBe(500);
  });
});

// ============================================================================
// DETERMINISM
// ============================================================================

describe("splitEqually — determinism (Phase 2.2)", () => {
  it("produces identical output for identical inputs", () => {
    const total = make(100, "INR");
    const ps = ["alice", "bob", "charlie"];
    const r1 = splitEqually(total, ps);
    const r2 = splitEqually(total, ps);
    expect(amounts(r1)).toEqual(amounts(r2));
  });

  it("participant order determines remainder distribution", () => {
    const total = make(10, "INR");
    // 10 / 3 = base 3, remainder 1 → index 0 gets 4
    const r1 = splitEqually(total, ["alice", "bob", "charlie"]);
    const r2 = splitEqually(total, ["charlie", "alice", "bob"]);

    // alice gets 4 in r1 (first), charlie gets 4 in r2 (first)
    expect(r1.allocations[0]!.participantId).toBe("alice");
    expect(r1.allocations[0]!.amount.amountMinor).toBe(4);

    expect(r2.allocations[0]!.participantId).toBe("charlie");
    expect(r2.allocations[0]!.amount.amountMinor).toBe(4);

    // Both reconcile to total
    expect(sumAllocations(r1)).toBe(10);
    expect(sumAllocations(r2)).toBe(10);
  });

  it("output preserves input participant order", () => {
    const ps = ["z", "a", "m"];
    const result = splitEqually(make(30, "INR"), ps);
    expect(result.allocations.map((a) => a.participantId)).toEqual(ps);
  });
});

// ============================================================================
// CURRENCY PRESERVATION
// ============================================================================

describe("splitEqually — currency preservation (Phase 2.2)", () => {
  it("preserves INR currency on all allocations", () => {
    const result = splitEqually(make(100, "INR"), ["p1", "p2", "p3"]);
    for (const a of result.allocations) {
      expect(a.amount.currency).toBe("INR");
    }
  });

  it("preserves USD currency on all allocations", () => {
    const result = splitEqually(make(299, "USD"), ["p1", "p2"]);
    for (const a of result.allocations) {
      expect(a.amount.currency).toBe("USD");
    }
  });

  it("preserves JPY currency on all allocations", () => {
    const result = splitEqually(make(1000, "JPY"), ["p1", "p2", "p3"]);
    for (const a of result.allocations) {
      expect(a.amount.currency).toBe("JPY");
    }
  });
});

// ============================================================================
// RESULT STRUCTURE
// ============================================================================

describe("splitEqually — result structure (Phase 2.2)", () => {
  it("result contains the original total", () => {
    const total = make(500, "INR");
    const result = splitEqually(total, ["p1", "p2"]);
    expect(result.total.amountMinor).toBe(500);
    expect(result.total.currency).toBe("INR");
  });

  it("result contains the correct participant count", () => {
    const result = splitEqually(make(100, "INR"), participants(7));
    expect(result.participantCount).toBe(7);
    expect(result.allocations.length).toBe(7);
  });

  it("each allocation carries the correct participantId", () => {
    const ps = ["user-a", "user-b", "user-c"];
    const result = splitEqually(make(30, "INR"), ps);
    expect(result.allocations.map((a) => a.participantId)).toEqual(ps);
  });

  it("all allocation amounts are non-negative integers", () => {
    const result = splitEqually(make(7, "INR"), participants(3));
    for (const a of result.allocations) {
      expect(Number.isInteger(a.amount.amountMinor)).toBe(true);
      expect(a.amount.amountMinor).toBeGreaterThanOrEqual(0);
    }
  });

  it("no allocation exceeds base + 1", () => {
    // 10 / 3 = base 3, remainder 1
    const result = splitEqually(make(10, "INR"), participants(3));
    const base = Math.floor(10 / 3);
    for (const a of result.allocations) {
      expect(a.amount.amountMinor).toBeLessThanOrEqual(base + 1);
      expect(a.amount.amountMinor).toBeGreaterThanOrEqual(base);
    }
  });
});

// ============================================================================
// INVALID INPUT — PARTICIPANTS
// ============================================================================

describe("splitEqually — invalid participant inputs (Phase 2.2)", () => {
  it("throws EmptyParticipantsError for empty list", () => {
    expect(() => splitEqually(make(100, "INR"), [])).toThrow(EmptyParticipantsError);
  });

  it("throws DuplicateParticipantError for duplicate IDs", () => {
    expect(() =>
      splitEqually(make(100, "INR"), ["alice", "bob", "alice"])
    ).toThrow(DuplicateParticipantError);
  });

  it("throws InvalidParticipantError for empty-string participant", () => {
    expect(() =>
      splitEqually(make(100, "INR"), ["alice", "", "bob"])
    ).toThrow(InvalidParticipantError);
  });

  it("throws InvalidParticipantError for whitespace-only participant", () => {
    expect(() =>
      splitEqually(make(100, "INR"), ["alice", "   ", "bob"])
    ).toThrow(InvalidParticipantError);
  });

  it("does NOT silently remove duplicates", () => {
    expect(() =>
      splitEqually(make(100, "INR"), ["x", "x"])
    ).toThrow(DuplicateParticipantError);
  });

  it("error codes are set correctly", () => {
    try {
      splitEqually(make(100, "INR"), []);
    } catch (e) {
      expect(e).toBeInstanceOf(EmptyParticipantsError);
      expect((e as EmptyParticipantsError).code).toBe("EMPTY_PARTICIPANTS");
    }
  });
});

// ============================================================================
// INVALID INPUT — TOTAL
// ============================================================================

describe("splitEqually — invalid total inputs (Phase 2.2)", () => {
  it("throws NegativeSplitTotalError for negative total", () => {
    expect(() =>
      splitEqually(make(-100, "INR"), ["alice", "bob"])
    ).toThrow(NegativeSplitTotalError);
  });

  it("error is a MoneyError subclass", () => {
    expect(() =>
      splitEqually(make(-1, "INR"), ["p1"])
    ).toThrow(MoneyError);
  });
});

// ============================================================================
// FINANCIAL INVARIANTS
// ============================================================================

describe("splitEqually — financial invariants (Phase 2.2)", () => {
  it("Invariant: sum of allocations always equals total", () => {
    const cases: [number, number][] = [
      [100, 2], [100, 3], [1, 3], [999, 3],
      [100, 4], [101, 4], [0, 5], [7, 3], [10001, 3],
    ];
    for (const [total, n] of cases) {
      const result = splitEqually(make(total, "INR"), participants(n));
      expect(sumAllocations(result)).toBe(total);
    }
  });

  it("Invariant: every allocation amount is a safe integer", () => {
    const result = splitEqually(make(10000, "INR"), participants(7));
    for (const a of result.allocations) {
      expect(Number.isSafeInteger(a.amount.amountMinor)).toBe(true);
    }
  });

  it("Invariant: every allocation uses the input currency", () => {
    const currencies = ["INR", "USD", "EUR", "GBP", "JPY"] as const;
    for (const currency of currencies) {
      const result = splitEqually(make(100, currency), participants(3));
      for (const a of result.allocations) {
        expect(a.amount.currency).toBe(currency);
      }
    }
  });

  it("Invariant: allocation count equals participant count", () => {
    for (const n of [1, 2, 3, 5, 10, 20]) {
      const result = splitEqually(make(100, "INR"), participants(n));
      expect(result.allocations.length).toBe(n);
      expect(result.participantCount).toBe(n);
    }
  });

  it("Invariant: no allocation exceeds base + 1 or is less than base", () => {
    // 17 / 5 = base 3, remainder 2
    const result = splitEqually(make(17, "INR"), participants(5));
    const base = Math.floor(17 / 5);
    for (const a of result.allocations) {
      expect(a.amount.amountMinor).toBeGreaterThanOrEqual(base);
      expect(a.amount.amountMinor).toBeLessThanOrEqual(base + 1);
    }
  });

  it("Invariant: each participant appears exactly once in output", () => {
    const ps = ["alice", "bob", "charlie"];
    const result = splitEqually(make(100, "INR"), ps);
    const ids = result.allocations.map((a) => a.participantId);
    expect(new Set(ids).size).toBe(ps.length);
    expect(ids.sort()).toEqual([...ps].sort());
  });

  it("Invariant: split errors are MoneyError subclasses", () => {
    const errors = [
      new EmptyParticipantsError(),
      new DuplicateParticipantError("x"),
      new InvalidParticipantError(0),
      new NegativeSplitTotalError(),
    ];
    for (const e of errors) {
      expect(e).toBeInstanceOf(MoneyError);
      expect(e).toBeInstanceOf(Error);
    }
  });
});
