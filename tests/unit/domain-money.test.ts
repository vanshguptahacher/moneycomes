import { describe, it, expect } from "vitest";
import {
  // Currency
  isCurrencyCode,
  getCurrencyMeta,
  parseCurrencyCode,
  SUPPORTED_CURRENCY_CODES,
  CURRENCY_META,
  // Money
  make,
  zero,
  fromDecimal,
  add,
  subtract,
  negate,
  abs,
  compare,
  eq,
  gt,
  lt,
  gte,
  lte,
  isZero,
  isPositive,
  isNegative,
  toSerializable,
  fromSerializable,
  format,
  // Errors
  MoneyError,
  InvalidMoneyError,
  CurrencyMismatchError,
  InvalidCurrencyError,
  InvalidPrecisionError,
  UnsafeIntegerError,
} from "../../src/domain/index.js";

// ============================================================================
// CURRENCY
// ============================================================================

describe("Currency (Phase 2.1)", () => {
  describe("isCurrencyCode", () => {
    it("returns true for all supported codes", () => {
      for (const code of SUPPORTED_CURRENCY_CODES) {
        expect(isCurrencyCode(code)).toBe(true);
      }
    });

    it("returns false for unsupported strings", () => {
      expect(isCurrencyCode("XYZ")).toBe(false);
      expect(isCurrencyCode("")).toBe(false);
      expect(isCurrencyCode("inr")).toBe(false); // case-sensitive
      expect(isCurrencyCode("US$")).toBe(false);
    });
  });

  describe("getCurrencyMeta", () => {
    it("returns correct metadata for INR", () => {
      const meta = getCurrencyMeta("INR");
      expect(meta.code).toBe("INR");
      expect(meta.symbol).toBe("₹");
      expect(meta.minorUnits).toBe(2);
      expect(meta.name).toBe("Indian Rupee");
    });

    it("returns correct metadata for USD", () => {
      const meta = getCurrencyMeta("USD");
      expect(meta.code).toBe("USD");
      expect(meta.symbol).toBe("$");
      expect(meta.minorUnits).toBe(2);
    });

    it("returns 0 minor units for JPY", () => {
      const meta = getCurrencyMeta("JPY");
      expect(meta.minorUnits).toBe(0);
      expect(meta.symbol).toBe("¥");
    });
  });

  describe("parseCurrencyCode", () => {
    it("parses valid currency codes", () => {
      expect(parseCurrencyCode("INR")).toBe("INR");
      expect(parseCurrencyCode("USD")).toBe("USD");
      expect(parseCurrencyCode("JPY")).toBe("JPY");
    });

    it("throws for unsupported codes", () => {
      expect(() => parseCurrencyCode("XYZ")).toThrow();
      expect(() => parseCurrencyCode("")).toThrow();
    });
  });

  describe("CURRENCY_META completeness", () => {
    it("has metadata for all supported codes", () => {
      for (const code of SUPPORTED_CURRENCY_CODES) {
        expect(CURRENCY_META[code]).toBeDefined();
        expect(CURRENCY_META[code]!.minorUnits).toBeGreaterThanOrEqual(0);
      }
    });
  });
});

// ============================================================================
// MONEY CONSTRUCTION
// ============================================================================

