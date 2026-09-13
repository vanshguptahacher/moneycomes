import {
  BadRequestError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../errors/index.js";
import {
  friendRepository,
  userRepository,
  type FriendRepository,
  type UserRepository,
  type BilateralBalance,
} from "../repositories/index.js";
import {
  FRIENDSHIP_STATUS,
  canonicalizeFriendshipPair,
  type Friendship,
  type User,
} from "../db/schema/index.js";

export interface SafeFriendProfile {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  defaultCurrencyCode: string;
  createdAt: string;
  updatedAt: string;
}

export interface FriendSummary {
  id: string;
  friend: SafeFriendProfile;
  status: string;
  balance: BilateralBalance;
  createdAt: string;
  updatedAt: string;
}

function formatSafeFriendProfile(user: User): SafeFriendProfile {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    emailVerified: user.emailVerified,
    image: user.image ?? null,
    defaultCurrencyCode: user.defaultCurrencyCode,
    createdAt: user.createdAt instanceof Date ? user.createdAt.toISOString() : String(user.createdAt),
    updatedAt: user.updatedAt instanceof Date ? user.updatedAt.toISOString() : String(user.updatedAt),
  };
}

/**
 * Application service for friendship workflows, authorization, and bilateral balances.
 * - Orchestrates use cases and authorization checks.
 * - Free of HTTP or framework dependencies.
 */
export class FriendService {
  constructor(
    private friendRepo: FriendRepository = friendRepository,
    private userRepo: UserRepository = userRepository
  ) {}

  /**
   * Creates a friendship relationship between the authenticated actor and another user.
   * Enforces self-friendship rejection, user existence, canonical pair ordering,
   * duplicate prevention, and database-level unique conflict handling.
   */
  async createFriendship(actorId: string, friendId: string): Promise<FriendSummary> {
    if (!actorId) {
      throw new ForbiddenError("Authenticated actor identity is required");
    }

    const trimmedFriendId = friendId?.trim();
    if (!trimmedFriendId) {
      throw new ValidationError("Friend user ID is required");
    }

    if (actorId === trimmedFriendId) {
      throw new BadRequestError("You cannot add yourself as a friend");
    }

    // 1. Verify target user exists
    const targetUser = await this.userRepo.findById(trimmedFriendId);
    if (!targetUser) {
      throw new NotFoundError(`User with ID ${trimmedFriendId} was not found`);
    }

    // 2. Canonicalize pair (userId1 < userId2)
    const { userId1, userId2 } = canonicalizeFriendshipPair(actorId, targetUser.id);

    // 3. Application-level duplicate check
    const existing = await this.friendRepo.findByPair(userId1, userId2);
    if (existing && existing.status === FRIENDSHIP_STATUS.ACTIVE) {
      throw new ConflictError("Friendship already exists with this user");
    }

    // 4. Persistence with database-level race protection
    let friendship: Friendship;
    try {
      friendship = await this.friendRepo.create({
        userId1,
        userId2,
        status: FRIENDSHIP_STATUS.ACTIVE,
      });
    } catch (err: unknown) {
      if (
        err &&
        typeof err === "object" &&
        (("code" in err && err.code === "23505") ||
          ("message" in err && String(err.message).toLowerCase().includes("unique")))
      ) {
        throw new ConflictError("Friendship already exists with this user");
      }
      throw err;
    }

    // 5. Bilateral balance (will be 0 for fresh friendship)
    const balance = await this.friendRepo.getBilateralBalance(actorId, targetUser.id);

    return {
      id: friendship.id,
      friend: formatSafeFriendProfile(targetUser),
      status: friendship.status,
      balance,
      createdAt:
        friendship.createdAt instanceof Date
          ? friendship.createdAt.toISOString()
          : String(friendship.createdAt),
      updatedAt:
        friendship.updatedAt instanceof Date
          ? friendship.updatedAt.toISOString()
          : String(friendship.updatedAt),
    };
  }

