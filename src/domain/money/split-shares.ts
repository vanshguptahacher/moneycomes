/**
 * Shares Split domain operation.
 *
 * A total Money amount is divided proportionally according to participant share counts.
 *
 * ============================================================
 * PROPORTIONAL MODEL
 * ============================================================
 *
 * The caller provides an integer share count for each participant.
 *
 *   totalShares = sum(shares_i)
 *   allocation_i = (totalMoney * shares_i) / totalShares
 *
 * Example:
 *   Total = INR 600
 *   A = 1 share, B = 2 shares, C = 3 shares  -> totalShares = 6
 *   A = INR 100, B = INR 200, C = INR 300
 *
 * ============================================================
 * ZERO-SHARE POLICY
 * ============================================================
 *
 * Individual participants may have 0 shares (e.g. a group member who
 * opted out of a specific shared expense).
 *
 * Invariant:
 *   A participant with 0 shares ALWAYS receives an allocation of exactly 0 minor units.
 *   They NEVER receive remainder units.
 *
 * However, totalShares across all participants MUST be strictly positive (> 0).
 * If all participants have 0 shares, the split is undefined and throws ZeroTotalSharesError.
 *
 * ============================================================
 * DETERMINISTIC ROUNDING (Largest Remainder Method)
 * ============================================================
 *
 * For total T (minor units), participant i with shares S_i, and totalShares S_total:
 *
 *   raw_i   = BigInt(T) * BigInt(S_i)
 *   floor_i = Number(raw_i / BigInt(S_total))
 *   frac_i  = Number(raw_i % BigInt(S_total))
 *
 * Deficit:
 *   shortfall = T - sum(floor_i)   (always 0 <= shortfall < n)
 *
 * Remainder distribution:
 *   The shortfall is distributed one minor unit (+1) at a time to participants
 *   in descending order of their remainder frac_i.
 *   Ties are broken stably by original input array order (earlier participant wins).
 *
 * CONTRACT:
 *   sum(allocations[i].amount.amountMinor) === total.amountMinor   (exact integer equality)
 *
 * This module is framework-independent. Do not import React, Hono, or Expo here.
 */

import { type Money, make, MoneyError } from "./money.js";
import {
  EmptyParticipantsError,
  DuplicateParticipantError,
  InvalidParticipantError,
  NegativeSplitTotalError,
  type SplitAllocation,
} from "./split-equal.js";

// ============================================================================
// DOMAIN ERRORS
// ============================================================================

/** Thrown when a participant has a negative share count. */
export class NegativeShareError extends MoneyError {
  constructor(participantId: string, shares: number) {
    super(
      "NEGATIVE_SHARE",
      `Participant "${participantId}" has a negative share count: ${shares}. Shares must be ≥ 0.`
    );
    this.name = "NegativeShareError";
  }
}

/** Thrown when a share count is not a valid safe integer. */
export class InvalidShareError extends MoneyError {
  constructor(participantId: string, shares: number) {
    super(
      "INVALID_SHARE",
      `Participant "${participantId}" has an invalid share count: ${shares}. Shares must be a non-negative integer.`
    );
    this.name = "InvalidShareError";
  }
}

/** Thrown when the sum of all shares is zero or invalid. */
export class ZeroTotalSharesError extends MoneyError {
  constructor() {
    super(
      "ZERO_TOTAL_SHARES",
      "Total shares must be greater than zero. At least one participant must have a positive share count."
    );
    this.name = "ZeroTotalSharesError";
  }
}

// Re-export shared errors for convenience
export {
  EmptyParticipantsError,
  DuplicateParticipantError,
  InvalidParticipantError,
  NegativeSplitTotalError,
};

// ============================================================================
// INPUT TYPE
// ============================================================================

/**
 * A single participant's share allocation input.
 *
 * @field participantId - Non-empty, unique participant identifier.
 * @field shares        - Non-negative safe integer share count (e.g. 1, 2, 3).
 */
export interface ShareAllocationInput {
  readonly participantId: string;
  readonly shares: number;
}

// ============================================================================
// RESULT TYPE
// ============================================================================

/**
 * The result of a shares split operation.
 *
 * Invariants:
 * - allocations.length === inputs.length
 * - sum of all amount.amountMinor === total.amountMinor
 * - every amount uses total.currency
 * - allocations are in the same order as the input array
 * - no allocation is negative
 * - totalShares === sum(inputs.shares)
 */
