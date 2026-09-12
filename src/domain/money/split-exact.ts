/**
 * Exact Split domain operation.
 *
 * The caller explicitly provides a Money allocation for every participant.
 * The domain validates that:
 *   1. Every participant appears exactly once.
 *   2. All allocations use the same currency as the total.
 *   3. All allocations are non-negative.
 *   4. The sum of all allocations equals the total exactly.
 *
 * CONTRACT:
 *   splitExactly(total, allocations).allocations
 *     .map(a => a.amount.amountMinor)
 *     .reduce((s, v) => s + v, 0)
 *   === total.amountMinor
 *
 * PARTICIPANT ORDERING RULE:
 *   Output allocations are returned in the same order as the input
 *   allocation array. The caller controls ordering.
 *
 * NEGATIVE ALLOCATION POLICY (from Phase 2.1 / docs/FINANCIAL_INVARIANTS.md):
 *   For expense splitting, allocations represent what each participant
 *   owes toward a shared cost. A negative allocation (e.g. "participant B
 *   contributed -₹50") has no meaningful interpretation and is rejected.
 *   Phase 2.1 permits negative Money values only for balance representations.
 *
 * This module is framework-independent. Do not import React, Hono, or Expo here.
 */

import { type Money, type CurrencyCode, make, MoneyError } from "./money.js";
import {
  EmptyParticipantsError,
  DuplicateParticipantError,
  InvalidParticipantError,
  type SplitAllocation,
} from "./split-equal.js";

// ============================================================================
// DOMAIN ERRORS — EXACT SPLIT SPECIFIC
// ============================================================================

/**
 * Thrown when a participant's allocation amount is negative.
 *
 * Exact split allocations represent a participant's share of a shared cost.
 * A negative share has no valid interpretation in that context.
 */
export class NegativeAllocationError extends MoneyError {
  constructor(participantId: string, amountMinor: number) {
    super(
      "NEGATIVE_ALLOCATION",
      `Participant "${participantId}" has a negative allocation of ${amountMinor} minor units. Exact split allocations must be non-negative.`
    );
    this.name = "NegativeAllocationError";
  }
}

/**
 * Thrown when a participant's allocation uses a different currency than the total.
 */
export class AllocationCurrencyMismatchError extends MoneyError {
  constructor(
    participantId: string,
    expectedCurrency: CurrencyCode,
    actualCurrency: CurrencyCode
  ) {
    super(
      "ALLOCATION_CURRENCY_MISMATCH",
      `Participant "${participantId}" allocation uses currency ${actualCurrency}, but the total is in ${expectedCurrency}. All allocations must use the same currency as the total.`
    );
    this.name = "AllocationCurrencyMismatchError";
  }
}

/**
 * Thrown when the sum of all allocations is less than the total.
 */
export class UnderAllocationError extends MoneyError {
  constructor(totalMinor: number, sumMinor: number, currency: CurrencyCode) {
    const shortfallMinor = totalMinor - sumMinor;
    super(
      "UNDER_ALLOCATION",
      `Allocations sum to ${sumMinor} ${currency}, but the total is ${totalMinor} ${currency}. Shortfall: ${shortfallMinor} minor units.`
    );
    this.name = "UnderAllocationError";
  }
}

/**
 * Thrown when the sum of all allocations exceeds the total.
 */
export class OverAllocationError extends MoneyError {
  constructor(totalMinor: number, sumMinor: number, currency: CurrencyCode) {
    const excessMinor = sumMinor - totalMinor;
    super(
      "OVER_ALLOCATION",
      `Allocations sum to ${sumMinor} ${currency}, but the total is ${totalMinor} ${currency}. Excess: ${excessMinor} minor units.`
    );
    this.name = "OverAllocationError";
  }
}

// ============================================================================
// RE-EXPORT SHARED ERRORS FOR CALLER CONVENIENCE
// ============================================================================

export {
  EmptyParticipantsError,
  DuplicateParticipantError,
  InvalidParticipantError,
};

// ============================================================================
// INPUT TYPE
// ============================================================================

/**
 * A single participant's exact allocation as provided by the caller.
 */
export interface ExactAllocationInput {
  /** The participant identifier (user ID or opaque participant string). */
  readonly participantId: string;
  /** The exact Money amount this participant is allocated. Must be non-negative. */
  readonly amount: Money;
}