describe("Money.make (Phase 2.1)", () => {
  it("creates zero money", () => {
    const m = make(0, "INR");
    expect(m.amountMinor).toBe(0);
    expect(m.currency).toBe("INR");
  });

  it("creates positive money", () => {
    const m = make(10050, "INR");
    expect(m.amountMinor).toBe(10050);
    expect(m.currency).toBe("INR");
  });

  it("creates negative money (for balance representation)", () => {
    const m = make(-5000, "USD");
    expect(m.amountMinor).toBe(-5000);
    expect(m.currency).toBe("USD");
  });

  it("creates the smallest representable unit (1 paise)", () => {
    const m = make(1, "INR");
    expect(m.amountMinor).toBe(1);
  });

  it("creates the smallest representable unit (1 JPY)", () => {
    const m = make(1, "JPY");
    expect(m.amountMinor).toBe(1);
  });

  it("creates large but safe values", () => {
    const large = Number.MAX_SAFE_INTEGER;
    const m = make(large, "INR");
    expect(m.amountMinor).toBe(large);
  });

  it("rejects NaN", () => {
    expect(() => make(NaN, "INR")).toThrow(InvalidMoneyError);
  });

  it("rejects Infinity", () => {
    expect(() => make(Infinity, "INR")).toThrow(InvalidMoneyError);
    expect(() => make(-Infinity, "INR")).toThrow(InvalidMoneyError);
  });

  it("rejects non-integer (floating-point) amounts", () => {
    expect(() => make(100.5, "INR")).toThrow(InvalidMoneyError);
    expect(() => make(0.01, "INR")).toThrow(InvalidMoneyError);
  });

  it("rejects unsafe integer exceeding MAX_SAFE_INTEGER", () => {
    const unsafe = Number.MAX_SAFE_INTEGER + 1;
    expect(() => make(unsafe, "INR")).toThrow(UnsafeIntegerError);
  });

  it("rejects unsafe integer below -MAX_SAFE_INTEGER", () => {
    const unsafe = -(Number.MAX_SAFE_INTEGER + 1);
    expect(() => make(unsafe, "INR")).toThrow(UnsafeIntegerError);
  });

  it("produces an immutable object", () => {
    const m = make(100, "INR");
    expect(() => {
      // @ts-expect-error testing immutability
      m.amountMinor = 999;
    }).toThrow();
  });
});

describe("Money.zero (Phase 2.1)", () => {
  it("creates zero for INR", () => {
    const m = zero("INR");
    expect(m.amountMinor).toBe(0);
    expect(m.currency).toBe("INR");
  });

  it("creates zero for JPY", () => {
    const m = zero("JPY");
    expect(m.amountMinor).toBe(0);
    expect(m.currency).toBe("JPY");
  });
});

// ============================================================================
// DECIMAL PARSING
// ============================================================================

describe("Money.fromDecimal (Phase 2.1)", () => {
  describe("valid inputs — INR (2 minor units)", () => {
    it("parses whole integer string", () => {
      expect(fromDecimal("100", "INR").amountMinor).toBe(10000);
    });

    it("parses zero", () => {
      expect(fromDecimal("0", "INR").amountMinor).toBe(0);
    });

    it("parses 2-decimal string", () => {
      expect(fromDecimal("100.50", "INR").amountMinor).toBe(10050);
    });

    it("parses 1-decimal string (padded to 2)", () => {
      expect(fromDecimal("100.5", "INR").amountMinor).toBe(10050);
    });

    it("parses minimum value (0.01)", () => {
      expect(fromDecimal("0.01", "INR").amountMinor).toBe(1);
    });

    it("parses negative decimal", () => {
      expect(fromDecimal("-100.50", "INR").amountMinor).toBe(-10050);
    });

    it("parses with explicit positive sign", () => {
      expect(fromDecimal("+100.50", "INR").amountMinor).toBe(10050);
    });

    it("strips leading and trailing whitespace", () => {
      expect(fromDecimal("  100.50  ", "INR").amountMinor).toBe(10050);
    });

    it("preserves correct currency on result", () => {
      expect(fromDecimal("50.00", "INR").currency).toBe("INR");
    });
  });

  describe("valid inputs — JPY (0 minor units)", () => {
    it("parses whole integer for JPY", () => {
      expect(fromDecimal("500", "JPY").amountMinor).toBe(500);
    });

    it("parses zero for JPY", () => {
      expect(fromDecimal("0", "JPY").amountMinor).toBe(0);
    });

    it("parses negative JPY amount", () => {
      expect(fromDecimal("-1000", "JPY").amountMinor).toBe(-1000);
    });
  });

  describe("invalid inputs", () => {
    it("rejects empty string", () => {
      expect(() => fromDecimal("", "INR")).toThrow(InvalidMoneyError);
    });

    it("rejects whitespace-only string", () => {
      expect(() => fromDecimal("   ", "INR")).toThrow(InvalidMoneyError);
    });

    it("rejects 'NaN' string", () => {
      expect(() => fromDecimal("NaN", "INR")).toThrow(InvalidMoneyError);
    });

    it("rejects 'Infinity' string", () => {
      expect(() => fromDecimal("Infinity", "INR")).toThrow(InvalidMoneyError);
    });

    it("rejects '-Infinity' string", () => {
      expect(() => fromDecimal("-Infinity", "INR")).toThrow(InvalidMoneyError);
    });

    it("rejects alphabetic input", () => {
      expect(() => fromDecimal("abc", "INR")).toThrow(InvalidMoneyError);
    });

    it("rejects mixed alphanumeric input", () => {
      expect(() => fromDecimal("100abc", "INR")).toThrow(InvalidMoneyError);
    });

    it("rejects multiple decimal points", () => {
      expect(() => fromDecimal("1.0.0", "INR")).toThrow(InvalidMoneyError);
    });
  });

  describe("precision violations", () => {
    it("rejects 3 decimal places for INR (max 2)", () => {
      expect(() => fromDecimal("100.555", "INR")).toThrow(InvalidPrecisionError);
    });

    it("rejects any decimal places for JPY (max 0)", () => {
      expect(() => fromDecimal("500.5", "JPY")).toThrow(InvalidPrecisionError);
      expect(() => fromDecimal("500.00", "JPY")).toThrow(InvalidPrecisionError);
    });
  });
});

