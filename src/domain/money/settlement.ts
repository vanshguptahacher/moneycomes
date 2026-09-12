/**
 * Settlement Engine domain operation (Phase 2.9).
 *
 * Represents and executes actual financial payments between two users
 * that reduce outstanding balances toward zero.
 *
 * ============================================================
 * BALANCE EFFECT CONVENTION
 * ============================================================
 *
 * Direction:
 *   Debtor (payer) pays money to Creditor (receiver).
 *
 * Position Changes:
 *   Debtor balance:   increases toward zero (paying down debt: netBalance + S).
 *   Creditor balance: decreases toward zero (collecting credit: netBalance - S).
 *
 * Zero-Sum Invariant:
 *   Delta(Debtor) + Delta(Creditor) === (+S) + (-S) === 0.
 *   Sum of all user net balances in group remains exactly zero.
 *
 * ============================================================
 * RECALCULATION MODEL
 * ============================================================
 *
 * Authoritative financial position is derivable from:
 *   expenses + settlements.
 *
 * No second independent balance state is maintained.
 * Recalculation is pure and deterministic.
 *
 * This module is framework-independent. Do not import React, Hono, or Expo here.
 */

import {
  type Money,
  type CurrencyCode,
  add,
  subtract,
  CurrencyMismatchError,
  MoneyError,
} from "./money.js";
import {
  type ExpenseBalanceResult,
  type UserBalance,
  BalanceReconciliationError,
} from "./balance.js";
import {
  type MemberGroupBalance,
  type GroupBalanceResult,
  UnknownGroupMemberError,
  calculateGroupBalances,
} from "./group-balance.js";
import { type NetBalanceInput } from "./debt-simplification.js";

// ============================================================================
// DOMAIN ERRORS
// ============================================================================

/** Thrown when a settlement attempts to settle between a user and themselves. */
export class SelfSettlementError extends MoneyError {
  readonly userId: string;

  constructor(userId: string) {
    super(
      "SELF_SETTLEMENT",
      `Cannot settle with oneself: debtor and creditor are both "${userId}".`
    );
    this.name = "SelfSettlementError";
    this.userId = userId;
  }
}

/** Thrown when a settlement amount is non-positive or invalid. */
export class InvalidSettlementAmountError extends MoneyError {
  readonly amountMinor?: number;

  constructor(message: string, amountMinor?: number) {
    super("INVALID_SETTLEMENT_AMOUNT", message);
    this.name = "InvalidSettlementAmountError";
    this.amountMinor = amountMinor;
  }
}

/** Thrown when a settlement amount exceeds the outstanding debt or credit between the parties. */
export class OverSettlementError extends MoneyError {
  readonly amountMinor: number;
  readonly maxAllowedMinor: number;
  readonly currency: CurrencyCode;
  readonly debtorId: string;
  readonly creditorId: string;

  constructor(
    amountMinor: number,
    maxAllowedMinor: number,
    currency: CurrencyCode,
    debtorId: string,
    creditorId: string
  ) {
    super(
      "OVER_SETTLEMENT",
      `Settlement amount (${amountMinor} minor units) exceeds outstanding debt (${maxAllowedMinor} minor units) between debtor "${debtorId}" and creditor "${creditorId}".`
    );
    this.name = "OverSettlementError";
    this.amountMinor = amountMinor;
    this.maxAllowedMinor = maxAllowedMinor;
    this.currency = currency;
    this.debtorId = debtorId;
    this.creditorId = creditorId;
  }
}

/** Thrown when debtor or creditor roles do not match active net balances. */
export class DebtorCreditorMismatchError extends MoneyError {
  readonly debtorId: string;
  readonly creditorId: string;

  constructor(message: string, debtorId: string, creditorId: string) {
    super("DEBTOR_CREDITOR_MISMATCH", message);
    this.name = "DebtorCreditorMismatchError";
    this.debtorId = debtorId;
    this.creditorId = creditorId;
  }
}

/** Thrown when a settlement has invalid user identifiers. */
export class InvalidSettlementPartiesError extends MoneyError {
  constructor(message: string) {
    super("INVALID_SETTLEMENT_PARTIES", message);
    this.name = "InvalidSettlementPartiesError";
  }
}

