import { ForbiddenError, NotFoundError, ValidationError } from "../errors/index.js";
import { userRepository, type UserRepository } from "../repositories/index.js";
import type { User, NewUser } from "../db/schema/index.js";

/**
 * Application service for user profile workflows.
 * - Orchestrates use cases and authorization checks.
 * - Free of HTTP or framework dependencies.
 */
export class UserService {
  constructor(private userRepo: UserRepository = userRepository) {}

  /**
   * Retrieves a user profile by ID, verifying that the actor has permission to view it.
   */
  async getUserById(actorId: string, targetUserId: string): Promise<User> {
    if (!actorId) {
      throw new ForbiddenError("Authenticated actor identity is required");
    }

    const user = await this.userRepo.findById(targetUserId);
    if (!user) {
      throw new NotFoundError(`User with ID ${targetUserId} was not found`);
    }

    // Authorization policy: A user can always view their own profile.
    // In future phases, friendship or group membership will allow viewing co-members.
    if (actorId !== targetUserId) {
      throw new ForbiddenError("You do not have permission to view this user profile");
    }

    return user;
  }

  /**
   * Updates user profile fields, strictly enforcing that a user can only edit their own profile.
   */
  async updateProfile(
    actorId: string,
    targetUserId: string,
    updates: Partial<Pick<NewUser, "name" | "image" | "defaultCurrencyCode">>
  ): Promise<User> {
    if (!actorId) {
      throw new ForbiddenError("Authenticated actor identity is required");
    }

    // Authorization policy: Only the owner can modify their profile
    if (actorId !== targetUserId) {
      throw new ForbiddenError("You cannot modify another user's profile");
    }

    const existingUser = await this.userRepo.findById(targetUserId);
    if (!existingUser) {
      throw new NotFoundError(`User with ID ${targetUserId} was not found`);
    }

    const updated = await this.userRepo.update(targetUserId, updates);
    if (!updated) {
      throw new NotFoundError(`Failed to update user profile for ${targetUserId}`);
    }

    return updated;
  }

  /**
   * Searches permitted users for friend adding/discovery.
   * Requires authenticated actor.
   * Enforces minimum query length (>= 2 chars) to avoid unrestricted directory dumping.
   * Excludes the searching actor.
   */
  async searchUsers(
    actorId: string,
    query: string,
    limit: number = 20
  ): Promise<User[]> {
    if (!actorId) {
      throw new ForbiddenError("Authenticated actor identity is required");
    }

    const trimmed = query?.trim() ?? "";
    if (trimmed.length < 2) {
      throw new ValidationError("Search query must be at least 2 characters long");
    }
    if (trimmed.length > 100) {
      throw new ValidationError("Search query cannot exceed 100 characters");
    }

    return this.userRepo.searchUsers(trimmed, actorId, limit);
  }
}

export const userService = new UserService();
