/**
 * Group Balance domain operation (Phase 2.7).
 *
 * Aggregates the per-user financial positions across multiple expenses
 * and settlements for all members of a group.
 *
 * ============================================================
 * BALANCE AGGREGATION MODEL
 * ============================================================
 *
 * For each member u in the group:
 *
 *   totalPaid_u = sum(expenses.paid_u) + sum(settlements.as_payer)
 *   totalOwed_u = sum(expenses.owed_u) + sum(settlements.as_receiver)
 *   netBalance_u = totalPaid_u - totalOwed_u
 *
 * Direction Convention:
 *   Positive (+): User paid more than their share -> User is OWED money (to receive).
 *   Negative (-): User paid less than their share -> User OWES money (to pay).
 *   Zero (0):     User is settled up across all group activity.
 *
 * ============================================================
 * FINANCIAL INVARIANT
 * ============================================================
 *
 * For any valid single-currency group:
 *
 *   sum(all member net balances) === 0
 *
 * ============================================================
 * ZERO-BALANCE MEMBERS
 * ============================================================
 *
 * Every member of the group is explicitly represented in the result.
 * If a member was not involved in any expense or settlement, their
 * paid, owed, and netBalance are all 0 minor units in the group currency.
 *
 * ============================================================
 * SETTLEMENT HANDLING
 * ============================================================
 *
 * When a debtor pays a creditor via a settlement (payer -> receiver, amount S):
 *   - Payer's balance increases by +S (paying down debt).
 *   - Receiver's balance decreases by -S (collecting credit).
 *   - Sum of settlement effects: +S + (-S) = 0.
 *
 * This module is framework-independent. Do not import React, Hono, or Expo here.
 */

import {
  type Money,
  type CurrencyCode,
  zero,
  add,
  subtract,
  CurrencyMismatchError,
  MoneyError,
} from "./money.js";
import {
  type ExpenseBalanceResult,
  BalanceReconciliationError,
} from "./balance.js";

// ============================================================================
// DOMAIN ERRORS
// ============================================================================

/** Thrown when the group member list is empty. */
export class EmptyGroupMembersError extends MoneyError {
  constructor() {
    super(
      "EMPTY_GROUP_MEMBERS",
      "Group member list must contain at least one member."
    );
    this.name = "EmptyGroupMembersError";
  }
}

/** Thrown when a group member identifier is blank or whitespace. */
export class InvalidMemberError extends MoneyError {
  constructor(index: number) {
    super(
      "INVALID_MEMBER",
      `Group member at index ${index} has an invalid identifier (empty or whitespace string).`
    );
    this.name = "InvalidMemberError";
  }
}

/** Thrown when duplicate member identifiers appear in the group member list. */
export class DuplicateMemberError extends MoneyError {
  constructor(memberId: string) {
    super(
      "DUPLICATE_MEMBER",
      `Duplicate group member detected: "${memberId}". Each member must appear exactly once.`
    );
    this.name = "DuplicateMemberError";
  }
}

/** Thrown when an expense or settlement references a user who is not in the group. */
export class UnknownGroupMemberError extends MoneyError {
  constructor(userId: string) {
    super(
      "UNKNOWN_GROUP_MEMBER",
      `User "${userId}" is not a member of the group.`
    );
    this.name = "UnknownGroupMemberError";
  }
}

/** Thrown when a settlement has invalid parties or a non-positive amount. */
export class InvalidSettlementError extends MoneyError {
  constructor(message: string) {
    super("INVALID_SETTLEMENT", message);
    this.name = "InvalidSettlementError";
  }
}

// ============================================================================
// TYPES
// ============================================================================

/**
 * A settlement between two group members.
 *
 * @field payerId    - User who transferred money (reducing debt).
 * @field receiverId - User who received money (reducing credit).
 * @field amount     - Positive Money amount transferred.
 */
