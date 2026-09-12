/**
 * Authoritative financial domain logic.
 * Independent of React, Hono, Expo, and all UI/HTTP frameworks.
 *
 * All financial calculations in the application must originate from this layer.
 */

// Currency
export {
  type CurrencyCode,
  type CurrencyMeta,
  CURRENCY_META,
  SUPPORTED_CURRENCY_CODES,
  isCurrencyCode,
  getCurrencyMeta,
  parseCurrencyCode,
} from "./money/currency.js";

// Money type and operations
export {
  // Types
  type Money,
  type SerializableMoney,

  // Errors
  MoneyError,
  InvalidMoneyError,
  CurrencyMismatchError,
  InvalidCurrencyError,
  InvalidPrecisionError,
  UnsafeIntegerError,

  // Construction
  make,
  zero,
  fromDecimal,

  // Arithmetic
  add,
  subtract,
  negate,
  abs,

  // Comparison
  compare,
  eq,
  gt,
  lt,
  gte,
  lte,
  isZero,
  isPositive,
  isNegative,

  // Serialization
  toSerializable,
  fromSerializable,

  // Formatting (presentation only)
  format,
} from "./money/money.js";
