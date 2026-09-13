import {
  ForbiddenError,
  NotFoundError,
  BadRequestError,
} from "../errors/index.js";
import {
  activityRepository,
  groupRepository,
  userRepository,
  type ActivityRepository,
  type GroupRepository,
  type UserRepository,
  type DbOrTx,
} from "../repositories/index.js";
import {
  type ActivityEvent,
  isActivityEventType,
  isActivityEntityType,
  validateActivityEventInput,
} from "../db/schema/index.js";

export interface SafeActivityUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export interface ActivityItemResponse {
  id: string;
  type: string;
  actorId: string;
  groupId: string | null;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  actor: SafeActivityUser;
}

export interface ActivityListResponse {
  activities: ActivityItemResponse[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListActivityServiceOptions {
  limit?: number;
  offset?: number;
  type?: string;
  entityType?: string;
}

/**
 * Service orchestrating activity retrieval, membership authorization,
 * cross-group data isolation, and safe user serialization.
 */
export class ActivityService {
  constructor(
    private activityRepo: ActivityRepository = activityRepository,
    private groupRepo: GroupRepository = groupRepository,
    private userRepo: UserRepository = userRepository
  ) {}

  /**
   * Helper to resolve safe actor profile representation.
   */
  private async getSafeUser(userId: string): Promise<SafeActivityUser> {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      return {
        id: userId,
        name: "Unknown User",
        email: "",
        image: null,
      };
    }
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    };
  }

  /**
   * Formats a raw database activity event into a safe client response.
   */
  private async formatActivityResponse(
    event: ActivityEvent
  ): Promise<ActivityItemResponse> {
    const actor = await this.getSafeUser(event.actorId);

    return {
      id: event.id,
      type: event.type,
      actorId: event.actorId,
      groupId: event.groupId,
      entityType: event.entityType,
      entityId: event.entityId,
      metadata: (event.metadata as Record<string, unknown>) ?? {},
      createdAt: event.createdAt.toISOString(),
      actor,
    };
  }

  /**
   * Validates filter options if provided.
   */
  private validateFilters(options?: ListActivityServiceOptions): void {
    if (!options) return;

    if (options.type !== undefined && options.type !== null) {
      const cleanType = String(options.type).trim();
      if (!isActivityEventType(cleanType)) {
        throw new BadRequestError(`Invalid activity type filter: "${cleanType}"`);
      }
    }

    if (options.entityType !== undefined && options.entityType !== null) {
      const cleanEntity = String(options.entityType).trim();
      if (!isActivityEntityType(cleanEntity)) {
        throw new BadRequestError(`Invalid activity entityType filter: "${cleanEntity}"`);
      }
    }
  }

  /**
   * Retrieves activity events scoped to a specific group.
   * Enforces server-side Better Auth group membership.
   */
  async getGroupActivity(
    actorId: string,
    groupId: string,
    options: ListActivityServiceOptions = {}
  ): Promise<ActivityListResponse> {
    // 1. Verify group exists
    const group = await this.groupRepo.findById(groupId);
    if (!group) {
      throw new NotFoundError("Group not found");
    }

    // 2. Verify actor is a member of the group
    const membership = await this.groupRepo.findMembership(groupId, actorId);
    if (!membership) {
      throw new ForbiddenError("You are not a member of this group");
    }

    // 3. Validate filters
    this.validateFilters(options);

    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const offset = Math.max(options.offset ?? 0, 0);

    // 4. Query repository
    const result = await this.activityRepo.listByGroupId(groupId, {
      ...options,
      limit,
      offset,
    });

    // 5. Format responses
    const formatted = await Promise.all(
      result.activities.map((item) => this.formatActivityResponse(item))
    );

    return {
      activities: formatted,
      total: result.total,
      limit,
      offset,
    };
  }

  /**
   * Retrieves activity events across all groups where the user is an active member.
   * Guarantees strict data isolation: unrelated group activity is never exposed.
   */
  async getUserActivity(
    actorId: string,
    options: ListActivityServiceOptions = {}
  ): Promise<ActivityListResponse> {
    // 1. Validate actor exists
    const user = await this.userRepo.findById(actorId);
    if (!user) {
      throw new NotFoundError("User not found");
    }

    // 2. Validate filters
    this.validateFilters(options);

    // 3. Retrieve user's authorized group IDs
    const memberships = await this.groupRepo.listByUserId(actorId);
    const userGroupIds = memberships.map((m) => m.group.id);

    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const offset = Math.max(options.offset ?? 0, 0);

    // 4. Query repository scoped strictly to user's authorized groups
    const result = await this.activityRepo.listForUser(actorId, userGroupIds, {
      ...options,
      limit,
      offset,
    });

    // 5. Format responses
    const formatted = await Promise.all(
      result.activities.map((item) => this.formatActivityResponse(item))
    );

    return {
      activities: formatted,
      total: result.total,
      limit,
      offset,
    };
  }

  /**
   * Logs an activity event with boundary validation.
   */
  async logEvent(
    data: {
      type: string;
      actorId: string;
      entityType: string;
      entityId: string;
      groupId?: string | null;
      metadata?: Record<string, unknown> | null;
      createdAt?: Date | null;
    },
    client?: DbOrTx
  ): Promise<ActivityEvent> {
    const validated = validateActivityEventInput(data);
    return this.activityRepo.create(validated, client);
  }
}

export const activityService = new ActivityService();