export interface GroupSettlementInput {
  readonly payerId: string;
  readonly receiverId: string;
  readonly amount: Money;
}

/**
 * Input for group balance aggregation.
 *
 * @field groupId     - Optional group identifier.
 * @field currency    - Expected group currency. If omitted, inferred from expenses/settlements (defaults to INR if empty).
 * @field members     - Complete list of group member user IDs.
 * @field expenses    - List of validated ExpenseBalanceResult objects for this group.
 * @field settlements - Optional list of completed settlements in this group.
 */
export interface GroupBalanceInput {
  readonly groupId?: string;
  readonly currency?: CurrencyCode;
  readonly members: readonly string[];
  readonly expenses: readonly ExpenseBalanceResult[];
  readonly settlements?: readonly GroupSettlementInput[];
}

/**
 * Aggregate net balance for a single group member.
 *
 * @field userId     - Group member identifier.
 * @field paid       - Total amount contributed across all expenses and settlements.
 * @field owed       - Total amount owed across all expenses and settlements.
 * @field netBalance - Net financial position (paid - owed).
 *                     Positive = owed money by group (to receive).
 *                     Negative = owes money to group (to pay).
 *                     Zero = fully settled.
 */
export interface MemberGroupBalance {
  readonly userId: string;
  readonly paid: Money;
  readonly owed: Money;
  readonly netBalance: Money;
}

/**
 * Result of group balance aggregation.
 *
 * Invariants:
 * - balances array is frozen.
 * - balances order exactly matches the input `members` order.
 * - sum of all netBalance.amountMinor === 0.
 * - every member in `members` has an entry.
 */
export interface GroupBalanceResult {
  readonly groupId?: string;
  readonly currency: CurrencyCode;
  readonly memberCount: number;
  readonly balances: readonly MemberGroupBalance[];
}

// ============================================================================
// VALIDATION & HELPERS
// ============================================================================

/**
 * Validates the group member list.
 */
function validateMembers(members: readonly string[]): Set<string> {
  if (members.length === 0) {
    throw new EmptyGroupMembersError();
  }

  const memberSet = new Set<string>();
  for (let i = 0; i < members.length; i++) {
    const memberId = members[i];
    if (typeof memberId !== "string" || memberId.trim().length === 0) {
      throw new InvalidMemberError(i);
    }
    if (memberSet.has(memberId)) {
      throw new DuplicateMemberError(memberId);
    }
    memberSet.add(memberId);
  }

  return memberSet;
}

// ============================================================================
// GROUP BALANCE OPERATION
// ============================================================================

/**
 * Calculates aggregate net balances for all members of a group.
 *
 * Algorithm:
 * 1. Validate members (non-empty, non-blank, no duplicates).
 * 2. Determine and validate currency consistency across all expenses and settlements.
 * 3. Validate that every user in expenses and settlements is a member of the group.
 * 4. Validate settlements (payer !== receiver, amount > 0).
 * 5. Aggregate paid and owed amounts for each member.
 * 6. Compute netBalance = paid - owed.
 * 7. Verify group zero-sum invariant: sum(netBalances) === 0.
 * 8. Return frozen result preserving input member order.
 *
 * @throws EmptyGroupMembersError    if members is empty
 * @throws InvalidMemberError         if any member ID is blank or whitespace
 * @throws DuplicateMemberError       if any member ID is duplicated
 * @throws UnknownGroupMemberError    if an expense or settlement involves a non-member
 * @throws CurrencyMismatchError      if any expense or settlement has a mismatched currency
 * @throws InvalidSettlementError     if a settlement has invalid parties or non-positive amount
 * @throws BalanceReconciliationError if sum of net balances is non-zero
 */