// ============================================================================
// RESULT TYPE
// ============================================================================

/**
 * The result of an exact split operation.
 *
 * Invariants:
 * - allocations.length === input allocations length
 * - sum of all amount.amountMinor === total.amountMinor
 * - every amount uses total.currency
 * - allocations are in the same order as the input array
 * - no allocation has a negative amountMinor
 */
export interface ExactSplitResult {
  /** The original total Money that was split. */
  readonly total: Money;
  /** The number of participants. */
  readonly participantCount: number;
  /** Ordered allocations, one per participant. Identical shape to EqualSplitResult. */
  readonly allocations: readonly SplitAllocation[];
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validates the exact allocation input list.
 *
 * Rules enforced (in order):
 * 1. List must not be empty.
 * 2. Each participant ID must be a non-empty, non-blank string.
 * 3. No duplicate participant IDs.
 * 4. Each allocation amount must use the same currency as the total.
 * 5. Each allocation amount must be non-negative.
 *
 * Throws domain errors on the first violation found.
 * Does NOT silently remove duplicates or adjust invalid values.
 */
function validateAllocations(
  totalCurrency: CurrencyCode,
  inputs: readonly ExactAllocationInput[]
): void {
  if (inputs.length === 0) {
    throw new EmptyParticipantsError();
  }

  const seen = new Set<string>();

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]!;
    const { participantId, amount } = input;

    // Reject blank participant IDs
    if (participantId.trim().length === 0) {
      throw new InvalidParticipantError(i);
    }

    // Reject duplicates
    if (seen.has(participantId)) {
      throw new DuplicateParticipantError(participantId);
    }
    seen.add(participantId);

    // Reject allocation in a different currency from the total
    if (amount.currency !== totalCurrency) {
      throw new AllocationCurrencyMismatchError(participantId, totalCurrency, amount.currency);
    }

    // Reject negative allocations
    if (amount.amountMinor < 0) {
      throw new NegativeAllocationError(participantId, amount.amountMinor);
    }
  }
}

// ============================================================================
// EXACT SPLIT OPERATION
// ============================================================================

/**
 * Validates and returns an exact split result from caller-provided allocations.
 *
 * Algorithm:
 * 1. Validate allocations (non-empty, no duplicates, valid IDs, currency match, non-negative).
 * 2. Sum all allocation amounts using exact integer arithmetic.
 * 3. Verify the sum equals the total exactly.
 *    - sum < total → UnderAllocationError
 *    - sum > total → OverAllocationError
 * 4. Return the validated allocation set unchanged.
 *
 * The total must be non-negative (consistent with Phase 2.2 policy).
 * All allocation amounts must be non-negative.
 *
 * @param total   - The Money total the allocations must sum to (must be ≥ 0).
 * @param inputs  - Ordered participant allocations, each with participantId + amount.
 *
 * @throws EmptyParticipantsError          if inputs is empty
 * @throws InvalidParticipantError         if any participant ID is blank
 * @throws DuplicateParticipantError       if any participant ID appears more than once
 * @throws AllocationCurrencyMismatchError if any allocation uses a different currency
 * @throws NegativeAllocationError         if any allocation amount is negative
 * @throws UnderAllocationError            if sum(allocations) < total
 * @throws OverAllocationError             if sum(allocations) > total
 */
export function splitExactly(
  total: Money,
  inputs: readonly ExactAllocationInput[]
): ExactSplitResult {
  // Validate total currency consistency + all individual allocations
  validateAllocations(total.currency, inputs);

  // Sum allocations using exact integer arithmetic — no floating-point
  let sumMinor = 0;
  for (const input of inputs) {
    sumMinor += input.amount.amountMinor;
  }

  const totalMinor = total.amountMinor;

  // Reconciliation check
  if (sumMinor < totalMinor) {
    throw new UnderAllocationError(totalMinor, sumMinor, total.currency);
  }
  if (sumMinor > totalMinor) {
    throw new OverAllocationError(totalMinor, sumMinor, total.currency);
  }

  // Build result — re-create allocation objects to avoid mutating input
  const allocations: SplitAllocation[] = inputs.map((input) => ({
    participantId: input.participantId,
    amount: make(input.amount.amountMinor, input.amount.currency),
  }));

  return Object.freeze({
    total,
    participantCount: inputs.length,
    allocations: Object.freeze(allocations),
  }) as ExactSplitResult;
}