/** Thrown when duplicate settlement IDs are detected in a collection or recalculation batch. */
export class DuplicateSettlementError extends MoneyError {
  readonly settlementId: string;

  constructor(settlementId: string) {
    super(
      "DUPLICATE_SETTLEMENT",
      `Duplicate settlement detected with ID "${settlementId}". Each settlement ID must be unique.`
    );
    this.name = "DuplicateSettlementError";
    this.settlementId = settlementId;
  }
}

// Re-export shared errors for caller convenience
export {
  CurrencyMismatchError,
  UnknownGroupMemberError,
  BalanceReconciliationError,
  MoneyError,
};

// ============================================================================
// TYPES
// ============================================================================

/**
 * Input for creating or validating a Settlement.
 *
 * Supports both `debtorId`/`creditorId` and `payerId`/`receiverId` aliases.
 */
export interface SettlementInput {
  readonly id?: string;
  readonly debtorId?: string;
  readonly creditorId?: string;
  readonly payerId?: string;
  readonly receiverId?: string;
  readonly amount: Money;
  readonly notes?: string;
  readonly settledAt?: Date;
}

/**
 * Validated, immutable Settlement model.
 *
 * Direction:
 *   debtor (payer) pays money to creditor (receiver).
 *   debtor balance increases toward zero (paying down debt).
 *   creditor balance decreases toward zero (collecting credit).
 */
export interface Settlement {
  readonly id?: string;
  readonly debtorId: string;
  readonly creditorId: string;
  readonly payerId: string;
  readonly receiverId: string;
  readonly amount: Money;
  readonly notes?: string;
  readonly settledAt?: Date;
}

/**
 * Input for recalculating group balances from historical expenses and settlements.
 */
export interface RecalculateBalancesInput {
  readonly groupId?: string;
  readonly currency?: CurrencyCode;
  readonly members: readonly string[];
  readonly expenses: readonly ExpenseBalanceResult[];
  readonly settlements: readonly (SettlementInput | Settlement)[];
}

// ============================================================================
// SETTLEMENT MODEL CREATION & VALIDATION
// ============================================================================

/**
 * Creates and validates an immutable Settlement object.
 *
 * Validates:
 * - Debtor and creditor identifiers exist and are non-empty strings.
 * - Conflicting alias definitions (if both provided) are rejected.
 * - Self-settlements (debtor === creditor) are rejected.
 * - Amount is a valid Money instance with positive safe integer amountMinor.
 *
 * @throws InvalidSettlementPartiesError if parties are missing, blank, or conflicting
 * @throws SelfSettlementError          if debtor === creditor
 * @throws InvalidSettlementAmountError  if amount <= 0 or not a safe integer
 */
export function createSettlement(input: SettlementInput): Settlement {
  if (!input) {
    throw new InvalidSettlementPartiesError("Settlement input is required.");
  }

  const debtorId = input.debtorId ?? input.payerId;
  const creditorId = input.creditorId ?? input.receiverId;

  if (typeof debtorId !== "string" || debtorId.trim().length === 0) {
    throw new InvalidSettlementPartiesError("Debtor identifier must be a non-empty string.");
  }

  if (typeof creditorId !== "string" || creditorId.trim().length === 0) {
    throw new InvalidSettlementPartiesError("Creditor identifier must be a non-empty string.");
  }

  // Cross-check aliases if both were provided
  if (input.debtorId !== undefined && input.payerId !== undefined && input.debtorId !== input.payerId) {
    throw new InvalidSettlementPartiesError(
      `Conflicting debtor identifiers: debtorId="${input.debtorId}", payerId="${input.payerId}".`
    );
  }
  if (input.creditorId !== undefined && input.receiverId !== undefined && input.creditorId !== input.receiverId) {
    throw new InvalidSettlementPartiesError(
      `Conflicting creditor identifiers: creditorId="${input.creditorId}", receiverId="${input.receiverId}".`
    );
  }

  if (debtorId === creditorId) {
    throw new SelfSettlementError(debtorId);
  }

  const { amount } = input;
  if (!amount || typeof amount !== "object" || typeof amount.amountMinor !== "number") {
    throw new InvalidSettlementAmountError("Settlement amount must be a valid Money object.");
  }

  if (!Number.isSafeInteger(amount.amountMinor)) {
    throw new InvalidSettlementAmountError(
      `Settlement amount must be a safe integer, got: ${amount.amountMinor}`,
      amount.amountMinor
    );
  }

  if (amount.amountMinor <= 0) {
    throw new InvalidSettlementAmountError(
      `Settlement amount must be greater than zero, got: ${amount.amountMinor} minor units.`,
      amount.amountMinor
    );
  }

  return Object.freeze({
    id: input.id,
    debtorId,
    creditorId,
    payerId: debtorId,
    receiverId: creditorId,
    amount,
    notes: input.notes,
    settledAt: input.settledAt,
  });
}

