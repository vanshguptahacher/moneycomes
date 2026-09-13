import { eq, and, or, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  friendships,
  expenses,
  expenseSplits,
  settlements,
  type Friendship,
  type NewFriendship,
  FRIENDSHIP_STATUS,
  canonicalizeFriendshipPair,
} from "../db/schema/index.js";
import type { DbOrTx } from "./types.js";

export interface BilateralBalance {
  amountMinor: number;
  currency: string;
}

/**
 * Repository for friendship persistence and bilateral friend balance operations.
 * - Isolated from HTTP concerns.
 * - Accepts an optional transaction handle for atomic operations.
 */
export class FriendRepository {
  /**
   * Find a friendship by its unique primary key ID.
   */
  async findById(id: string, client: DbOrTx = db): Promise<Friendship | null> {
    const results = await client
      .select()
      .from(friendships)
      .where(eq(friendships.id, id))
      .limit(1);

    return results[0] ?? null;
  }

  /**
   * Find a friendship by a pair of user IDs, canonicalizing the pair order first.
   */
  async findByPair(
    userA: string,
    userB: string,
    client: DbOrTx = db
  ): Promise<Friendship | null> {
    const { userId1, userId2 } = canonicalizeFriendshipPair(userA, userB);

    const results = await client
      .select()
      .from(friendships)
      .where(and(eq(friendships.userId1, userId1), eq(friendships.userId2, userId2)))
      .limit(1);

    return results[0] ?? null;
  }

  /**
   * List all active friendships where the user is either party.
   */
  async listByUserId(userId: string, client: DbOrTx = db): Promise<Friendship[]> {
    return client
      .select()
      .from(friendships)
      .where(
        and(
          or(eq(friendships.userId1, userId), eq(friendships.userId2, userId)),
          eq(friendships.status, FRIENDSHIP_STATUS.ACTIVE)
        )
      )
      .orderBy(desc(friendships.createdAt));
  }

  /**
   * Create a new friendship record.
   * Expects pre-canonicalized userId1 and userId2.
   */
  async create(data: NewFriendship, client: DbOrTx = db): Promise<Friendship> {
    const results = await client
      .insert(friendships)
      .values({
        ...data,
        status: data.status ?? FRIENDSHIP_STATUS.ACTIVE,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    const created = results[0];
    if (!created) {
      throw new Error("Failed to insert friendship record");
    }
    return created;
  }

  /**
   * Delete a friendship record by ID.
   * Leaves all related expenses, splits, and settlements completely intact.
   */
  async delete(id: string, client: DbOrTx = db): Promise<boolean> {
    const results = await client
      .delete(friendships)
      .where(eq(friendships.id, id))
      .returning({ id: friendships.id });

    return results.length > 0;
  }

  /**
   * Calculates the authoritative bilateral net balance between userA and userB.
   *
   * Convention (from perspective of userA):
   *   Positive (+): userB owes userA money.
   *   Negative (-): userA owes userB money.
   *   Zero (0):     fully settled / no outstanding balance.
   *
   * Invariant:
   *   balance(A, B) === -balance(B, A)
   *
   * Pure integer minor-unit arithmetic, derived strictly from:
   *   1. Non-deleted expenses where userA paid for userB (+userA)
   *   2. Non-deleted expenses where userB paid for userA (-userA)
   *   3. Settlements where userA paid userB (+userA, paying down debt)
   *   4. Settlements where userB paid userA (-userA, collecting credit)
   */
  async getBilateralBalance(
    userIdA: string,
    userIdB: string,
    client: DbOrTx = db
  ): Promise<BilateralBalance> {
    let netMinor = 0;
    let resolvedCurrency = "INR";

    // 1. Expenses where A is payer and B is a split participant (B owes A)
    const splitsPaidByA = await client
      .select({
        allocated: expenseSplits.allocatedAmountMinor,
        currency: expenses.currencyCode,
      })
      .from(expenseSplits)
      .innerJoin(expenses, eq(expenseSplits.expenseId, expenses.id))
      .where(
        and(
          eq(expenses.payerId, userIdA),
          eq(expenseSplits.userId, userIdB),
          eq(expenses.isDeleted, false)
        )
      );

    for (const s of splitsPaidByA) {
      netMinor += Number(s.allocated);
      resolvedCurrency = s.currency;
    }

    // 2. Expenses where B is payer and A is a split participant (A owes B)
    const splitsPaidByB = await client
      .select({
        allocated: expenseSplits.allocatedAmountMinor,
        currency: expenses.currencyCode,
      })
      .from(expenseSplits)
      .innerJoin(expenses, eq(expenseSplits.expenseId, expenses.id))
      .where(
        and(
          eq(expenses.payerId, userIdB),
          eq(expenseSplits.userId, userIdA),
          eq(expenses.isDeleted, false)
        )
      );

    for (const s of splitsPaidByB) {
      netMinor -= Number(s.allocated);
      resolvedCurrency = s.currency;
    }

    // 3. Direct settlements where A paid B (A paid down debt to B -> increases A's net balance toward/above zero)
    const settlementsPaidByA = await client
      .select({
        amount: settlements.amountMinor,
        currency: settlements.currencyCode,
      })
      .from(settlements)
      .where(
        and(
          eq(settlements.payerId, userIdA),
          eq(settlements.receiverId, userIdB)
        )
      );

    for (const st of settlementsPaidByA) {
      netMinor += Number(st.amount);
      resolvedCurrency = st.currency;
    }

    // 4. Direct settlements where B paid A (B paid down debt to A -> decreases A's net balance toward zero)
    const settlementsPaidByB = await client
      .select({
        amount: settlements.amountMinor,
        currency: settlements.currencyCode,
      })
      .from(settlements)
      .where(
        and(
          eq(settlements.payerId, userIdB),
          eq(settlements.receiverId, userIdA)
        )
      );

    for (const st of settlementsPaidByB) {
      netMinor -= Number(st.amount);
      resolvedCurrency = st.currency;
    }

    return {
      amountMinor: netMinor,
      currency: resolvedCurrency,
    };
  }
}

export const friendRepository = new FriendRepository();
