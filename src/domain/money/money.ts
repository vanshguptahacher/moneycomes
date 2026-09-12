/**
 * Money domain type and operations.
 *
 * FINANCIAL INVARIANTS (see docs/FINANCIAL_INVARIANTS.md):
 *
 * 1. Money always carries an explicit currency.
 * 2. Arithmetic requires matching currencies.
 * 3. Authoritative money is represented as an exact integer (minor units).
 * 4. Floating-point values are NEVER authoritative.
 * 5. Precision violations are rejected unless an explicit rounding policy applies.
 * 6. Currency conversion is NEVER implicit.
 * 7. Financial calculations are deterministic.
 * 8. Financial domain code is independent of UI, HTTP, and framework code.
 *
 * This module is framework-independent. Do not import React, Hono, or Expo here.
 */

import {
  type CurrencyCode,
  getCurrencyMeta,
  isCurrencyCode,
  parseCurrencyCode,
} from "./currency.js";

// ============================================================================
// DOMAIN ERRORS
// ============================================================================

/**
 * Base class for all financial domain errors.
 * Never throw generic Error from financial operations.
 */
export class MoneyError extends Error {
  public readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "MoneyError";
    this.code = code;
  }
}

/** Thrown when a Money value cannot be constructed because the amount is invalid. */
export class InvalidMoneyError extends MoneyError {
  constructor(message: string) {
    super("INVALID_MONEY", message);
    this.name = "InvalidMoneyError";
  }
}

/** Thrown when arithmetic is attempted between two different currencies. */
export class CurrencyMismatchError extends MoneyError {
  constructor(a: CurrencyCode, b: CurrencyCode) {
    super(
      "CURRENCY_MISMATCH",
      `Currency mismatch: cannot combine ${a} and ${b}. Explicit currency conversion is required.`
    );
    this.name = "CurrencyMismatchError";
  }
}

/** Thrown when a string currency code is not a supported CurrencyCode. */
export class InvalidCurrencyError extends MoneyError {
  constructor(code: string) {
    super(
      "INVALID_CURRENCY",
      `"${code}" is not a supported currency code.`
    );
    this.name = "InvalidCurrencyError";
  }
}

/** Thrown when the decimal string has more decimal places than the currency allows. */
export class InvalidPrecisionError extends MoneyError {
  constructor(input: string, currency: CurrencyCode, allowed: number) {
    super(
      "INVALID_PRECISION",
      `"${input}" has more than ${allowed} decimal place(s) for ${currency}.`
    );
    this.name = "InvalidPrecisionError";
  }
}

/** Thrown when an amount exceeds Number.MAX_SAFE_INTEGER or is otherwise unsafe. */
export class UnsafeIntegerError extends MoneyError {
  constructor(value: number) {
    super(
      "UNSAFE_INTEGER",
      `${value} is not a safe integer. Amounts must be within ±${Number.MAX_SAFE_INTEGER}.`
    );
    this.name = "UnsafeIntegerError";
  }
}

// ============================================================================
// MONEY TYPE
// ============================================================================

/**
 * Authoritative Money representation.
 *
 * - amountMinor: integer in the currency's smallest unit (e.g. paise for INR, cents for USD, yen for JPY).
 *   May be negative for balance representations (debts).
 * - currency: ISO 4217 code from the supported set.
 *
 * NEVER store or transmit floating-point values as authoritative money.
 *
 * Example: ₹100.50 → { amountMinor: 10050, currency: "INR" }
 */
export interface Money {
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
}

// ============================================================================
// SERIALIZABLE FORM
// ============================================================================

/**
 * Wire/storage representation of Money.
 * Suitable for JSON serialization and database storage.
 */
export interface SerializableMoney {
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
}

// ============================================================================
// CONSTRUCTION
// ============================================================================

/**
 * Validates and returns a Money value from a known integer minor-unit amount.
 *
 * Throws:
 * - InvalidCurrencyError  — if the currency code is not supported
 * - InvalidMoneyError     — if amountMinor is NaN, Infinity, or non-integer
 * - UnsafeIntegerError    — if |amountMinor| > Number.MAX_SAFE_INTEGER
 */
export function make(amountMinor: number, currency: CurrencyCode): Money {
  // Validate currency
  if (!isCurrencyCode(currency)) {
    throw new InvalidCurrencyError(currency);
  }

  // Reject NaN and Infinity
  if (!Number.isFinite(amountMinor)) {
    throw new InvalidMoneyError(
      `amountMinor must be a finite number, received: ${amountMinor}`
    );
  }

  // Reject non-integers (floating-point values)
  if (!Number.isInteger(amountMinor)) {
    throw new InvalidMoneyError(
      `amountMinor must be an integer (minor unit), received: ${amountMinor}. Use fromDecimal() to parse a decimal string.`
    );
  }

  // Reject unsafe integers
  if (!Number.isSafeInteger(amountMinor)) {
    throw new UnsafeIntegerError(amountMinor);
  }

  return Object.freeze({ amountMinor, currency }) as Money;
}