/**
 * Validates a settlement stand-alone or against an active balance context.
 *
 * When `balances` is provided, validates:
 * - Both debtor and creditor exist in the balance context.
 * - Settlement currency matches context currency.
 * - Debtor actually owes money (netBalance < 0).
 * - Creditor is actually owed money (netBalance > 0).
 * - Amount does not exceed the outstanding debt: min(abs(debtor), creditor).
 *
 * @throws InvalidSettlementPartiesError  if user IDs are invalid or balance context empty
 * @throws SelfSettlementError           if debtor === creditor
 * @throws InvalidSettlementAmountError   if amount <= 0
 * @throws UnknownGroupMemberError       if debtor or creditor is not in the balance context
 * @throws CurrencyMismatchError         if currency differs from balance context
 * @throws DebtorCreditorMismatchError   if debtor does not owe or creditor is not owed
 * @throws OverSettlementError           if amount exceeds outstanding balance
 */
export function validateSettlement(
  settlement: SettlementInput | Settlement,
  balances?:
    | GroupBalanceResult
    | readonly (NetBalanceInput | MemberGroupBalance | UserBalance)[]
): Settlement {
  const validatedSettlement = createSettlement(settlement);

  if (!balances) {
    return validatedSettlement;
  }

  let balanceList: readonly (NetBalanceInput | MemberGroupBalance | UserBalance)[];
  let contextCurrency: CurrencyCode;

  if ("balances" in balances && "currency" in balances) {
    balanceList = balances.balances;
    contextCurrency = balances.currency;
  } else if (Array.isArray(balances)) {
    balanceList = balances;
    if (balanceList.length === 0) {
      throw new InvalidSettlementPartiesError("Cannot validate settlement against an empty balances list.");
    }
    contextCurrency = balanceList[0]!.netBalance.currency;
  } else {
    throw new InvalidSettlementPartiesError("Invalid balance context provided.");
  }

  const { debtorId, creditorId, amount } = validatedSettlement;

  // 1. Currency validation
  if (amount.currency !== contextCurrency) {
    throw new CurrencyMismatchError(contextCurrency, amount.currency);
  }

  // 2. Member existence validation
  const debtorBal = balanceList.find((b) => b.userId === debtorId);
  if (!debtorBal) {
    throw new UnknownGroupMemberError(debtorId);
  }

  const creditorBal = balanceList.find((b) => b.userId === creditorId);
  if (!creditorBal) {
    throw new UnknownGroupMemberError(creditorId);
  }

  if (debtorBal.netBalance.currency !== contextCurrency) {
    throw new CurrencyMismatchError(contextCurrency, debtorBal.netBalance.currency);
  }
  if (creditorBal.netBalance.currency !== contextCurrency) {
    throw new CurrencyMismatchError(contextCurrency, creditorBal.netBalance.currency);
  }

  // 3. Debtor & Creditor direction validation
  // Debtor must have negative balance (owes money: netBalance < 0)
  if (debtorBal.netBalance.amountMinor >= 0) {
    throw new DebtorCreditorMismatchError(
      `User "${debtorId}" is not in debt (net balance is ${debtorBal.netBalance.amountMinor} minor units). Cannot act as debtor.`,
      debtorId,
      creditorId
    );
  }

  // Creditor must have positive balance (is owed money: netBalance > 0)
  if (creditorBal.netBalance.amountMinor <= 0) {
    throw new DebtorCreditorMismatchError(
      `User "${creditorId}" is not owed money (net balance is ${creditorBal.netBalance.amountMinor} minor units). Cannot act as creditor.`,
      debtorId,
      creditorId
    );
  }

  // 4. Amount must not exceed outstanding debt or credit
  const outstandingDebt = Math.abs(debtorBal.netBalance.amountMinor);
  const outstandingCredit = creditorBal.netBalance.amountMinor;
  const maxAllowed = Math.min(outstandingDebt, outstandingCredit);

  if (amount.amountMinor > maxAllowed) {
    throw new OverSettlementError(
      amount.amountMinor,
      maxAllowed,
      contextCurrency,
      debtorId,
      creditorId
    );
  }

  return validatedSettlement;
}

