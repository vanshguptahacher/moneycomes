/**
 * Percentage Split domain operation.
 *
 * The caller provides a percentage allocation (in basis points) for every participant.
 * The domain calculates exact Money allocations and reconciles the total exactly.
 *
 * ============================================================
 * PRECISION MODEL — BASIS POINTS
 * ============================================================
 *
 * Percentages are represented as integer BASIS POINTS (bps):
 *
 *   1 bps  = 0.01%
 *   100 bps = 1%
 *   5000 bps = 50%
 *   10000 bps = 100%
 *
 * This matches the `expense_splits.percentage_basis_points` database column (integer).
 * It enables two decimal places of percentage precision without floating-point.
 *
 *   50%    → 5000 bps
 *   33.33% → 3333 bps
 *   33.34% → 3334 bps
 *   0.01%  → 1 bps
 *
 * Maximum precision: 0.01% per participant.
 * All percentages must sum to exactly 10000 bps (= 100%).
 *
 * ============================================================
 * ALLOCATION CALCULATION — EXACT INTEGER ARITHMETIC
 * ============================================================
 *
 * For each participant i with basis points bps_i and total T (minor units):
 *
 *   raw_i   = T * bps_i         (exact integer multiplication)
 *   alloc_i = Math.floor(raw_i / 10000)
 *   frac_i  = raw_i % 10000     (fractional remainder, 0 ≤ frac_i < 10000)
 *
 * This avoids floating-point division. Only integer `*` and `%` are used.
 *
 * ============================================================
 * REMAINDER RECONCILIATION
 * ============================================================
 *
 * After floor allocation, the sum may be short of the total by at most
 * (participantCount - 1) minor units. The shortfall is distributed
 * one extra minor unit at a time to participants in descending order of
 * their fractional remainder (frac_i), with ties broken by input order
 * (earlier participant wins the extra unit first).
 *
 * This is the "Largest Remainder Method" — standard for proportional rounding.
 *
 * CONTRACT:
 *   sum(allocations[i].amount.amountMinor) === total.amountMinor
 *
 * PARTICIPANT ORDERING RULE:
 *   Output allocations are in the same order as the input array.
 *   Remainder assignment uses a stable sort by descending fractional part.
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
// CONSTANTS
// ============================================================================

/** Total basis points representing exactly 100%. */
export const TOTAL_BASIS_POINTS = 10_000;

/** Minimum valid basis points per participant (0.01%). */
export const MIN_BASIS_POINTS = 0;

/** Maximum valid basis points per participant (100%). */
export const MAX_BASIS_POINTS = TOTAL_BASIS_POINTS;

// ============================================================================
// DOMAIN ERRORS
// ============================================================================

/** Thrown when a percentage (in basis points) is negative. */
export class NegativePercentageError extends MoneyError {
  constructor(participantId: string, basisPoints: number) {
    super(
      "NEGATIVE_PERCENTAGE",
      `Participant "${participantId}" has a negative percentage: ${basisPoints} bps. Percentages must be ≥ 0.`
    );
    this.name = "NegativePercentageError";
  }
}

/** Thrown when a basis-point value is not an integer. */
export class InvalidPercentageError extends MoneyError {
  constructor(participantId: string, basisPoints: number) {
    super(
      "INVALID_PERCENTAGE",
      `Participant "${participantId}" has an invalid percentage: ${basisPoints} bps. Basis points must be a non-negative integer.`
    );
    this.name = "InvalidPercentageError";
  }
}

/**
 * Thrown when the sum of all basis points does not equal exactly 10000
 * (i.e. percentages do not add up to exactly 100%).
 */
export class PercentageTotalError extends MoneyError {
  constructor(totalBps: number) {
    const diff = totalBps - TOTAL_BASIS_POINTS;
    const direction = diff > 0 ? "over" : "under";
    super(
      "PERCENTAGE_TOTAL_ERROR",
      `Percentages must total exactly ${TOTAL_BASIS_POINTS} bps (100%). Got ${totalBps} bps — ${Math.abs(diff)} bps ${direction}.`
    );
    this.name = "PercentageTotalError";
  }
}

// Re-export shared participant & total errors for convenience
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
 * A single participant's percentage allocation.
 *
 * @field participantId  - Non-empty, unique participant identifier.
 * @field basisPoints    - Integer percentage in basis points (1 bps = 0.01%).
 *                         Must be ≥ 0. All participants' basisPoints must sum to 10000.
 *
 * Examples:
 *   50%    → basisPoints: 5000
 *   33.33% → basisPoints: 3333
 *   0.01%  → basisPoints: 1
 */