// ============================================================================
// ARITHMETIC
// ============================================================================

describe("Money arithmetic (Phase 2.1)", () => {
  describe("add", () => {
    it("adds two zero values", () => {
      expect(add(zero("INR"), zero("INR")).amountMinor).toBe(0);
    });

    it("adds two positive values", () => {
      expect(add(make(100, "INR"), make(50, "INR")).amountMinor).toBe(150);
    });

    it("adds positive and negative (net result)", () => {
      expect(add(make(1000, "INR"), make(-300, "INR")).amountMinor).toBe(700);
    });

    it("0 + 0 = 0 (additive identity)", () => {
      const result = add(zero("USD"), zero("USD"));
      expect(result.amountMinor).toBe(0);
      expect(result.currency).toBe("USD");
    });

    it("a + 0 = a (right identity)", () => {
      const a = make(500, "INR");
      expect(eq(add(a, zero("INR")), a)).toBe(true);
    });

    it("preserves currency on result", () => {
      expect(add(make(100, "USD"), make(50, "USD")).currency).toBe("USD");
    });

    it("throws CurrencyMismatchError for different currencies", () => {
      expect(() => add(make(100, "INR"), make(100, "USD"))).toThrow(CurrencyMismatchError);
    });

    it("throws UnsafeIntegerError on overflow", () => {
      const big = make(Number.MAX_SAFE_INTEGER, "INR");
      expect(() => add(big, make(1, "INR"))).toThrow(UnsafeIntegerError);
    });
  });

  describe("subtract", () => {
    it("subtracts two equal values giving zero", () => {
      expect(subtract(make(500, "INR"), make(500, "INR")).amountMinor).toBe(0);
    });

    it("subtracts smaller from larger", () => {
      expect(subtract(make(1000, "INR"), make(300, "INR")).amountMinor).toBe(700);
    });

    it("subtracts larger from smaller (negative result)", () => {
      expect(subtract(make(300, "INR"), make(1000, "INR")).amountMinor).toBe(-700);
    });

    it("a - 0 = a (right identity)", () => {
      const a = make(999, "INR");
      expect(eq(subtract(a, zero("INR")), a)).toBe(true);
    });

    it("throws CurrencyMismatchError for different currencies", () => {
      expect(() => subtract(make(100, "INR"), make(100, "USD"))).toThrow(CurrencyMismatchError);
    });
  });

  describe("negate", () => {
    it("negates positive amount", () => {
      expect(negate(make(500, "INR")).amountMinor).toBe(-500);
    });

    it("negates negative amount (double negation = identity)", () => {
      expect(negate(make(-500, "INR")).amountMinor).toBe(500);
    });

    it("negate of zero is zero", () => {
      expect(negate(zero("INR")).amountMinor).toBe(0);
    });

    it("a + (-a) = 0", () => {
      const a = make(1234, "USD");
      expect(add(a, negate(a)).amountMinor).toBe(0);
    });

    it("preserves currency", () => {
      expect(negate(make(100, "EUR")).currency).toBe("EUR");
    });
  });

  describe("abs", () => {
    it("abs of positive is unchanged", () => {
      expect(abs(make(500, "INR")).amountMinor).toBe(500);
    });

    it("abs of negative is positive", () => {
      expect(abs(make(-500, "INR")).amountMinor).toBe(500);
    });

    it("abs of zero is zero", () => {
      expect(abs(zero("INR")).amountMinor).toBe(0);
    });

    it("preserves currency", () => {
      expect(abs(make(-100, "GBP")).currency).toBe("GBP");
    });
  });
});