  /**
   * Retrieves all active friends of the authenticated actor with attached bilateral balances.
   * Supports optional search filtering and deterministic alphabetical sorting by friend name.
   */
  async getFriends(actorId: string, query?: string): Promise<FriendSummary[]> {
    if (!actorId) {
      throw new ForbiddenError("Authenticated actor identity is required");
    }

    const friendshipsList = await this.friendRepo.listByUserId(actorId);
    if (friendshipsList.length === 0) {
      return [];
    }

    const summaries: FriendSummary[] = [];

    for (const f of friendshipsList) {
      const friendUserId = f.userId1 === actorId ? f.userId2 : f.userId1;
      const friendUser = await this.userRepo.findById(friendUserId);

      if (!friendUser) {
        continue;
      }

      const balance = await this.friendRepo.getBilateralBalance(actorId, friendUserId);

      summaries.push({
        id: f.id,
        friend: formatSafeFriendProfile(friendUser),
        status: f.status,
        balance,
        createdAt:
          f.createdAt instanceof Date ? f.createdAt.toISOString() : String(f.createdAt),
        updatedAt:
          f.updatedAt instanceof Date ? f.updatedAt.toISOString() : String(f.updatedAt),
      });
    }

    // Optional query filtering by name or email
    let filtered = summaries;
    if (query && query.trim()) {
      const q = query.trim().toLowerCase();
      filtered = summaries.filter(
        (s) =>
          s.friend.name.toLowerCase().includes(q) ||
          s.friend.email.toLowerCase().includes(q)
      );
    }

    // Deterministic alphabetical sorting by friend name
    filtered.sort((a, b) => a.friend.name.localeCompare(b.friend.name));

    return filtered;
  }

  /**
   * Retrieves a specific friendship detail, verifying that the authenticated actor is a member of the friendship.
   * Rejects IDOR attempts to read unrelated friendships with 403 Forbidden.
   */
  async getFriendship(actorId: string, idOrFriendUserId: string): Promise<FriendSummary> {
    if (!actorId) {
      throw new ForbiddenError("Authenticated actor identity is required");
    }

    const trimmed = idOrFriendUserId?.trim();
    if (!trimmed) {
      throw new ValidationError("Friendship or user ID is required");
    }

    let friendship = await this.friendRepo.findById(trimmed);

    if (!friendship) {
      try {
        friendship = await this.friendRepo.findByPair(actorId, trimmed);
      } catch {
        // Not a valid pair or self-friendship
      }
    }

    if (!friendship) {
      throw new NotFoundError(`Friendship was not found`);
    }

    // IDOR Protection: Actor must be either party
    if (friendship.userId1 !== actorId && friendship.userId2 !== actorId) {
      throw new ForbiddenError("You do not have permission to view this friendship");
    }

    const friendUserId = friendship.userId1 === actorId ? friendship.userId2 : friendship.userId1;
    const friendUser = await this.userRepo.findById(friendUserId);
    if (!friendUser) {
      throw new NotFoundError(`Friend user profile was not found`);
    }

    const balance = await this.friendRepo.getBilateralBalance(actorId, friendUserId);

    return {
      id: friendship.id,
      friend: formatSafeFriendProfile(friendUser),
      status: friendship.status,
      balance,
      createdAt:
        friendship.createdAt instanceof Date
          ? friendship.createdAt.toISOString()
          : String(friendship.createdAt),
      updatedAt:
        friendship.updatedAt instanceof Date
          ? friendship.updatedAt.toISOString()
          : String(friendship.updatedAt),
    };
  }

  /**
   * Removes a friendship relationship.
   * Strictly enforces that only an involved party can remove the friendship.
   * Preserves all underlying expenses and settlements.
   */
  async removeFriendship(
    actorId: string,
    idOrFriendUserId: string
  ): Promise<{ success: boolean; message: string }> {
    if (!actorId) {
      throw new ForbiddenError("Authenticated actor identity is required");
    }

    const trimmed = idOrFriendUserId?.trim();
    if (!trimmed) {
      throw new ValidationError("Friendship or user ID is required");
    }

    let friendship = await this.friendRepo.findById(trimmed);

    if (!friendship) {
      try {
        friendship = await this.friendRepo.findByPair(actorId, trimmed);
      } catch {
        // Not a valid pair
      }
    }

    if (!friendship) {
      throw new NotFoundError(`Friendship was not found`);
    }

    // IDOR Protection: Actor must be an involved party
    if (friendship.userId1 !== actorId && friendship.userId2 !== actorId) {
      throw new ForbiddenError("You do not have permission to remove this friendship");
    }

    await this.friendRepo.delete(friendship.id);

    return {
      success: true,
      message: "Friendship removed successfully",
    };
  }

  /**
   * Retrieves the authoritative bilateral balance between the actor and a friend.
   */
  async getBilateralBalance(actorId: string, idOrFriendUserId: string): Promise<BilateralBalance> {
    const summary = await this.getFriendship(actorId, idOrFriendUserId);
    return summary.balance;
  }
}

export const friendService = new FriendService();