export interface PercentageAllocationInput {
  readonly participantId: string;
  readonly basisPoints: number;
}

// ============================================================================
// RESULT TYPE
// ============================================================================

/**
 * The result of a percentage split operation.
 *
 * Invariants:
 * - allocations.length === inputs.length
 * - sum of all amount.amountMinor === total.amountMinor
 * - every amount uses total.currency
 * - allocations are in the same order as the input array
 * - no allocation is negative
 */
export interface PercentageSplitResult {
  /** The original total Money that was split. */
  readonly total: Money;
  /** The number of participants. */
  readonly participantCount: number;
  /** Ordered allocations, one per participant. */
  readonly allocations: readonly SplitAllocation[];
}

// ============================================================================
// VALIDATION
// ============================================================================

/**
 * Validates the percentage allocation input list.
 *
 * Rules (in order):
 * 1. List must not be empty.
 * 2. Each participant ID must be non-empty and non-blank.
 * 3. No duplicate participant IDs.
 * 4. Each basisPoints value must be a non-negative integer.
 * 5. Sum of all basisPoints must equal exactly TOTAL_BASIS_POINTS (10000).
 *
 * Does NOT silently normalize, round, or remove participants.
 */
function validateInputs(inputs: readonly PercentageAllocationInput[]): void {
  if (inputs.length === 0) {
    throw new EmptyParticipantsError();
  }

  const seen = new Set<string>();
  let bpsSum = 0;

  for (let i = 0; i < inputs.length; i++) {
    const { participantId, basisPoints } = inputs[i]!;

    // Blank participant ID
    if (participantId.trim().length === 0) {
      throw new InvalidParticipantError(i);
    }

    // Duplicate
    if (seen.has(participantId)) {
      throw new DuplicateParticipantError(participantId);
    }
    seen.add(participantId);

    // Non-integer or NaN/Infinity
    if (!Number.isInteger(basisPoints) || !Number.isFinite(basisPoints)) {
      throw new InvalidPercentageError(participantId, basisPoints);
    }

    // Negative basisPoints
    if (basisPoints < 0) {
      throw new NegativePercentageError(participantId, basisPoints);
    }

    bpsSum += basisPoints;
  }

  // Total must be exactly 10000
  if (bpsSum !== TOTAL_BASIS_POINTS) {
    throw new PercentageTotalError(bpsSum);
  }
}

// ============================================================================
// PERCENTAGE SPLIT OPERATION
// ============================================================================

/**
 * Splits a total Money amount among participants using basis-point percentages.
 *
 * Algorithm:
 * 1. Validate inputs (participant IDs, basis-point values, 100% total).
 * 2. For each participant compute:
 *      raw   = total.amountMinor * basisPoints   (exact integer multiplication)
 *      floor = Math.floor(raw / TOTAL_BASIS_POINTS)
 *      frac  = raw % TOTAL_BASIS_POINTS
 * 3. Sum the floor allocations; compute shortfall = total - sum(floors).
 * 4. Distribute the shortfall (one extra minor unit per deficit) to participants
 *    sorted by descending frac, ties broken by input order (stable).
 *    This is the Largest Remainder Method.
 * 5. Return allocations in the original input order.
 *
 * Correctness guarantee:
 *   sum(alloc.amount.amountMinor) === total.amountMinor   (always)
 *
 * @throws NegativeSplitTotalError   if total.amountMinor < 0
 * @throws EmptyParticipantsError     if inputs is empty
 * @throws InvalidParticipantError    if any participant ID is blank
 * @throws DuplicateParticipantError  if any participant ID appears more than once
 * @throws InvalidPercentageError     if any basisPoints is non-integer or non-finite
 * @throws NegativePercentageError    if any basisPoints is negative
 * @throws PercentageTotalError       if sum(basisPoints) ≠ 10000
 */
