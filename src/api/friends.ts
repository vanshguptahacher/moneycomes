import { apiRequest } from "./client.js";
import type { UserProfile } from "./users.js";

export interface BilateralBalance {
  amountMinor: number;
  currency: string;
}

export interface FriendSummary {
  id: string;
  friend: UserProfile;
  status: string;
  balance: BilateralBalance;
  createdAt: string;
  updatedAt: string;
}

export interface CreateFriendshipInput {
  friendId: string;
}

/**
 * Searches permitted users by name or email for friend discovery.
 */
export async function searchUsers(
  query: string,
  limit: number = 20
): Promise<UserProfile[]> {
  const params = new URLSearchParams({
    q: query,
    limit: String(limit),
  });
  return apiRequest<UserProfile[]>(`/api/v1/users/search?${params.toString()}`, {
    method: "GET",
  });
}

/**
 * Retrieves the current authenticated user's friends list with bilateral balances.
 * Optionally filters by query substring matching name or email.
 */
export async function getFriends(query?: string): Promise<FriendSummary[]> {
  const endpoint = query?.trim()
    ? `/api/v1/friends?q=${encodeURIComponent(query.trim())}`
    : "/api/v1/friends";

  return apiRequest<FriendSummary[]>(endpoint, {
    method: "GET",
  });
}

/**
 * Creates a mutual friendship between the authenticated user and another user.
 */
export async function addFriend(friendId: string): Promise<FriendSummary> {
  return apiRequest<FriendSummary>("/api/v1/friends", {
    method: "POST",
    body: { friendId },
  });
}

/**
 * Retrieves details and bilateral balance of a specific friendship.
 */
export async function getFriend(idOrFriendUserId: string): Promise<FriendSummary> {
  return apiRequest<FriendSummary>(
    `/api/v1/friends/${encodeURIComponent(idOrFriendUserId)}`,
    {
      method: "GET",
    }
  );
}

/**
 * Removes a friendship relationship.
 */
export async function removeFriend(
  idOrFriendUserId: string
): Promise<{ success: boolean; message: string }> {
  return apiRequest<{ success: boolean; message: string }>(
    `/api/v1/friends/${encodeURIComponent(idOrFriendUserId)}`,
    {
      method: "DELETE",
    }
  );
}

/**
 * Retrieves the bilateral balance between the authenticated user and a friend.
 */
export async function getFriendBalance(
  idOrFriendUserId: string
): Promise<BilateralBalance> {
  return apiRequest<BilateralBalance>(
    `/api/v1/friends/${encodeURIComponent(idOrFriendUserId)}/balance`,
    {
      method: "GET",
    }
  );
}
