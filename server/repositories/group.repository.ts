import { eq, and, desc } from "drizzle-orm";
import { db } from "../db/client.js";
import {
  groups,
  groupMembers,
  users,
  type Group,
  type NewGroup,
  type GroupMember,
  type User,
  GROUP_ROLES,
} from "../db/schema/index.js";
import type { DbOrTx } from "./types.js";

export interface UserGroupMembership {
  group: Group;
  role: string;
}

export interface GroupMemberWithProfile {
  member: GroupMember;
  user: User;
}

/**
 * Repository for group persistence and membership operations.
 * - Isolated from HTTP concerns.
 * - Accepts optional transaction handle for atomic operations.
 */
export class GroupRepository {
  /**
   * Find a group by primary key ID.
   */
  async findById(id: string, client: DbOrTx = db): Promise<Group | null> {
    const results = await client
      .select()
      .from(groups)
      .where(eq(groups.id, id))
      .limit(1);

    return results[0] ?? null;
  }

  /**
   * List all active groups where the specified user is a member.
   * Returns group metadata and the user's role in that group.
   */
  async listByUserId(
    userId: string,
    includeArchived: boolean = false,
    client: DbOrTx = db
  ): Promise<UserGroupMembership[]> {
    const conditions = [eq(groupMembers.userId, userId)];
    if (!includeArchived) {
      conditions.push(eq(groups.isArchived, false));
    }

    const results = await client
      .select({
        group: groups,
        role: groupMembers.role,
      })
      .from(groupMembers)
      .innerJoin(groups, eq(groupMembers.groupId, groups.id))
      .where(and(...conditions))
      .orderBy(desc(groups.createdAt));

    return results;
  }

  /**
   * Creates a group and automatically registers the creator as an admin member.
   * Runs atomically within a database transaction.
   */
  async createWithCreator(
    data: NewGroup,
    creatorId: string,
    initialMemberIds: string[] = [],
    client: DbOrTx = db
  ): Promise<Group> {
    return client.transaction(async (tx) => {
      const insertedGroups = await tx
        .insert(groups)
        .values({
          ...data,
          createdById: creatorId,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      const createdGroup = insertedGroups[0];
      if (!createdGroup) {
        throw new Error("Failed to insert group record");
      }

      // Add creator as admin member
      await tx.insert(groupMembers).values({
        groupId: createdGroup.id,
        userId: creatorId,
        role: GROUP_ROLES.ADMIN,
        joinedAt: new Date(),
      });

      // Add unique initial members if specified (excluding creator)
      const uniqueInitialMembers = Array.from(
        new Set(initialMemberIds.filter((id) => id !== creatorId))
      );

      if (uniqueInitialMembers.length > 0) {
        await tx.insert(groupMembers).values(
          uniqueInitialMembers.map((memberId) => ({
            groupId: createdGroup.id,
            userId: memberId,
            role: GROUP_ROLES.MEMBER,
            joinedAt: new Date(),
          }))
        );
      }

      return createdGroup;
    });
  }

  /**
   * Updates group metadata.
   */
  async update(
    id: string,
    data: Partial<NewGroup>,
    client: DbOrTx = db
  ): Promise<Group | null> {
    const results = await client
      .update(groups)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(groups.id, id))
      .returning();

    return results[0] ?? null;
  }

  /**
   * Finds a specific membership record by groupId and userId.
   */
  async findMembership(
    groupId: string,
    userId: string,
    client: DbOrTx = db
  ): Promise<GroupMember | null> {
    const results = await client
      .select()
      .from(groupMembers)
      .where(
        and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId))
      )
      .limit(1);

    return results[0] ?? null;
  }

  /**
   * Lists all members of a group with their associated user profiles.
   */
  async listMembers(
    groupId: string,
    client: DbOrTx = db
  ): Promise<GroupMemberWithProfile[]> {
    const results = await client
      .select({
        member: groupMembers,
        user: users,
      })
      .from(groupMembers)
      .innerJoin(users, eq(groupMembers.userId, users.id))
      .where(eq(groupMembers.groupId, groupId))
      .orderBy(groupMembers.joinedAt);

    return results;
  }

  /**
   * Adds a user to a group.
   */
  async addMember(
    groupId: string,
    userId: string,
    role: string = GROUP_ROLES.MEMBER,
    client: DbOrTx = db
  ): Promise<GroupMember> {
    const results = await client
      .insert(groupMembers)
      .values({
        groupId,
        userId,
        role,
        joinedAt: new Date(),
      })
      .returning();

    const created = results[0];
    if (!created) {
      throw new Error("Failed to insert group member record");
    }
    return created;
  }

  /**
   * Removes a member from a group.
   */
  async removeMember(
    groupId: string,
    userId: string,
    client: DbOrTx = db
  ): Promise<boolean> {
    const results = await client
      .delete(groupMembers)
      .where(
        and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId))
      )
      .returning({ id: groupMembers.id });

    return results.length > 0;
  }
}

export const groupRepository = new GroupRepository();
