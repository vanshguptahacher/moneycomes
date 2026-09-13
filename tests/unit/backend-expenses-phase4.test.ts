import { describe, it, expect, vi, beforeEach } from "vitest";
import { app } from "../../server/app.js";
import { auth, type AuthUser, type AuthSession } from "../../server/auth/index.js";
import { groupRepository } from "../../server/repositories/group.repository.js";
import { userRepository } from "../../server/repositories/user.repository.js";
import { expenseRepository } from "../../server/repositories/expense.repository.js";
import { notificationRepository } from "../../server/repositories/notification.repository.js";
import type { Group, GroupMember, Expense, ExpenseSplit, User, Notification } from "../../server/db/schema/index.js";
import {
  createExpense,
  getExpense,
  getGroupExpenses,
  updateExpense,
  deleteExpense,
} from "../../src/api/index.js";

describe("Phase 4.10 — Expenses API & Split Engine Hardening", () => {
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

  const mockGroup: Group = {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Goa Trip 2026",
    description: "Vacation expenses in Goa",
    defaultCurrencyCode: "INR",
    createdById: "usr_alice_123",
    isArchived: false,
    createdAt: new Date("2026-01-10T10:00:00.000Z"),
    updatedAt: new Date("2026-01-10T10:00:00.000Z"),
  };

  const mockAliceAdminMembership: GroupMember = {
    id: "mem_alice_admin",
    groupId: mockGroup.id,
    userId: "usr_alice_123",
    role: "admin",
    joinedAt: new Date("2026-01-10T10:00:00.000Z"),
  };

  const mockBobMemberMembership: GroupMember = {
    id: "mem_bob_member",
    groupId: mockGroup.id,
    userId: "usr_bob_456",
    role: "member",
    joinedAt: new Date("2026-01-10T11:00:00.000Z"),
  };

  const mockExpense: Expense = {
    id: "33333333-3333-3333-3333-333333333333",
    groupId: mockGroup.id,
    payerId: "usr_alice_123",
    createdById: "usr_alice_123",
    categoryId: null,
    description: "Dinner at Beach Shack",
    amountMinor: 30000, // 300.00 INR
    currencyCode: "INR",
    splitMethod: "equal",
    date: new Date("2026-01-11T20:00:00.000Z"),
    notes: "Delicious sea food",
    receiptUrl: null,
    isDeleted: false,
    createdAt: new Date("2026-01-11T20:30:00.000Z"),
    updatedAt: new Date("2026-01-11T20:30:00.000Z"),
  };

  const mockSplits: ExpenseSplit[] = [
    {
      id: "split_1",
      expenseId: mockExpense.id,
      userId: "usr_alice_123",
      allocatedAmountMinor: 15000,
      percentageBasisPoints: null,
      shares: null,
      createdAt: new Date("2026-01-11T20:30:00.000Z"),
    },
    {
      id: "split_2",
      expenseId: mockExpense.id,
      userId: "usr_bob_456",
      allocatedAmountMinor: 15000,
      percentageBasisPoints: null,
      shares: null,
      createdAt: new Date("2026-01-11T20:30:00.000Z"),
    },
  ];

  const dummyNotification: Notification = {
    id: "notif_dummy",
    recipientId: "usr_alice_123",
    actorId: null,
    type: "expense_created",
    title: "New Expense Added",
    message: "dummy",
    groupId: null,
    expenseId: null,
    settlementId: null,
    activityId: null,
    metadata: {},
    readAt: null,
    createdAt: new Date(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // A. AUTHENTICATION
  // ==========================================================================
  describe("Authentication Gate", () => {
    it("rejects unauthenticated POST /api/v1/groups/:groupId/expenses with HTTP 401", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue(null);

      const res = await app.request(`/api/v1/groups/${mockGroup.id}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: "Dinner",
          amountMinor: 1000,
          paidByUserId: "usr_alice_123",
        }),
      });

      expect(res.status).toBe(401);
      const data = await res.json();
      expect(data.error.code).toBe("UNAUTHORIZED");
    });

    it("rejects unauthenticated GET /api/v1/groups/:groupId/expenses with HTTP 401", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue(null);

      const res = await app.request(`/api/v1/groups/${mockGroup.id}/expenses`, {
        method: "GET",
      });

      expect(res.status).toBe(401);
    });
  });

  // ==========================================================================
  // B. GROUP AUTHORIZATION
  // ==========================================================================
  describe("Group Membership Authorization", () => {
    it("rejects non-group member attempting to create an expense (HTTP 403)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue({
        user: { id: mockUserCharlie.id, name: mockUserCharlie.name, email: mockUserCharlie.email } as AuthUser,
        session: mockCharlieSession,
      });

      vi.spyOn(groupRepository, "findMembership").mockResolvedValue(null);

      const res = await app.request(`/api/v1/groups/${mockGroup.id}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: "Unauthorized Lunch",
          amountMinor: 2000,
          paidByUserId: "usr_alice_123",
        }),
      });

      expect(res.status).toBe(403);
      const data = await res.json();
      expect(data.error.code).toBe("FORBIDDEN");
    });

    it("rejects non-group member attempting to list expenses (HTTP 403)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue({
        user: { id: mockUserCharlie.id, name: mockUserCharlie.name, email: mockUserCharlie.email } as AuthUser,
        session: mockCharlieSession,
      });

      vi.spyOn(groupRepository, "findMembership").mockResolvedValue(null);

      const res = await app.request(`/api/v1/groups/${mockGroup.id}/expenses`, {
        method: "GET",
      });

      expect(res.status).toBe(403);
    });
  });

  // ==========================================================================
  // C. VALIDATION
  // ==========================================================================
  describe("Boundary Validation", () => {
    it("rejects non-positive amountMinor (HTTP 400)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue({
        user: { id: mockUserAlice.id, name: mockUserAlice.name, email: mockUserAlice.email } as AuthUser,
        session: mockAliceSession,
      });

      const res = await app.request(`/api/v1/groups/${mockGroup.id}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: "Zero Expense",
          amountMinor: 0,
          paidByUserId: "usr_alice_123",
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json();
      expect(data.error.code).toBe("VALIDATION_ERROR");
    });

    it("rejects empty description (HTTP 400)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue({
        user: { id: mockUserAlice.id, name: mockUserAlice.name, email: mockUserAlice.email } as AuthUser,
        session: mockAliceSession,
      });

      const res = await app.request(`/api/v1/groups/${mockGroup.id}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: "   ",
          amountMinor: 1000,
          paidByUserId: "usr_alice_123",
        }),
      });

      expect(res.status).toBe(400);
    });

    it("rejects invalid UUID in path (HTTP 400)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue({
        user: { id: mockUserAlice.id, name: mockUserAlice.name, email: mockUserAlice.email } as AuthUser,
        session: mockAliceSession,
      });

      const res = await app.request(`/api/v1/groups/not-a-uuid/expenses`, {
        method: "GET",
      });

      expect(res.status).toBe(400);
    });
  });

  // ==========================================================================
  // D. SPLIT CALCULATION ENGINE & PERSISTENCE
  // ==========================================================================
  describe("Split Calculation Engine Integration", () => {
    it("creates an expense with equal split across all group members", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue({
        user: { id: mockUserAlice.id, name: mockUserAlice.name, email: mockUserAlice.email } as AuthUser,
        session: mockAliceSession,
      });

      vi.spyOn(groupRepository, "findMembership").mockImplementation(async (gId, uId) => {
        if (uId === mockUserAlice.id) return mockAliceAdminMembership;
        if (uId === mockUserBob.id) return mockBobMemberMembership;
        return null;
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValue(mockGroup);
      vi.spyOn(groupRepository, "listMembers").mockResolvedValue([
        { member: mockAliceAdminMembership, user: mockUserAlice },
        { member: mockBobMemberMembership, user: mockUserBob },
      ]);
      vi.spyOn(userRepository, "findById").mockImplementation(async (id) => {
        if (id === mockUserAlice.id) return mockUserAlice;
        if (id === mockUserBob.id) return mockUserBob;
        return null;
      });

      const mockCreatedExpense: Expense = {
        ...mockExpense,
        amountMinor: 30000,
      };
      const mockCreatedSplits: ExpenseSplit[] = [
        {
          id: "sp_1",
          expenseId: mockCreatedExpense.id,
          userId: mockUserAlice.id,
          allocatedAmountMinor: 15000,
          percentageBasisPoints: null,
          shares: null,
          createdAt: new Date(),
        },
        {
          id: "sp_2",
          expenseId: mockCreatedExpense.id,
          userId: mockUserBob.id,
          allocatedAmountMinor: 15000,
          percentageBasisPoints: null,
          shares: null,
          createdAt: new Date(),
        },
      ];

      vi.spyOn(expenseRepository, "createWithSplits").mockResolvedValue({
        expense: mockCreatedExpense,
        splits: mockCreatedSplits,
      });
      vi.spyOn(notificationRepository, "create").mockResolvedValue(dummyNotification);

      const res = await app.request(`/api/v1/groups/${mockGroup.id}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: "Dinner at Beach Shack",
          amountMinor: 30000,
          currencyCode: "INR",
          paidByUserId: mockUserAlice.id,
          splitType: "EQUAL",
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.data.description).toBe("Dinner at Beach Shack");
      expect(data.data.amountMinor).toBe(30000);
      expect(data.data.splits).toHaveLength(2);
      expect(data.data.splits[0].allocatedAmountMinor).toBe(15000);
      expect(data.data.splits[1].allocatedAmountMinor).toBe(15000);
    });

    it("creates an expense with exact split validating exact sums", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue({
        user: { id: mockUserAlice.id, name: mockUserAlice.name, email: mockUserAlice.email } as AuthUser,
        session: mockAliceSession,
      });

      vi.spyOn(groupRepository, "findMembership").mockImplementation(async (gId, uId) => {
        if (uId === mockUserAlice.id) return mockAliceAdminMembership;
        if (uId === mockUserBob.id) return mockBobMemberMembership;
        return null;
      });
      vi.spyOn(groupRepository, "findById").mockResolvedValue(mockGroup);
      vi.spyOn(userRepository, "findById").mockImplementation(async (id) => {
        if (id === mockUserAlice.id) return mockUserAlice;
        if (id === mockUserBob.id) return mockUserBob;
        return null;
      });

      vi.spyOn(expenseRepository, "createWithSplits").mockResolvedValue({
        expense: { ...mockExpense, amountMinor: 25000, splitMethod: "exact" },
        splits: [
          { ...mockSplits[0], allocatedAmountMinor: 10000 },
          { ...mockSplits[1], allocatedAmountMinor: 15000 },
        ],
      });
      vi.spyOn(notificationRepository, "create").mockResolvedValue(dummyNotification);

      const res = await app.request(`/api/v1/groups/${mockGroup.id}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: "Scuba Gear Rental",
          amountMinor: 25000,
          currencyCode: "INR",
          paidByUserId: mockUserAlice.id,
          splitType: "EXACT",
          splits: [
            { userId: mockUserAlice.id, amountMinor: 10000 },
            { userId: mockUserBob.id, amountMinor: 15000 },
          ],
        }),
      });

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.data.amountMinor).toBe(25000);
      expect(data.data.splits[0].allocatedAmountMinor).toBe(10000);
      expect(data.data.splits[1].allocatedAmountMinor).toBe(15000);
    });

    it("rejects exact split when sum of allocations does not match total (HTTP 400)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue({
        user: { id: mockUserAlice.id, name: mockUserAlice.name, email: mockUserAlice.email } as AuthUser,
        session: mockAliceSession,
      });

      vi.spyOn(groupRepository, "findMembership").mockResolvedValue(mockAliceAdminMembership);
      vi.spyOn(groupRepository, "findById").mockResolvedValue(mockGroup);

      const res = await app.request(`/api/v1/groups/${mockGroup.id}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: "Mismatched Exact Split",
          amountMinor: 30000,
          currencyCode: "INR",
          paidByUserId: mockUserAlice.id,
          splitType: "EXACT",
          splits: [
            { userId: mockUserAlice.id, amountMinor: 10000 },
            { userId: mockUserBob.id, amountMinor: 10000 }, // sum 20000 != 30000
          ],
        }),
      });

      expect(res.status).toBe(400);
    });
  });

  // ==========================================================================
  // E. IDEMPOTENCY
  // ==========================================================================
  describe("Idempotency Safeguard", () => {
    it("returns cached expense response on duplicate Idempotency-Key header", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue({
        user: { id: mockUserAlice.id, name: mockUserAlice.name, email: mockUserAlice.email } as AuthUser,
        session: mockAliceSession,
      });

      vi.spyOn(groupRepository, "findMembership").mockResolvedValue(mockAliceAdminMembership);
      vi.spyOn(groupRepository, "findById").mockResolvedValue(mockGroup);
      vi.spyOn(groupRepository, "listMembers").mockResolvedValue([
        { member: mockAliceAdminMembership, user: mockUserAlice },
      ]);
      vi.spyOn(userRepository, "findById").mockResolvedValue(mockUserAlice);

      const createSpy = vi.spyOn(expenseRepository, "createWithSplits").mockResolvedValue({
        expense: mockExpense,
        splits: [mockSplits[0]],
      });
      vi.spyOn(notificationRepository, "create").mockResolvedValue(dummyNotification);

      const idempotencyKey = "unique-key-12345";

      // First call
      const res1 = await app.request(`/api/v1/groups/${mockGroup.id}/expenses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          description: "Dinner",
          amountMinor: 15000,
          paidByUserId: mockUserAlice.id,
          splitType: "EQUAL",
        }),
      });

      expect(res1.status).toBe(201);
      expect(createSpy).toHaveBeenCalledTimes(1);

      // Second call with same idempotency key
      const res2 = await app.request(`/api/v1/groups/${mockGroup.id}/expenses`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          description: "Dinner",
          amountMinor: 15000,
          paidByUserId: mockUserAlice.id,
          splitType: "EQUAL",
        }),
      });

      expect(res2.status).toBe(201);
      // Repository should NOT have been called a second time
      expect(createSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ==========================================================================
  // F. READ EXPENSES & PAGINATION
  // ==========================================================================
  describe("Read Expenses", () => {
    it("retrieves a single expense with safe profile serialization", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue({
        user: { id: mockUserAlice.id, name: mockUserAlice.name, email: mockUserAlice.email } as AuthUser,
        session: mockAliceSession,
      });

      vi.spyOn(groupRepository, "findMembership").mockResolvedValue(mockAliceAdminMembership);
      vi.spyOn(expenseRepository, "findByIdWithSplits").mockResolvedValue({
        expense: mockExpense,
        splits: mockSplits,
      });
      vi.spyOn(userRepository, "findById").mockImplementation(async (id) => {
        if (id === mockUserAlice.id) return mockUserAlice;
        if (id === mockUserBob.id) return mockUserBob;
        return null;
      });

      const res = await app.request(
        `/api/v1/groups/${mockGroup.id}/expenses/${mockExpense.id}`,
        { method: "GET" }
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.id).toBe(mockExpense.id);
      expect(data.data.payer.name).toBe("Alice Liddell");
      expect(data.data.splits).toHaveLength(2);
    });

    it("lists group expenses with pagination metadata", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue({
        user: { id: mockUserAlice.id, name: mockUserAlice.name, email: mockUserAlice.email } as AuthUser,
        session: mockAliceSession,
      });

      vi.spyOn(groupRepository, "findMembership").mockResolvedValue(mockAliceAdminMembership);
      vi.spyOn(expenseRepository, "listByGroupId").mockResolvedValue({
        expenses: [{ ...mockExpense, splits: mockSplits }],
        total: 1,
      });
      vi.spyOn(userRepository, "findById").mockImplementation(async (id) => {
        if (id === mockUserAlice.id) return mockUserAlice;
        if (id === mockUserBob.id) return mockUserBob;
        return null;
      });

      const res = await app.request(
        `/api/v1/groups/${mockGroup.id}/expenses?limit=10&offset=0`,
        { method: "GET" }
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data).toHaveLength(1);
      expect(data.meta.total).toBe(1);
      expect(data.meta.limit).toBe(10);
      expect(data.meta.offset).toBe(0);
    });
  });

  // ==========================================================================
  // G. UPDATE & DELETE AUTHORIZATION
  // ==========================================================================
  describe("Update and Delete Authorization", () => {
    it("allows expense creator to update notes", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue({
        user: { id: mockUserAlice.id, name: mockUserAlice.name, email: mockUserAlice.email } as AuthUser,
        session: mockAliceSession,
      });

      vi.spyOn(groupRepository, "findMembership").mockResolvedValue(mockAliceAdminMembership);
      vi.spyOn(expenseRepository, "findByIdWithSplits").mockResolvedValue({
        expense: mockExpense,
        splits: mockSplits,
      });
      vi.spyOn(expenseRepository, "updateWithSplits").mockResolvedValue({
        expense: { ...mockExpense, notes: "Updated note" },
        splits: mockSplits,
      });
      vi.spyOn(userRepository, "findById").mockResolvedValue(mockUserAlice);

      const res = await app.request(
        `/api/v1/groups/${mockGroup.id}/expenses/${mockExpense.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes: "Updated note" }),
        }
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.notes).toBe("Updated note");
    });

    it("rejects non-creator non-admin member from updating expense (HTTP 403)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue({
        user: { id: mockUserBob.id, name: mockUserBob.name, email: mockUserBob.email } as AuthUser,
        session: mockBobSession,
      });

      vi.spyOn(groupRepository, "findMembership").mockResolvedValue(mockBobMemberMembership);
      vi.spyOn(expenseRepository, "findByIdWithSplits").mockResolvedValue({
        expense: mockExpense, // createdById: Alice
        splits: mockSplits,
      });

      const res = await app.request(
        `/api/v1/groups/${mockGroup.id}/expenses/${mockExpense.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description: "Unauthorized Update" }),
        }
      );

      expect(res.status).toBe(403);
    });

    it("allows expense creator to soft-delete expense", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue({
        user: { id: mockUserAlice.id, name: mockUserAlice.name, email: mockUserAlice.email } as AuthUser,
        session: mockAliceSession,
      });

      vi.spyOn(groupRepository, "findMembership").mockResolvedValue(mockAliceAdminMembership);
      vi.spyOn(expenseRepository, "findById").mockResolvedValue(mockExpense);
      const deleteSpy = vi.spyOn(expenseRepository, "softDelete").mockResolvedValue(true);

      const res = await app.request(
        `/api/v1/groups/${mockGroup.id}/expenses/${mockExpense.id}`,
        { method: "DELETE" }
      );

      expect(res.status).toBe(200);
      expect(deleteSpy).toHaveBeenCalledWith(mockExpense.id, mockUserAlice.id);
    });
  });

  // ==========================================================================
  // H. CLIENT API SDK
  // ==========================================================================
  describe("Client API SDK wrapper", () => {
    it("client functions invoke API client correctly", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          data: { id: mockExpense.id, description: "Test Expense" },
        }),
      });
      globalThis.fetch = mockFetch;

      const created = await createExpense("group-123", {
        description: "Test Expense",
        amountMinor: 1000,
        paidByUserId: "usr_alice",
      });

      expect(created.id).toBe(mockExpense.id);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/groups/group-123/expenses"),
        expect.objectContaining({ method: "POST" })
      );

      await getExpense("group-123", "exp-456");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/groups/group-123/expenses/exp-456"),
        expect.objectContaining({ method: "GET" })
      );

      await getGroupExpenses("group-123", { limit: 10, offset: 5 });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/groups/group-123/expenses?limit=10&offset=5"),
        expect.objectContaining({ method: "GET" })
      );

      await updateExpense("group-123", "exp-456", { description: "Updated" });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/groups/group-123/expenses/exp-456"),
        expect.objectContaining({ method: "PATCH" })
      );

      await deleteExpense("group-123", "exp-456");
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/groups/group-123/expenses/exp-456"),
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });
});
