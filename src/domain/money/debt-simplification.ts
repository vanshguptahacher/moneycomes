/**
 * Debt Simplification domain operation (Phase 2.8).
 *
 * Reduces payment hops by generating a minimal, deterministic set of direct
 * transfers between debtors and creditors that settles all group net positions.
 *
 * ============================================================
 * BALANCE CONVENTION
 * ============================================================
 *
 * Input:
 *   Positive balance (+): Creditor -> should receive money.
 *   Negative balance (-): Debtor   -> owes money.
 *   Zero balance (0):     Settled  -> does not participate in transfers.
 *
 * Output:
 *   Simplified transfers where each transfer has:
 *     fromUserId: Debtor (who pays)
 *     toUserId:   Creditor (who receives)
 *     amount:     Exact positive Money amount
 *
 * ============================================================
 * PRESERVATION INVARIANT
 * ============================================================
 *
 * 1. For every user u:
 *      sum(transfers received by u) - sum(transfers paid by u) === original net balance of u
 * 2. After applying all generated transfers, every user's remaining balance is 0.
 * 3. Total money transferred equals the sum of all positive creditor balances
 *    (which equals the sum of all absolute debtor balances).
 * 4. Sum of all original net balances must be exactly 0 (reconciled input).
 *
 * ============================================================
 * DETERMINISTIC MATCHING ALGORITHM
 * ============================================================
 *
 * 1. Extract debtors (netBalance < 0) with debtAmount = abs(netBalance).
 * 2. Extract creditors (netBalance > 0) with creditAmount = netBalance.
 * 3. Sort debtors:
 *      Primary:   Descending by debtAmount (largest debt first).
 *      Secondary: Ascending by original inputIndex (earlier in input wins).
 * 4. Sort creditors:
 *      Primary:   Descending by creditAmount (largest credit first).
 *      Secondary: Ascending by original inputIndex (earlier in input wins).
 * 5. Greedily match the head debtor D and head creditor C:
 *      transferAmount = min(D.remaining, C.remaining)
 *      Generate transfer: D pays C transferAmount
 *      D.remaining -= transferAmount
 *      C.remaining -= transferAmount
 *      If D.remaining === 0 -> advance debtor
 *      If C.remaining === 0 -> advance creditor
 * 6. Repeat until all debts and credits reach 0.
 *
 * This module is framework-independent. Do not import React, Hono, or Expo here.
 */

import {
  type Money,
  type CurrencyCode,
  make,
  CurrencyMismatchError,
  MoneyError,
} from "./money.js";
import {
  DuplicateParticipantError,
  InvalidParticipantError,
} from "./split-equal.js";
import {
  type UserBalance,
  type ExpenseBalanceResult,
} from "./balance.js";
import {
  type MemberGroupBalance,
  type GroupBalanceResult,
} from "./group-balance.js";

// ============================================================================
// DOMAIN ERRORS
// ============================================================================

/** Thrown when the balance input array is empty. */
export class EmptyBalancesError extends MoneyError {
  constructor() {
    super("EMPTY_BALANCES", "Balances array must not be empty.");
    this.name = "EmptyBalancesError";
  }
}

/** Thrown when net balances do not reconcile to zero. */
export class UnreconciledBalancesError extends MoneyError {
  constructor(sumMinor: number) {
    super(
      "UNRECONCILED_BALANCES",
      `Cannot simplify debts: net balances do not sum to zero (discrepancy of ${sumMinor} minor units).`
    );
    this.name = "UnreconciledBalancesError";
  }
}

// Re-export shared errors for caller convenience
export {
  DuplicateParticipantError,
  InvalidParticipantError,
  CurrencyMismatchError,
};

// ============================================================================
// TYPES
// ============================================================================

/**
 * Basic net balance input item.
 */
export interface NetBalanceInput {
  readonly userId: string;
  readonly netBalance: Money;
}

/**
 * Options object for debt simplification.
 */
export interface SimplifyDebtsInput {
  readonly balances: readonly (NetBalanceInput | MemberGroupBalance | UserBalance)[];
  readonly currency?: CurrencyCode;
}

/**
 * A single direct simplified transfer from a debtor to a creditor.
 *
 * @field fromUserId - User who pays (debtor).
 * @field toUserId   - User who receives (creditor).
 * @field debtorId   - Alias for fromUserId.
 * @field creditorId - Alias for toUserId.
 * @field amount     - Positive Money amount to transfer.
 */
export interface SimplifiedTransfer {
  readonly fromUserId: string;
  readonly toUserId: string;
  readonly debtorId: string;
  readonly creditorId: string;
  readonly amount: Money;
}

/**
 * Result of debt simplification.
 *
 * Invariants:
 * - transfers is frozen.
 * - transferCount === transfers.length.
 * - every transfer has amount > 0.
 * - every transfer uses the same currency.
 */
export interface SimplifiedDebtsResult {
  readonly currency: CurrencyCode;
  readonly transferCount: number;
  readonly transfers: readonly SimplifiedTransfer[];
}

// ============================================================================
// DEBT SIMPLIFICATION OPERATION
// ============================================================================

/**
 * Overload 1: Accepts a SimplifyDebtsInput options object.
 */