/**
 * Returns a zero Money value for the given currency.
 */
export function zero(currency: CurrencyCode): Money {
  return make(0, currency);
}

// ============================================================================
// DECIMAL PARSING
// ============================================================================

/**
 * Parses a user-facing decimal string into a Money value.
 *
 * Accepted format:
 *   - Optional leading/trailing whitespace (stripped)
 *   - Optional leading '-' or '+' sign
 *   - Integer digits only, OR integer digits + '.' + fractional digits
 *   - Fractional digits must not exceed the currency's minorUnits
 *
 * Examples (INR, minorUnits=2):
 *   "100"     → { amountMinor: 10000, currency: "INR" }
 *   "100.50"  → { amountMinor: 10050, currency: "INR" }
 *   "0.01"    → { amountMinor: 1,     currency: "INR" }
 *   "100.555" → throws InvalidPrecisionError
 *   "abc"     → throws InvalidMoneyError
 *
 * Examples (JPY, minorUnits=0):
 *   "500"     → { amountMinor: 500,   currency: "JPY" }
 *   "500.5"   → throws InvalidPrecisionError (JPY has 0 decimal places)
 *
 * IMPORTANT: This function uses string-based arithmetic only.
 * No floating-point multiplication is used for conversion.
 *
 * Throws:
 * - InvalidCurrencyError   — unsupported currency
 * - InvalidMoneyError      — empty, NaN, Infinity, non-numeric input
 * - InvalidPrecisionError  — more decimal places than currency allows
 * - UnsafeIntegerError     — result exceeds safe integer range
 */
export function fromDecimal(rawInput: string, currency: CurrencyCode): Money {
  if (!isCurrencyCode(currency)) {
    throw new InvalidCurrencyError(currency);
  }

  const trimmed = rawInput.trim();

  // Reject empty
  if (trimmed.length === 0) {
    throw new InvalidMoneyError("Amount string must not be empty.");
  }

  // Reject explicitly banned string values
  const lower = trimmed.toLowerCase();
  if (lower === "nan" || lower === "infinity" || lower === "-infinity" || lower === "+infinity") {
    throw new InvalidMoneyError(`Invalid amount: "${trimmed}"`);
  }

  // Parse optional sign
  let rest = trimmed;
  let negative = false;
  if (rest.startsWith("-")) {
    negative = true;
    rest = rest.slice(1);
  } else if (rest.startsWith("+")) {
    rest = rest.slice(1);
  }

  if (rest.length === 0) {
    throw new InvalidMoneyError(`Invalid amount: "${trimmed}"`);
  }

  const meta = getCurrencyMeta(currency);

  // Split on decimal separator
  const parts = rest.split(".");
  if (parts.length > 2) {
    throw new InvalidMoneyError(`Invalid amount format: "${trimmed}"`);
  }

  const integerPart = parts[0]!;
  const fractionalPart = parts[1] ?? "";

  // Validate integer part: must be non-empty digits
  if (!/^\d+$/.test(integerPart)) {
    throw new InvalidMoneyError(
      `Invalid amount: "${trimmed}". Only digits are allowed in the integer part.`
    );
  }

  // Validate fractional part: must be only digits
  if (fractionalPart.length > 0 && !/^\d+$/.test(fractionalPart)) {
    throw new InvalidMoneyError(
      `Invalid amount: "${trimmed}". Only digits are allowed after the decimal point.`
    );
  }

  // Validate precision: fractional digits must not exceed minorUnits
  if (fractionalPart.length > meta.minorUnits) {
    throw new InvalidPrecisionError(trimmed, currency, meta.minorUnits);
  }

  // Pad fractional part to the required length (right-pad with zeros)
  const paddedFraction = fractionalPart.padEnd(meta.minorUnits, "0");

  // Combine integer and padded fraction as a single integer string
  const combinedStr = integerPart + paddedFraction;

  // Parse into a number — safe because we validated it's all digits
  const magnitude = parseInt(combinedStr, 10);

  const amountMinor = negative ? -magnitude : magnitude;

  return make(amountMinor, currency);
}

// ============================================================================
// ARITHMETIC
// ============================================================================

/**
 * Guards that two Money values share the same currency before an operation.
 */
function assertSameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) {
    throw new CurrencyMismatchError(a.currency, b.currency);
  }
}

/**
 * Adds two Money values of the same currency.
 *
 * Throws CurrencyMismatchError if currencies differ.
 * Throws UnsafeIntegerError if the result would exceed safe integer bounds.
 */
