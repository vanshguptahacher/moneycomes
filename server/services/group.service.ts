import {
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
} from "../errors/index.js";
import {
  groupRepository,
  userRepository,
  type GroupRepository,
  type UserRepository,
} from "../repositories/index.js";
import {
  GROUP_ROLES,
  type Group,
  type GroupMember,
} from "../db/schema/index.js";

export interface SafeGroupMemberUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export interface GroupMemberResponse {
  id: string;
  groupId: string;
  role: string;
  joinedAt: string;
  user: SafeGroupMemberUser;
}

export interface GroupDetailResponse {
  id: string;
  name: string;
  description: string | null;
  defaultCurrencyCode: string;
  createdById: string;
  isArchived: boolean;
  role?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GroupSummaryResponse {
  id: string;
  name: string;
  description: string | null;
  defaultCurrencyCode: string;
  createdById: string;
  isArchived: boolean;
  role: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGroupInput {
  name: string;
  description?: string | null;
  defaultCurrencyCode?: string;
  memberUserIds?: string[];
}

export interface UpdateGroupInput {
  name?: string;
  description?: string | null;
  defaultCurrencyCode?: string;
  isArchived?: boolean;
}

const SUPPORTED_CURRENCIES = new Set(["INR", "USD", "EUR", "GBP", "JPY"]);

function formatGroupDetail(group: Group, role?: string): GroupDetailResponse {
  return {
    id: group.id,
    name: group.name,
    description: group.description ?? null,
    defaultCurrencyCode: group.defaultCurrencyCode,
    createdById: group.createdById,
    isArchived: group.isArchived,
    role,
    createdAt:
      group.createdAt instanceof Date
        ? group.createdAt.toISOString()
        : String(group.createdAt),
    updatedAt:
      group.updatedAt instanceof Date
        ? group.updatedAt.toISOString()
        : String(group.updatedAt),
  };
}

/**
 * Application service for group workflows, membership management, and authorization.
 * - Enforces zero-trust actor authorization.
 * - Orchestrates atomic operations and role security.
 * - Free of HTTP or framework dependencies.
 */
export class GroupService {
  constructor(
    private groupRepo: GroupRepository = groupRepository,
    private userRepo: UserRepository = userRepository
  ) {}

  /**
   * Creates a new group and automatically adds the creator as an admin member.
   * Runs atomically within a database transaction.
   */
  async createGroup(
    actorId: string,
    input: CreateGroupInput
  ): Promise<GroupDetailResponse> {
    if (!actorId) {
      throw new ForbiddenError("Authenticated actor identity is required");
    }

    const trimmedName = input.name?.trim();
    if (!trimmedName) {
      throw new ValidationError("Group name cannot be empty");
    }
    if (trimmedName.length > 255) {
      throw new ValidationError("Group name cannot exceed 255 characters");
    }

    const currency = input.defaultCurrencyCode
      ? input.defaultCurrencyCode.trim().toUpperCase()
      : "INR";

    if (!SUPPORTED_CURRENCIES.has(currency)) {
      throw new ValidationError(
        `Invalid defaultCurrencyCode: ${currency}. Must be one of: INR, USD, EUR, GBP, JPY`
      );
    }

    // Verify initial members exist if specified
    const initialMemberIds = input.memberUserIds ?? [];
    for (const memberId of initialMemberIds) {
      const existingUser = await this.userRepo.findById(memberId);
      if (!existingUser) {
        throw new NotFoundError(`User with ID ${memberId} was not found`);
      }
    }

    const group = await this.groupRepo.createWithCreator(
      {
        name: trimmedName,
        description: input.description?.trim() || null,
        defaultCurrencyCode: currency,
        createdById: actorId,
      },
      actorId,
      initialMemberIds
    );

    return formatGroupDetail(group, GROUP_ROLES.ADMIN);
  }

  /**
   * Retrieves all active groups for the authenticated user.
   */
  async getGroupsForUser(
    actorId: string,
    query?: string
  ): Promise<GroupSummaryResponse[]> {
    if (!actorId) {
      throw new ForbiddenError("Authenticated actor identity is required");
    }

    const memberships = await this.groupRepo.listByUserId(actorId);

    let filtered = memberships;
    if (query && query.trim()) {
      const q = query.trim().toLowerCase();
      filtered = memberships.filter((m) =>
        m.group.name.toLowerCase().includes(q)
      );
    }

    return filtered.map((m) => ({
      id: m.group.id,
      name: m.group.name,
      description: m.group.description ?? null,
      defaultCurrencyCode: m.group.defaultCurrencyCode,
      createdById: m.group.createdById,
      isArchived: m.group.isArchived,
      role: m.role,
      createdAt:
        m.group.createdAt instanceof Date
          ? m.group.createdAt.toISOString()
          : String(m.group.createdAt),
      updatedAt:
        m.group.updatedAt instanceof Date
          ? m.group.updatedAt.toISOString()
          : String(m.group.updatedAt),
    }));
  }

  /**
   * Retrieves group details by ID, verifying that the actor is a member.
   * Rejects non-members with 403 Forbidden.
   */
  async getGroupById(
    actorId: string,
    groupId: string
  ): Promise<GroupDetailResponse> {
    if (!actorId) {
      throw new ForbiddenError("Authenticated actor identity is required");
    }

    const trimmedGroupId = groupId?.trim();
    if (!trimmedGroupId) {
      throw new ValidationError("Group ID is required");
    }

    const group = await this.groupRepo.findById(trimmedGroupId);
    if (!group) {
      throw new NotFoundError(`Group with ID ${trimmedGroupId} was not found`);
    }

    // Authorization: Actor must be a member of the group
    const membership = await this.groupRepo.findMembership(trimmedGroupId, actorId);
    if (!membership) {
      throw new ForbiddenError("You do not have permission to view this group");
    }

    return formatGroupDetail(group, membership.role);
  }

  /**
   * Updates group metadata.
   * Only group admins or the group creator may update group details.
   */
  async updateGroup(
    actorId: string,
    groupId: string,
    updates: UpdateGroupInput
  ): Promise<GroupDetailResponse> {
    if (!actorId) {
      throw new ForbiddenError("Authenticated actor identity is required");
    }

    const trimmedGroupId = groupId?.trim();
    if (!trimmedGroupId) {
      throw new ValidationError("Group ID is required");
    }

    const group = await this.groupRepo.findById(trimmedGroupId);
    if (!group) {
      throw new NotFoundError(`Group with ID ${trimmedGroupId} was not found`);
    }

    // Authorization: Actor must be a member
    const membership = await this.groupRepo.findMembership(trimmedGroupId, actorId);
    if (!membership) {
      throw new ForbiddenError("You do not have permission to update this group");
    }

    // Role check: Only admin or creator can update
    if (membership.role !== GROUP_ROLES.ADMIN && group.createdById !== actorId) {
      throw new ForbiddenError("Only group admins can update group details");
    }

    const cleanData: Partial<Group> = {};

    if (updates.name !== undefined) {
      const trimmedName = updates.name.trim();
      if (!trimmedName) {
        throw new ValidationError("Group name cannot be empty");
      }
      if (trimmedName.length > 255) {
        throw new ValidationError("Group name cannot exceed 255 characters");
      }
      cleanData.name = trimmedName;
    }

    if (updates.description !== undefined) {
      cleanData.description = updates.description ? updates.description.trim() : null;
    }

    if (updates.defaultCurrencyCode !== undefined) {
      const currency = updates.defaultCurrencyCode.trim().toUpperCase();
      if (!SUPPORTED_CURRENCIES.has(currency)) {
        throw new ValidationError(
          `Invalid defaultCurrencyCode: ${currency}. Must be one of: INR, USD, EUR, GBP, JPY`
        );
      }
      cleanData.defaultCurrencyCode = currency;
    }

    if (updates.isArchived !== undefined) {
      cleanData.isArchived = updates.isArchived;
    }

    const updated = await this.groupRepo.update(trimmedGroupId, cleanData);
    if (!updated) {
      throw new NotFoundError(`Failed to update group ${trimmedGroupId}`);
    }

    return formatGroupDetail(updated, membership.role);
  }

  /**
   * Retrieves all members of a group with safe user profiles.
   * Actor must be a member of the group.
   */
  async getGroupMembers(
    actorId: string,
    groupId: string
  ): Promise<GroupMemberResponse[]> {
    if (!actorId) {
      throw new ForbiddenError("Authenticated actor identity is required");
    }

    const trimmedGroupId = groupId?.trim();
    if (!trimmedGroupId) {
      throw new ValidationError("Group ID is required");
    }

    const group = await this.groupRepo.findById(trimmedGroupId);
    if (!group) {
      throw new NotFoundError(`Group with ID ${trimmedGroupId} was not found`);
    }

    // Authorization: Actor must be a member
    const actorMembership = await this.groupRepo.findMembership(trimmedGroupId, actorId);
    if (!actorMembership) {
      throw new ForbiddenError("You do not have permission to view group members");
    }

    const members = await this.groupRepo.listMembers(trimmedGroupId);

    return members.map(({ member, user }) => ({
      id: member.id,
      groupId: member.groupId,
      role: member.role,
      joinedAt:
        member.joinedAt instanceof Date
          ? member.joinedAt.toISOString()
          : String(member.joinedAt),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image ?? null,
      },
    }));
  }

  /**
   * Adds an existing user to a group.
   * Actor must be an existing group member.
   * Rejects duplicate memberships with 409 Conflict.
   */
  async addMember(
    actorId: string,
    groupId: string,
    targetUserId: string,
    requestedRole: string = GROUP_ROLES.MEMBER
  ): Promise<GroupMemberResponse> {
    if (!actorId) {
      throw new ForbiddenError("Authenticated actor identity is required");
    }

    const trimmedGroupId = groupId?.trim();
    const trimmedTargetId = targetUserId?.trim();

    if (!trimmedGroupId) {
      throw new ValidationError("Group ID is required");
    }
    if (!trimmedTargetId) {
      throw new ValidationError("User ID is required");
    }

    const group = await this.groupRepo.findById(trimmedGroupId);
    if (!group) {
      throw new NotFoundError(`Group with ID ${trimmedGroupId} was not found`);
    }

    // Authorization: Actor must be a member
    const actorMembership = await this.groupRepo.findMembership(trimmedGroupId, actorId);
    if (!actorMembership) {
      throw new ForbiddenError("You do not have permission to add members to this group");
    }

    // Verify target user exists in canonical users table
    const targetUser = await this.userRepo.findById(trimmedTargetId);
    if (!targetUser) {
      throw new NotFoundError(`User with ID ${trimmedTargetId} was not found`);
    }

    // Application-level duplicate membership check
    const existingMembership = await this.groupRepo.findMembership(
      trimmedGroupId,
      trimmedTargetId
    );
    if (existingMembership) {
      throw new ConflictError("User is already a member of this group");
    }

    // Role Security: Only admins can assign the admin role; non-admins always add as "member"
    const assignedRole =
      actorMembership.role === GROUP_ROLES.ADMIN && requestedRole === GROUP_ROLES.ADMIN
        ? GROUP_ROLES.ADMIN
        : GROUP_ROLES.MEMBER;

    let member: GroupMember;
    try {
      member = await this.groupRepo.addMember(trimmedGroupId, trimmedTargetId, assignedRole);
    } catch (err: unknown) {
      if (
        err &&
        typeof err === "object" &&
        (("code" in err && err.code === "23505") ||
          ("message" in err && String(err.message).toLowerCase().includes("unique")))
      ) {
        throw new ConflictError("User is already a member of this group");
      }
      throw err;
    }

    return {
      id: member.id,
      groupId: member.groupId,
      role: member.role,
      joinedAt:
        member.joinedAt instanceof Date
          ? member.joinedAt.toISOString()
          : String(member.joinedAt),
      user: {
        id: targetUser.id,
        name: targetUser.name,
        email: targetUser.email,
        image: targetUser.image ?? null,
      },
    };
  }

  /**
   * Removes a member from a group.
   * Rules:
   * - A member may remove themselves (leave group), unless they are the group creator.
   * - A group admin may remove other members.
   * - An ordinary member cannot remove other members.
   * - The group creator cannot be removed from the group.
   */
  async removeMember(
    actorId: string,
    groupId: string,
    targetUserId: string
  ): Promise<{ success: boolean; message: string }> {
    if (!actorId) {
      throw new ForbiddenError("Authenticated actor identity is required");
    }

    const trimmedGroupId = groupId?.trim();
    const trimmedTargetId = targetUserId?.trim();

    if (!trimmedGroupId) {
      throw new ValidationError("Group ID is required");
    }
    if (!trimmedTargetId) {
      throw new ValidationError("User ID is required");
    }

    const group = await this.groupRepo.findById(trimmedGroupId);
    if (!group) {
      throw new NotFoundError(`Group with ID ${trimmedGroupId} was not found`);
    }

    // Target must actually be in the group
    const targetMembership = await this.groupRepo.findMembership(
      trimmedGroupId,
      trimmedTargetId
    );
    if (!targetMembership) {
      throw new NotFoundError(`Member with ID ${trimmedTargetId} was not found in this group`);
    }

    // Creator protection: Group creator cannot be removed from the group
    if (group.createdById === trimmedTargetId) {
      throw new ForbiddenError("The group creator cannot be removed from the group");
    }

    // Authorization checks:
    if (actorId === trimmedTargetId) {
      // Self-removal / leaving group
      await this.groupRepo.removeMember(trimmedGroupId, trimmedTargetId);
      return { success: true, message: "You have left the group successfully" };
    }

    // Removing another user: Actor must be a group admin or group creator
    const actorMembership = await this.groupRepo.findMembership(trimmedGroupId, actorId);
    if (!actorMembership) {
      throw new ForbiddenError("You do not have permission to remove members from this group");
    }

    if (actorMembership.role !== GROUP_ROLES.ADMIN && group.createdById !== actorId) {
      throw new ForbiddenError("Only group admins can remove other members");
    }

    await this.groupRepo.removeMember(trimmedGroupId, trimmedTargetId);
    return { success: true, message: "Member removed from group successfully" };
  }
}

export const groupService = new GroupService();
