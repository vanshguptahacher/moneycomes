import { eq, and, desc, count } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  settlements,
  activityEvents,
  type Settlement,
  type NewSettlement,
  ACTIVITY_EVENT_TYPES,
  ACTIVITY_ENTITY_TYPES,
} from "../db/schema/index.js";
import type { DbOrTx } from "./types.js";

export interface ListSettlementsOptions {
  limit?: number;
  offset?: number;
}

export interface ListSettlementsResult {
  settlements: Settlement[];
  total: number;
}

/**
 * Repository for settlements persistence and transactional operations.
 * - Isolated from HTTP and routing concerns.
 * - Manages atomic creation, update, and deletion of settlements with activity events.
 * - Accepts optional DbOrTx handle for transaction composability.
 */
export class SettlementRepository {
  /**
   * Find a settlement by its unique identifier.
   */
  async findById(id: string, client: DbOrTx = db): Promise<Settlement | null> {
    const results = await client
      .select()
      .from(settlements)
      .where(eq(settlements.id, id))
      .limit(1);

    return results[0] ?? null;
  }

  /**
   * List settlements for a specific group with deterministic ordering and pagination.
   */
  async listByGroupId(
    groupId: string,
    options: ListSettlementsOptions = {},
    client: DbOrTx = db
  ): Promise<ListSettlementsResult> {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const offset = Math.max(options.offset ?? 0, 0);

    const countResults = await client
      .select({ total: count() })
      .from(settlements)
      .where(eq(settlements.groupId, groupId));

    const total = Number(countResults[0]?.total ?? 0);

    const results = await client
      .select()
      .from(settlements)
      .where(eq(settlements.groupId, groupId))
      .orderBy(desc(settlements.settledAt), desc(settlements.createdAt))
      .limit(limit)
      .offset(offset);

    return {
      settlements: results,
      total,
    };
  }

  /**
   * Atomically creates a settlement and its corresponding activity event.
   * Rolls back completely if either operation fails.
   */
  async createWithActivity(
    data: NewSettlement,
    actorId: string,
    client: DbOrTx = db
  ): Promise<Settlement> {
    return client.transaction(async (tx) => {
      const inserted = await tx
        .insert(settlements)
        .values(data)
        .returning();

      const created = inserted[0];
      if (!created) {
        throw new Error("Failed to insert settlement record");
      }

      await tx.insert(activityEvents).values({
        type: ACTIVITY_EVENT_TYPES.SETTLEMENT_CREATED,
        actorId,
        groupId: created.groupId,
        entityType: ACTIVITY_ENTITY_TYPES.SETTLEMENT,
        entityId: created.id,
        metadata: {
          amountMinor: created.amountMinor,
          currencyCode: created.currencyCode,
          payerId: created.payerId,
          receiverId: created.receiverId,
          notes: created.notes,
        },
        createdAt: new Date(),
      });

      return created;
    });
  }

  /**
   * Atomically updates a settlement and records a settlement_updated activity event.
   */
  async updateWithActivity(
    id: string,
    data: Partial<NewSettlement>,
    actorId: string,
    client: DbOrTx = db
  ): Promise<Settlement | null> {
    return client.transaction(async (tx) => {
      const updated = await tx
        .update(settlements)
        .set(data)
        .where(eq(settlements.id, id))
        .returning();

      const record = updated[0];
      if (!record) {
        return null;
      }

      await tx.insert(activityEvents).values({
        type: ACTIVITY_EVENT_TYPES.SETTLEMENT_UPDATED,
        actorId,
        groupId: record.groupId,
        entityType: ACTIVITY_ENTITY_TYPES.SETTLEMENT,
        entityId: record.id,
        metadata: {
          amountMinor: record.amountMinor,
          currencyCode: record.currencyCode,
          notes: record.notes,
        },
        createdAt: new Date(),
      });

      return record;
    });
  }

  /**
   * Atomically deletes a settlement from a group and records a settlement_deleted activity event.
   */
  async deleteWithActivity(
    id: string,
    groupId: string,
    actorId: string,
    client: DbOrTx = db
  ): Promise<boolean> {
    return client.transaction(async (tx) => {
      const deleted = await tx
        .delete(settlements)
        .where(and(eq(settlements.id, id), eq(settlements.groupId, groupId)))
        .returning();

      const record = deleted[0];
      if (!record) {
        return false;
      }

      await tx.insert(activityEvents).values({
        type: ACTIVITY_EVENT_TYPES.SETTLEMENT_DELETED,
        actorId,
        groupId,
        entityType: ACTIVITY_ENTITY_TYPES.SETTLEMENT,
        entityId: id,
        metadata: {
          amountMinor: record.amountMinor,
          currencyCode: record.currencyCode,
          payerId: record.payerId,
          receiverId: record.receiverId,
        },
        createdAt: new Date(),
      });

      return true;
    });
  }

  /**
   * Find all settlements for a group (unpaginated, for balance calculation).
   */
  async findGroupSettlementsAll(
    groupId: string,
    client: DbOrTx = db
  ): Promise<Settlement[]> {
    return client
      .select()
      .from(settlements)
      .where(eq(settlements.groupId, groupId))
      .orderBy(settlements.settledAt, settlements.createdAt);
  }
}

export const settlementRepository = new SettlementRepository();
