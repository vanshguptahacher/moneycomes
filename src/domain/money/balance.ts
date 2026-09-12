/**
 * Balance Engine domain operation (Phase 2.6).
 *
 * Calculates per-user net financial positions from payer contributions
 * and participant split obligations.
 *
 * ============================================================
 * BALANCE CONVENTION
 * ============================================================
 *
 * For an expense:
 *
 *   net balance = amount paid - amount owed
 *
 *   Positive balance (+): user paid more than they owe -> user is OWED money (should receive).
 *   Negative balance (-): user paid less than they owe -> user OWES money (should pay).
 *   Zero balance (0):     user is settled for this expense.
 *
 * ============================================================
 * FINANCIAL INVARIANT
 * ============================================================
 *
 * For every valid expense:
 *
 *   sum(all user net balances) === 0
 *
 * Money is neither created nor destroyed.
 *
 * ============================================================
 * PAYER NOT PARTICIPANT SUPPORT
 * ============================================================
 *
 * If the payer is not among the split participants (e.g. Alice pays 100
 * for Bob and Charlie's lunch), Alice's obligation is 0, and her net balance
 * is +100. The participants owe their full allocated obligations.
 * Total net balance reconciles exactly to 0.
 *
 * This module is framework-independent. Do not import React, Hono, or Expo here.
 */

import {
  type Money,
  zero,
  subtract,
  MoneyError,
} from "./money.js";
import {
  EmptyParticipantsError,
  DuplicateParticipantError,
  InvalidParticipantError,
  NegativeSplitTotalError,
  type SplitAllocation,
} from "./split-equal.js";
import {
  AllocationCurrencyMismatchError,
  NegativeAllocationError,
  UnderAllocationError,
  OverAllocationError,
} from "./split-exact.js";

// ============================================================================
// DOMAIN ERRORS
// ============================================================================

/** Thrown when the payer ID is invalid (empty or whitespace-only). */
export class InvalidPayerError extends MoneyError {
  constructor() {
    super(
      "INVALID_PAYER",
      "Payer identifier must be a non-empty, non-whitespace string."
    );
    this.name = "InvalidPayerError";
  }
}

/** Internal safety guard thrown if net balances do not sum to exactly zero. */
export class BalanceReconciliationError extends MoneyError {
  constructor(sumMinor: number) {
    super(
      "BALANCE_RECONCILIATION_ERROR",
      `Sum of all user net balances must equal 0, got: ${sumMinor} minor units.`
    );
    this.name = "BalanceReconciliationError";
  }
}

// Re-export shared errors for caller convenience
export {
  EmptyParticipantsError,
  DuplicateParticipantError,
  InvalidParticipantError,
  NegativeSplitTotalError,
  AllocationCurrencyMismatchError,
  NegativeAllocationError,
  UnderAllocationError,
  OverAllocationError,
};

// ============================================================================
// TYPES
// ============================================================================

/**
 * Input for expense balance calculation.
 *
 * @field total       - The total Money amount of the expense. Must be non-negative.
 * @field payerId     - Identifier of the user who paid the total amount.
 * @field allocations - Validated monetary obligations for each participant.
 */
export interface ExpenseBalanceInput {
  readonly total: Money;
  readonly payerId: string;
  readonly allocations: readonly SplitAllocation[];
}

/**
 * Net balance breakdown for an individual user in an expense.
 *
 * @field userId     - User identifier.
 * @field paid       - Amount contributed by this user as payer (0 if not payer).
 * @field owed       - Amount this user owes for their share of the expense.
 * @field netBalance - Net financial position (paid - owed).
 *                     Positive = owed money (to receive).
 *                     Negative = owes money (to pay).
 *                     Zero = fully settled.
 */
export interface UserBalance {
  readonly userId: string;
  readonly paid: Money;
  readonly owed: Money;
  readonly netBalance: Money;
}

/**
 * Output of the expense balance calculation.
 *
 * Invariants:
 * - balances is frozen.
 * - sum of all netBalance.amountMinor === 0.
 * - every balance uses total.currency.
 */