// ============================================================================
// COMPARISON
// ============================================================================

describe("Money comparison (Phase 2.1)", () => {
  describe("compare", () => {
    it("returns 0 for equal amounts", () => {
      expect(compare(make(100, "INR"), make(100, "INR"))).toBe(0);
    });

    it("returns -1 when a < b", () => {
      expect(compare(make(50, "INR"), make(100, "INR"))).toBe(-1);
    });

    it("returns 1 when a > b", () => {
      expect(compare(make(100, "INR"), make(50, "INR"))).toBe(1);
    });

    it("compare(a, a) = 0 always", () => {
      const a = make(999, "USD");
      expect(compare(a, a)).toBe(0);
    });

    it("throws for currency mismatch", () => {
      expect(() => compare(make(100, "INR"), make(100, "USD"))).toThrow(CurrencyMismatchError);
    });
  });

  describe("eq / gt / lt / gte / lte", () => {
    const inr100 = make(100, "INR");
    const inr200 = make(200, "INR");
    const inr100b = make(100, "INR");

    it("eq returns true for same value", () => {
      expect(eq(inr100, inr100b)).toBe(true);
    });

    it("eq returns false for different values", () => {
      expect(eq(inr100, inr200)).toBe(false);
    });

    it("gt", () => {
      expect(gt(inr200, inr100)).toBe(true);
      expect(gt(inr100, inr200)).toBe(false);
    });

    it("lt", () => {
      expect(lt(inr100, inr200)).toBe(true);
      expect(lt(inr200, inr100)).toBe(false);
    });

    it("gte", () => {
      expect(gte(inr200, inr100)).toBe(true);
      expect(gte(inr100, inr100b)).toBe(true);
      expect(gte(inr100, inr200)).toBe(false);
    });

    it("lte", () => {
      expect(lte(inr100, inr200)).toBe(true);
      expect(lte(inr100, inr100b)).toBe(true);
      expect(lte(inr200, inr100)).toBe(false);
    });
  });

  describe("isZero / isPositive / isNegative", () => {
    it("isZero returns true for zero", () => {
      expect(isZero(zero("INR"))).toBe(true);
    });

    it("isZero returns false for non-zero", () => {
      expect(isZero(make(1, "INR"))).toBe(false);
      expect(isZero(make(-1, "INR"))).toBe(false);
    });

    it("isPositive", () => {
      expect(isPositive(make(1, "INR"))).toBe(true);
      expect(isPositive(zero("INR"))).toBe(false);
      expect(isPositive(make(-1, "INR"))).toBe(false);
    });

    it("isNegative", () => {
      expect(isNegative(make(-1, "INR"))).toBe(true);
      expect(isNegative(zero("INR"))).toBe(false);
      expect(isNegative(make(1, "INR"))).toBe(false);
    });
  });
});

// ============================================================================
// SERIALIZATION
// ============================================================================

describe("Money serialization (Phase 2.1)", () => {
  it("toSerializable returns expected shape", () => {
    const m = make(10050, "INR");
    const s = toSerializable(m);
    expect(s).toEqual({ amountMinor: 10050, currency: "INR" });
  });

  it("fromSerializable reconstructs money correctly", () => {
    const s = { amountMinor: 2575, currency: "USD" as const };
    const m = fromSerializable(s);
    expect(m.amountMinor).toBe(2575);
    expect(m.currency).toBe("USD");
  });

  it("round-trips through serialization", () => {
    const original = make(99900, "EUR");
    const serialized = toSerializable(original);
    const restored = fromSerializable(serialized);
    expect(eq(original, restored)).toBe(true);
  });

  it("serialization does not mutate the original money value", () => {
    const m = make(500, "GBP");
    const s = toSerializable(m);
    expect(m.amountMinor).toBe(500); // unchanged
    expect(s.amountMinor).toBe(500);
  });
});

// ============================================================================
// FORMATTING
// ============================================================================

