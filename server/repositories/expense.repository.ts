import { eq, and, desc, count } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  expenses,
  expenseSplits,
  activityEvents,
  type Expense,
  type NewExpense,
  type ExpenseSplit,
  type NewExpenseSplit,
  ACTIVITY_EVENT_TYPES,
  ACTIVITY_ENTITY_TYPES,
} from "../db/schema/index.js";
import type { DbOrTx } from "./types.js";

export interface ListExpensesOptions {
  limit?: number;
  offset?: number;
}

export interface ListExpensesResult {
  expenses: (Expense & { splits: ExpenseSplit[] })[];
  total: number;
}

/**
 * Repository for expenses persistence, split management, and transactional operations.
 */
export class ExpenseRepository {
  /**
   * Find an active (non-deleted) expense by unique ID.
   */
  async findById(id: string, client: DbOrTx = db): Promise<Expense | null> {
    const results = await client
      .select()
      .from(expenses)
      .where(and(eq(expenses.id, id), eq(expenses.isDeleted, false)))
      .limit(1);

    return results[0] ?? null;
  }

  /**
   * Find an active expense along with all its splits.
   */
  async findByIdWithSplits(
    id: string,
    client: DbOrTx = db
  ): Promise<{ expense: Expense; splits: ExpenseSplit[] } | null> {
    const exp = await this.findById(id, client);
    if (!exp) {
      return null;
    }

    const splits = await client
      .select()
      .from(expenseSplits)
      .where(eq(expenseSplits.expenseId, id));

    return { expense: exp, splits };
  }

  /**
   * List active expenses for a specific group with deterministic ordering and pagination.
   */
  async listByGroupId(
    groupId: string,
    options: ListExpensesOptions = {},
    client: DbOrTx = db
  ): Promise<ListExpensesResult> {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const offset = Math.max(options.offset ?? 0, 0);

    const whereClause = and(
      eq(expenses.groupId, groupId),
      eq(expenses.isDeleted, false)
    );

    const countResults = await client
      .select({ total: count() })
      .from(expenses)
      .where(whereClause);

    const total = Number(countResults[0]?.total ?? 0);

    const rawExpenses = await client
      .select()
      .from(expenses)
      .where(whereClause)
      .orderBy(desc(expenses.date), desc(expenses.createdAt), desc(expenses.id))
      .limit(limit)
      .offset(offset);

    if (rawExpenses.length === 0) {
      return { expenses: [], total };
    }

    // Fetch splits for these expenses
    const expenseIds = rawExpenses.map((e) => e.id);
    const allSplits = await Promise.all(
      expenseIds.map(async (eid) => {
        return client
          .select()
          .from(expenseSplits)
          .where(eq(expenseSplits.expenseId, eid));
      })
    );

    const splitsMap = new Map<string, ExpenseSplit[]>();
    for (let i = 0; i < expenseIds.length; i++) {
      splitsMap.set(expenseIds[i], allSplits[i] ?? []);
    }

    const enriched = rawExpenses.map((exp) => ({
      ...exp,
      splits: splitsMap.get(exp.id) ?? [],
    }));

    return {
      expenses: enriched,
      total,
    };
  }

  /**
   * Atomically create an expense, its participant splits, and an activity event.
   */
  async createWithSplits(
    expenseData: NewExpense,
    splitsData: Omit<NewExpenseSplit, "expenseId">[],
    actorId: string,
    client: DbOrTx = db
  ): Promise<{ expense: Expense; splits: ExpenseSplit[] }> {
    const execute = async (tx: DbOrTx) => {
      // 1. Insert expense
      const insertedExpense = await tx
        .insert(expenses)
        .values(expenseData)
        .returning();

      const created = insertedExpense[0];
      if (!created) {
        throw new Error("Failed to insert expense record");
      }

      // 2. Insert splits
      let createdSplits: ExpenseSplit[] = [];
      if (splitsData.length > 0) {
        const toInsert = splitsData.map((s) => ({
          ...s,
          expenseId: created.id,
        }));
        createdSplits = await tx
          .insert(expenseSplits)
          .values(toInsert)
          .returning();
      }

      // 3. Log activity event
      await tx.insert(activityEvents).values({
        type: ACTIVITY_EVENT_TYPES.EXPENSE_CREATED,
        actorId,
        groupId: created.groupId,
        entityType: ACTIVITY_ENTITY_TYPES.EXPENSE,
        entityId: created.id,
        metadata: {
          description: created.description,
          amountMinor: created.amountMinor,
          currencyCode: created.currencyCode,
          payerId: created.payerId,
          splitMethod: created.splitMethod,
          participantsCount: createdSplits.length,
        },
        createdAt: new Date(),
      });

      return { expense: created, splits: createdSplits };
    };

    if ("transaction" in client && typeof client.transaction === "function") {
      return (client as typeof db).transaction(execute);
    }
    return execute(client);
  }

