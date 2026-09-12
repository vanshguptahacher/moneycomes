/**
 * Equal Split domain operation.
 *
 * Divides a total Money amount exactly among a list of participants
 * using integer minor-unit arithmetic only.
 *
 * CONTRACT:
 *   splitEqually(total, participants).allocations
 *     .map(a => a.amount.amountMinor)
 *     .reduce((s, v) => s + v, 0)
 *   === total.amountMinor
 *
 * REMAINDER RULE:
 *   When the total does not divide evenly, the remainder (in minor units)
 *   is distributed one extra unit at a time to the FIRST `remainder` participants
 *   in the order they were supplied.
 *
 *   This is deterministic: the same ordered participant list always
 *   produces the same allocation.
 *
 * PARTICIPANT ORDERING RULE:
 *   Output allocations are returned in the same order as the input
 *   participant array. The caller is responsible for supplying a stable,
 *   meaningful order (e.g. sorted by user ID or display name) when
 *   determinism across different callers is required.
 *
 * This module is framework-independent. Do not import React, Hono, or Expo here.
 */

import { type Money, make, MoneyError } from "./money.js";

// ============================================================================
// DOMAIN ERRORS
// ============================================================================

/** Thrown when the participant list is empty. */
export class EmptyParticipantsError extends MoneyError {
  constructor() {
    super("EMPTY_PARTICIPANTS", "Participant list must not be empty.");
    this.name = "EmptyParticipantsError";
  }
}

/** Thrown when the participant list contains duplicate identifiers. */
export class DuplicateParticipantError extends MoneyError {
  constructor(duplicateId: string) {
    super(
      "DUPLICATE_PARTICIPANT",
      `Duplicate participant detected: "${duplicateId}". Each participant must appear exactly once.`
    );
    this.name = "DuplicateParticipantError";
  }
}

/** Thrown when a participant identifier is invalid (empty string). */
export class InvalidParticipantError extends MoneyError {
  constructor(index: number) {
    super(
      "INVALID_PARTICIPANT",
      `Participant at index ${index} has an invalid identifier (empty string).`
    );
    this.name = "InvalidParticipantError";
  }
}

/**
 * Thrown when the total is negative and the domain does not support
 * negative-total equal splits.
 */
export class NegativeSplitTotalError extends MoneyError {
  constructor() {
    super(
      "NEGATIVE_SPLIT_TOTAL",
      "Equal split requires a non-negative total. Negative balances should be expressed as a settlement, not an equal split."
    );
    this.name = "NegativeSplitTotalError";
  }
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * A single participant's allocation from an equal split.
 */
export interface SplitAllocation {
  /** The participant identifier (user ID or opaque participant string). */
  readonly participantId: string;
  /** The exact integer Money amount allocated to this participant. */
  readonly amount: Money;
}

/**
 * The result of an equal split operation.
 *
 * Invariants:
 * - allocations.length === participants.length
 * - sum of all amount.amountMinor === total.amountMinor
 * - every amount uses total.currency
 * - allocations are in the same order as the input participant array
 */
export interface EqualSplitResult {
  /** The original total Money that was split. */
  readonly total: Money;
  /** The number of participants. */
  readonly participantCount: number;
  /** Ordered allocations, one per participant. */
  readonly allocations: readonly SplitAllocation[];
}

// ============================================================================
// PARTICIPANT VALIDATION
// ============================================================================

/**
 * Validates the participant list.
 *
 * Rules enforced:
 * 1. List must not be empty.
 * 2. Each participant ID must be a non-empty string.
 * 3. No duplicate participant IDs.
 *
 * Throws domain-specific errors on violation.
 * Does NOT silently remove duplicates or strip invalid entries.
 */
function validateParticipants(participants: readonly string[]): void {
  if (participants.length === 0) {
    throw new EmptyParticipantsError();
  }

  const seen = new Set<string>();

  for (let i = 0; i < participants.length; i++) {
    const id = participants[i]!;

    // Reject empty-string identifiers
    if (id.trim().length === 0) {
      throw new InvalidParticipantError(i);
    }

    // Reject duplicates
    if (seen.has(id)) {
      throw new DuplicateParticipantError(id);
    }

    seen.add(id);
  }
}

// ============================================================================
// EQUAL SPLIT OPERATION
// ============================================================================

/**
 * Splits a total Money amount equally among all participants.
 *
 * Algorithm:
 * 1. Validate participants (non-empty, no duplicates, valid IDs).
 * 2. Compute base allocation: Math.floor(totalMinor / n)
 * 3. Compute remainder: totalMinor % n  (always 0 ≤ remainder < n)
 * 4. Assign base to every participant.
 * 5. Add 1 minor unit to the first `remainder` participants.
 *
 * The resulting allocations sum to exactly `total.amountMinor`.
 *
 * @param total        - The Money amount to split (must be ≥ 0).
 * @param participants - Ordered, de-duplicated participant ID list.
 *
 * @throws NegativeSplitTotalError   if total.amountMinor < 0
 * @throws EmptyParticipantsError    if participants is empty
 * @throws InvalidParticipantError   if any participant ID is empty/blank
 * @throws DuplicateParticipantError if any participant ID appears more than once
 */
export function splitEqually(
  total: Money,
  participants: readonly string[]
): EqualSplitResult {
  // Validate total: must be non-negative
  if (total.amountMinor < 0) {
    throw new NegativeSplitTotalError();
  }

  // Validate participants
  validateParticipants(participants);

  const n = participants.length;
  const totalMinor = total.amountMinor;
  const currency = total.currency;

  // Integer division — no floating-point
  const base = Math.floor(totalMinor / n);  // base allocation per participant
  const remainder = totalMinor % n;          // number of participants who get +1

  // Build allocations
  // Participants at indices 0..(remainder-1) receive (base + 1),
  // all others receive base.
  const allocations: SplitAllocation[] = participants.map((participantId, index) => {
    const extraUnit = index < remainder ? 1 : 0;
    return {
      participantId,
      amount: make(base + extraUnit, currency),
    };
  });

  return Object.freeze({
    total,
    participantCount: n,
    allocations: Object.freeze(allocations),
  }) as EqualSplitResult;
}