describe("Money.format (Phase 2.1)", () => {
  it("formats INR whole rupees", () => {
    expect(format(make(10000, "INR"))).toBe("₹100.00");
  });

  it("formats INR with paise", () => {
    expect(format(make(10050, "INR"))).toBe("₹100.50");
  });

  it("formats INR minimum unit", () => {
    expect(format(make(1, "INR"))).toBe("₹0.01");
  });

  it("formats USD", () => {
    expect(format(make(2575, "USD"))).toBe("$25.75");
  });

  it("formats EUR", () => {
    expect(format(make(1000, "EUR"))).toBe("€10.00");
  });

  it("formats GBP", () => {
    expect(format(make(599, "GBP"))).toBe("£5.99");
  });

  it("formats JPY (zero minor units, no decimal)", () => {
    expect(format(make(500, "JPY"))).toBe("¥500");
  });

  it("formats zero", () => {
    expect(format(zero("INR"))).toBe("₹0.00");
  });

  it("formats zero JPY", () => {
    expect(format(zero("JPY"))).toBe("¥0");
  });

  it("formats negative INR", () => {
    expect(format(make(-10050, "INR"))).toBe("-₹100.50");
  });

  it("formats negative JPY", () => {
    expect(format(make(-500, "JPY"))).toBe("-¥500");
  });

  it("does NOT mutate the underlying Money value", () => {
    const m = make(10050, "INR");
    format(m); // call it
    expect(m.amountMinor).toBe(10050); // unchanged
    expect(m.currency).toBe("INR");    // unchanged
  });
});

// ============================================================================
// FINANCIAL INVARIANTS
// ============================================================================

describe("Financial invariants (Phase 2.1)", () => {
  it("Invariant 1: Money always has a currency", () => {
    const m = make(100, "INR");
    expect(m.currency).toBeDefined();
    expect(typeof m.currency).toBe("string");
  });

  it("Invariant 2: arithmetic between different currencies throws", () => {
    expect(() => add(make(100, "INR"), make(100, "USD"))).toThrow(CurrencyMismatchError);
    expect(() => subtract(make(100, "INR"), make(100, "USD"))).toThrow(CurrencyMismatchError);
    expect(() => compare(make(100, "INR"), make(100, "USD"))).toThrow(CurrencyMismatchError);
  });

  it("Invariant 3: amountMinor is always an integer", () => {
    const cases = [0, 1, 1000, -500, Number.MAX_SAFE_INTEGER];
    for (const v of cases) {
      expect(Number.isInteger(make(v, "INR").amountMinor)).toBe(true);
    }
  });

  it("Invariant 4: floating-point values are rejected", () => {
    expect(() => make(100.5, "INR")).toThrow(InvalidMoneyError);
    expect(() => make(0.1, "INR")).toThrow(InvalidMoneyError);
    expect(() => make(1.23456789, "INR")).toThrow(InvalidMoneyError);
  });

  it("Invariant 5: precision violations are rejected", () => {
    expect(() => fromDecimal("0.001", "INR")).toThrow(InvalidPrecisionError);
  });

  it("Invariant 7: arithmetic is deterministic (same inputs = same output)", () => {
    const a = make(12345, "INR");
    const b = make(67890, "INR");
    const r1 = add(a, b);
    const r2 = add(a, b);
    expect(r1.amountMinor).toBe(r2.amountMinor);
    expect(r1.currency).toBe(r2.currency);
  });

  it("Invariant: arithmetic never changes currency", () => {
    const a = make(100, "INR");
    expect(add(a, a).currency).toBe("INR");
    expect(subtract(a, a).currency).toBe("INR");
    expect(negate(a).currency).toBe("INR");
    expect(abs(a).currency).toBe("INR");
  });

  it("Invariant: format never changes stored value", () => {
    const m = make(9999, "INR");
    const formatted = format(m);
    expect(typeof formatted).toBe("string");
    expect(m.amountMinor).toBe(9999);
  });

  it("Invariant: MoneyError is base of all financial domain errors", () => {
    const errors = [
      new InvalidMoneyError("test"),
      new CurrencyMismatchError("INR", "USD"),
      new InvalidCurrencyError("XYZ"),
      new InvalidPrecisionError("1.234", "INR", 2),
      new UnsafeIntegerError(Number.MAX_SAFE_INTEGER + 1),
    ];
    for (const e of errors) {
      expect(e).toBeInstanceOf(MoneyError);
      expect(e).toBeInstanceOf(Error);
      expect(typeof e.code).toBe("string");
    }
  });
});