export function simplifyDebts(input: SimplifyDebtsInput): SimplifiedDebtsResult;

/**
 * Overload 2: Accepts a GroupBalanceResult directly.
 */
export function simplifyDebts(groupResult: GroupBalanceResult): SimplifiedDebtsResult;

/**
 * Overload 3: Accepts an ExpenseBalanceResult directly.
 */
export function simplifyDebts(expenseResult: ExpenseBalanceResult): SimplifiedDebtsResult;

/**
 * Overload 4: Accepts an array of balance items.
 */
export function simplifyDebts(
  balances: readonly (NetBalanceInput | MemberGroupBalance | UserBalance)[]
): SimplifiedDebtsResult;

/**
 * Implementation of simplifyDebts.
 */
export function simplifyDebts(
  inputOrBalances:
    | SimplifyDebtsInput
    | GroupBalanceResult
    | ExpenseBalanceResult
    | readonly (NetBalanceInput | MemberGroupBalance | UserBalance)[]
): SimplifiedDebtsResult {
  let rawBalances: readonly (NetBalanceInput | MemberGroupBalance | UserBalance)[];
  let explicitCurrency: CurrencyCode | undefined;

  if (Array.isArray(inputOrBalances)) {
    rawBalances = inputOrBalances;
  } else if ("balances" in inputOrBalances) {
    rawBalances = inputOrBalances.balances;
    if ("currency" in inputOrBalances && typeof inputOrBalances.currency === "string") {
      explicitCurrency = inputOrBalances.currency;
    }
  } else {
    throw new EmptyBalancesError();
  }

  if (rawBalances.length === 0) {
    throw new EmptyBalancesError();
  }

  // 1. Determine active currency
  const activeCurrency: CurrencyCode = explicitCurrency ?? rawBalances[0]!.netBalance.currency;

  // 2. Validate inputs, uniqueness, and currency consistency
  const seenUsers = new Set<string>();
  let sumMinor = 0;

  type InternalDebtor = {
    userId: string;
    inputIndex: number;
    remaining: number; // positive minor units
  };

  type InternalCreditor = {
    userId: string;
    inputIndex: number;
    remaining: number; // positive minor units
  };

  const debtors: InternalDebtor[] = [];
  const creditors: InternalCreditor[] = [];

  for (let i = 0; i < rawBalances.length; i++) {
    const item = rawBalances[i]!;
    const { userId, netBalance } = item;

    // Validate user ID
    if (typeof userId !== "string" || userId.trim().length === 0) {
      throw new InvalidParticipantError(i);
    }

    // Reject duplicate users
    if (seenUsers.has(userId)) {
      throw new DuplicateParticipantError(userId);
    }
    seenUsers.add(userId);

    // Validate currency
    if (netBalance.currency !== activeCurrency) {
      throw new CurrencyMismatchError(activeCurrency, netBalance.currency);
    }

    const minor = netBalance.amountMinor;
    sumMinor += minor;

    if (minor < 0) {
      debtors.push({
        userId,
        inputIndex: i,
        remaining: Math.abs(minor),
      });
    } else if (minor > 0) {
      creditors.push({
        userId,
        inputIndex: i,
        remaining: minor,
      });
    }
  }

  // 3. Reconciled input verification: sum of net balances must be exactly 0
  if (sumMinor !== 0) {
    throw new UnreconciledBalancesError(sumMinor);
  }

  // If all balances are 0, return empty transfers immediately
  if (debtors.length === 0 || creditors.length === 0) {
    return Object.freeze({
      currency: activeCurrency,
      transferCount: 0,
      transfers: Object.freeze([]),
    });
  }

  // 4. Deterministic sorting:
  // Debtors: largest debt first; tie-breaker: original inputIndex
  debtors.sort((a, b) => {
    const diff = b.remaining - a.remaining;
    if (diff !== 0) return diff;
    return a.inputIndex - b.inputIndex;
  });

  // Creditors: largest credit first; tie-breaker: original inputIndex
  creditors.sort((a, b) => {
    const diff = b.remaining - a.remaining;
    if (diff !== 0) return diff;
    return a.inputIndex - b.inputIndex;
  });

  // 5. Greedy matching
  const transfers: SimplifiedTransfer[] = [];
  let dIdx = 0;
  let cIdx = 0;

  while (dIdx < debtors.length && cIdx < creditors.length) {
    const debtor = debtors[dIdx]!;
    const creditor = creditors[cIdx]!;

    const transferMinor = Math.min(debtor.remaining, creditor.remaining);

    if (transferMinor > 0) {
      transfers.push(
        Object.freeze({
          fromUserId: debtor.userId,
          toUserId: creditor.userId,
          debtorId: debtor.userId,
          creditorId: creditor.userId,
          amount: make(transferMinor, activeCurrency),
        })
      );

      debtor.remaining -= transferMinor;
      creditor.remaining -= transferMinor;
    }

    if (debtor.remaining === 0) {
      dIdx++;
    }
    if (creditor.remaining === 0) {
      cIdx++;
    }
  }

  return Object.freeze({
    currency: activeCurrency,
    transferCount: transfers.length,
    transfers: Object.freeze(transfers),
  });
}
