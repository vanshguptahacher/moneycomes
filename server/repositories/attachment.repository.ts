import { eq, desc, count } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  attachments,
  type Attachment,
  type NewAttachment,
} from "../db/schema/index.js";
import type { DbOrTx } from "./types.js";

/**
 * Repository for attachments persistence and querying.
 * - Enforces deterministic ordering (createdAt descending, id descending).
 * - Scoped to parent expense.
 */
export class AttachmentRepository {
  /**
   * Find an attachment by unique ID.
   */
  async findById(id: string, client: DbOrTx = db): Promise<Attachment | null> {
    const results = await client
      .select()
      .from(attachments)
      .where(eq(attachments.id, id))
      .limit(1);

    return results[0] ?? null;
  }

  /**
   * List all attachments belonging to a specific expense.
   */
  async listByExpenseId(
    expenseId: string,
    client: DbOrTx = db
  ): Promise<Attachment[]> {
    return client
      .select()
      .from(attachments)
      .where(eq(attachments.expenseId, expenseId))
      .orderBy(desc(attachments.createdAt), desc(attachments.id));
  }

  /**
   * Count total attachments for an expense.
   */
  async countByExpenseId(
    expenseId: string,
    client: DbOrTx = db
  ): Promise<number> {
    const results = await client
      .select({ value: count() })
      .from(attachments)
      .where(eq(attachments.expenseId, expenseId));

    return Number(results[0]?.value ?? 0);
  }

  /**
   * Insert a new attachment metadata record.
   */
  async create(
    data: NewAttachment,
    client: DbOrTx = db
  ): Promise<Attachment> {
    const results = await client
      .insert(attachments)
      .values(data)
      .returning();

    const created = results[0];
    if (!created) {
      throw new Error("Failed to insert attachment record");
    }

    return created;
  }

  /**
   * Delete an attachment metadata record by ID.
   */
  async delete(id: string, client: DbOrTx = db): Promise<boolean> {
    const deleted = await client
      .delete(attachments)
      .where(eq(attachments.id, id))
      .returning({ id: attachments.id });

    return deleted.length > 0;
  }
}

export const attachmentRepository = new AttachmentRepository();
