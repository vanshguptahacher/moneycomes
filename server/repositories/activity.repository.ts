import { eq, and, or, inArray, isNull, desc, count } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  activityEvents,
  type ActivityEvent,
  type NewActivityEvent,
} from "../db/schema/index.js";
import type { DbOrTx } from "./types.js";

export interface ListActivityOptions {
  limit?: number;
  offset?: number;
  type?: string;
  entityType?: string;
}

export interface ListActivityResult {
  activities: ActivityEvent[];
  total: number;
}

/**
 * Repository for activity events persistence and querying.
 * - Isolated from HTTP and routing concerns.
 * - Deterministically sorts by createdAt descending, id descending.
 * - Enforces bounded pagination.
 */
export class ActivityRepository {
  /**
   * Find an activity event by unique ID.
   */
  async findById(id: string, client: DbOrTx = db): Promise<ActivityEvent | null> {
    const results = await client
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.id, id))
      .limit(1);

    return results[0] ?? null;
  }

  /**
   * List activity events scoped to a specific group.
   */
  async listByGroupId(
    groupId: string,
    options: ListActivityOptions = {},
    client: DbOrTx = db
  ): Promise<ListActivityResult> {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const offset = Math.max(options.offset ?? 0, 0);

    const conditions = [eq(activityEvents.groupId, groupId)];
    if (options.type) {
      conditions.push(eq(activityEvents.type, options.type));
    }
    if (options.entityType) {
      conditions.push(eq(activityEvents.entityType, options.entityType));
    }

    const whereClause = and(...conditions);

    const countResults = await client
      .select({ total: count() })
      .from(activityEvents)
      .where(whereClause);

    const total = Number(countResults[0]?.total ?? 0);

    const results = await client
      .select()
      .from(activityEvents)
      .where(whereClause)
      .orderBy(desc(activityEvents.createdAt), desc(activityEvents.id))
      .limit(limit)
      .offset(offset);

    return {
      activities: results,
      total,
    };
  }

  /**
   * List activity events for a user across their authorized groups.
   */
  async listForUser(
    userId: string,
    userGroupIds: string[],
    options: ListActivityOptions = {},
    client: DbOrTx = db
  ): Promise<ListActivityResult> {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const offset = Math.max(options.offset ?? 0, 0);

    // If user belongs to no groups, only personal activity (null groupId and actorId === userId) applies
    const scopeCondition =
      userGroupIds.length > 0
        ? or(
            inArray(activityEvents.groupId, userGroupIds),
            and(isNull(activityEvents.groupId), eq(activityEvents.actorId, userId))
          )
        : and(isNull(activityEvents.groupId), eq(activityEvents.actorId, userId));

    const filterConditions = [];
    if (options.type) {
      filterConditions.push(eq(activityEvents.type, options.type));
    }
    if (options.entityType) {
      filterConditions.push(eq(activityEvents.entityType, options.entityType));
    }

    const whereClause =
      filterConditions.length > 0
        ? and(scopeCondition, ...filterConditions)
        : scopeCondition;

    const countResults = await client
      .select({ total: count() })
      .from(activityEvents)
      .where(whereClause);

    const total = Number(countResults[0]?.total ?? 0);

    const results = await client
      .select()
      .from(activityEvents)
      .where(whereClause)
      .orderBy(desc(activityEvents.createdAt), desc(activityEvents.id))
      .limit(limit)
      .offset(offset);

    return {
      activities: results,
      total,
    };
  }

  /**
   * Persists an activity event.
   */
  async create(
    data: NewActivityEvent,
    client: DbOrTx = db
  ): Promise<ActivityEvent> {
    const inserted = await client
      .insert(activityEvents)
      .values(data)
      .returning();

    const record = inserted[0];
    if (!record) {
      throw new Error("Failed to insert activity event record");
    }

    return record;
  }
}

export const activityRepository = new ActivityRepository();