// ============================================================================
// INSPECTION HELPERS
// ============================================================================

/**
 * Returns true if the settlement fully settles either the debtor's remaining debt
 * or the creditor's remaining credit (i.e. reaches the maximum allowed settlement).
 */
export function isFullSettlement(
  settlement: SettlementInput | Settlement,
  balances:
    | GroupBalanceResult
    | readonly (NetBalanceInput | MemberGroupBalance | UserBalance)[]
): boolean {
  const s = validateSettlement(settlement, balances);
  const balanceList = "balances" in balances ? balances.balances : balances;
  const debtorBal = balanceList.find((b) => b.userId === s.debtorId)!;
  const creditorBal = balanceList.find((b) => b.userId === s.creditorId)!;

  const maxAllowed = Math.min(
    Math.abs(debtorBal.netBalance.amountMinor),
    creditorBal.netBalance.amountMinor
  );

  return s.amount.amountMinor === maxAllowed;
}

/**
 * Returns true if the settlement leaves residual balance for both debtor and creditor.
 */
export function isPartialSettlement(
  settlement: SettlementInput | Settlement,
  balances:
    | GroupBalanceResult
    | readonly (NetBalanceInput | MemberGroupBalance | UserBalance)[]
): boolean {
  return !isFullSettlement(settlement, balances);
}

/**
 * Returns true if the settlement brings both the debtor AND creditor to exact zero.
 */
export function isMutualFullSettlement(
  settlement: SettlementInput | Settlement,
  balances:
    | GroupBalanceResult
    | readonly (NetBalanceInput | MemberGroupBalance | UserBalance)[]
): boolean {
  const s = validateSettlement(settlement, balances);
  const balanceList = "balances" in balances ? balances.balances : balances;
  const debtorBal = balanceList.find((b) => b.userId === s.debtorId)!;
  const creditorBal = balanceList.find((b) => b.userId === s.creditorId)!;

  const debt = Math.abs(debtorBal.netBalance.amountMinor);
  const credit = creditorBal.netBalance.amountMinor;

  return s.amount.amountMinor === debt && s.amount.amountMinor === credit;
}

// ============================================================================
// BALANCE APPLICATION
// ============================================================================

/**
 * Overload 1: Applies a settlement to a GroupBalanceResult.
 */
export function applySettlement(
  current: GroupBalanceResult,
  settlement: SettlementInput | Settlement
): GroupBalanceResult;

/**
 * Overload 2: Applies a settlement to an array of balance items.
 */
export function applySettlement<
  T extends NetBalanceInput | MemberGroupBalance | UserBalance,
>(current: readonly T[], settlement: SettlementInput | Settlement): readonly T[];

/**
 * Implementation of applySettlement.
 */
export function applySettlement<
  T extends NetBalanceInput | MemberGroupBalance | UserBalance,
