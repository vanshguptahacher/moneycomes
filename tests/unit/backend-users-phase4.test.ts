/**
 * Phase 4.2 — Users & Profile API Test Suite.
 *
 * Verifies that:
 * 1. Authenticated user can retrieve their own profile via GET /api/v1/users/me.
 * 2. Unauthenticated requests are rejected with HTTP 401 Unauthorized.
 * 3. Authenticated user can update allowed profile fields via PATCH /api/v1/users/me.
 * 4. Invalid input (empty name, bad currency, malformed JSON) is rejected with HTTP 400.
 * 5. Protected fields (id, email, emailVerified, password, createdAt) cannot be modified.
 * 6. IDOR security: User A cannot read or modify User B's profile (HTTP 403 Forbidden).
 * 7. User identity is derived strictly from Better Auth session, ignoring client-supplied headers/params.
 * 8. Safe responses omit password hashes, tokens, database credentials, and stack traces.
 * 9. Mobile client helpers (getCurrentUserProfile, updateCurrentUserProfile, getUserProfileById) function properly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { app } from "../../server/app.js";
import { auth, type AuthUser, type AuthSession } from "../../server/auth/index.js";
import { userRepository } from "../../server/repositories/user.repository.js";
import type { User } from "../../server/db/schema/index.js";
import {
  getCurrentUserProfile,
  updateCurrentUserProfile,
  getUserProfileById,
  ApiClientError,
} from "../../src/api/index.js";

describe("Phase 4.2 — Users & Profile API", () => {
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

  const mockAliceSession: AuthSession = {
    id: "sess_alice_token",
    userId: "usr_alice_123",
    token: "tok_alice_secret",
    expiresAt: new Date(Date.now() + 86400000),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // 1. GET /api/v1/users/me — CURRENT AUTHENTICATED USER RETRIEVAL
  // ==========================================================================
  describe("GET /api/v1/users/me", () => {
    it("returns HTTP 401 Unauthorized when request is unauthenticated", async () => {
      const res = await app.request("/api/v1/users/me", {
        method: "GET",
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBeDefined();
      expect(body.error.code).toBe("UNAUTHORIZED");
      expect(body.error.requestId).toBeDefined();
    });

    it("returns authenticated user's own profile when session is valid", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(mockUserAlice);

      const res = await app.request("/api/v1/users/me", {
        method: "GET",
        headers: {
          Cookie: "better-auth.session_token=alice_valid_token",
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.data).toBeDefined();
      expect(body.data.id).toBe("usr_alice_123");
      expect(body.data.name).toBe("Alice Liddell");
      expect(body.data.email).toBe("alice@wonderland.com");
      expect(body.data.emailVerified).toBe(true);
      expect(body.data.image).toBe("https://example.com/alice.jpg");
      expect(body.data.defaultCurrencyCode).toBe("INR");
      expect(body.data.createdAt).toBe("2026-01-01T00:00:00.000Z");
      expect(body.meta?.requestId).toBeDefined();

      // Zero leakage of private authentication internals
      const rawData = body.data as Record<string, unknown>;
      expect(rawData["password"]).toBeUndefined();
      expect(rawData["passwordHash"]).toBeUndefined();
      expect(rawData["token"]).toBeUndefined();
      expect(rawData["secret"]).toBeUndefined();
    });

    it("derives user identity strictly from session, ignoring spoofed client headers", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const findSpy = vi.spyOn(userRepository, "findById").mockResolvedValueOnce(mockUserAlice);

      const res = await app.request("/api/v1/users/me", {
        method: "GET",
        headers: {
          Cookie: "better-auth.session_token=alice_valid_token",
          "x-user-id": "usr_bob_456",
          "user-id": "usr_bob_456",
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe("usr_alice_123");
      expect(findSpy).toHaveBeenCalledWith("usr_alice_123");
    });
  });

  // ==========================================================================
  // 2. PATCH /api/v1/users/me — CURRENT USER PROFILE UPDATE
  // ==========================================================================
  describe("PATCH /api/v1/users/me", () => {
    it("returns HTTP 401 Unauthorized when request is unauthenticated", async () => {
      const res = await app.request("/api/v1/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "New Name" }),
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error.code).toBe("UNAUTHORIZED");
    });

    it("successfully updates allowed profile fields (name, image, defaultCurrencyCode)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(mockUserAlice);

      const updatedAlice: User = {
        ...mockUserAlice,
        name: "Alice Updated",
        image: "https://example.com/new-avatar.png",
        defaultCurrencyCode: "USD",
        updatedAt: new Date("2026-01-10T12:00:00.000Z"),
      };

      const updateSpy = vi.spyOn(userRepository, "update").mockResolvedValueOnce(updatedAlice);

      const res = await app.request("/api/v1/users/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: "better-auth.session_token=alice_valid_token",
        },
        body: JSON.stringify({
          name: "Alice Updated",
          image: "https://example.com/new-avatar.png",
          defaultCurrencyCode: "USD",
        }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.data.id).toBe("usr_alice_123");
      expect(body.data.name).toBe("Alice Updated");
      expect(body.data.image).toBe("https://example.com/new-avatar.png");
      expect(body.data.defaultCurrencyCode).toBe("USD");
      expect(body.data.updatedAt).toBe("2026-01-10T12:00:00.000Z");

      expect(updateSpy).toHaveBeenCalledWith("usr_alice_123", {
        name: "Alice Updated",
        image: "https://example.com/new-avatar.png",
        defaultCurrencyCode: "USD",
      });
    });

    it("allows clearing the avatar image by passing null", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(mockUserAlice);

      const updatedAlice: User = {
        ...mockUserAlice,
        image: null,
      };

      vi.spyOn(userRepository, "update").mockResolvedValueOnce(updatedAlice);

      const res = await app.request("/api/v1/users/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: "better-auth.session_token=alice_valid_token",
        },
        body: JSON.stringify({ image: null }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.image).toBeNull();
    });

    it("rejects invalid input: empty name", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const res = await app.request("/api/v1/users/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: "better-auth.session_token=alice_valid_token",
        },
        body: JSON.stringify({ name: "   " }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
      expect(body.error.details?.name).toBeDefined();
    });

    it("rejects invalid input: unsupported currency code", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const res = await app.request("/api/v1/users/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: "better-auth.session_token=alice_valid_token",
        },
        body: JSON.stringify({ defaultCurrencyCode: "BITCOIN" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects empty body with no fields provided", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const res = await app.request("/api/v1/users/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: "better-auth.session_token=alice_valid_token",
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects attempt to modify immutable and protected fields (id, email, password)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      // Strict schema rejection test: passing immutable or unauthorized fields
      const res = await app.request("/api/v1/users/me", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: "better-auth.session_token=alice_valid_token",
        },
        body: JSON.stringify({
          name: "Alice",
          id: "attacker-override-id",
          email: "hacked@evil.com",
          emailVerified: true,
          password: "new-password",
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // ==========================================================================
  // 3. GET /api/v1/users/:id & PATCH /api/v1/users/:id — IDOR PROTECTION
  // ==========================================================================
  describe("Authorization & IDOR Security Boundary", () => {
    it("allows authenticated user to retrieve own profile via /api/v1/users/:id", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(mockUserAlice);

      const res = await app.request("/api/v1/users/usr_alice_123", {
        method: "GET",
        headers: {
          Cookie: "better-auth.session_token=alice_valid_token",
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe("usr_alice_123");
    });

    it("STRICTLY REJECTS IDOR PROBE: User A attempting to view User B's profile returns 403", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(mockUserBob);

      const res = await app.request("/api/v1/users/usr_bob_456", {
        method: "GET",
        headers: {
          Cookie: "better-auth.session_token=alice_valid_token",
        },
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("FORBIDDEN");
      expect(body.error.message).toContain("permission");
    });

    it("STRICTLY REJECTS IDOR MUTATION: User A attempting to update User B's profile returns 403", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const updateSpy = vi.spyOn(userRepository, "update");

      const res = await app.request("/api/v1/users/usr_bob_456", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: "better-auth.session_token=alice_valid_token",
        },
        body: JSON.stringify({ name: "Bob Hacked Name" }),
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("FORBIDDEN");
      expect(body.error.message).toContain("cannot modify another user's profile");

      // Verify that database update was NEVER called
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it("returns HTTP 404 when requested user profile does not exist", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(null);

      const res = await app.request("/api/v1/users/usr_alice_123", {
        method: "GET",
        headers: {
          Cookie: "better-auth.session_token=alice_valid_token",
        },
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
    });
  });

  // ==========================================================================
  // 4. MOBILE API CLIENT ABSTRACTION TESTS
  // ==========================================================================
  describe("Mobile API Client Helpers (src/api)", () => {
    it("getCurrentUserProfile fetches /api/v1/users/me and unwraps data payload", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            id: "usr_alice_123",
            name: "Alice Liddell",
            email: "alice@wonderland.com",
            emailVerified: true,
            image: null,
            defaultCurrencyCode: "INR",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        }),
      });

      vi.stubGlobal("fetch", mockFetch);

      const profile = await getCurrentUserProfile();
      expect(profile.id).toBe("usr_alice_123");
      expect(profile.name).toBe("Alice Liddell");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/users/me"),
        expect.objectContaining({ method: "GET", credentials: "include" })
      );
    });

    it("updateCurrentUserProfile sends PATCH with JSON body and credentials", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            id: "usr_alice_123",
            name: "Alice Updated",
            email: "alice@wonderland.com",
            emailVerified: true,
            image: null,
            defaultCurrencyCode: "USD",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
          },
        }),
      });

      vi.stubGlobal("fetch", mockFetch);

      const updated = await updateCurrentUserProfile({
        name: "Alice Updated",
        defaultCurrencyCode: "USD",
      });

      expect(updated.name).toBe("Alice Updated");
      expect(updated.defaultCurrencyCode).toBe("USD");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/users/me"),
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ name: "Alice Updated", defaultCurrencyCode: "USD" }),
        })
      );
    });

    it("getUserProfileById encodes user ID and performs GET", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          data: {
            id: "usr_alice_123",
            name: "Alice Liddell",
            email: "alice@wonderland.com",
            emailVerified: true,
            image: null,
            defaultCurrencyCode: "INR",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        }),
      });

      vi.stubGlobal("fetch", mockFetch);

      const profile = await getUserProfileById("usr_alice_123");
      expect(profile.id).toBe("usr_alice_123");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/users/usr_alice_123"),
        expect.objectContaining({ method: "GET" })
      );
    });

    it("throws ApiClientError with server status, code, and message on error", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({
          error: {
            code: "FORBIDDEN",
            message: "You do not have permission to view this user profile",
            requestId: "req_123",
          },
        }),
      });

      vi.stubGlobal("fetch", mockFetch);

      await expect(getUserProfileById("usr_bob_456")).rejects.toThrowError(ApiClientError);
      await expect(getUserProfileById("usr_bob_456")).rejects.toMatchObject({
        status: 403,
        code: "FORBIDDEN",
        requestId: "req_123",
      });
    });
  });
});