  /**
   * Atomically update an expense and reallocate its splits with an activity event.
   */
  async updateWithSplits(
    id: string,
    updates: Partial<NewExpense>,
    newSplits?: Omit<NewExpenseSplit, "expenseId">[],
    actorId?: string,
    client: DbOrTx = db
  ): Promise<{ expense: Expense; splits: ExpenseSplit[] } | null> {
    const execute = async (tx: DbOrTx) => {
      const existing = await tx
        .select()
        .from(expenses)
        .where(and(eq(expenses.id, id), eq(expenses.isDeleted, false)))
        .limit(1);

      if (!existing[0]) {
        return null;
      }

      const updated = await tx
        .update(expenses)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(expenses.id, id))
        .returning();

      const exp = updated[0];
      if (!exp) {
        return null;
      }

      let splits: ExpenseSplit[];
      if (newSplits !== undefined) {
        // Replace splits
        await tx.delete(expenseSplits).where(eq(expenseSplits.expenseId, id));

        const toInsert = newSplits.map((s) => ({
          ...s,
          expenseId: id,
        }));

        splits = await tx
          .insert(expenseSplits)
          .values(toInsert)
          .returning();
      } else {
        splits = await tx
          .select()
          .from(expenseSplits)
          .where(eq(expenseSplits.expenseId, id));
      }

      if (actorId) {
        await tx.insert(activityEvents).values({
          type: ACTIVITY_EVENT_TYPES.EXPENSE_UPDATED,
          actorId,
          groupId: exp.groupId,
          entityType: ACTIVITY_ENTITY_TYPES.EXPENSE,
          entityId: exp.id,
          metadata: {
            description: exp.description,
            amountMinor: exp.amountMinor,
            currencyCode: exp.currencyCode,
          },
          createdAt: new Date(),
        });
      }

      return { expense: exp, splits };
    };

    if ("transaction" in client && typeof client.transaction === "function") {
      return (client as typeof db).transaction(execute);
    }
    return execute(client);
  }

  /**
   * Atomically soft-delete an expense and log an activity event.
   */
  async softDelete(
    id: string,
    actorId: string,
    client: DbOrTx = db
  ): Promise<boolean> {
    const execute = async (tx: DbOrTx) => {
      const existing = await tx
        .select()
        .from(expenses)
        .where(and(eq(expenses.id, id), eq(expenses.isDeleted, false)))
        .limit(1);

      if (!existing[0]) {
        return false;
      }

      const exp = existing[0];

      await tx
        .update(expenses)
        .set({ isDeleted: true, updatedAt: new Date() })
        .where(eq(expenses.id, id));

      await tx.insert(activityEvents).values({
        type: ACTIVITY_EVENT_TYPES.EXPENSE_DELETED,
        actorId,
        groupId: exp.groupId,
        entityType: ACTIVITY_ENTITY_TYPES.EXPENSE,
        entityId: exp.id,
        metadata: {
          description: exp.description,
          amountMinor: exp.amountMinor,
          currencyCode: exp.currencyCode,
        },
        createdAt: new Date(),
      });

      return true;
    };

    if ("transaction" in client && typeof client.transaction === "function") {
      return (client as typeof db).transaction(execute);
    }
    return execute(client);
  }

  /**
   * Find all active expenses with splits for a group (unpaginated, for balance calculation).
   */
  async findGroupExpensesWithSplits(
    groupId: string,
    client: DbOrTx = db
  ): Promise<(Expense & { splits: ExpenseSplit[] })[]> {
    const rawExpenses = await client
      .select()
      .from(expenses)
      .where(
        and(
          eq(expenses.groupId, groupId),
          eq(expenses.isDeleted, false)
        )
      )
      .orderBy(expenses.date, expenses.createdAt);

    if (rawExpenses.length === 0) {
      return [];
    }

    const expenseIds = rawExpenses.map((e) => e.id);
    const allSplits = await Promise.all(
      expenseIds.map((eid) =>
        client
          .select()
          .from(expenseSplits)
          .where(eq(expenseSplits.expenseId, eid))
      )
    );

    const splitsMap = new Map<string, ExpenseSplit[]>();
    for (let i = 0; i < expenseIds.length; i++) {
      splitsMap.set(expenseIds[i], allSplits[i] ?? []);
    }

    return rawExpenses.map((exp) => ({
      ...exp,
      splits: splitsMap.get(exp.id) ?? [],
    }));
  }
}

export const expenseRepository = new ExpenseRepository();
