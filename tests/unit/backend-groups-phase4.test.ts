/**
 * Phase 4.4 — Groups API Test Suite.
 *
 * Verifies that:
 * 1. Group creation creates group and automatically registers creator as admin member atomically.
 * 2. Unauthenticated requests are rejected with HTTP 401 Unauthorized.
 * 3. Group name, description, and currency are strictly validated.
 * 4. User can list only groups where they are an active member.
 * 5. Strict IDOR protection: Non-members cannot view group details, update group, list members, or add/remove members (HTTP 403 Forbidden).
 * 6. Group updates require admin/creator role. Ordinary members are rejected with HTTP 403 Forbidden.
 * 7. Members can be added with duplicate prevention (HTTP 409 Conflict) and user existence checks (HTTP 404).
 * 8. Member removal rules: Members can leave; admins can remove ordinary members; ordinary members cannot remove others; creator cannot be removed.
 * 9. Concurrency / race conditions in membership creation map safely to HTTP 409 Conflict.
 * 10. Mobile API client methods invoke endpoints properly and handle errors.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { app } from "../../server/app.js";
import { auth, type AuthUser, type AuthSession } from "../../server/auth/index.js";
import { groupRepository } from "../../server/repositories/group.repository.js";
import { userRepository } from "../../server/repositories/user.repository.js";
import type { Group, GroupMember, User } from "../../server/db/schema/index.js";
import {
  createGroup,
  getGroups,
  getGroup,
  updateGroup,
  getGroupMembers,
  addGroupMember,
  removeGroupMember,
  ApiClientError,
} from "../../src/api/index.js";

describe("Phase 4.4 — Groups API", () => {
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

  const mockBobSession: AuthSession = {
    id: "sess_bob_token",
    userId: "usr_bob_456",
    token: "tok_bob_secret",
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

  const mockGroupGoa: Group = {
    id: "g1111111-1111-1111-1111-111111111111",
    name: "Goa Trip 2026",
    description: "Vacation expenses in Goa",
    defaultCurrencyCode: "INR",
    createdById: "usr_alice_123",
    isArchived: false,
    createdAt: new Date("2026-01-10T10:00:00.000Z"),
    updatedAt: new Date("2026-01-10T10:00:00.000Z"),
  };

  const mockAliceAdminMembership: GroupMember = {
    id: "m1111111-1111-1111-1111-111111111111",
    groupId: mockGroupGoa.id,
    userId: "usr_alice_123",
    role: "admin",
    joinedAt: new Date("2026-01-10T10:00:00.000Z"),
  };

  const mockBobMemberMembership: GroupMember = {
    id: "m2222222-2222-2222-2222-222222222222",
    groupId: mockGroupGoa.id,
    userId: "usr_bob_456",
    role: "member",
    joinedAt: new Date("2026-01-10T11:00:00.000Z"),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // 1. CREATE GROUP (POST /api/v1/groups)
  // ==========================================================================
  describe("Group Creation (POST /api/v1/groups)", () => {
    it("returns HTTP 401 Unauthorized when unauthenticated", async () => {
      const res = await app.request("/api/v1/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Ski Trip" }),
      });
      expect(res.status).toBe(401);
    });

    it("successfully creates group and automatically registers creator as admin member", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      const createWithCreatorSpy = vi
        .spyOn(groupRepository, "createWithCreator")
        .mockResolvedValueOnce(mockGroupGoa);

      const res = await app.request("/api/v1/groups", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: "better-auth.session_token=alice_token",
        },
        body: JSON.stringify({
          name: "Goa Trip 2026",
          description: "Vacation expenses in Goa",
          defaultCurrencyCode: "INR",
        }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data).toBeDefined();
      expect(body.data.id).toBe(mockGroupGoa.id);
      expect(body.data.name).toBe("Goa Trip 2026");
      expect(body.data.role).toBe("admin");
      expect(createWithCreatorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Goa Trip 2026",
          description: "Vacation expenses in Goa",
          defaultCurrencyCode: "INR",
          createdById: "usr_alice_123",
        }),
        "usr_alice_123",
        []
      );
    });

    it("derives creator identity strictly from session, ignoring spoofed client headers", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      const createWithCreatorSpy = vi
        .spyOn(groupRepository, "createWithCreator")
        .mockResolvedValueOnce(mockGroupGoa);

      await app.request("/api/v1/groups", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": "usr_charlie_789", // Spoofed actor header
          Cookie: "better-auth.session_token=alice_token",
        },
        body: JSON.stringify({ name: "Goa Trip 2026" }),
      });

      expect(createWithCreatorSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          createdById: "usr_alice_123", // Must be alice from session
        }),
        "usr_alice_123",
        []
      );
    });

    it("rejects empty group name with HTTP 400 Validation Error", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const res = await app.request("/api/v1/groups", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: "better-auth.session_token=alice_token",
        },
        body: JSON.stringify({ name: "   " }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects invalid currency code with HTTP 400 Validation Error", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const res = await app.request("/api/v1/groups", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: "better-auth.session_token=alice_token",
        },
        body: JSON.stringify({ name: "Goa Trip", defaultCurrencyCode: "BTC" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects initial member that does not exist in users table (HTTP 404)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(null);

      const res = await app.request("/api/v1/groups", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: "better-auth.session_token=alice_token",
        },
        body: JSON.stringify({
          name: "Goa Trip",
          memberUserIds: ["usr_nonexistent_999"],
        }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
    });
  });

  // ==========================================================================
  // 2. LIST GROUPS (GET /api/v1/groups)
  // ==========================================================================
  describe("List Groups (GET /api/v1/groups)", () => {
    it("returns HTTP 401 Unauthorized when unauthenticated", async () => {
      const res = await app.request("/api/v1/groups", { method: "GET" });
      expect(res.status).toBe(401);
    });

    it("returns only groups where the authenticated user is an active member", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(groupRepository, "listByUserId").mockResolvedValueOnce([
        { group: mockGroupGoa, role: "admin" },
      ]);

      const res = await app.request("/api/v1/groups", {
        method: "GET",
        headers: { Cookie: "better-auth.session_token=alice_token" },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe(mockGroupGoa.id);
      expect(body.data[0].name).toBe("Goa Trip 2026");
      expect(body.data[0].role).toBe("admin");
    });

    it("filters groups with optional ?q= query parameter", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const mockGroupFlat: Group = {
        id: "g2222222-2222-2222-2222-222222222222",
        name: "Flatmates Mumbai",
        description: null,
        defaultCurrencyCode: "INR",
        createdById: "usr_alice_123",
        isArchived: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      vi.spyOn(groupRepository, "listByUserId").mockResolvedValueOnce([
        { group: mockGroupGoa, role: "admin" },
        { group: mockGroupFlat, role: "member" },
      ]);

      const res = await app.request("/api/v1/groups?q=flat", {
        method: "GET",
        headers: { Cookie: "better-auth.session_token=alice_token" },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe("Flatmates Mumbai");
    });
  });

  // ==========================================================================
  // 3. GET GROUP DETAILS & IDOR (GET /api/v1/groups/:id)
  // ==========================================================================
  describe("Get Group Details & IDOR (GET /api/v1/groups/:id)", () => {
    it("allows a group member (Alice) to view group details", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValueOnce(mockGroupGoa);
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(mockAliceAdminMembership);

      const res = await app.request(`/api/v1/groups/${mockGroupGoa.id}`, {
        method: "GET",
        headers: { Cookie: "better-auth.session_token=alice_token" },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe(mockGroupGoa.id);
      expect(body.data.role).toBe("admin");
    });

    it("STRICT IDOR PROTECTION: rejects non-member (Charlie) attempting to view Alice's group (HTTP 403 Forbidden)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserCharlie as unknown as AuthUser,
        session: mockCharlieSession,
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValueOnce(mockGroupGoa);
      // Charlie has no membership in Goa group
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(null);

      const res = await app.request(`/api/v1/groups/${mockGroupGoa.id}`, {
        method: "GET",
        headers: { Cookie: "better-auth.session_token=charlie_token" },
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("FORBIDDEN");
      expect(body.error.message).toContain("do not have permission to view this group");
    });

    it("returns HTTP 404 when requested group does not exist", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValueOnce(null);

      const res = await app.request("/api/v1/groups/00000000-0000-0000-0000-000000000000", {
        method: "GET",
        headers: { Cookie: "better-auth.session_token=alice_token" },
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
    });
  });

  // ==========================================================================
  // 4. UPDATE GROUP & ROLE SECURITY (PATCH /api/v1/groups/:id)
  // ==========================================================================
  describe("Update Group & Role Enforcement (PATCH /api/v1/groups/:id)", () => {
    it("allows group admin (Alice) to update group details", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValueOnce(mockGroupGoa);
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(mockAliceAdminMembership);
      vi.spyOn(groupRepository, "update").mockResolvedValueOnce({
        ...mockGroupGoa,
        name: "Goa Trip Extended",
      });

      const res = await app.request(`/api/v1/groups/${mockGroupGoa.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: "better-auth.session_token=alice_token",
        },
        body: JSON.stringify({ name: "Goa Trip Extended" }),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.name).toBe("Goa Trip Extended");
    });

    it("ROLE ENFORCEMENT: rejects ordinary member (Bob) attempting to update group details (HTTP 403 Forbidden)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserBob as unknown as AuthUser,
        session: mockBobSession,
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValueOnce(mockGroupGoa);
      // Bob is ordinary member, not admin
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(mockBobMemberMembership);

      const res = await app.request(`/api/v1/groups/${mockGroupGoa.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: "better-auth.session_token=bob_token",
        },
        body: JSON.stringify({ name: "Hacked Group Name" }),
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("FORBIDDEN");
      expect(body.error.message).toContain("Only group admins can update group details");
    });

    it("IDOR ENFORCEMENT: rejects non-member (Charlie) attempting to update group (HTTP 403 Forbidden)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserCharlie as unknown as AuthUser,
        session: mockCharlieSession,
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValueOnce(mockGroupGoa);
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(null);

      const res = await app.request(`/api/v1/groups/${mockGroupGoa.id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Cookie: "better-auth.session_token=charlie_token",
        },
        body: JSON.stringify({ name: "Hacked Group Name" }),
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("FORBIDDEN");
    });
  });

  // ==========================================================================
  // 5. LIST GROUP MEMBERS (GET /api/v1/groups/:id/members)
  // ==========================================================================
  describe("List Group Members (GET /api/v1/groups/:id/members)", () => {
    it("allows a group member (Bob) to view member list", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserBob as unknown as AuthUser,
        session: mockBobSession,
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValueOnce(mockGroupGoa);
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(mockBobMemberMembership);
      vi.spyOn(groupRepository, "listMembers").mockResolvedValueOnce([
        { member: mockAliceAdminMembership, user: mockUserAlice },
        { member: mockBobMemberMembership, user: mockUserBob },
      ]);

      const res = await app.request(`/api/v1/groups/${mockGroupGoa.id}/members`, {
        method: "GET",
        headers: { Cookie: "better-auth.session_token=bob_token" },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(2);
      expect(body.data[0].role).toBe("admin");
      expect(body.data[0].user.name).toBe("Alice Liddell");
      expect(body.data[1].role).toBe("member");
      expect(body.data[1].user.name).toBe("Bob Builder");
    });

    it("STRICT IDOR: rejects non-member (Charlie) attempting to list members of Alice's group (HTTP 403)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserCharlie as unknown as AuthUser,
        session: mockCharlieSession,
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValueOnce(mockGroupGoa);
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(null);

      const res = await app.request(`/api/v1/groups/${mockGroupGoa.id}/members`, {
        method: "GET",
        headers: { Cookie: "better-auth.session_token=charlie_token" },
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("FORBIDDEN");
    });
  });

  // ==========================================================================
  // 6. ADD GROUP MEMBER (POST /api/v1/groups/:id/members)
  // ==========================================================================
  describe("Add Group Member (POST /api/v1/groups/:id/members)", () => {
    it("allows authorized member to add an existing user", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValueOnce(mockGroupGoa);
      vi.spyOn(groupRepository, "findMembership")
        .mockResolvedValueOnce(mockAliceAdminMembership) // Actor check
        .mockResolvedValueOnce(null); // Target duplicate check
      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(mockUserCharlie);
      vi.spyOn(groupRepository, "addMember").mockResolvedValueOnce({
        id: "m3333333-3333-3333-3333-333333333333",
        groupId: mockGroupGoa.id,
        userId: "usr_charlie_789",
        role: "member",
        joinedAt: new Date(),
      });

      const res = await app.request(`/api/v1/groups/${mockGroupGoa.id}/members`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: "better-auth.session_token=alice_token",
        },
        body: JSON.stringify({ userId: "usr_charlie_789" }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.role).toBe("member");
      expect(body.data.user.id).toBe("usr_charlie_789");
    });

    it("rejects duplicate membership with HTTP 409 Conflict", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValueOnce(mockGroupGoa);
      vi.spyOn(groupRepository, "findMembership")
        .mockResolvedValueOnce(mockAliceAdminMembership) // Actor check
        .mockResolvedValueOnce(mockBobMemberMembership); // Bob already member
      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(mockUserBob);

      const res = await app.request(`/api/v1/groups/${mockGroupGoa.id}/members`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: "better-auth.session_token=alice_token",
        },
        body: JSON.stringify({ userId: "usr_bob_456" }),
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe("CONFLICT");
      expect(body.error.message).toContain("already a member");
    });

    it("rejects nonexistent target user with HTTP 404 Not Found", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValueOnce(mockGroupGoa);
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(mockAliceAdminMembership);
      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(null);

      const res = await app.request(`/api/v1/groups/${mockGroupGoa.id}/members`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: "better-auth.session_token=alice_token",
        },
        body: JSON.stringify({ userId: "usr_ghost_999" }),
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
    });

    it("sanitizes privilege escalation: ordinary member adding another user forces role to member", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserBob as unknown as AuthUser,
        session: mockBobSession,
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValueOnce(mockGroupGoa);
      vi.spyOn(groupRepository, "findMembership")
        .mockResolvedValueOnce(mockBobMemberMembership) // Bob is ordinary member
        .mockResolvedValueOnce(null);
      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(mockUserCharlie);
      const addMemberSpy = vi.spyOn(groupRepository, "addMember").mockResolvedValueOnce({
        id: "m3333333-3333-3333-3333-333333333333",
        groupId: mockGroupGoa.id,
        userId: "usr_charlie_789",
        role: "member",
        joinedAt: new Date(),
      });

      // Bob attempts to add Charlie as "admin"
      await app.request(`/api/v1/groups/${mockGroupGoa.id}/members`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: "better-auth.session_token=bob_token",
        },
        body: JSON.stringify({ userId: "usr_charlie_789", role: "admin" }),
      });

      // Role must be forced to "member"
      expect(addMemberSpy).toHaveBeenCalledWith(mockGroupGoa.id, "usr_charlie_789", "member");
    });

    it("handles database unique constraint race condition with HTTP 409 Conflict", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValueOnce(mockGroupGoa);
      vi.spyOn(groupRepository, "findMembership")
        .mockResolvedValueOnce(mockAliceAdminMembership)
        .mockResolvedValueOnce(null);
      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(mockUserCharlie);

      const dbUniqueError = new Error("duplicate key value violates unique constraint 'group_members_group_user_uq'");
      (dbUniqueError as unknown as Record<string, unknown>).code = "23505";
      vi.spyOn(groupRepository, "addMember").mockRejectedValueOnce(dbUniqueError);

      const res = await app.request(`/api/v1/groups/${mockGroupGoa.id}/members`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: "better-auth.session_token=alice_token",
        },
        body: JSON.stringify({ userId: "usr_charlie_789" }),
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error.code).toBe("CONFLICT");
    });
  });

  // ==========================================================================
  // 7. REMOVE GROUP MEMBER (DELETE /api/v1/groups/:id/members/:userId)
  // ==========================================================================
  describe("Remove Group Member (DELETE /api/v1/groups/:id/members/:userId)", () => {
    it("allows a member (Bob) to remove themselves (leave group)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserBob as unknown as AuthUser,
        session: mockBobSession,
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValueOnce(mockGroupGoa);
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(mockBobMemberMembership);
      const removeSpy = vi.spyOn(groupRepository, "removeMember").mockResolvedValueOnce(true);

      const res = await app.request(`/api/v1/groups/${mockGroupGoa.id}/members/usr_bob_456`, {
        method: "DELETE",
        headers: { Cookie: "better-auth.session_token=bob_token" },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.success).toBe(true);
      expect(removeSpy).toHaveBeenCalledWith(mockGroupGoa.id, "usr_bob_456");
    });

    it("allows group admin (Alice) to remove another member (Bob)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValueOnce(mockGroupGoa);
      vi.spyOn(groupRepository, "findMembership")
        .mockResolvedValueOnce(mockBobMemberMembership) // target membership
        .mockResolvedValueOnce(mockAliceAdminMembership); // actor membership
      const removeSpy = vi.spyOn(groupRepository, "removeMember").mockResolvedValueOnce(true);

      const res = await app.request(`/api/v1/groups/${mockGroupGoa.id}/members/usr_bob_456`, {
        method: "DELETE",
        headers: { Cookie: "better-auth.session_token=alice_token" },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.success).toBe(true);
      expect(removeSpy).toHaveBeenCalledWith(mockGroupGoa.id, "usr_bob_456");
    });

    it("CREATOR PROTECTION: rejects attempt to remove the group creator (Alice) (HTTP 403 Forbidden)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserBob as unknown as AuthUser,
        session: mockBobSession,
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValueOnce(mockGroupGoa);
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(mockAliceAdminMembership); // target is Alice (creator)

      const res = await app.request(`/api/v1/groups/${mockGroupGoa.id}/members/usr_alice_123`, {
        method: "DELETE",
        headers: { Cookie: "better-auth.session_token=bob_token" },
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("FORBIDDEN");
      expect(body.error.message).toContain("group creator cannot be removed");
    });

    it("ROLE RESTRICTION: rejects ordinary member (Bob) attempting to remove another user (Charlie) (HTTP 403 Forbidden)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserBob as unknown as AuthUser,
        session: mockBobSession,
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValueOnce(mockGroupGoa);
      const mockCharlieMembership: GroupMember = {
        id: "m3333333-3333-3333-3333-333333333333",
        groupId: mockGroupGoa.id,
        userId: "usr_charlie_789",
        role: "member",
        joinedAt: new Date(),
      };
      vi.spyOn(groupRepository, "findMembership")
        .mockResolvedValueOnce(mockCharlieMembership) // target is Charlie
        .mockResolvedValueOnce(mockBobMemberMembership); // actor is Bob (not admin)

      const res = await app.request(`/api/v1/groups/${mockGroupGoa.id}/members/usr_charlie_789`, {
        method: "DELETE",
        headers: { Cookie: "better-auth.session_token=bob_token" },
      });

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.code).toBe("FORBIDDEN");
      expect(body.error.message).toContain("Only group admins can remove other members");
    });

    it("returns HTTP 404 when target member is not in the group", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValueOnce(mockGroupGoa);
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(null); // Target not in group

      const res = await app.request(`/api/v1/groups/${mockGroupGoa.id}/members/usr_unknown_999`, {
        method: "DELETE",
        headers: { Cookie: "better-auth.session_token=alice_token" },
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
    });
  });

  // ==========================================================================
  // 8. MOBILE API CLIENT METHOD TESTS
  // ==========================================================================
  describe("Mobile API Client Methods", () => {
    it("createGroup invokes POST /api/v1/groups with input", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { id: "g-1", name: "Road Trip" },
            meta: { requestId: "req-1" },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        )
      );

      const res = await createGroup({ name: "Road Trip", defaultCurrencyCode: "USD" });
      expect(res.name).toBe("Road Trip");
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/groups"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "Road Trip", defaultCurrencyCode: "USD" }),
        })
      );
    });

    it("getGroups invokes GET /api/v1/groups with optional query", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: "g-1", name: "Road Trip" }],
            meta: { requestId: "req-1" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const res = await getGroups("road");
      expect(res).toHaveLength(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/groups?q=road"),
        expect.objectContaining({ method: "GET" })
      );
    });

    it("getGroup invokes GET /api/v1/groups/:id", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { id: "g-1", name: "Road Trip" },
            meta: { requestId: "req-1" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const res = await getGroup("g-1");
      expect(res.id).toBe("g-1");
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/groups/g-1"),
        expect.objectContaining({ method: "GET" })
      );
    });

    it("updateGroup invokes PATCH /api/v1/groups/:id", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { id: "g-1", name: "Road Trip 2" },
            meta: { requestId: "req-1" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const res = await updateGroup("g-1", { name: "Road Trip 2" });
      expect(res.name).toBe("Road Trip 2");
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/groups/g-1"),
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ name: "Road Trip 2" }),
        })
      );
    });

    it("getGroupMembers invokes GET /api/v1/groups/:id/members", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ id: "m-1", role: "admin", user: { id: "u-1" } }],
            meta: { requestId: "req-1" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const res = await getGroupMembers("g-1");
      expect(res).toHaveLength(1);
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/groups/g-1/members"),
        expect.objectContaining({ method: "GET" })
      );
    });

    it("addGroupMember invokes POST /api/v1/groups/:id/members", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { id: "m-2", role: "member", user: { id: "u-2" } },
            meta: { requestId: "req-1" },
          }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        )
      );

      const res = await addGroupMember("g-1", { userId: "u-2" });
      expect(res.id).toBe("m-2");
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/groups/g-1/members"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ userId: "u-2" }),
        })
      );
    });

    it("removeGroupMember invokes DELETE /api/v1/groups/:id/members/:userId", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: { success: true, message: "Member removed from group successfully" },
            meta: { requestId: "req-1" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );

      const res = await removeGroupMember("g-1", "u-2");
      expect(res.success).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/groups/g-1/members/u-2"),
        expect.objectContaining({ method: "DELETE" })
      );
    });

    it("mobile client handles ApiClientError on HTTP error responses", async () => {
      vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: "FORBIDDEN",
              message: "Only group admins can update group details",
              requestId: "req-err-123",
            },
          }),
          { status: 403, headers: { "Content-Type": "application/json" } }
        )
      );

      await expect(updateGroup("g-1", { name: "New Name" })).rejects.toThrow(ApiClientError);
    });
  });
});