export function add(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return make(a.amountMinor + b.amountMinor, a.currency);
}

/**
 * Subtracts b from a. Both must share the same currency.
 *
 * Throws CurrencyMismatchError if currencies differ.
 * Throws UnsafeIntegerError if the result would exceed safe integer bounds.
 */
export function subtract(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return make(a.amountMinor - b.amountMinor, a.currency);
}

/**
 * Negates the amount of a Money value (e.g. ₹500 → -₹500).
 * Note: negate(zero) returns zero (not -0).
 */
export function negate(m: Money): Money {
  // Use `|| 0` to normalize -0 to 0 (JavaScript -0 quirk)
  return make((-m.amountMinor) || 0, m.currency);
}

/**
 * Returns the absolute value of a Money value (e.g. -₹500 → ₹500).
 */
export function abs(m: Money): Money {
  return make(Math.abs(m.amountMinor), m.currency);
}

// ============================================================================
// COMPARISON
// ============================================================================

/**
 * Compares two Money values of the same currency.
 *
 * Returns:
 *   -1 if a < b
 *    0 if a === b
 *   +1 if a > b
 *
 * Throws CurrencyMismatchError if currencies differ.
 */
export function compare(a: Money, b: Money): -1 | 0 | 1 {
  assertSameCurrency(a, b);
  if (a.amountMinor < b.amountMinor) return -1;
  if (a.amountMinor > b.amountMinor) return 1;
  return 0;
}

/** Returns true if a equals b (same currency and same amount). */
export function eq(a: Money, b: Money): boolean {
  return compare(a, b) === 0;
}

/** Returns true if a > b. Throws if currencies differ. */
export function gt(a: Money, b: Money): boolean {
  return compare(a, b) === 1;
}

/** Returns true if a < b. Throws if currencies differ. */
export function lt(a: Money, b: Money): boolean {
  return compare(a, b) === -1;
}

/** Returns true if a >= b. Throws if currencies differ. */
export function gte(a: Money, b: Money): boolean {
  return compare(a, b) >= 0;
}

/** Returns true if a <= b. Throws if currencies differ. */
export function lte(a: Money, b: Money): boolean {
  return compare(a, b) <= 0;
}

/** Returns true if amountMinor === 0. */
export function isZero(m: Money): boolean {
  return m.amountMinor === 0;
}

/** Returns true if amountMinor > 0. */
export function isPositive(m: Money): boolean {
  return m.amountMinor > 0;
}

/** Returns true if amountMinor < 0. */
export function isNegative(m: Money): boolean {
  return m.amountMinor < 0;
}

// ============================================================================
// SERIALIZATION
// ============================================================================

/**
 * Converts Money to its deterministic wire/storage representation.
 * Safe for JSON serialization and database storage.
 *
 * The representation is identical to the database schema's amountMinor + currencyCode.
 */
export function toSerializable(m: Money): SerializableMoney {
  return { amountMinor: m.amountMinor, currency: m.currency };
}

/**
 * Reconstructs a Money value from its serialized form.
 * Applies the same validation as `make()`.
 */
export function fromSerializable(s: SerializableMoney): Money {
  return make(s.amountMinor, s.currency);
}

// ============================================================================
// FORMATTING (PRESENTATION ONLY)
// ============================================================================

/**
 * Formats a Money value as a human-readable display string.
 *
 * Examples:
 *   { amountMinor: 10050, currency: "INR" } → "₹100.50"
 *   { amountMinor: 2575,  currency: "USD" } → "$25.75"
 *   { amountMinor: 500,   currency: "JPY" } → "¥500"
 *   { amountMinor: -10050, currency: "INR" } → "-₹100.50"
 *
 * IMPORTANT:
 * - This is a PRESENTATION-ONLY function.
 * - It does NOT modify the underlying Money value.
 * - Never use formatted strings in financial calculations.
 * - Does not apply locale-specific thousands separators (use Intl.NumberFormat
 *   in UI components if needed, passing the amountMinor integer directly).
 */
export function format(m: Money): string {
  const meta = getCurrencyMeta(m.currency);
  const absMinor = Math.abs(m.amountMinor);
  const sign = m.amountMinor < 0 ? "-" : "";

  if (meta.minorUnits === 0) {
    return `${sign}${meta.symbol}${absMinor}`;
  }

  const factor = Math.pow(10, meta.minorUnits);
  const wholePart = Math.floor(absMinor / factor);
  const fracPart = absMinor % factor;

  const fracStr = fracPart.toString().padStart(meta.minorUnits, "0");
  return `${sign}${meta.symbol}${wholePart}.${fracStr}`;
}

// ============================================================================
// RE-EXPORT parseCurrencyCode for convenience
// ============================================================================

export { type CurrencyCode, getCurrencyMeta, isCurrencyCode, parseCurrencyCode };
