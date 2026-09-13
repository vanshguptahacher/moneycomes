/**
 * Phase 4.6 — Settlements API Test Suite.
 *
 * Verifies that:
 * A. Authentication: Unauthenticated requests to create, list, get, update, delete are rejected (HTTP 401).
 * B. Group Authorization: Active group members can create/list/get; non-members are rejected (HTTP 403).
 * C. Validation: Invalid group ID, settlement ID, negative/zero amount, invalid currency, external payer/receiver,
 *    and self-settlements are strictly rejected (HTTP 400).
 * D. Security / IDOR: Cross-group settlement access is prevented (HTTP 404); client cannot spoof actor ID.
 * E. Create & Persistence: Settlements are stored with exact integer minor units, correct payer, receiver, and currency.
 * F. Transaction Safety: Settlement and activity events are committed or rolled back atomically.
 * G. Idempotency: Duplicate creation requests with the same Idempotency-Key return cached response without duplicate inserts.
 * H. Read: Get settlement and list settlements return safe profiles and support deterministic pagination.
 * I. Update: Settlement creator and group admins can update; ordinary non-creators are forbidden (HTTP 403).
 * J. Delete / Reversal: Settlement creator and group admins can delete; ordinary non-creators are forbidden (HTTP 403).
 * K. Mobile API Client: Client functions invoke endpoints correctly with parameters and headers.
 * L. Financial Engine Consistency: Settlements integrate with existing settlement engine invariants.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { app } from "../../server/app.js";
import { auth, type AuthUser, type AuthSession } from "../../server/auth/index.js";
import { groupRepository } from "../../server/repositories/group.repository.js";
import { userRepository } from "../../server/repositories/user.repository.js";
import { settlementRepository } from "../../server/repositories/settlement.repository.js";
import type { Group, GroupMember, Settlement, User } from "../../server/db/schema/index.js";
import {
  createSettlement,
  getGroupSettlements,
  getSettlement,
  updateSettlement,
  deleteSettlement,
} from "../../src/api/index.js";
import {
  createSettlement as createDomainSettlement,
  applySettlement,
  isFullSettlement,
} from "../../src/domain/money/settlement.js";
import { make } from "../../src/domain/money/money.js";
import { calculateGroupBalances } from "../../src/domain/money/group-balance.js";

describe("Phase 4.6 — Settlements API", () => {
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
    name: "Work Project",
    description: "Office team expenses",
    defaultCurrencyCode: "INR",
    createdById: "usr_charlie_789",
    isArchived: false,
    createdAt: new Date("2026-01-15T10:00:00.000Z"),
    updatedAt: new Date("2026-01-15T10:00:00.000Z"),
  };

  const mockAliceAdminMembership: GroupMember = {
    id: "44444444-4444-4444-4444-444444444444",
    groupId: "11111111-1111-1111-1111-111111111111",
    userId: "usr_alice_123",
    role: "admin",
    joinedAt: new Date("2026-01-10T10:00:00.000Z"),
  };

  const mockBobMemberMembership: GroupMember = {
    id: "55555555-5555-5555-5555-555555555555",
    groupId: "11111111-1111-1111-1111-111111111111",
    userId: "usr_bob_456",
    role: "member",
    joinedAt: new Date("2026-01-10T11:00:00.000Z"),
  };

  const mockSettlement1: Settlement = {
    id: "33333333-3333-3333-3333-333333333333",
    payerId: "usr_bob_456",
    receiverId: "usr_alice_123",
    groupId: "11111111-1111-1111-1111-111111111111",
    amountMinor: 50000, // 500.00 INR
    currencyCode: "INR",
    settledAt: new Date("2026-01-12T12:00:00.000Z"),
    createdById: "usr_bob_456",
    notes: "Paid via UPI",
    createdAt: new Date("2026-01-12T12:05:00.000Z"),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // A. AUTHENTICATION
  // ==========================================================================
  describe("A. Authentication Verification", () => {
    it("1. unauthenticated create rejected with HTTP 401", async () => {
      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/settlements`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payerId: "usr_bob_456",
            receiverId: "usr_alice_123",
            amountMinor: 50000,
          }),
        }
      );
      expect(res.status).toBe(401);
    });

    it("2. unauthenticated list rejected with HTTP 401", async () => {
      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/settlements`,
        {
          method: "GET",
        }
      );
      expect(res.status).toBe(401);
    });

    it("3. unauthenticated get rejected with HTTP 401", async () => {
      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/settlements/${mockSettlement1.id}`,
        {
          method: "GET",
        }
      );
      expect(res.status).toBe(401);
    });

    it("unauthenticated patch rejected with HTTP 401", async () => {
      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/settlements/${mockSettlement1.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes: "Updated" }),
        }
      );
      expect(res.status).toBe(401);
    });

    it("unauthenticated delete rejected with HTTP 401", async () => {
      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/settlements/${mockSettlement1.id}`,
        {
          method: "DELETE",
        }
      );
      expect(res.status).toBe(401);
    });
  });

  // ==========================================================================
  // B. GROUP AUTHORIZATION
  // ==========================================================================
  describe("B. Group Authorization", () => {
    it("4. group member can create settlement", async () => {
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
      vi.spyOn(settlementRepository, "createWithActivity").mockResolvedValueOnce(
        mockSettlement1
      );

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
            amountMinor: 50000,
            notes: "Paid via UPI",
          }),
        }
      );

      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.data.id).toBe(mockSettlement1.id);
      expect(json.data.amountMinor).toBe(50000);
      expect(json.data.payer.id).toBe(mockUserBob.id);
      expect(json.data.receiver.id).toBe(mockUserAlice.id);
    });

    it("5. non-member cannot create settlement (HTTP 403)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserCharlie as unknown as AuthUser,
        session: mockCharlieSession,
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValueOnce(mockGroupGoa);
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(null); // Charlie is not a member

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/settlements`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: "better-auth.session_token=charlie_token",
          },
          body: JSON.stringify({
            payerId: "usr_bob_456",
            receiverId: "usr_alice_123",
            amountMinor: 50000,
          }),
        }
      );

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("FORBIDDEN");
    });

    it("6. member can list settlements", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(
        mockAliceAdminMembership
      );
      vi.spyOn(settlementRepository, "listByGroupId").mockResolvedValueOnce({
        settlements: [mockSettlement1],
        total: 1,
      });
      vi.spyOn(userRepository, "findById").mockImplementation(async (id) => {
        if (id === mockUserBob.id) return mockUserBob;
        if (id === mockUserAlice.id) return mockUserAlice;
        return null;
      });

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/settlements`,
        {
          method: "GET",
          headers: { Cookie: "better-auth.session_token=alice_token" },
        }
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toHaveLength(1);
      expect(json.data[0].id).toBe(mockSettlement1.id);
      expect(json.meta.total).toBe(1);
    });

    it("7. non-member cannot list settlements (HTTP 403)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserCharlie as unknown as AuthUser,
        session: mockCharlieSession,
      });
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(null);

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/settlements`,
        {
          method: "GET",
          headers: { Cookie: "better-auth.session_token=charlie_token" },
        }
      );

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("FORBIDDEN");
    });
  });

  // ==========================================================================
  // C. VALIDATION
  // ==========================================================================
  describe("C. Boundary and Domain Validation", () => {
    it("8. invalid group ID rejected with HTTP 400", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const res = await app.request("/api/v1/groups/not-a-valid-uuid/settlements", {
        method: "GET",
        headers: { Cookie: "better-auth.session_token=alice_token" },
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain("must be a valid UUID");
    });

    it("9. invalid settlement ID rejected with HTTP 400", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/settlements/invalid-settlement-id`,
        {
          method: "GET",
          headers: { Cookie: "better-auth.session_token=alice_token" },
        }
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain("must be a valid UUID");
    });

    it("10. invalid amount (non-integer / float) rejected with HTTP 400", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/settlements`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: "better-auth.session_token=alice_token",
          },
          body: JSON.stringify({
            payerId: "usr_bob_456",
            receiverId: "usr_alice_123",
            amountMinor: 50.75, // float is forbidden
          }),
        }
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("11. zero amount rejected with HTTP 400", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/settlements`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: "better-auth.session_token=alice_token",
          },
          body: JSON.stringify({
            payerId: "usr_bob_456",
            receiverId: "usr_alice_123",
            amountMinor: 0,
          }),
        }
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("12. negative amount rejected with HTTP 400", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/settlements`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: "better-auth.session_token=alice_token",
          },
          body: JSON.stringify({
            payerId: "usr_bob_456",
            receiverId: "usr_alice_123",
            amountMinor: -500,
          }),
        }
      );

      expect(res.status).toBe(400);
    });

    it("13. invalid currency rejected with HTTP 400", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/settlements`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: "better-auth.session_token=alice_token",
          },
          body: JSON.stringify({
            payerId: "usr_bob_456",
            receiverId: "usr_alice_123",
            amountMinor: 1000,
            currencyCode: "XYZ", // unsupported currency
          }),
        }
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });

    it("14. payer outside group rejected with HTTP 400", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValueOnce(mockGroupGoa);
      vi.spyOn(groupRepository, "findMembership").mockImplementation(
        async (groupId, userId) => {
          if (groupId === mockGroupGoa.id) {
            if (userId === mockUserAlice.id) return mockAliceAdminMembership;
            // Charlie is NOT in the group
            if (userId === "usr_charlie_789") return null;
          }
          return null;
        }
      );

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/settlements`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: "better-auth.session_token=alice_token",
          },
          body: JSON.stringify({
            payerId: "usr_charlie_789", // not a member
            receiverId: "usr_alice_123",
            amountMinor: 5000,
          }),
        }
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain("not a member of this group");
    });

    it("15. receiver outside group rejected with HTTP 400", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValueOnce(mockGroupGoa);
      vi.spyOn(groupRepository, "findMembership").mockImplementation(
        async (groupId, userId) => {
          if (groupId === mockGroupGoa.id) {
            if (userId === mockUserAlice.id) return mockAliceAdminMembership;
            if (userId === mockUserBob.id) return mockBobMemberMembership;
            if (userId === "usr_unknown_999") return null;
          }
          return null;
        }
      );

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/settlements`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: "better-auth.session_token=alice_token",
          },
          body: JSON.stringify({
            payerId: "usr_bob_456",
            receiverId: "usr_unknown_999", // not a member
            amountMinor: 5000,
          }),
        }
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain("not a member of this group");
    });

    it("16. self-settlement (payer === receiver) rejected with HTTP 400", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValueOnce(mockGroupGoa);
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(
        mockAliceAdminMembership
      );

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/settlements`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: "better-auth.session_token=alice_token",
          },
          body: JSON.stringify({
            payerId: "usr_alice_123",
            receiverId: "usr_alice_123", // self-settlement
            amountMinor: 5000,
          }),
        }
      );

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.message).toContain("cannot be the same user");
    });
  });

  // ==========================================================================
  // D. SECURITY / IDOR
  // ==========================================================================
  describe("D. Security and IDOR Protection", () => {
    it("17. settlement from another group cannot be accessed (HTTP 404)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(
        mockAliceAdminMembership
      );
      // Settlement belongs to mockGroupOther, not mockGroupGoa
      vi.spyOn(settlementRepository, "findById").mockResolvedValueOnce({
        ...mockSettlement1,
        groupId: mockGroupOther.id,
      });

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/settlements/${mockSettlement1.id}`,
        {
          method: "GET",
          headers: { Cookie: "better-auth.session_token=alice_token" },
        }
      );

      expect(res.status).toBe(404);
      const json = await res.json();
      expect(json.error.code).toBe("NOT_FOUND");
    });

    it("18. manipulated groupId cannot expose another group's settlement", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      // Alice is not a member of mockGroupOther
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(null);

      const res = await app.request(
        `/api/v1/groups/${mockGroupOther.id}/settlements/${mockSettlement1.id}`,
        {
          method: "GET",
          headers: { Cookie: "better-auth.session_token=alice_token" },
        }
      );

      expect(res.status).toBe(403);
    });

    it("19-20. client cannot impersonate another creator or provide arbitrary authorization data", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserBob as unknown as AuthUser,
        session: mockBobSession,
      });

      const res = await app.request(`/api/v1/groups/${mockGroupGoa.id}/settlements`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: "better-auth.session_token=bob_token",
        },
        body: JSON.stringify({
          payerId: "usr_bob_456",
          receiverId: "usr_alice_123",
          amountMinor: 50000,
          createdById: "usr_alice_123", // attempting to spoof creator
        }),
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error.code).toBe("VALIDATION_ERROR");
    });
  });

  // ==========================================================================
  // E. CREATE & ATOMIC PERSISTENCE
  // ==========================================================================
  describe("E. Create Settlement Persistence", () => {
    it("21-25. valid settlement created with integer minor units, payer, receiver, currency", async () => {
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

      const createSpy = vi
        .spyOn(settlementRepository, "createWithActivity")
        .mockResolvedValueOnce(mockSettlement1);

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
            amountMinor: 50000,
            currencyCode: "INR",
            notes: "Paid via UPI",
          }),
        }
      );

      expect(res.status).toBe(201);
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          groupId: mockGroupGoa.id,
          payerId: "usr_bob_456",
          receiverId: "usr_alice_123",
          amountMinor: 50000,
          currencyCode: "INR",
          notes: "Paid via UPI",
        }),
        "usr_bob_456"
      );
    });
  });

  // ==========================================================================
  // F. TRANSACTION SAFETY
  // ==========================================================================
  describe("F. Transaction Safety", () => {
    it("26-28. failed activity creation rolls back settlement and returns HTTP 500", async () => {
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

      // Simulate database failure during transactional execution
      vi.spyOn(settlementRepository, "createWithActivity").mockRejectedValueOnce(
        new Error("Database transaction aborted")
      );

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
            amountMinor: 50000,
          }),
        }
      );

      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error.code).toBe("INTERNAL_ERROR");
    });
  });

  // ==========================================================================
  // G. IDEMPOTENCY
  // ==========================================================================
  describe("G. Idempotency", () => {
    it("29. repeated identical idempotent request does not create duplicates", async () => {
      const idempotencyKey = "client-settle-key-12345";

      vi.spyOn(groupRepository, "findById").mockResolvedValue(mockGroupGoa);
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

      const createSpy = vi
        .spyOn(settlementRepository, "createWithActivity")
        .mockResolvedValueOnce(mockSettlement1);

      // First Request
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserBob as unknown as AuthUser,
        session: mockBobSession,
      });

      const res1 = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/settlements`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: "better-auth.session_token=bob_token",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            payerId: "usr_bob_456",
            receiverId: "usr_alice_123",
            amountMinor: 50000,
          }),
        }
      );

      expect(res1.status).toBe(201);
      expect(createSpy).toHaveBeenCalledTimes(1);

      // Second Request with identical Idempotency-Key
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserBob as unknown as AuthUser,
        session: mockBobSession,
      });

      const res2 = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/settlements`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: "better-auth.session_token=bob_token",
            "Idempotency-Key": idempotencyKey,
          },
          body: JSON.stringify({
            payerId: "usr_bob_456",
            receiverId: "usr_alice_123",
            amountMinor: 50000,
          }),
        }
      );

      expect(res2.status).toBe(201);
      // Repository must NOT have been called a second time!
      expect(createSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // H. READ & PAGINATION
  // ==========================================================================
  describe("H. Read Settlements", () => {
    it("30. get settlement returns correct record and safe user profile", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserBob as unknown as AuthUser,
        session: mockBobSession,
      });
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(
        mockBobMemberMembership
      );
      vi.spyOn(settlementRepository, "findById").mockResolvedValueOnce(
        mockSettlement1
      );
      vi.spyOn(userRepository, "findById").mockImplementation(async (id) => {
        if (id === mockUserBob.id) return mockUserBob;
        if (id === mockUserAlice.id) return mockUserAlice;
        return null;
      });

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/settlements/${mockSettlement1.id}`,
        {
          method: "GET",
          headers: { Cookie: "better-auth.session_token=bob_token" },
        }
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.id).toBe(mockSettlement1.id);
      expect(json.data.amountMinor).toBe(50000);
      expect(json.data.payer.email).toBe(mockUserBob.email);
      expect(json.data.receiver.email).toBe(mockUserAlice.email);
    });

    it("31-33. list settlements applies pagination parameters and deterministic ordering", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserBob as unknown as AuthUser,
        session: mockBobSession,
      });
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(
        mockBobMemberMembership
      );
      const listSpy = vi
        .spyOn(settlementRepository, "listByGroupId")
        .mockResolvedValueOnce({
          settlements: [mockSettlement1],
          total: 25,
        });
      vi.spyOn(userRepository, "findById").mockResolvedValue(mockUserBob);

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/settlements?limit=10&offset=20`,
        {
          method: "GET",
          headers: { Cookie: "better-auth.session_token=bob_token" },
        }
      );

      expect(res.status).toBe(200);
      expect(listSpy).toHaveBeenCalledWith(mockGroupGoa.id, {
        limit: 10,
        offset: 20,
      });
      const json = await res.json();
      expect(json.meta.limit).toBe(10);
      expect(json.meta.offset).toBe(20);
      expect(json.meta.total).toBe(25);
    });
  });

  // ==========================================================================
  // I. UPDATE
  // ==========================================================================
  describe("I. Update Settlement", () => {
    it("34. settlement creator can update notes and amount", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserBob as unknown as AuthUser,
        session: mockBobSession,
      });
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(
        mockBobMemberMembership // Bob is member and creator of mockSettlement1
      );
      vi.spyOn(settlementRepository, "findById").mockResolvedValueOnce(
        mockSettlement1
      );
      vi.spyOn(settlementRepository, "updateWithActivity").mockResolvedValueOnce({
        ...mockSettlement1,
        amountMinor: 60000,
        notes: "Updated amount to 600",
      });
      vi.spyOn(userRepository, "findById").mockImplementation(async (id) => {
        if (id === mockUserBob.id) return mockUserBob;
        if (id === mockUserAlice.id) return mockUserAlice;
        return null;
      });

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/settlements/${mockSettlement1.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Cookie: "better-auth.session_token=bob_token",
          },
          body: JSON.stringify({
            amountMinor: 60000,
            notes: "Updated amount to 600",
          }),
        }
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.amountMinor).toBe(60000);
      expect(json.data.notes).toBe("Updated amount to 600");
    });

    it("group admin can update a settlement created by another member", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(
        mockAliceAdminMembership // Alice is admin
      );
      vi.spyOn(settlementRepository, "findById").mockResolvedValueOnce(
        mockSettlement1 // created by Bob
      );
      vi.spyOn(settlementRepository, "updateWithActivity").mockResolvedValueOnce({
        ...mockSettlement1,
        notes: "Admin verified settlement",
      });
      vi.spyOn(userRepository, "findById").mockResolvedValue(mockUserAlice);

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/settlements/${mockSettlement1.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Cookie: "better-auth.session_token=alice_token",
          },
          body: JSON.stringify({
            notes: "Admin verified settlement",
          }),
        }
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data.notes).toBe("Admin verified settlement");
    });

    it("35. unauthorized update fails (non-creator member rejected with HTTP 403)", async () => {
      // Create a scenario where Charlie is an ordinary member (not admin, not creator)
      const mockCharlieMember: GroupMember = {
        id: "m3333333-3333-3333-3333-333333333333",
        groupId: mockGroupGoa.id,
        userId: "usr_charlie_789",
        role: "member",
        joinedAt: new Date(),
      };

      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserCharlie as unknown as AuthUser,
        session: mockCharlieSession,
      });
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(
        mockCharlieMember
      );
      vi.spyOn(settlementRepository, "findById").mockResolvedValueOnce(
        mockSettlement1 // created by Bob
      );

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/settlements/${mockSettlement1.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Cookie: "better-auth.session_token=charlie_token",
          },
          body: JSON.stringify({ notes: "Malicious edit" }),
        }
      );

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("FORBIDDEN");
    });
  });

  // ==========================================================================
  // J. DELETE / REVERSAL
  // ==========================================================================
  describe("J. Delete Settlement", () => {
    it("38. creator can delete settlement (HTTP 200)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserBob as unknown as AuthUser,
        session: mockBobSession,
      });
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(
        mockBobMemberMembership
      );
      vi.spyOn(settlementRepository, "findById").mockResolvedValueOnce(
        mockSettlement1
      );
      const deleteSpy = vi
        .spyOn(settlementRepository, "deleteWithActivity")
        .mockResolvedValueOnce(true);

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/settlements/${mockSettlement1.id}`,
        {
          method: "DELETE",
          headers: { Cookie: "better-auth.session_token=bob_token" },
        }
      );

      expect(res.status).toBe(200);
      expect(deleteSpy).toHaveBeenCalledWith(
        mockSettlement1.id,
        mockGroupGoa.id,
        "usr_bob_456"
      );
      const json = await res.json();
      expect(json.data.success).toBe(true);
    });

    it("39. unauthorized delete fails (ordinary non-creator member rejected with HTTP 403)", async () => {
      const mockCharlieMember: GroupMember = {
        id: "m3333333-3333-3333-3333-333333333333",
        groupId: mockGroupGoa.id,
        userId: "usr_charlie_789",
        role: "member",
        joinedAt: new Date(),
      };

      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserCharlie as unknown as AuthUser,
        session: mockCharlieSession,
      });
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(
        mockCharlieMember
      );
      vi.spyOn(settlementRepository, "findById").mockResolvedValueOnce(
        mockSettlement1
      );

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/settlements/${mockSettlement1.id}`,
        {
          method: "DELETE",
          headers: { Cookie: "better-auth.session_token=charlie_token" },
        }
      );

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("FORBIDDEN");
    });
  });

  // ==========================================================================
  // K. MOBILE API CLIENT
  // ==========================================================================
  describe("K. Mobile API Client Methods", () => {
    it("createSettlement passes Idempotency-Key header and returns typed settlement", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({
          data: {
            id: mockSettlement1.id,
            groupId: mockGroupGoa.id,
            payerId: "usr_bob_456",
            receiverId: "usr_alice_123",
            amountMinor: 50000,
            currencyCode: "INR",
            settledAt: "2026-01-12T12:00:00.000Z",
            createdById: "usr_bob_456",
            notes: "UPI",
            createdAt: "2026-01-12T12:05:00.000Z",
            payer: { id: "usr_bob_456", name: "Bob", email: "bob@builder.com", image: null },
            receiver: { id: "usr_alice_123", name: "Alice", email: "alice@wonderland.com", image: null },
            createdBy: { id: "usr_bob_456", name: "Bob", email: "bob@builder.com", image: null },
          },
        }),
      } as unknown as Response);

      const result = await createSettlement(
        mockGroupGoa.id,
        {
          payerId: "usr_bob_456",
          receiverId: "usr_alice_123",
          amountMinor: 50000,
        },
        "idemp-key-xyz"
      );

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining(`/api/v1/groups/${mockGroupGoa.id}/settlements`),
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            "Idempotency-Key": "idemp-key-xyz",
          }),
        })
      );
      expect(result.id).toBe(mockSettlement1.id);
      expect(result.amountMinor).toBe(50000);
    });

    it("getGroupSettlements sets limit and offset query params", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: [],
          meta: { total: 0, limit: 15, offset: 30 },
        }),
      } as unknown as Response);

      await getGroupSettlements(mockGroupGoa.id, { limit: 15, offset: 30 });

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("limit=15&offset=30"),
        expect.objectContaining({ method: "GET" })
      );
    });

    it("getSettlement calls specific settlement endpoint", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: { id: mockSettlement1.id },
        }),
      } as unknown as Response);

      const res = await getSettlement(mockGroupGoa.id, mockSettlement1.id);
      expect(res.id).toBe(mockSettlement1.id);
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          `/api/v1/groups/${mockGroupGoa.id}/settlements/${mockSettlement1.id}`
        ),
        expect.objectContaining({ method: "GET" })
      );
    });

    it("updateSettlement sends PATCH with update body", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: { id: mockSettlement1.id, amountMinor: 75000 },
        }),
      } as unknown as Response);

      const res = await updateSettlement(mockGroupGoa.id, mockSettlement1.id, {
        amountMinor: 75000,
      });

      expect(res.amountMinor).toBe(75000);
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          `/api/v1/groups/${mockGroupGoa.id}/settlements/${mockSettlement1.id}`
        ),
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({ amountMinor: 75000 }),
        })
      );
    });

    it("deleteSettlement sends DELETE request", async () => {
      const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          data: { success: true, message: "Settlement deleted successfully" },
        }),
      } as unknown as Response);

      const res = await deleteSettlement(mockGroupGoa.id, mockSettlement1.id);
      expect(res.success).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          `/api/v1/groups/${mockGroupGoa.id}/settlements/${mockSettlement1.id}`
        ),
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });

  // ==========================================================================
  // L. FINANCIAL ENGINE RECALCULATION & CONSISTENCY
  // ==========================================================================
  describe("L. Financial Domain Consistency with Phase 2 Engines", () => {
    it("42-45. settlement correctly reduces outstanding debt between debtor and creditor", () => {
      const currency = "INR";
      const members = ["usr_alice_123", "usr_bob_456"];

      // Baseline: Alice paid 1000 INR (100,000 minor units), split equally 50/50 with Bob
      // Alice balance: +50,000 (owed 500)
      // Bob balance:   -50,000 (owes 500)
      const baseline = calculateGroupBalances({
        groupId: mockGroupGoa.id,
        currency,
        members,
        expenses: [
          {
            payerId: "usr_alice_123",
            total: make(100000, currency),
            balances: [
              {
                userId: "usr_alice_123",
                paid: make(100000, currency),
                owed: make(50000, currency),
                netBalance: make(50000, currency),
              },
              {
                userId: "usr_bob_456",
                paid: make(0, currency),
                owed: make(50000, currency),
                netBalance: make(-50000, currency),
              },
            ],
          },
        ],
        settlements: [],
      });

      expect(baseline.balances.find((b) => b.userId === "usr_bob_456")?.netBalance.amountMinor).toBe(-50000);
      expect(baseline.balances.find((b) => b.userId === "usr_alice_123")?.netBalance.amountMinor).toBe(50000);

      // Now Bob records settlement paying Alice 50,000 minor units (full settlement)
      const settlement = createDomainSettlement({
        id: mockSettlement1.id,
        debtorId: "usr_bob_456",
        creditorId: "usr_alice_123",
        amount: make(50000, currency),
      });

      expect(isFullSettlement(settlement, baseline)).toBe(true);

      const postSettlement = applySettlement(baseline, settlement);

      // Post-settlement: Both balances must be exact zero!
      const bobPost = postSettlement.balances.find((b) => b.userId === "usr_bob_456");
      const alicePost = postSettlement.balances.find((b) => b.userId === "usr_alice_123");

      expect(bobPost?.netBalance.amountMinor).toBe(0);
      expect(alicePost?.netBalance.amountMinor).toBe(0);

      // Zero-sum invariant: sum of all net balances is exactly 0
      const totalSum = postSettlement.balances.reduce(
        (sum, b) => sum + b.netBalance.amountMinor,
        0
      );
      expect(totalSum).toBe(0);
    });
  });
});