>(
  current: GroupBalanceResult | readonly T[],
  settlement: SettlementInput | Settlement
): GroupBalanceResult | readonly T[] {
  const validated = validateSettlement(settlement, current);
  const { debtorId, creditorId, amount } = validated;

  if ("balances" in current && "currency" in current) {
    // GroupBalanceResult branch
    const newBalances: MemberGroupBalance[] = current.balances.map((mBal) => {
      if (mBal.userId === debtorId) {
        const newPaid = add(mBal.paid, amount);
        const newNet = subtract(newPaid, mBal.owed);
        return Object.freeze({
          userId: mBal.userId,
          paid: newPaid,
          owed: mBal.owed,
          netBalance: newNet,
        });
      }
      if (mBal.userId === creditorId) {
        const newOwed = add(mBal.owed, amount);
        const newNet = subtract(mBal.paid, newOwed);
        return Object.freeze({
          userId: mBal.userId,
          paid: mBal.paid,
          owed: newOwed,
          netBalance: newNet,
        });
      }
      return mBal;
    });

    // Reconciliation check
    let sumMinor = 0;
    for (const b of newBalances) {
      sumMinor += b.netBalance.amountMinor;
    }
    if (sumMinor !== 0) {
      throw new BalanceReconciliationError(sumMinor);
    }

    return Object.freeze({
      groupId: current.groupId,
      currency: current.currency,
      memberCount: current.memberCount,
      balances: Object.freeze(newBalances),
    });
  }

  // Array branch
  const rawList = current as readonly T[];
  const newBalances = rawList.map((item) => {
    if (item.userId === debtorId) {
      if ("paid" in item && "owed" in item) {
        const typed = item as unknown as UserBalance | MemberGroupBalance;
        const newPaid = add(typed.paid, amount);
        const newNet = subtract(newPaid, typed.owed);
        return Object.freeze({
          ...item,
          paid: newPaid,
          owed: typed.owed,
          netBalance: newNet,
        });
      }
      const newNet = add(item.netBalance, amount);
      return Object.freeze({
        ...item,
        netBalance: newNet,
      });
    }
    if (item.userId === creditorId) {
      if ("paid" in item && "owed" in item) {
        const typed = item as unknown as UserBalance | MemberGroupBalance;
        const newOwed = add(typed.owed, amount);
        const newNet = subtract(typed.paid, newOwed);
        return Object.freeze({
          ...item,
          paid: typed.paid,
          owed: newOwed,
          netBalance: newNet,
        });
      }
      const newNet = subtract(item.netBalance, amount);
      return Object.freeze({
        ...item,
        netBalance: newNet,
      });
    }
    return item;
  });

  // Reconciliation check
  let sumMinor = 0;
  for (const b of newBalances) {
    sumMinor += (b as NetBalanceInput).netBalance.amountMinor;
  }
  if (sumMinor !== 0) {
    throw new BalanceReconciliationError(sumMinor);
  }

  return Object.freeze(newBalances) as unknown as readonly T[];
}

// ============================================================================
// BATCH APPLICATION & RECALCULATION
// ============================================================================

/**
 * Overload 1: Sequentially applies a list of settlements to a GroupBalanceResult.
 */
export function applySettlements(
  current: GroupBalanceResult,
  settlements: readonly (SettlementInput | Settlement)[]
): GroupBalanceResult;

/**
 * Overload 2: Sequentially applies a list of settlements to an array of balance items.
 */
export function applySettlements<
  T extends NetBalanceInput | MemberGroupBalance | UserBalance,
>(
  current: readonly T[],
  settlements: readonly (SettlementInput | Settlement)[]
): readonly T[];

/**
 * Implementation of applySettlements.
 */
export function applySettlements<
  T extends NetBalanceInput | MemberGroupBalance | UserBalance,
>(
  current: GroupBalanceResult | readonly T[],
  settlements: readonly (SettlementInput | Settlement)[]
): GroupBalanceResult | readonly T[] {
  // Validate duplicate settlement IDs in batch
  const seenIds = new Set<string>();
  for (const s of settlements) {
    if (s.id) {
      if (seenIds.has(s.id)) {
        throw new DuplicateSettlementError(s.id);
      }
      seenIds.add(s.id);
    }
  }

  let state = current;
  for (const settlement of settlements) {
    if ("balances" in state && "currency" in state) {
      state = applySettlement(state, settlement);
    } else {
      state = applySettlement(state as readonly T[], settlement);
    }
  }

  return state;
}

/**
 * Pure and deterministic recalculation of authoritative group balances
 * from expenses and settlements.
 *
 * Algorithm:
 * 1. Derives baseline balances from expenses using `calculateGroupBalances`.
 * 2. Sequentially validates and applies each settlement using `applySettlements`.
 *
 * Invariants:
 * - Every settlement is validated in order against active balances.
 * - Net group position remains zero at every step.
 * - Idempotent and deterministic for identical input collections.
 */
export function recalculateBalances(
  input: RecalculateBalancesInput
): GroupBalanceResult {
  const { groupId, currency, members, expenses, settlements = [] } = input;

  // 1. Derive baseline balances strictly from expenses
  const baseline = calculateGroupBalances({
    groupId,
    currency,
    members,
    expenses,
    settlements: [],
  });

  // 2. Sequentially validate and apply settlements
  return applySettlements(baseline, settlements);
}
