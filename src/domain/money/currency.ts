/**
 * Currency domain layer.
 *
 * Defines the supported currency codes, metadata (name, symbol, minor units),
 * and validation helpers.
 *
 * This module is framework-independent. Do not import React, Hono, or Expo here.
 */

// ============================================================================
// CURRENCY CODE
// ============================================================================

/**
 * Supported ISO 4217 currency codes.
 *
 * Add new codes here only after verifying:
 * 1. The minor-unit count in CURRENCY_META below.
 * 2. The currencies table seed data.
 */
export type CurrencyCode = "INR" | "USD" | "EUR" | "GBP" | "JPY";

// ============================================================================
// CURRENCY METADATA
// ============================================================================

export interface CurrencyMeta {
  /** ISO 4217 currency code */
  readonly code: CurrencyCode;
  /** Full display name */
  readonly name: string;
  /** Currency symbol for display */
  readonly symbol: string;
  /**
   * Number of minor-unit digits.
   *
   * Examples:
   *   INR → 2 (paise: ₹1.00 = 100 paise)
   *   USD → 2 (cents: $1.00 = 100 cents)
   *   JPY → 0 (no minor units: ¥1 = 1 yen)
   *
   * Never assume all currencies use 2 decimal places.
   */
  readonly minorUnits: number;
}

/**
 * Authoritative metadata for all supported currencies.
 *
 * minorUnits determines how many decimal places are valid when
 * parsing user-facing decimal strings (e.g. "100.50" for INR/USD/EUR/GBP,
 * but not "100.50" for JPY which has 0 minor units).
 */
export const CURRENCY_META: Record<CurrencyCode, CurrencyMeta> = {
  INR: { code: "INR", name: "Indian Rupee",    symbol: "₹", minorUnits: 2 },
  USD: { code: "USD", name: "US Dollar",        symbol: "$", minorUnits: 2 },
  EUR: { code: "EUR", name: "Euro",             symbol: "€", minorUnits: 2 },
  GBP: { code: "GBP", name: "British Pound",   symbol: "£", minorUnits: 2 },
  JPY: { code: "JPY", name: "Japanese Yen",    symbol: "¥", minorUnits: 0 },
} as const;

/** Ordered list of all supported currency codes. */
export const SUPPORTED_CURRENCY_CODES: readonly CurrencyCode[] = [
  "INR",
  "USD",
  "EUR",
  "GBP",
  "JPY",
];

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Type guard: returns true if `s` is a supported CurrencyCode.
 */
export function isCurrencyCode(s: string): s is CurrencyCode {
  return s in CURRENCY_META;
}

/**
 * Returns the metadata for a known currency code.
 * Throws if the code is not supported.
 */
export function getCurrencyMeta(code: CurrencyCode): CurrencyMeta {
  return CURRENCY_META[code];
}

/**
 * Validates that `s` is a supported CurrencyCode.
 * Returns the code narrowed to CurrencyCode if valid.
 * Throws InvalidCurrencyError if not.
 */
export function parseCurrencyCode(s: string): CurrencyCode {
  if (!isCurrencyCode(s)) {
    throw new Error(
      `Unsupported currency code: "${s}". Supported codes: ${SUPPORTED_CURRENCY_CODES.join(", ")}`
    );
  }
  return s;
}