export function calculateGroupBalances(input: GroupBalanceInput): GroupBalanceResult {
  const { groupId, members, expenses, settlements = [] } = input;

  // 1. Validate members
  const memberSet = validateMembers(members);

  // 2. Determine currency
  let activeCurrency: CurrencyCode = input.currency ?? "INR";
  if (input.currency === undefined) {
    if (expenses.length > 0) {
      activeCurrency = expenses[0]!.total.currency;
    } else if (settlements.length > 0) {
      activeCurrency = settlements[0]!.amount.currency;
    }
  }

  const zeroMoney = zero(activeCurrency);

  // Initialize tracking maps for every group member (preserves zero balances)
  const paidMap = new Map<string, Money>();
  const owedMap = new Map<string, Money>();

  for (const memberId of members) {
    paidMap.set(memberId, zeroMoney);
    owedMap.set(memberId, zeroMoney);
  }

  // 3. Process expenses
  for (const expense of expenses) {
    if (expense.total.currency !== activeCurrency) {
      throw new CurrencyMismatchError(activeCurrency, expense.total.currency);
    }

    for (const uBal of expense.balances) {
      if (!memberSet.has(uBal.userId)) {
        throw new UnknownGroupMemberError(uBal.userId);
      }
      if (uBal.paid.currency !== activeCurrency) {
        throw new CurrencyMismatchError(activeCurrency, uBal.paid.currency);
      }
      if (uBal.owed.currency !== activeCurrency) {
        throw new CurrencyMismatchError(activeCurrency, uBal.owed.currency);
      }

      const currentPaid = paidMap.get(uBal.userId)!;
      const currentOwed = owedMap.get(uBal.userId)!;

      paidMap.set(uBal.userId, add(currentPaid, uBal.paid));
      owedMap.set(uBal.userId, add(currentOwed, uBal.owed));
    }
  }

  // 4. Process settlements
  for (const settlement of settlements) {
    const { payerId, receiverId, amount } = settlement;

    if (!memberSet.has(payerId)) {
      throw new UnknownGroupMemberError(payerId);
    }
    if (!memberSet.has(receiverId)) {
      throw new UnknownGroupMemberError(receiverId);
    }
    if (payerId === receiverId) {
      throw new InvalidSettlementError(
        `Settlement payer and receiver must be different users, got "${payerId}" for both.`
      );
    }
    if (amount.amountMinor <= 0) {
      throw new InvalidSettlementError(
        `Settlement amount must be greater than zero, got: ${amount.amountMinor} minor units.`
      );
    }
    if (amount.currency !== activeCurrency) {
      throw new CurrencyMismatchError(activeCurrency, amount.currency);
    }

    // Payer contributed money: increase payer's paid total
    const payerPaid = paidMap.get(payerId)!;
    paidMap.set(payerId, add(payerPaid, amount));

    // Receiver collected money: increase receiver's owed total
    const receiverOwed = owedMap.get(receiverId)!;
    owedMap.set(receiverId, add(receiverOwed, amount));
  }

  // 5. Build results in original members input order
  const balances: MemberGroupBalance[] = members.map((memberId) => {
    const paid = paidMap.get(memberId)!;
    const owed = owedMap.get(memberId)!;
    const netBalance = subtract(paid, owed);

    return Object.freeze({
      userId: memberId,
      paid,
      owed,
      netBalance,
    });
  });

  // 6. Reconciliation check: sum(all net balances) === 0
  let groupSumMinor = 0;
  for (const b of balances) {
    groupSumMinor += b.netBalance.amountMinor;
  }

  if (groupSumMinor !== 0) {
    throw new BalanceReconciliationError(groupSumMinor);
  }

  return Object.freeze({
    groupId,
    currency: activeCurrency,
    memberCount: members.length,
    balances: Object.freeze(balances),
  }) as GroupBalanceResult;
}

// ============================================================================
// CONVENIENCE HELPERS
// ============================================================================

/**
 * Finds the balance record for a specific member in a GroupBalanceResult.
 */
export function getMemberBalance(
  result: GroupBalanceResult,
  userId: string
): MemberGroupBalance | undefined {
  return result.balances.find((b) => b.userId === userId);
}