export interface ExpenseBalanceResult {
  readonly total: Money;
  readonly payerId: string;
  readonly balances: readonly UserBalance[];
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validates the inputs to the balance engine.
 *
 * Rules:
 * 1. Total must be non-negative.
 * 2. Payer ID must be non-empty and non-whitespace.
 * 3. Allocations list must not be empty.
 * 4. Each participant ID must be non-empty and non-whitespace.
 * 5. No duplicate participant IDs in allocations.
 * 6. Every allocation must use the same currency as the total.
 * 7. Every allocation amount must be non-negative.
 * 8. Sum of allocation amounts must equal total amount exactly.
 */
function validateBalanceInputs(
  total: Money,
  payerId: string,
  allocations: readonly SplitAllocation[]
): void {
  // 1. Validate total
  if (total.amountMinor < 0) {
    throw new NegativeSplitTotalError();
  }

  // 2. Validate payer
  if (typeof payerId !== "string" || payerId.trim().length === 0) {
    throw new InvalidPayerError();
  }

  // 3. Validate non-empty allocations
  if (allocations.length === 0) {
    throw new EmptyParticipantsError();
  }

  const seen = new Set<string>();
  let sumMinor = 0;
  const currency = total.currency;

  for (let i = 0; i < allocations.length; i++) {
    const alloc = allocations[i]!;
    const { participantId, amount } = alloc;

    // 4. Validate participant ID
    if (typeof participantId !== "string" || participantId.trim().length === 0) {
      throw new InvalidParticipantError(i);
    }

    // 5. Reject duplicates
    if (seen.has(participantId)) {
      throw new DuplicateParticipantError(participantId);
    }
    seen.add(participantId);

    // 6. Reject currency mismatch
    if (amount.currency !== currency) {
      throw new AllocationCurrencyMismatchError(participantId, currency, amount.currency);
    }

    // 7. Reject negative allocation
    if (amount.amountMinor < 0) {
      throw new NegativeAllocationError(participantId, amount.amountMinor);
    }

    sumMinor += amount.amountMinor;
  }

  // 8. Validate sum of allocations equals total
  const totalMinor = total.amountMinor;
  if (sumMinor < totalMinor) {
    throw new UnderAllocationError(totalMinor, sumMinor, currency);
  }
  if (sumMinor > totalMinor) {
    throw new OverAllocationError(totalMinor, sumMinor, currency);
  }
}

// ============================================================================
// BALANCE CALCULATION OPERATION
// ============================================================================

/**
 * Overload 1: Accepts an `ExpenseBalanceInput` object.
 */
export function calculateExpenseBalances(
  input: ExpenseBalanceInput
): ExpenseBalanceResult;

/**
 * Overload 2: Accepts separate `total`, `payerId`, and `allocations` arguments.
 */
export function calculateExpenseBalances(
  total: Money,
  payerId: string,
  allocations: readonly SplitAllocation[]
): ExpenseBalanceResult;

/**
 * Implementation of calculateExpenseBalances.
 *
 * Calculates per-user net balances for an expense.
 *
 * Algorithm:
 * 1. Validate total, payer, allocations, currencies, and sum equality.
 * 2. Map participant obligations from allocations.
 * 3. Credit the payer with the full total contribution.
 * 4. For each user (all participants + payer if not in participants):
 *      paid = (user === payer) ? total : zero
 *      owed = user's allocated obligation (or zero if payer not participant)
 *      netBalance = paid - owed
 * 5. Verify financial invariant: sum(netBalances) === 0.
 * 6. Return frozen result.
 */
export function calculateExpenseBalances(
  totalOrInput: Money | ExpenseBalanceInput,
  maybePayerId?: string,
  maybeAllocations?: readonly SplitAllocation[]
): ExpenseBalanceResult {
  let total: Money;
  let payerId: string;
  let allocations: readonly SplitAllocation[];

  if (maybePayerId !== undefined && maybeAllocations !== undefined) {
    total = totalOrInput as Money;
    payerId = maybePayerId;
    allocations = maybeAllocations;
  } else {
    const input = totalOrInput as ExpenseBalanceInput;
    total = input.total;
    payerId = input.payerId;
    allocations = input.allocations;
  }

  validateBalanceInputs(total, payerId, allocations);

  const currency = total.currency;
  const zeroMoney = zero(currency);

  // Map participant obligations
  const obligationMap = new Map<string, Money>();
  for (const alloc of allocations) {
    obligationMap.set(alloc.participantId, alloc.amount);
  }

  const payerIsParticipant = obligationMap.has(payerId);

  // Determine all users involved in deterministic order:
  // If payer is not a participant, payer is prepended first, followed by all participants in input order.
  // If payer is a participant, participants maintain original input order.
  const userIds: string[] = payerIsParticipant
    ? allocations.map((a) => a.participantId)
    : [payerId, ...allocations.map((a) => a.participantId)];

  const balances: UserBalance[] = userIds.map((userId) => {
    const paid = userId === payerId ? total : zeroMoney;
    const owed = obligationMap.get(userId) ?? zeroMoney;
    const netBalance = subtract(paid, owed);

    return Object.freeze({
      userId,
      paid,
      owed,
      netBalance,
    });
  });

  // Safety invariant check: sum of all net balances must be exactly 0
  let netSumMinor = 0;
  for (const b of balances) {
    netSumMinor += b.netBalance.amountMinor;
  }

  if (netSumMinor !== 0) {
    throw new BalanceReconciliationError(netSumMinor);
  }

  return Object.freeze({
    total,
    payerId,
    balances: Object.freeze(balances),
  }) as ExpenseBalanceResult;
}

// ============================================================================
// CONVENIENCE HELPERS
// ============================================================================

/**
 * Finds the balance record for a specific user in an ExpenseBalanceResult.
 */
export function getUserBalance(
  result: ExpenseBalanceResult,
  userId: string
): UserBalance | undefined {
  return result.balances.find((b) => b.userId === userId);
}
