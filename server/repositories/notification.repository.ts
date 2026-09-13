import { eq, and, isNull, desc, count, sql } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  notifications,
  type Notification,
  type NewNotification,
} from "../db/schema/index.js";
import type { DbOrTx } from "./types.js";

export interface ListNotificationOptions {
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
  type?: string;
}

export interface ListNotificationResult {
  notifications: Notification[];
  total: number;
}

/**
 * Repository for notifications persistence and querying.
 * - Enforces recipient-scoped isolation.
 * - Deterministically sorts by createdAt descending, id descending.
 * - Executes unread counts and batch updates directly in the database.
 * - Applies bounded pagination.
 */
export class NotificationRepository {
  /**
   * Find a notification by unique ID.
   */
  async findById(id: string, client: DbOrTx = db): Promise<Notification | null> {
    const results = await client
      .select()
      .from(notifications)
      .where(eq(notifications.id, id))
      .limit(1);

    return results[0] ?? null;
  }

  /**
   * List notifications scoped strictly to a specific recipient user.
   */
  async listByRecipientId(
    recipientId: string,
    options: ListNotificationOptions = {},
    client: DbOrTx = db
  ): Promise<ListNotificationResult> {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const offset = Math.max(options.offset ?? 0, 0);

    const conditions = [eq(notifications.recipientId, recipientId)];

    if (options.unreadOnly) {
      conditions.push(isNull(notifications.readAt));
    }

    if (options.type) {
      conditions.push(eq(notifications.type, options.type));
    }

    const whereClause = and(...conditions);

    const [notifList, totalCount] = await Promise.all([
      client
        .select()
        .from(notifications)
        .where(whereClause)
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(limit)
        .offset(offset),
      client
        .select({ value: count() })
        .from(notifications)
        .where(whereClause),
    ]);

    return {
      notifications: notifList,
      total: Number(totalCount[0]?.value ?? 0),
    };
  }

  /**
   * Efficiently get the count of unread notifications for a recipient using SQL count().
   * Does NOT load notification records into memory.
   */
  async getUnreadCount(recipientId: string, client: DbOrTx = db): Promise<number> {
    const results = await client
      .select({ value: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.recipientId, recipientId),
          isNull(notifications.readAt)
        )
      );

    return Number(results[0]?.value ?? 0);
  }

  /**
   * Mark a notification as read (readAt = NOW()) scoped strictly to the recipient.
   * If already read, updates/retains read status idempotently.
   */
  async markAsRead(
    id: string,
    recipientId: string,
    client: DbOrTx = db
  ): Promise<Notification | null> {
    const existing = await client
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.recipientId, recipientId)
        )
      )
      .limit(1);

    if (!existing[0]) {
      return null;
    }

    // If already read, return as is (idempotent)
    if (existing[0].readAt !== null) {
      return existing[0];
    }

    const updated = await client
      .update(notifications)
      .set({ readAt: sql`NOW()` })
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.recipientId, recipientId)
        )
      )
      .returning();

    return updated[0] ?? null;
  }

  /**
   * Mark a notification as unread (readAt = NULL) scoped strictly to the recipient.
   * If already unread, returns existing record idempotently.
   */
  async markAsUnread(
    id: string,
    recipientId: string,
    client: DbOrTx = db
  ): Promise<Notification | null> {
    const existing = await client
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.recipientId, recipientId)
        )
      )
      .limit(1);

    if (!existing[0]) {
      return null;
    }

    // If already unread, return as is (idempotent)
    if (existing[0].readAt === null) {
      return existing[0];
    }

    const updated = await client
      .update(notifications)
      .set({ readAt: null })
      .where(
        and(
          eq(notifications.id, id),
          eq(notifications.recipientId, recipientId)
        )
      )
      .returning();

    return updated[0] ?? null;
  }

  /**
   * Batch mark all unread notifications as read for a recipient.
   * Efficiently executes in the database without loading records into memory.
   */
  async markAllAsRead(recipientId: string, client: DbOrTx = db): Promise<number> {
    const updated = await client
      .update(notifications)
      .set({ readAt: sql`NOW()` })
      .where(
        and(
          eq(notifications.recipientId, recipientId),
          isNull(notifications.readAt)
        )
      )
      .returning({ id: notifications.id });

    return updated.length;
  }

  /**
   * Create a new notification record in the database.
   */
  async create(
    data: NewNotification,
    client: DbOrTx = db
  ): Promise<Notification> {
    const results = await client
      .insert(notifications)
      .values(data)
      .returning();

    const created = results[0];
    if (!created) {
      throw new Error("Failed to insert notification record");
    }

    return created;
  }
}

export const notificationRepository = new NotificationRepository();
