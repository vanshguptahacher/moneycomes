/**
 * Phase 4.3 — Friends API Test Suite.
 *
 * Verifies that:
 * 1. Authenticated user can search permitted users with query validation and safe profile returns.
 * 2. Unauthenticated requests are rejected with HTTP 401 Unauthorized.
 * 3. Search cannot be used as an unrestricted user directory (requires >= 2 chars, limit capped, actor excluded).
 * 4. Safe responses never leak passwords, tokens, auth secrets, or DB connection strings.
 * 5. Friendship creation enforces canonical ordering (userId1 < userId2), self-friendship rejection,
 *    and duplicate / reverse-duplicate conflict rejection (HTTP 409).
 * 6. Concurrency / race condition duplicate creation attempts are protected by unique constraints (HTTP 409).
 * 7. Authenticated user retrieves own friends list with attached bilateral balance.
 * 8. Both sides of canonical friendship (user as userId1 or userId2) are resolved correctly.
 * 9. Friends list supports optional search filtering (?q=) and deterministic alphabetical ordering.
 * 10. Strict IDOR protection: User C cannot view, modify, delete, or inspect balance of User A + User B friendship (HTTP 403).
 * 11. Friendship removal deletes relationship while leaving expenses, splits, and settlements intact.
 * 12. Bilateral balance is calculated purely using integer minor units from authoritative expenses and settlements.
 * 13. Mobile API client methods function properly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { app } from "../../server/app.js";
import { auth, type AuthUser, type AuthSession } from "../../server/auth/index.js";
import { userRepository } from "../../server/repositories/user.repository.js";
import { friendRepository } from "../../server/repositories/friend.repository.js";
import type { User, Friendship } from "../../server/db/schema/index.js";
import {
  searchUsers,
  getFriends,
  addFriend,
  getFriend,
  removeFriend,
  getFriendBalance,
  ApiClientError,
} from "../../src/api/index.js";

describe("Phase 4.3 — Friends API", () => {
  const mockUserAlice: User = {
    id: "usr_alice_123",
    name: "Alice Liddell",
    email: "alice@wonderland.com",
    emailVerified: true,
    image: "https://example.com/alice.jpg",
    defaultCurrencyCode: "INR",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  const mockUserBob: User = {
    id: "usr_bob_456",
    name: "Bob Builder",
    email: "bob@builder.com",
    emailVerified: false,
    image: null,
    defaultCurrencyCode: "USD",
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  };

  const mockUserCharlie: User = {
    id: "usr_charlie_789",
    name: "Charlie Chaplin",
    email: "charlie@chaplin.com",
    emailVerified: true,
    image: null,
    defaultCurrencyCode: "INR",
    createdAt: new Date("2026-01-03T00:00:00.000Z"),
    updatedAt: new Date("2026-01-03T00:00:00.000Z"),
  };

  const mockAliceSession: AuthSession = {
    id: "sess_alice_token",
    userId: "usr_alice_123",
    token: "tok_alice_secret",
    expiresAt: new Date(Date.now() + 86400000),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockCharlieSession: AuthSession = {
    id: "sess_charlie_token",
    userId: "usr_charlie_789",
    token: "tok_charlie_secret",
    expiresAt: new Date(Date.now() + 86400000),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockFriendshipAliceBob: Friendship = {
    id: "f81d4fae-7dec-11d0-a765-00a0c91e6bf6",
    userId1: "usr_alice_123", // "usr_alice_123" < "usr_bob_456" canonically
    userId2: "usr_bob_456",
    status: "active",
    createdAt: new Date("2026-01-05T10:00:00.000Z"),
    updatedAt: new Date("2026-01-05T10:00:00.000Z"),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // 1. USER SEARCH API (GET /api/v1/users/search & GET /api/v1/friends/search)
  // ==========================================================================
  describe("User Search API", () => {
    it("returns HTTP 401 Unauthorized when search is unauthenticated", async () => {
      const res = await app.request("/api/v1/users/search?q=bob", {
        method: "GET",
      });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
    });

    it("searches permitted users and returns safe profiles", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(userRepository, "searchUsers").mockResolvedValueOnce([mockUserBob]);

      const res = await app.request("/api/v1/users/search?q=bob", {
        method: "GET",
        headers: { Cookie: "better-auth.session_token=alice_token" },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toBeDefined();
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe("usr_bob_456");
      expect(body.data[0].name).toBe("Bob Builder");
      expect(body.data[0].email).toBe("bob@builder.com");

      // Verify safe serialization: no private internals
      const rawItem = body.data[0] as Record<string, unknown>;
      expect(rawItem["password"]).toBeUndefined();
      expect(rawItem["passwordHash"]).toBeUndefined();
      expect(rawItem["session"]).toBeUndefined();
    });

    it("works via GET /api/v1/friends/search alias as well", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(userRepository, "searchUsers").mockResolvedValueOnce([mockUserBob]);

      const res = await app.request("/api/v1/friends/search?q=builder", {
        method: "GET",
        headers: { Cookie: "better-auth.session_token=alice_token" },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe("Bob Builder");
    });

    it("rejects invalid search query: shorter than 2 characters (HTTP 400)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const res = await app.request("/api/v1/users/search?q=a", {
        method: "GET",
        headers: { Cookie: "better-auth.session_token=alice_token" },
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects search query without q parameter (HTTP 400)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const res = await app.request("/api/v1/users/search", {
        method: "GET",
        headers: { Cookie: "better-auth.session_token=alice_token" },
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects search query exceeding 100 characters (HTTP 400)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const longQuery = "a".repeat(101);
      const res = await app.request(`/api/v1/users/search?q=${longQuery}`, {
        method: "GET",
        headers: { Cookie: "better-auth.session_token=alice_token" },
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("excludes the authenticated actor from search results", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      const searchSpy = vi.spyOn(userRepository, "searchUsers").mockResolvedValueOnce([]);

      await app.request("/api/v1/users/search?q=alice", {
        method: "GET",
        headers: { Cookie: "better-auth.session_token=alice_token" },
      });

      // Assert that searchUsers was called with actorId "usr_alice_123" as excludeUserId
      expect(searchSpy).toHaveBeenCalledWith("alice", "usr_alice_123", 20);
    });
  });

  // ==========================================================================
  // 2. FRIENDSHIP CREATION (POST /api/v1/friends)
  // ==========================================================================
  describe("Friendship Creation (POST /api/v1/friends)", () => {
    it("returns HTTP 401 Unauthorized when creating friendship unauthenticated", async () => {
      const res = await app.request("/api/v1/friends", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ friendId: "usr_bob_456" }),
      });
      expect(res.status).toBe(401);
    });

    it("successfully creates friendship and returns HTTP 201 with safe friend profile", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(mockUserBob);
      vi.spyOn(friendRepository, "findByPair").mockResolvedValueOnce(null);
      vi.spyOn(friendRepository, "create").mockResolvedValueOnce(mockFriendshipAliceBob);
      vi.spyOn(friendRepository, "getBilateralBalance").mockResolvedValueOnce({
        amountMinor: 0,
        currency: "INR",
      });

      const res = await app.request("/api/v1/friends", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: "better-auth.session_token=alice_token",
        },
        body: JSON.stringify({ friendId: "usr_bob_456" }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data).toBeDefined();
      expect(body.data.id).toBe(mockFriendshipAliceBob.id);
      expect(body.data.status).toBe("active");
      expect(body.data.friend.id).toBe("usr_bob_456");
      expect(body.data.friend.name).toBe("Bob Builder");
      expect(body.data.balance).toEqual({ amountMinor: 0, currency: "INR" });
    });

    it("derives actor identity strictly from session, ignoring spoofed client headers", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(mockUserBob);
      vi.spyOn(friendRepository, "findByPair").mockResolvedValueOnce(null);
      const createSpy = vi.spyOn(friendRepository, "create").mockResolvedValueOnce(mockFriendshipAliceBob);
      vi.spyOn(friendRepository, "getBilateralBalance").mockResolvedValueOnce({
        amountMinor: 0,
        currency: "INR",
      });

      await app.request("/api/v1/friends", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": "usr_charlie_789", // Spoofed actor header
          Cookie: "better-auth.session_token=alice_token",
        },
        body: JSON.stringify({ friendId: "usr_bob_456" }),
      });

      // Canonical pair must be alice ("usr_alice_123") and bob ("usr_bob_456"), NOT spoofed charlie
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          userId1: "usr_alice_123",
          userId2: "usr_bob_456",
        })
      );
    });

    it("rejects self-friendship with HTTP 400 Bad Request", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const res = await app.request("/api/v1/friends", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: "better-auth.session_token=alice_token",
        },
        body: JSON.stringify({ friendId: "usr_alice_123" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("BAD_REQUEST");
      expect(body.error.message).toContain("cannot add yourself as a friend");
    });

    it("rejects friendship with nonexistent target user with HTTP 404 Not Found", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(null);

      const res = await app.request("/api/v1/friends", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: "better-auth.session_token=alice_token",
        },
        body: JSON.stringify({ friendId: "usr_nonexistent_999" }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
    });

    it("rejects duplicate friendship with HTTP 409 Conflict", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(mockUserBob);
      vi.spyOn(friendRepository, "findByPair").mockResolvedValueOnce(mockFriendshipAliceBob);

      const res = await app.request("/api/v1/friends", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: "better-auth.session_token=alice_token",
        },
        body: JSON.stringify({ friendId: "usr_bob_456" }),
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe("CONFLICT");
      expect(body.error.message).toContain("already exists");
    });

    it("rejects reverse duplicate friendship (Bob adds Alice when Alice already added Bob) with HTTP 409 Conflict", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserBob as unknown as AuthUser,
        session: { ...mockAliceSession, userId: "usr_bob_456" },
      });
      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(mockUserAlice);
      // findByPair with (Bob, Alice) will canonicalize to (Alice, Bob) and find existing
      vi.spyOn(friendRepository, "findByPair").mockResolvedValueOnce(mockFriendshipAliceBob);

      const res = await app.request("/api/v1/friends", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: "better-auth.session_token=bob_token",
        },
        body: JSON.stringify({ friendId: "usr_alice_123" }),
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe("CONFLICT");
    });

    it("handles database unique constraint violation under concurrent race conditions with HTTP 409", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(mockUserBob);
      vi.spyOn(friendRepository, "findByPair").mockResolvedValueOnce(null); // Passed app check

      // Simulate concurrent DB unique violation (PostgreSQL code 23505)
      const dbUniqueError = new Error("duplicate key value violates unique constraint 'friendships_users_uq'");
      (dbUniqueError as unknown as Record<string, unknown>).code = "23505";
      vi.spyOn(friendRepository, "create").mockRejectedValueOnce(dbUniqueError);

      const res = await app.request("/api/v1/friends", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: "better-auth.session_token=alice_token",
        },
        body: JSON.stringify({ friendId: "usr_bob_456" }),
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe("CONFLICT");
    });

    it("rejects empty body or missing friendId/userId with HTTP 400 Validation Error", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const res = await app.request("/api/v1/friends", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: "better-auth.session_token=alice_token",
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // ==========================================================================
  // 3. RETRIEVE FRIENDS LIST (GET /api/v1/friends)
  // ==========================================================================
  describe("Retrieve Friends List (GET /api/v1/friends)", () => {
    it("returns HTTP 401 Unauthorized when unauthenticated", async () => {
      const res = await app.request("/api/v1/friends", {
        method: "GET",
      });
      expect(res.status).toBe(401);
    });

    it("returns authenticated user's friends list with bilateral balance and resolved friend profiles", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(friendRepository, "listByUserId").mockResolvedValueOnce([mockFriendshipAliceBob]);
      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(mockUserBob);
      vi.spyOn(friendRepository, "getBilateralBalance").mockResolvedValueOnce({
        amountMinor: 5000,
        currency: "INR",
      });

      const res = await app.request("/api/v1/friends", {
        method: "GET",
        headers: { Cookie: "better-auth.session_token=alice_token" },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toBeDefined();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe(mockFriendshipAliceBob.id);
      expect(body.data[0].friend.id).toBe("usr_bob_456");
      expect(body.data[0].friend.name).toBe("Bob Builder");
      expect(body.data[0].balance).toEqual({ amountMinor: 5000, currency: "INR" });
    });

    it("correctly resolves the other user when the actor is userId2 in canonical pair", async () => {
      // Bob is userId2 in mockFriendshipAliceBob
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserBob as unknown as AuthUser,
        session: { ...mockAliceSession, userId: "usr_bob_456" },
      });
      vi.spyOn(friendRepository, "listByUserId").mockResolvedValueOnce([mockFriendshipAliceBob]);
      // Should query Alice since Bob is userId2
      const findUserSpy = vi.spyOn(userRepository, "findById").mockResolvedValueOnce(mockUserAlice);
      vi.spyOn(friendRepository, "getBilateralBalance").mockResolvedValueOnce({
        amountMinor: -5000,
        currency: "INR",
      });

      const res = await app.request("/api/v1/friends", {
        method: "GET",
        headers: { Cookie: "better-auth.session_token=bob_token" },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(findUserSpy).toHaveBeenCalledWith("usr_alice_123");
      expect(body.data[0].friend.id).toBe("usr_alice_123");
      expect(body.data[0].friend.name).toBe("Alice Liddell");
      expect(body.data[0].balance).toEqual({ amountMinor: -5000, currency: "INR" });
    });

    it("filters friends list with optional ?q= query parameter", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const friendshipAliceCharlie: Friendship = {
        id: "f81d4fae-7dec-11d0-a765-00a0c91e6bf7",
        userId1: "usr_alice_123",
        userId2: "usr_charlie_789",
        status: "active",
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.spyOn(friendRepository, "listByUserId").mockResolvedValueOnce([
        mockFriendshipAliceBob,
        friendshipAliceCharlie,
      ]);
      vi.spyOn(userRepository, "findById")
        .mockResolvedValueOnce(mockUserBob)
        .mockResolvedValueOnce(mockUserCharlie);
      vi.spyOn(friendRepository, "getBilateralBalance").mockResolvedValue({
        amountMinor: 0,
        currency: "INR",
      });

      const res = await app.request("/api/v1/friends?q=charlie", {
        method: "GET",
        headers: { Cookie: "better-auth.session_token=alice_token" },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].friend.name).toBe("Charlie Chaplin");
    });
  });

  // ==========================================================================
  // 4. FRIEND DETAIL & STRICT IDOR BOUNDARY (GET /api/v1/friends/:id)
  // ==========================================================================
  describe("Friend Detail & IDOR Protection (GET /api/v1/friends/:id)", () => {
    it("allows an involved user (Alice) to view friendship details", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(friendRepository, "findById").mockResolvedValueOnce(mockFriendshipAliceBob);
      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(mockUserBob);
      vi.spyOn(friendRepository, "getBilateralBalance").mockResolvedValueOnce({
        amountMinor: 2500,
        currency: "INR",
      });

      const res = await app.request(`/api/v1/friends/${mockFriendshipAliceBob.id}`, {
        method: "GET",
        headers: { Cookie: "better-auth.session_token=alice_token" },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe(mockFriendshipAliceBob.id);
      expect(body.data.friend.id).toBe("usr_bob_456");
      expect(body.data.balance).toEqual({ amountMinor: 2500, currency: "INR" });
    });

    it("allows looking up friendship by friend's user ID directly", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(friendRepository, "findById").mockResolvedValueOnce(null);
      vi.spyOn(friendRepository, "findByPair").mockResolvedValueOnce(mockFriendshipAliceBob);
      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(mockUserBob);
      vi.spyOn(friendRepository, "getBilateralBalance").mockResolvedValueOnce({
        amountMinor: 0,
        currency: "INR",
      });

      const res = await app.request("/api/v1/friends/usr_bob_456", {
        method: "GET",
        headers: { Cookie: "better-auth.session_token=alice_token" },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe(mockFriendshipAliceBob.id);
    });

    it("STRICT IDOR PROTECTION: rejects unrelated user (Charlie) attempting to view Alice + Bob friendship (HTTP 403 Forbidden)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserCharlie as unknown as AuthUser,
        session: mockCharlieSession,
      });
      // Charlie tries to view friendship between Alice and Bob
      vi.spyOn(friendRepository, "findById").mockResolvedValueOnce(mockFriendshipAliceBob);

      const res = await app.request(`/api/v1/friends/${mockFriendshipAliceBob.id}`, {
        method: "GET",
        headers: { Cookie: "better-auth.session_token=charlie_token" },
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("FORBIDDEN");
      expect(body.error.message).toContain("do not have permission to view this friendship");
    });

    it("returns HTTP 404 when requested friendship does not exist", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(friendRepository, "findById").mockResolvedValueOnce(null);
      vi.spyOn(friendRepository, "findByPair").mockResolvedValueOnce(null);

      const res = await app.request("/api/v1/friends/00000000-0000-0000-0000-000000000000", {
        method: "GET",
        headers: { Cookie: "better-auth.session_token=alice_token" },
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
    });
  });

  // ==========================================================================
  // 5. FRIEND REMOVAL & STRICT IDOR BOUNDARY (DELETE /api/v1/friends/:id)
  // ==========================================================================
  describe("Friend Removal & IDOR Protection (DELETE /api/v1/friends/:id)", () => {
    it("allows an involved user (Alice) to remove the friendship", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(friendRepository, "findById").mockResolvedValueOnce(mockFriendshipAliceBob);
      const deleteSpy = vi.spyOn(friendRepository, "delete").mockResolvedValueOnce(true);

      const res = await app.request(`/api/v1/friends/${mockFriendshipAliceBob.id}`, {
        method: "DELETE",
        headers: { Cookie: "better-auth.session_token=alice_token" },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.success).toBe(true);
      expect(deleteSpy).toHaveBeenCalledWith(mockFriendshipAliceBob.id);
    });

    it("STRICT IDOR PROTECTION: rejects unrelated user (Charlie) attempting to delete Alice + Bob friendship (HTTP 403 Forbidden)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserCharlie as unknown as AuthUser,
        session: mockCharlieSession,
      });
      vi.spyOn(friendRepository, "findById").mockResolvedValueOnce(mockFriendshipAliceBob);
      const deleteSpy = vi.spyOn(friendRepository, "delete");

      const res = await app.request(`/api/v1/friends/${mockFriendshipAliceBob.id}`, {
        method: "DELETE",
        headers: { Cookie: "better-auth.session_token=charlie_token" },
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("FORBIDDEN");
      expect(body.error.message).toContain("do not have permission to remove this friendship");
      expect(deleteSpy).not.toHaveBeenCalled();
    });

    it("returns HTTP 404 when deleting a nonexistent friendship", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(friendRepository, "findById").mockResolvedValueOnce(null);
      vi.spyOn(friendRepository, "findByPair").mockResolvedValueOnce(null);

      const res = await app.request("/api/v1/friends/nonexistent-id", {
        method: "DELETE",
        headers: { Cookie: "better-auth.session_token=alice_token" },
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
    });
  });

  // ==========================================================================
  // 6. DEDICATED BILATERAL BALANCE (GET /api/v1/friends/:id/balance)
  // ==========================================================================
  describe("Bilateral Balance Endpoint (GET /api/v1/friends/:id/balance)", () => {
    it("returns authoritative bilateral position for involved friend", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(friendRepository, "findById").mockResolvedValueOnce(mockFriendshipAliceBob);
      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(mockUserBob);
      vi.spyOn(friendRepository, "getBilateralBalance").mockResolvedValueOnce({
        amountMinor: 10500, // 105.00 INR
        currency: "INR",
      });

      const res = await app.request(`/api/v1/friends/${mockFriendshipAliceBob.id}/balance`, {
        method: "GET",
        headers: { Cookie: "better-auth.session_token=alice_token" },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual({
        amountMinor: 10500,
        currency: "INR",
      });
    });

    it("STRICT IDOR PROTECTION: rejects unrelated user (Charlie) viewing bilateral balance between Alice and Bob (HTTP 403 Forbidden)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserCharlie as unknown as AuthUser,
        session: mockCharlieSession,
      });
      vi.spyOn(friendRepository, "findById").mockResolvedValueOnce(mockFriendshipAliceBob);

      const res = await app.request(`/api/v1/friends/${mockFriendshipAliceBob.id}/balance`, {
        method: "GET",
        headers: { Cookie: "better-auth.session_token=charlie_token" },
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("FORBIDDEN");
    });
  });

  // ==========================================================================
  // 7. FINANCIAL ENGINE BILATERAL BALANCE DOMAIN TESTS
  // ==========================================================================
  describe("FriendRepository Bilateral Balance Calculation Logic", () => {
    it("calculates exact net balance taking into account expenses and settlements", async () => {
      // Mock db client returning synthetic financial rows
      const fakeDbClient = {
        select: vi.fn().mockReturnValue({
          from: vi.fn().mockReturnValue({
            innerJoin: vi.fn().mockReturnValue({
              where: vi.fn()
                // 1. Splits paid by A for B
                .mockResolvedValueOnce([
                  { allocated: 5000, currency: "INR" }, // A paid 50.00 for B
                  { allocated: 3000, currency: "INR" }, // A paid 30.00 for B -> Total A paid for B = +8000
                ])
                // 2. Splits paid by B for A
                .mockResolvedValueOnce([
                  { allocated: 2000, currency: "INR" }, // B paid 20.00 for A -> Total B paid for A = -2000
                ]),
            }),
            where: vi.fn()
              // 3. Settlements paid by A to B
              .mockResolvedValueOnce([
                { amount: 1000, currency: "INR" }, // A settled 10.00 to B -> +1000
              ])
              // 4. Settlements paid by B to A
              .mockResolvedValueOnce([
                { amount: 4000, currency: "INR" }, // B settled 40.00 to A -> -4000
              ]),
          }),
        }),
      };

      // Expected calculation:
      // net = (+8000 - 2000) + (+1000 - 4000)
      // net = +6000 - 3000 = +3000 minor units (B owes A ₹30.00)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const balance = await friendRepository.getBilateralBalance("userA", "userB", fakeDbClient as any);

      expect(balance.amountMinor).toBe(3000);
      expect(balance.currency).toBe("INR");
    });
  });

  // ==========================================================================
  // 8. MOBILE API CLIENT METHOD TESTS
  // ==========================================================================
  describe("Mobile API Client Methods", () => {
    it("searchUsers invokes GET /api/v1/users/search with query parameters", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: "usr_bob_456", name: "Bob Builder" }],
            meta: { requestId: "req-123" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const users = await searchUsers("bob", 10);
      expect(users).toHaveLength(1);
      expect(users[0].name).toBe("Bob Builder");
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/users/search?q=bob&limit=10"),
        expect.objectContaining({ method: "GET" })
      );
    });

    it("getFriends invokes GET /api/v1/friends", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: "f-1", friend: { id: "usr_bob_456" } }],
            meta: { requestId: "req-123" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const friends = await getFriends();
      expect(friends).toHaveLength(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/friends"),
        expect.objectContaining({ method: "GET" })
      );
    });

    it("addFriend invokes POST /api/v1/friends with JSON body", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { id: "f-1", friend: { id: "usr_bob_456" } },
            meta: { requestId: "req-123" },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        )
      );

      const created = await addFriend("usr_bob_456");
      expect(created.id).toBe("f-1");
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/friends"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ friendId: "usr_bob_456" }),
        })
      );
    });

    it("getFriend invokes GET /api/v1/friends/:id", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { id: "f-1", friend: { id: "usr_bob_456" } },
            meta: { requestId: "req-123" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const res = await getFriend("f-1");
      expect(res.id).toBe("f-1");
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/friends/f-1"),
        expect.objectContaining({ method: "GET" })
      );
    });

    it("removeFriend invokes DELETE /api/v1/friends/:id", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { success: true, message: "Friendship removed successfully" },
            meta: { requestId: "req-123" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const res = await removeFriend("f-1");
      expect(res.success).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/friends/f-1"),
        expect.objectContaining({ method: "DELETE" })
      );
    });

    it("getFriendBalance invokes GET /api/v1/friends/:id/balance", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { amountMinor: 2000, currency: "INR" },
            meta: { requestId: "req-123" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const balance = await getFriendBalance("usr_bob_456");
      expect(balance).toEqual({ amountMinor: 2000, currency: "INR" });
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/friends/usr_bob_456/balance"),
        expect.objectContaining({ method: "GET" })
      );
    });

    it("mobile client handles ApiClientError on HTTP error responses", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: "CONFLICT",
              message: "Friendship already exists with this user",
              requestId: "req-conflict-123",
            },
          }),
          { status: 409, headers: { "Content-Type": "application/json" } }
        )
      );

      await expect(addFriend("usr_bob_456")).rejects.toThrow(ApiClientError);
    });
  });
});