export interface SharesSplitResult {
  /** The original total Money that was split. */
  readonly total: Money;
  /** The sum of all participant shares. */
  readonly totalShares: number;
  /** The number of participants. */
  readonly participantCount: number;
  /** Ordered allocations, one per participant. */
  readonly allocations: readonly SplitAllocation[];
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validates the shares allocation input list.
 *
 * Rules:
 * 1. Participant list must not be empty.
 * 2. Each participant ID must be non-empty and non-whitespace.
 * 3. No duplicate participant IDs.
 * 4. Each share value must be a non-negative safe integer.
 * 5. Total shares sum must be > 0 and within safe integer limits.
 *
 * Returns the computed totalShares.
 */
function validateInputs(inputs: readonly ShareAllocationInput[]): number {
  if (inputs.length === 0) {
    throw new EmptyParticipantsError();
  }

  const seen = new Set<string>();
  let totalShares = 0;

  for (let i = 0; i < inputs.length; i++) {
    const { participantId, shares } = inputs[i]!;

    // Blank or whitespace-only participant ID
    if (participantId.trim().length === 0) {
      throw new InvalidParticipantError(i);
    }

    // Duplicate ID
    if (seen.has(participantId)) {
      throw new DuplicateParticipantError(participantId);
    }
    seen.add(participantId);

    // Non-integer, NaN, or non-finite share count
    if (!Number.isInteger(shares) || !Number.isFinite(shares) || !Number.isSafeInteger(shares)) {
      throw new InvalidShareError(participantId, shares);
    }

    // Negative share count
    if (shares < 0) {
      throw new NegativeShareError(participantId, shares);
    }

    totalShares += shares;

    if (!Number.isSafeInteger(totalShares)) {
      throw new InvalidShareError(participantId, shares);
    }
  }

  // Total shares must be > 0
  if (totalShares <= 0) {
    throw new ZeroTotalSharesError();
  }

  return totalShares;
}

// ============================================================================
// SHARES SPLIT OPERATION
// ============================================================================

/**
 * Splits a total Money amount proportionally among participants according to their shares.
 *
 * Algorithm:
 * 1. Validate inputs (participants, shares, total >= 0).
 * 2. Calculate totalShares = sum(shares). Must be > 0.
 * 3. For each participant compute:
 *      raw   = BigInt(total.amountMinor) * BigInt(shares)   (exact BigInt arithmetic)
 *      floor = Number(raw / BigInt(totalShares))
 *      frac  = Number(raw % BigInt(totalShares))
 * 4. Sum floor allocations and calculate shortfall = total.amountMinor - sum(floors).
 * 5. Distribute shortfall (+1 minor unit each) to participants in descending order of frac,
 *    breaking ties by original input array order (Largest Remainder Method).
 * 6. Return frozen result with allocations in original input order.
 *
 * @throws NegativeSplitTotalError  if total.amountMinor < 0
 * @throws EmptyParticipantsError    if inputs is empty
 * @throws InvalidParticipantError   if any participant ID is blank
 * @throws DuplicateParticipantError if any participant ID is duplicated
 * @throws InvalidShareError         if any share is not a non-negative safe integer
 * @throws NegativeShareError        if any share is negative
 * @throws ZeroTotalSharesError      if sum(shares) is 0
 */
export function splitByShares(
  total: Money,
  inputs: readonly ShareAllocationInput[]
): SharesSplitResult {
  if (total.amountMinor < 0) {
    throw new NegativeSplitTotalError();
  }

  const totalShares = validateInputs(inputs);

  const totalMinor = total.amountMinor;
  const currency = total.currency;
  const n = inputs.length;

  type WorkItem = {
    inputIndex: number;
    participantId: string;
    floor: number;
    frac: number;
  };

  const totalSharesBig = BigInt(totalShares);

  // Step 3: compute floor allocation and remainder using BigInt arithmetic
  const work: WorkItem[] = inputs.map((input, idx) => {
    const raw = BigInt(totalMinor) * BigInt(input.shares);
    const floor = Number(raw / totalSharesBig);
    const frac = Number(raw % totalSharesBig);
    return {
      inputIndex: idx,
      participantId: input.participantId,
      floor,
      frac,
    };
  });

  // Step 4: calculate shortfall
  let floorSum = 0;
  for (const w of work) {
    floorSum += w.floor;
  }
  const shortfall = totalMinor - floorSum; // always 0 <= shortfall < n

  // Step 5: Largest Remainder Method — sort indices by descending frac, ties by inputIndex
  const sortedIndices = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
    const fracDiff = work[b]!.frac - work[a]!.frac;
    if (fracDiff !== 0) return fracDiff;
    return work[a]!.inputIndex - work[b]!.inputIndex;
  });

  const extra = new Array<number>(n).fill(0);
  for (let i = 0; i < shortfall; i++) {
    extra[sortedIndices[i]!]! = 1;
  }

  // Step 6: build result in original input order
  const allocations: SplitAllocation[] = work.map((w, i) => ({
    participantId: w.participantId,
    amount: make(w.floor + extra[i]!, currency),
  }));

  return Object.freeze({
    total,
    totalShares,
    participantCount: n,
    allocations: Object.freeze(allocations),
  }) as SharesSplitResult;
}
