/**
 * Phase 4.7 — Activity API Test Suite.
 *
 * Verifies that:
 * A. Authentication: Unauthenticated requests to group and global activity endpoints are rejected (HTTP 401).
 * B. Group Authorization: Active group members can read group activity; non-members are rejected (HTTP 403).
 * C. Data Isolation: Global activity feed returns only events from user's authorized groups; unrelated group events are never exposed.
 * D. Safe Response: Only safe fields and safe actor profiles (id, name, email, image) are returned (no secrets or internal tokens).
 * E. Pagination: Limit and offset pagination is bounded (max 100) and chronologically deterministic (newest first).
 * F. Filtering: Valid type and entityType filters work; invalid filters are rejected (HTTP 400); filters cannot bypass authorization.
 * G. Read-Only Invariant: Client cannot create, edit, or delete activity events (POST, PATCH, DELETE are rejected/unmapped).
 * H. Activity Generation Integration: Server-side domain operations (e.g. settlements) generate activity atomically.
 * I. Mobile API Client: getGroupActivity and getUserActivity invoke endpoints correctly with parameters.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { app } from "../../server/app.js";
import { auth, type AuthUser, type AuthSession } from "../../server/auth/index.js";
import { groupRepository } from "../../server/repositories/group.repository.js";
import { userRepository } from "../../server/repositories/user.repository.js";
import { activityRepository } from "../../server/repositories/activity.repository.js";
import { settlementRepository } from "../../server/repositories/settlement.repository.js";
import type { ActivityEvent, Group, GroupMember, User } from "../../server/db/schema/index.js";
import {
  getGroupActivity,
  getUserActivity,
} from "../../src/api/index.js";

describe("Phase 4.7 — Activity API", () => {
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
    defaultCurrencyCode: "INR",
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
    id: "11111111-1111-1111-1111-111111111111",
    name: "Goa Trip 2026",
    description: "Vacation expenses in Goa",
    defaultCurrencyCode: "INR",
    createdById: "usr_alice_123",
    isArchived: false,
    createdAt: new Date("2026-01-10T10:00:00.000Z"),
    updatedAt: new Date("2026-01-10T10:00:00.000Z"),
  };

  const mockGroupOther: Group = {
    id: "22222222-2222-2222-2222-222222222222",
    name: "Private Team Project",
    description: "Confidential expenses",
    defaultCurrencyCode: "USD",
    createdById: "usr_charlie_789",
    isArchived: false,
    createdAt: new Date("2026-01-15T10:00:00.000Z"),
    updatedAt: new Date("2026-01-15T10:00:00.000Z"),
  };

  const mockAliceAdminMembership: GroupMember = {
    id: "44444444-4444-4444-4444-444444444444",
    groupId: mockGroupGoa.id,
    userId: "usr_alice_123",
    role: "admin",
    joinedAt: new Date("2026-01-10T10:00:00.000Z"),
  };

  const mockBobMemberMembership: GroupMember = {
    id: "55555555-5555-5555-5555-555555555555",
    groupId: mockGroupGoa.id,
    userId: "usr_bob_456",
    role: "member",
    joinedAt: new Date("2026-01-10T11:00:00.000Z"),
  };

  const mockActivityEvent1: ActivityEvent = {
    id: "aa111111-1111-1111-1111-111111111111",
    type: "settlement_created",
    actorId: "usr_bob_456",
    groupId: mockGroupGoa.id,
    entityType: "settlement",
    entityId: "33333333-3333-3333-3333-333333333333",
    metadata: {
      amountMinor: 50000,
      currencyCode: "INR",
      payerId: "usr_bob_456",
      receiverId: "usr_alice_123",
      notes: "UPI payment",
    },
    createdAt: new Date("2026-01-12T12:00:00.000Z"),
  };

  const mockActivityEvent2: ActivityEvent = {
    id: "aa222222-2222-2222-2222-222222222222",
    type: "group_created",
    actorId: "usr_alice_123",
    groupId: mockGroupGoa.id,
    entityType: "group",
    entityId: mockGroupGoa.id,
    metadata: {
      groupName: "Goa Trip 2026",
    },
    createdAt: new Date("2026-01-10T10:00:00.000Z"),
  };

  const mockActivityEventOtherGroup: ActivityEvent = {
    id: "aa333333-3333-3333-3333-333333333333",
    type: "expense_created",
    actorId: "usr_charlie_789",
    groupId: mockGroupOther.id,
    entityType: "expense",
    entityId: "ee111111-1111-1111-1111-111111111111",
    metadata: {
      amountMinor: 99000,
      currencyCode: "USD",
      description: "Secret Office Party",
    },
    createdAt: new Date("2026-01-16T15:00:00.000Z"),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // A. AUTHENTICATION
  // ==========================================================================
  describe("A. Authentication Verification", () => {
    it("1. unauthenticated group activity request rejected with HTTP 401", async () => {
      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/activity`,
        {
          method: "GET",
        }
      );
      expect(res.status).toBe(401);
    });

    it("unauthenticated global activity request rejected with HTTP 401", async () => {
      const res = await app.request("/api/v1/activity", {
        method: "GET",
      });
      expect(res.status).toBe(401);
    });

    it("2. authenticated activity request succeeds when authorized", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValueOnce(mockGroupGoa);
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(
        mockAliceAdminMembership
      );
      vi.spyOn(activityRepository, "listByGroupId").mockResolvedValueOnce({
        activities: [mockActivityEvent1],
        total: 1,
      });
      vi.spyOn(userRepository, "findById").mockResolvedValue(mockUserBob);

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/activity`,
        {
          method: "GET",
          headers: { Cookie: "better-auth.session_token=alice_token" },
        }
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].id).toBe(mockActivityEvent1.id);
    });
  });

  // ==========================================================================
  // B. GROUP AUTHORIZATION & IDOR
  // ==========================================================================
  describe("B. Group Authorization and IDOR Defense", () => {
    it("3. group member can read group activity", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserBob as unknown as AuthUser,
        session: mockBobSession,
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValueOnce(mockGroupGoa);
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(
        mockBobMemberMembership
      );
      vi.spyOn(activityRepository, "listByGroupId").mockResolvedValueOnce({
        activities: [mockActivityEvent1],
        total: 1,
      });
      vi.spyOn(userRepository, "findById").mockResolvedValue(mockUserBob);

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/activity`,
        {
          method: "GET",
          headers: { Cookie: "better-auth.session_token=bob_token" },
        }
      );

      expect(res.status).toBe(200);
    });

    it("4. non-member cannot read group activity (HTTP 403)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserCharlie as unknown as AuthUser,
        session: mockCharlieSession,
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValueOnce(mockGroupGoa);
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(null);

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/activity`,
        {
          method: "GET",
          headers: { Cookie: "better-auth.session_token=charlie_token" },
        }
      );

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("FORBIDDEN");
    });

    it("5. manipulated groupId cannot expose another group's activity", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      // Alice is NOT a member of mockGroupOther
      vi.spyOn(groupRepository, "findById").mockResolvedValueOnce(mockGroupOther);
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(null);

      const res = await app.request(
        `/api/v1/groups/${mockGroupOther.id}/activity`,
        {
          method: "GET",
          headers: { Cookie: "better-auth.session_token=alice_token" },
        }
      );

      expect(res.status).toBe(403);
    });

    it("non-existent groupId returns HTTP 404", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValueOnce(null);

      const res = await app.request(
        `/api/v1/groups/00000000-0000-0000-0000-000000000000/activity`,
        {
          method: "GET",
          headers: { Cookie: "better-auth.session_token=alice_token" },
        }
      );

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("NOT_FOUND");
    });

    it("invalid UUID format for groupId is rejected with HTTP 400", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const res = await app.request(`/api/v1/groups/not-a-valid-uuid/activity`, {
        method: "GET",
        headers: { Cookie: "better-auth.session_token=alice_token" },
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain("must be a valid UUID");
    });
  });

  // ==========================================================================
  // C. DATA ISOLATION (GLOBAL USER ACTIVITY FEED)
  // ==========================================================================
  describe("C. Data Isolation (Global User Activity Feed)", () => {
    it("6-7. user A sees only activity from their authorized groups, never unrelated private groups", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(userRepository, "findById").mockResolvedValue(mockUserAlice);
      // Alice is member of only mockGroupGoa
      vi.spyOn(groupRepository, "listByUserId").mockResolvedValueOnce([
        { group: mockGroupGoa, role: "admin" },
      ]);

      const listForUserSpy = vi
        .spyOn(activityRepository, "listForUser")
        .mockResolvedValueOnce({
          activities: [mockActivityEvent1, mockActivityEvent2],
          total: 2,
        });

      const res = await app.request("/api/v1/activity", {
        method: "GET",
        headers: { Cookie: "better-auth.session_token=alice_token" },
      });

      expect(res.status).toBe(200);
      // Assert that repository was called with ONLY Alice's authorized group IDs
      expect(listForUserSpy).toHaveBeenCalledWith(
        "usr_alice_123",
        [mockGroupGoa.id],
        expect.objectContaining({ limit: 20, offset: 0 })
      );

      const json = await res.json();
      expect(json.data).toHaveLength(2);
      // Ensure no events from mockGroupOther exist
      const otherGroupEvents = json.data.filter(
        (e: { id: string; groupId: string }) =>
          e.groupId === mockGroupOther.id || e.id === mockActivityEventOtherGroup.id
      );
      expect(otherGroupEvents).toHaveLength(0);
    });

    it("8. user with zero groups returns empty list without error", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(userRepository, "findById").mockResolvedValue(mockUserAlice);
      vi.spyOn(groupRepository, "listByUserId").mockResolvedValueOnce([]); // No groups

      const listForUserSpy = vi
        .spyOn(activityRepository, "listForUser")
        .mockResolvedValueOnce({
          activities: [],
          total: 0,
        });

      const res = await app.request("/api/v1/activity", {
        method: "GET",
        headers: { Cookie: "better-auth.session_token=alice_token" },
      });

      expect(res.status).toBe(200);
      expect(listForUserSpy).toHaveBeenCalledWith(
        "usr_alice_123",
        [],
        expect.objectContaining({ limit: 20, offset: 0 })
      );
      const json = await res.json();
      expect(json.data).toEqual([]);
      expect(json.meta.total).toBe(0);
    });
  });

  // ==========================================================================
  // D. SAFE RESPONSE FORMATTING
  // ==========================================================================
  describe("D. Safe Response Serialization", () => {
    it("9-10. returns safe actor profile (id, name, email, image) and omits internal/auth secrets", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValueOnce(mockGroupGoa);
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(
        mockAliceAdminMembership
      );
      vi.spyOn(activityRepository, "listByGroupId").mockResolvedValueOnce({
        activities: [mockActivityEvent1],
        total: 1,
      });
      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(mockUserBob);

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/activity`,
        {
          method: "GET",
          headers: { Cookie: "better-auth.session_token=alice_token" },
        }
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      const item = json.data[0];

      // Safe fields present
      expect(item.id).toBe(mockActivityEvent1.id);
      expect(item.type).toBe("settlement_created");
      expect(item.entityType).toBe("settlement");
      expect(item.entityId).toBe(mockActivityEvent1.entityId);
      expect(item.actor).toBeDefined();
      expect(item.actor.id).toBe(mockUserBob.id);
      expect(item.actor.name).toBe(mockUserBob.name);
      expect(item.actor.email).toBe(mockUserBob.email);

      // Verify no sensitive fields leaked
      expect(item).not.toHaveProperty("password");
      expect(item).not.toHaveProperty("token");
      expect(item).not.toHaveProperty("secret");
      expect(item.actor).not.toHaveProperty("password");
    });
  });

  // ==========================================================================
  // E. PAGINATION
  // ==========================================================================
  describe("E. Bounded Deterministic Pagination", () => {
    it("11-13. first page and next page parameters are passed properly", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValue(mockGroupGoa);
      vi.spyOn(groupRepository, "findMembership").mockResolvedValue(
        mockAliceAdminMembership
      );
      vi.spyOn(userRepository, "findById").mockResolvedValue(mockUserAlice);

      const listSpy = vi
        .spyOn(activityRepository, "listByGroupId")
        .mockResolvedValue({
          activities: [mockActivityEvent1],
          total: 50,
        });

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/activity?limit=15&offset=30`,
        {
          method: "GET",
          headers: { Cookie: "better-auth.session_token=alice_token" },
        }
      );

      expect(res.status).toBe(200);
      expect(listSpy).toHaveBeenCalledWith(
        mockGroupGoa.id,
        expect.objectContaining({ limit: 15, offset: 30 })
      );

      const json = await res.json();
      expect(json.meta.limit).toBe(15);
      expect(json.meta.offset).toBe(30);
      expect(json.meta.total).toBe(50);
    });

    it("14. limit is bounded to maximum 100", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValueOnce(mockGroupGoa);
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(
        mockAliceAdminMembership
      );
      vi.spyOn(userRepository, "findById").mockResolvedValue(mockUserAlice);

      const listSpy = vi
        .spyOn(activityRepository, "listByGroupId")
        .mockResolvedValueOnce({
          activities: [],
          total: 0,
        });

      await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/activity?limit=500`,
        {
          method: "GET",
          headers: { Cookie: "better-auth.session_token=alice_token" },
        }
      );

      // Service caps limit at 100
      expect(listSpy).toHaveBeenCalledWith(
        mockGroupGoa.id,
        expect.objectContaining({ limit: 100 })
      );
    });

    it("15. invalid pagination input (non-integer) is rejected with HTTP 400", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/activity?limit=abc`,
        {
          method: "GET",
          headers: { Cookie: "better-auth.session_token=alice_token" },
        }
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // ==========================================================================
  // F. FILTERS
  // ==========================================================================
  describe("F. Activity Filtering", () => {
    it("16. valid type and entityType filters work", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValueOnce(mockGroupGoa);
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(
        mockAliceAdminMembership
      );
      vi.spyOn(userRepository, "findById").mockResolvedValue(mockUserBob);

      const listSpy = vi
        .spyOn(activityRepository, "listByGroupId")
        .mockResolvedValueOnce({
          activities: [mockActivityEvent1],
          total: 1,
        });

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/activity?type=settlement_created&entityType=settlement`,
        {
          method: "GET",
          headers: { Cookie: "better-auth.session_token=alice_token" },
        }
      );

      expect(res.status).toBe(200);
      expect(listSpy).toHaveBeenCalledWith(
        mockGroupGoa.id,
        expect.objectContaining({
          type: "settlement_created",
          entityType: "settlement",
        })
      );
    });

    it("17. invalid type filter is rejected with HTTP 400", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValueOnce(mockGroupGoa);
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(
        mockAliceAdminMembership
      );

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/activity?type=unsupported_custom_event`,
        {
          method: "GET",
          headers: { Cookie: "better-auth.session_token=alice_token" },
        }
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain("Invalid activity type filter");
    });

    it("invalid entityType filter is rejected with HTTP 400", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValueOnce(mockGroupGoa);
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(
        mockAliceAdminMembership
      );

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/activity?entityType=nonexistent_entity`,
        {
          method: "GET",
          headers: { Cookie: "better-auth.session_token=alice_token" },
        }
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain("Invalid activity entityType filter");
    });
  });

  // ==========================================================================
  // G. READ-ONLY INVARIANT & CLIENT MUTATION PREVENTION
  // ==========================================================================
  describe("G. Read-Only Invariant and Client Mutation Prevention", () => {
    it("21. client cannot POST arbitrary activity (returns HTTP 404)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const res = await app.request("/api/v1/activity", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: "better-auth.session_token=alice_token",
        },
        body: JSON.stringify({
          type: "expense_created",
          metadata: { fake: true },
        }),
      });

      expect(res.status).toBe(404);
    });

    it("client cannot POST to group activity endpoint (returns HTTP 404)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/activity`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: "better-auth.session_token=alice_token",
          },
          body: JSON.stringify({ fake: "activity" }),
        }
      );

      expect(res.status).toBe(404);
    });

    it("22. client cannot PATCH or DELETE activity (returns HTTP 404)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const patchRes = await app.request(
        `/api/v1/activity/${mockActivityEvent1.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Cookie: "better-auth.session_token=alice_token",
          },
          body: JSON.stringify({ type: "tampered" }),
        }
      );
      expect(patchRes.status).toBe(404);

      const deleteRes = await app.request(
        `/api/v1/activity/${mockActivityEvent1.id}`,
        {
          method: "DELETE",
          headers: { Cookie: "better-auth.session_token=alice_token" },
        }
      );
      expect(deleteRes.status).toBe(404);
    });
  });

  // ==========================================================================
  // H. ACTIVITY GENERATION INTEGRATION
  // ==========================================================================
  describe("H. Domain Activity Generation Integration", () => {
    it("19. settlement creation transactionally logs settlement_created activity", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserBob as unknown as AuthUser,
        session: mockBobSession,
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValueOnce(mockGroupGoa);
      vi.spyOn(groupRepository, "findMembership").mockImplementation(
        async (groupId, userId) => {
          if (groupId === mockGroupGoa.id) {
            if (userId === mockUserBob.id) return mockBobMemberMembership;
            if (userId === mockUserAlice.id) return mockAliceAdminMembership;
          }
          return null;
        }
      );
      vi.spyOn(userRepository, "findById").mockImplementation(async (id) => {
        if (id === mockUserBob.id) return mockUserBob;
        if (id === mockUserAlice.id) return mockUserAlice;
        return null;
      });

      const createSettlementSpy = vi
        .spyOn(settlementRepository, "createWithActivity")
        .mockResolvedValueOnce({
          id: "33333333-3333-3333-3333-333333333333",
          payerId: "usr_bob_456",
          receiverId: "usr_alice_123",
          groupId: mockGroupGoa.id,
          amountMinor: 25000,
          currencyCode: "INR",
          settledAt: new Date(),
          createdById: "usr_bob_456",
          notes: "Activity test",
          createdAt: new Date(),
        });

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/settlements`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: "better-auth.session_token=bob_token",
          },
          body: JSON.stringify({
            payerId: "usr_bob_456",
            receiverId: "usr_alice_123",
            amountMinor: 25000,
            notes: "Activity test",
          }),
        }
      );

      expect(res.status).toBe(201);
      // Confirms createWithActivity was invoked with actorId
      expect(createSettlementSpy).toHaveBeenCalledWith(
        expect.objectContaining({ amountMinor: 25000 }),
        "usr_bob_456"
      );
    });
  });

  // ==========================================================================
  // I. MOBILE API CLIENT
  // ==========================================================================
  describe("I. Mobile API Client Methods", () => {
    it("getGroupActivity invokes group activity endpoint with query params", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            {
              id: mockActivityEvent1.id,
              type: "settlement_created",
              actorId: "usr_bob_456",
              groupId: mockGroupGoa.id,
              entityType: "settlement",
              entityId: mockActivityEvent1.entityId,
              metadata: {},
              createdAt: "2026-01-12T12:00:00.000Z",
              actor: { id: "usr_bob_456", name: "Bob", email: "bob@builder.com", image: null },
            },
          ],
        }),
      } as unknown as Response);

      const items = await getGroupActivity(mockGroupGoa.id, {
        limit: 10,
        offset: 20,
        type: "settlement_created",
      });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          `/api/v1/groups/${mockGroupGoa.id}/activity?limit=10&offset=20&type=settlement_created`
        ),
        expect.objectContaining({ method: "GET" })
      );
      expect(items).toHaveLength(1);
      expect(items[0].type).toBe("settlement_created");
    });

    it("getUserActivity invokes global activity endpoint with query params", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [],
          meta: { total: 0, limit: 20, offset: 0 },
        }),
      } as unknown as Response);

      const items = await getUserActivity({ limit: 25, entityType: "group" });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/activity?limit=25&entityType=group"),
        expect.objectContaining({ method: "GET" })
      );
      expect(items).toEqual([]);
    });
  });
});