export function splitByPercentage(
  total: Money,
  inputs: readonly PercentageAllocationInput[]
): PercentageSplitResult {
  if (total.amountMinor < 0) {
    throw new NegativeSplitTotalError();
  }

  validateInputs(inputs);

  const totalMinor = total.amountMinor;
  const currency = total.currency;
  const n = inputs.length;

  // Step 2: compute floor allocation and fractional remainder for each participant
  type WorkItem = {
    inputIndex: number;
    participantId: string;
    floor: number;
    frac: number;
  };

  const work: WorkItem[] = inputs.map((input, idx) => {
    // Exact BigInt arithmetic avoids 53-bit overflow when multiplying
    // large safe integers (up to Number.MAX_SAFE_INTEGER) by basis points.
    const raw = BigInt(totalMinor) * BigInt(input.basisPoints);
    const floor = Number(raw / 10000n);
    const frac = Number(raw % 10000n);
    return { inputIndex: idx, participantId: input.participantId, floor, frac };
  });

  // Step 3: compute shortfall
  let floorSum = 0;
  for (const w of work) {
    floorSum += w.floor;
  }
  const shortfall = totalMinor - floorSum; // always 0 ≤ shortfall < n

  // Step 4: Largest Remainder Method — sort by descending frac, ties by inputIndex
  // We need a stable sort: sort indices, not the work array, to preserve original order
  const sortedIndices = Array.from({ length: n }, (_, i) => i).sort((a, b) => {
    const fracDiff = work[b]!.frac - work[a]!.frac;
    if (fracDiff !== 0) return fracDiff;           // descending frac
    return work[a]!.inputIndex - work[b]!.inputIndex; // ascending inputIndex (earlier wins)
  });

  // Assign extra units
  const extra = new Array<number>(n).fill(0);
  for (let i = 0; i < shortfall; i++) {
    extra[sortedIndices[i]!]! = 1;
  }

  // Step 5: build result in original input order
  const allocations: SplitAllocation[] = work.map((w, i) => ({
    participantId: w.participantId,
    amount: make(w.floor + extra[i]!, currency),
  }));

  return Object.freeze({
    total,
    participantCount: n,
    allocations: Object.freeze(allocations),
  }) as PercentageSplitResult;
}

// ============================================================================
// UTILITY — Parse a decimal percentage string to basis points
// ============================================================================

/**
 * Converts a human-readable percentage string to integer basis points.
 *
 * Accepted formats:
 *   "50"      → 5000
 *   "50.00"   → 5000
 *   "33.33"   → 3333
 *   "0.01"    → 1
 *   "100"     → 10000
 *
 * Rejects:
 *   - more than 2 decimal places ("33.333" → InvalidPercentageError)
 *   - non-numeric input
 *   - negative values
 *
 * This function uses string-based arithmetic only. No floating-point multiplication.
 *
 * @throws InvalidPercentageError for malformed or imprecise input
 * @throws NegativePercentageError for negative input
 */
export function percentageStringToBasisPoints(raw: string): number {
  const trimmed = raw.trim();

  if (trimmed.length === 0) {
    throw new InvalidPercentageError("(input)", NaN);
  }

  const lower = trimmed.toLowerCase();
  if (lower === "nan" || lower === "infinity" || lower === "-infinity" || lower === "+infinity") {
    throw new InvalidPercentageError("(input)", NaN);
  }

  let str = trimmed;
  let negative = false;
  if (str.startsWith("-")) {
    negative = true;
    str = str.slice(1);
  } else if (str.startsWith("+")) {
    str = str.slice(1);
  }

  if (str.length === 0) {
    throw new InvalidPercentageError("(input)", NaN);
  }

  const parts = str.split(".");
  if (parts.length > 2) {
    throw new InvalidPercentageError("(input)", NaN);
  }

  const intPart = parts[0]!;
  const fracPart = parts[1] ?? "";

  if (!/^\d+$/.test(intPart) || (fracPart.length > 0 && !/^\d+$/.test(fracPart))) {
    throw new InvalidPercentageError("(input)", NaN);
  }

  if (fracPart.length > 2) {
    throw new InvalidPercentageError("(input)", NaN);
  }

  const paddedFrac = fracPart.padEnd(2, "0");
  const basisPoints = parseInt(intPart + paddedFrac, 10);

  if (!Number.isSafeInteger(basisPoints)) {
    throw new InvalidPercentageError("(input)", NaN);
  }

  if (negative && basisPoints > 0) {
    throw new NegativePercentageError("(input)", -basisPoints);
  }

  return basisPoints;
}

// ============================================================================
// UTILITY — Format basis points as decimal percentage string
// ============================================================================

/**
 * Converts integer basis points back to a decimal percentage string (e.g. 5000 -> "50.00").
 * This is a formatting utility and does not use floating-point.
 *
 * @throws InvalidPercentageError if basisPoints is non-integer or non-finite.
 */
export function basisPointsToPercentageString(basisPoints: number): string {
  if (!Number.isInteger(basisPoints) || !Number.isFinite(basisPoints)) {
    throw new InvalidPercentageError("(input)", basisPoints);
  }
  const isNeg = basisPoints < 0;
  const abs = Math.abs(basisPoints);
  const intPart = Math.floor(abs / 100).toString();
  const fracPart = (abs % 100).toString().padStart(2, "0");
  return `${isNeg ? "-" : ""}${intPart}.${fracPart}`;
}
