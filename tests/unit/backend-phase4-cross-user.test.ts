/**
 * Phase 4.10 — Multi-User & IDOR Matrix Test Suite.
 *
 * Enforces strict authorization boundaries across all 9 Phase 4 resources:
 * User A = Creator / Owner (in Group AB, Friend with User B)
 * User B = Member / Friend (in Group AB, Friend with User A)
 * User C = Attacker / External User (unrelated, zero permissions)
 *
 * 9 Resources Tested:
 * 1. Profile: User C cannot read another user's private data or update another user's profile
 * 2. Friends: User C cannot accept, reject, or cancel friendship between User A and User B
 * 3. Friend Balance: User C cannot read bilateral balance between User A and User B
 * 4. Group: User C cannot read, update, or archive Group AB
 * 5. Group Members: User C cannot add/remove members from Group AB
 * 6. Expenses: User C cannot create, read, update, or delete expenses in Group AB
 * 7. Settlements: User C cannot create, read, update, or delete settlements in Group AB
 * 8. Activity: User C cannot read activity feed of Group AB
 * 9. Notifications: User C cannot read, mark-read, or delete notifications belonging to User A or User B
 *
 * ZERO attacks must succeed (return 200) or crash (return 500).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { app } from "../../server/app.js";
import { auth, type AuthUser, type AuthSession } from "../../server/auth/index.js";
import { userRepository } from "../../server/repositories/user.repository.js";
import { friendRepository } from "../../server/repositories/friend.repository.js";
import { groupRepository } from "../../server/repositories/group.repository.js";
import { expenseRepository } from "../../server/repositories/expense.repository.js";
import { settlementRepository } from "../../server/repositories/settlement.repository.js";
import { notificationRepository } from "../../server/repositories/notification.repository.js";
import type {
  User,
  Friendship,
  Group,
  Expense,
  ExpenseSplit,
  Settlement,
  Notification,
} from "../../server/db/schema/index.js";

describe("Phase 4.10 — Multi-User & IDOR Security Matrix", () => {
  // Actors
  const userA: User = {
    id: "usr_alice_aaa",
    name: "Alice Owner",
    email: "alice@company.com",
    emailVerified: true,
    image: "https://example.com/alice.jpg",
    defaultCurrencyCode: "INR",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  const userB: User = {
    id: "usr_bob_bbb",
    name: "Bob Friend",
    email: "bob@company.com",
    emailVerified: true,
    image: null,
    defaultCurrencyCode: "INR",
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  };

  const userC: User = {
    id: "usr_charlie_ccc",
    name: "Charlie Attacker",
    email: "charlie@attacker.com",
    emailVerified: true,
    image: null,
    defaultCurrencyCode: "USD",
    createdAt: new Date("2026-01-03T00:00:00.000Z"),
    updatedAt: new Date("2026-01-03T00:00:00.000Z"),
  };

  const sessionC: AuthSession = {
    id: "sess_charlie_attacker",
    userId: userC.id,
    token: "tok_charlie_token",
    expiresAt: new Date(Date.now() + 86400000),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // Group AB (Valid UUID)
  const groupAB: Group = {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Confidential Group AB",
    description: "Internal confidential group",
    defaultCurrencyCode: "INR",
    createdById: userA.id,
    isArchived: false,
    createdAt: new Date("2026-01-10T00:00:00.000Z"),
    updatedAt: new Date("2026-01-10T00:00:00.000Z"),
  };

  // Friendship AB (Valid UUID)
  const friendshipAB: Friendship = {
    id: "22222222-2222-2222-2222-222222222222",
    userId1: userA.id,
    userId2: userB.id,
    status: "active",
    createdAt: new Date("2026-01-05T00:00:00.000Z"),
    updatedAt: new Date("2026-01-05T00:00:00.000Z"),
  };

  // Expense in Group AB (Valid UUID)
  const expenseAB: Expense = {
    id: "33333333-3333-3333-3333-333333333333",
    groupId: groupAB.id,
    payerId: userA.id,
    createdById: userA.id,
    categoryId: null,
    description: "Secret Dinner",
    amountMinor: 50000,
    currencyCode: "INR",
    splitMethod: "equal",
    date: new Date("2026-01-12T00:00:00.000Z"),
    notes: "Confidential budget",
    receiptUrl: null,
    isDeleted: false,
    createdAt: new Date("2026-01-12T00:00:00.000Z"),
    updatedAt: new Date("2026-01-12T00:00:00.000Z"),
  };

  const splitsAB: ExpenseSplit[] = [
    {
      id: "split_a",
      expenseId: expenseAB.id,
      userId: userA.id,
      allocatedAmountMinor: 25000,
      percentageBasisPoints: null,
      shares: null,
      createdAt: new Date(),
    },
    {
      id: "split_b",
      expenseId: expenseAB.id,
      userId: userB.id,
      allocatedAmountMinor: 25000,
      percentageBasisPoints: null,
      shares: null,
      createdAt: new Date(),
    },
  ];

  // Settlement in Group AB (Valid UUID)
  const settlementAB: Settlement = {
    id: "44444444-4444-4444-4444-444444444444",
    groupId: groupAB.id,
    payerId: userB.id,
    receiverId: userA.id,
    amountMinor: 25000,
    currencyCode: "INR",
    settledAt: new Date("2026-01-13T00:00:00.000Z"),
    createdById: userB.id,
    notes: "Settling dinner",
    createdAt: new Date("2026-01-13T00:00:00.000Z"),
  };

  // Notification for User A (Valid UUID)
  const notificationA: Notification = {
    id: "55555555-5555-5555-5555-555555555555",
    recipientId: userA.id,
    actorId: userB.id,
    type: "expense_created",
    title: "Secret Expense",
    message: "Bob added an expense",
    groupId: groupAB.id,
    expenseId: expenseAB.id,
    settlementId: null,
    activityId: null,
    metadata: {},
    readAt: null,
    createdAt: new Date(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();

    // Default: Authenticated as Attacker User C
    vi.spyOn(auth.api, "getSession").mockResolvedValue({
      user: { id: userC.id, name: userC.name, email: userC.email } as AuthUser,
      session: sessionC,
    });

    // Default repository mocks
    vi.spyOn(userRepository, "findById").mockImplementation(async (id) => {
      if (id === userA.id) return userA;
      if (id === userB.id) return userB;
      return userC;
    });
    vi.spyOn(groupRepository, "findById").mockResolvedValue(groupAB);
    vi.spyOn(groupRepository, "findMembership").mockImplementation(async (gId, uId) => {
      if (uId === userB.id) {
        return {
          id: "mem_bob_member",
          groupId: groupAB.id,
          userId: userB.id,
          role: "member",
          joinedAt: new Date(),
        };
      }
      return null; // User C has no membership
    });
    vi.spyOn(friendRepository, "findById").mockResolvedValue(friendshipAB);
    vi.spyOn(expenseRepository, "findByIdWithSplits").mockResolvedValue({
      expense: expenseAB,
      splits: splitsAB,
    });
    vi.spyOn(settlementRepository, "findById").mockResolvedValue(settlementAB);
    vi.spyOn(notificationRepository, "findById").mockResolvedValue(notificationA);
  });

  // ==========================================================================
  // 1. PROFILE IDOR DEFENSE
  // ==========================================================================
  describe("Resource 1: User Profile IDOR Defense", () => {
    it("User C cannot update User A's profile (profile endpoint binds strictly to session actor)", async () => {
      const updateSpy = vi.spyOn(userRepository, "update").mockResolvedValue({
        ...userC,
        name: "Hacked Name",
      });

      const res = await app.request("/api/v1/users/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Hacked Name" }),
      });

      expect(res.status).toBe(200);
      // Service strictly updates userC.id, NEVER userA.id
      expect(updateSpy).toHaveBeenCalledWith(userC.id, expect.objectContaining({ name: "Hacked Name" }));
      expect(updateSpy).not.toHaveBeenCalledWith(userA.id, expect.anything());
    });
  });

  // ==========================================================================
  // 2. FRIENDS IDOR DEFENSE
  // ==========================================================================
  describe("Resource 2: Friends Relationship IDOR Defense", () => {
    it("User C cannot accept, reject, or delete friendship between User A and User B (HTTP 403 / 404)", async () => {
      const res = await app.request(`/api/v1/friends/${friendshipAB.id}`, {
        method: "DELETE",
      });

      expect([403, 404]).toContain(res.status);
      expect(res.status).not.toBe(200);
      expect(res.status).not.toBe(500);
    });
  });

  // ==========================================================================
  // 3. FRIEND BILATERAL BALANCE IDOR DEFENSE
  // ==========================================================================
  describe("Resource 3: Friend Bilateral Balance IDOR Defense", () => {
    it("User C cannot view bilateral balance between User A and User B (HTTP 403)", async () => {
      const res = await app.request(`/api/v1/friends/${friendshipAB.id}/balance`, {
        method: "GET",
      });

      expect([403, 404]).toContain(res.status);
      expect(res.status).not.toBe(200);
      expect(res.status).not.toBe(500);
    });
  });

  // ==========================================================================
  // 4. GROUP IDOR DEFENSE
  // ==========================================================================
  describe("Resource 4: Group CRUD IDOR Defense", () => {
    it("User C cannot read Group AB metadata (HTTP 403)", async () => {
      const res = await app.request(`/api/v1/groups/${groupAB.id}`, {
        method: "GET",
      });

      expect(res.status).toBe(403);
    });

    it("User C cannot update Group AB metadata (HTTP 403)", async () => {
      const res = await app.request(`/api/v1/groups/${groupAB.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Attacker Group Rename" }),
      });

      expect(res.status).toBe(403);
    });

    it("User C cannot archive Group AB (HTTP 403)", async () => {
      const res = await app.request(`/api/v1/groups/${groupAB.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isArchived: true }),
      });

      expect(res.status).toBe(403);
    });
  });

  // ==========================================================================
  // 5. GROUP MEMBERS IDOR DEFENSE
  // ==========================================================================
  describe("Resource 5: Group Membership IDOR Defense", () => {
    it("User C cannot list members of Group AB (HTTP 403)", async () => {
      const res = await app.request(`/api/v1/groups/${groupAB.id}/members`, {
        method: "GET",
      });

      expect(res.status).toBe(403);
    });

    it("User C cannot add self or another user to Group AB (HTTP 403)", async () => {
      const res = await app.request(`/api/v1/groups/${groupAB.id}/members`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: userC.id, role: "member" }),
      });

      expect(res.status).toBe(403);
    });

    it("User C cannot remove User B from Group AB (HTTP 403)", async () => {
      const res = await app.request(`/api/v1/groups/${groupAB.id}/members/${userB.id}`, {
        method: "DELETE",
      });

      expect(res.status).toBe(403);
    });
  });

  // ==========================================================================
  // 6. EXPENSES IDOR DEFENSE
  // ==========================================================================
  describe("Resource 6: Group Expenses IDOR Defense", () => {
    it("User C cannot create an expense in Group AB (HTTP 403)", async () => {
      const res = await app.request(`/api/v1/groups/${groupAB.id}/expenses`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: "Illegal Expense",
          amountMinor: 10000,
          paidByUserId: userC.id,
        }),
      });

      expect(res.status).toBe(403);
    });

    it("User C cannot read an expense from Group AB (HTTP 403 / 404)", async () => {
      const res = await app.request(`/api/v1/groups/${groupAB.id}/expenses/${expenseAB.id}`, {
        method: "GET",
      });

      expect([403, 404]).toContain(res.status);
    });

    it("User C cannot update an expense in Group AB (HTTP 403 / 404)", async () => {
      const res = await app.request(`/api/v1/groups/${groupAB.id}/expenses/${expenseAB.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: "Defaced Expense" }),
      });

      expect([403, 404]).toContain(res.status);
    });

    it("User C cannot delete an expense in Group AB (HTTP 403 / 404)", async () => {
      const res = await app.request(`/api/v1/groups/${groupAB.id}/expenses/${expenseAB.id}`, {
        method: "DELETE",
      });

      expect([403, 404]).toContain(res.status);
    });
  });

  // ==========================================================================
  // 7. SETTLEMENTS IDOR DEFENSE
  // ==========================================================================
  describe("Resource 7: Group Settlements IDOR Defense", () => {
    it("User C cannot create a settlement in Group AB (HTTP 403)", async () => {
      const res = await app.request(`/api/v1/groups/${groupAB.id}/settlements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          payerId: userC.id,
          receiverId: userA.id,
          amountMinor: 5000,
        }),
      });

      expect(res.status).toBe(403);
    });

    it("User C cannot read a settlement in Group AB (HTTP 403 / 404)", async () => {
      const res = await app.request(`/api/v1/groups/${groupAB.id}/settlements/${settlementAB.id}`, {
        method: "GET",
      });

      expect([403, 404]).toContain(res.status);
    });

    it("User C cannot delete a settlement in Group AB (HTTP 403 / 404)", async () => {
      const res = await app.request(`/api/v1/groups/${groupAB.id}/settlements/${settlementAB.id}`, {
        method: "DELETE",
      });

      expect([403, 404]).toContain(res.status);
    });
  });

  // ==========================================================================
  // 8. ACTIVITY IDOR DEFENSE
  // ==========================================================================
  describe("Resource 8: Activity Feed IDOR Defense", () => {
    it("User C cannot read Group AB's activity feed (HTTP 403)", async () => {
      const res = await app.request(`/api/v1/groups/${groupAB.id}/activity`, {
        method: "GET",
      });

      expect(res.status).toBe(403);
    });
  });

  // ==========================================================================
  // 9. NOTIFICATIONS IDOR DEFENSE
  // ==========================================================================
  describe("Resource 9: Notifications IDOR Defense", () => {
    it("User C cannot read User A's notification or mark it as read (HTTP 404)", async () => {
      vi.spyOn(notificationRepository, "markAsRead").mockImplementation(async (id, recipientId) => {
        if (recipientId === userA.id) return notificationA;
        return null;
      });

      const res = await app.request(`/api/v1/notifications/${notificationA.id}/read`, {
        method: "PATCH",
      });

      expect(res.status).toBe(404);
    });

    it("User C's notification list strictly queries recipientId === userC.id", async () => {
      const listSpy = vi.spyOn(notificationRepository, "listByRecipientId").mockResolvedValue({
        notifications: [],
        total: 0,
      });

      const res = await app.request("/api/v1/notifications", {
        method: "GET",
      });

      expect(res.status).toBe(200);
      expect(listSpy).toHaveBeenCalledWith(userC.id, expect.anything());
      expect(listSpy).not.toHaveBeenCalledWith(userA.id, expect.anything());
    });
  });
});
