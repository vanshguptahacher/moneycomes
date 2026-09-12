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

// Equal Split
export {
  // Errors
  EmptyParticipantsError,
  DuplicateParticipantError,
  InvalidParticipantError,
  NegativeSplitTotalError,

  // Types
  type SplitAllocation,
  type EqualSplitResult,

  // Operation
  splitEqually,
} from "./money/split-equal.js";

// Exact Split
export {
  // Errors (exact-split-specific)
  NegativeAllocationError,
  AllocationCurrencyMismatchError,
  UnderAllocationError,
  OverAllocationError,

  // Types
  type ExactAllocationInput,
  type ExactSplitResult,

  // Operation
  splitExactly,
} from "./money/split-exact.js";

// Percentage Split
export {
  // Constants
  TOTAL_BASIS_POINTS,
  MIN_BASIS_POINTS,
  MAX_BASIS_POINTS,

  // Errors
  NegativePercentageError,
  InvalidPercentageError,
  PercentageTotalError,

  // Types
  type PercentageAllocationInput,
  type PercentageSplitResult,

  // Operations
  splitByPercentage,
  percentageStringToBasisPoints,
  basisPointsToPercentageString,
} from "./money/split-percentage.js";

// Shares Split
export {
  // Errors
  NegativeShareError,
  InvalidShareError,
  ZeroTotalSharesError,

  // Types
  type ShareAllocationInput,
  type SharesSplitResult,

  // Operation
  splitByShares,
} from "./money/split-shares.js";

// Balance Engine
export {
  // Errors
  InvalidPayerError,
  BalanceReconciliationError,

  // Types
  type ExpenseBalanceInput,
  type UserBalance,
  type ExpenseBalanceResult,

  // Operations & helpers
  calculateExpenseBalances,
  getUserBalance,
} from "./money/balance.js";

// Group Balance
export {
  // Errors
  EmptyGroupMembersError,
  InvalidMemberError,
  DuplicateMemberError,
  UnknownGroupMemberError,
  InvalidSettlementError,

  // Types
  type GroupSettlementInput,
  type GroupBalanceInput,
  type MemberGroupBalance,
  type GroupBalanceResult,

  // Operations & helpers
  calculateGroupBalances,
  getMemberBalance,
} from "./money/group-balance.js";

// Debt Simplification
export {
  // Errors
  EmptyBalancesError,
  UnreconciledBalancesError,

  // Types
  type NetBalanceInput,
  type SimplifyDebtsInput,
  type SimplifiedTransfer,
  type SimplifiedDebtsResult,

  // Operation
  simplifyDebts,
} from "./money/debt-simplification.js";

// Settlement Engine
export {
  // Errors
  SelfSettlementError,
  InvalidSettlementAmountError,
  OverSettlementError,
  DebtorCreditorMismatchError,
  InvalidSettlementPartiesError,
  DuplicateSettlementError,

  // Types
  type SettlementInput,
  type Settlement,
  type RecalculateBalancesInput,

  // Operations & helpers
  createSettlement,
  validateSettlement,
  isFullSettlement,
  isPartialSettlement,
  isMutualFullSettlement,
  applySettlement,
  applySettlements,
  recalculateBalances,
} from "./money/settlement.js";
