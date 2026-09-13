import { eq, and, or, ilike, ne } from "drizzle-orm";
import { db } from "../db/client.js";
import { users, type User, type NewUser } from "../db/schema/index.js";
import type { DbOrTx } from "./types.js";

/**
 * Repository for user persistence operations.
 * - Isolated from HTTP concerns.
 * - Accepts an optional transaction handle for atomic operations.
 */
export class UserRepository {
  /**
   * Find a user by stable ID.
   */
  async findById(id: string, client: DbOrTx = db): Promise<User | null> {
    const results = await client
      .select()
      .from(users)
      .where(eq(users.id, id))
      .limit(1);

    return results[0] ?? null;
  }

  /**
   * Find a user by unique email address.
   */
  async findByEmail(email: string, client: DbOrTx = db): Promise<User | null> {
    const results = await client
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    return results[0] ?? null;
  }

  /**
   * Update user profile attributes.
   */
  async update(
    id: string,
    data: Partial<NewUser>,
    client: DbOrTx = db
  ): Promise<User | null> {
    const results = await client
      .update(users)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id))
      .returning();

    return results[0] ?? null;
  }

  /**
   * Search users by matching name or email (case-insensitive substring).
   * Excludes the searching user (actor).
   */
  async searchUsers(
    query: string,
    excludeUserId?: string,
    limit: number = 20,
    client: DbOrTx = db
  ): Promise<User[]> {
    const trimmed = query.trim();
    if (!trimmed) {
      return [];
    }
    const pattern = `%${trimmed}%`;
    const searchCondition = or(
      ilike(users.name, pattern),
      ilike(users.email, pattern)
    );

    const condition = excludeUserId
      ? and(searchCondition, ne(users.id, excludeUserId))
      : searchCondition;

    return client
      .select()
      .from(users)
      .where(condition)
      .limit(Math.min(Math.max(1, limit), 50));
  }
}

export const userRepository = new UserRepository();
