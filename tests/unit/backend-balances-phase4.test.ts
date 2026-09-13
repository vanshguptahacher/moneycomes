/**
 * Phase 4.6 — Balances API Test Suite.
 *
 * Verifies:
 * 1. Authentication: Unauthenticated requests to balance endpoints return HTTP 401.
 * 2. Authorization & IDOR: Non-members cannot view group balance or simplified debts (HTTP 403).
 * 3. Validation: Invalid group UUID or unsupported currency returns HTTP 400; non-existent group returns HTTP 404.
 * 4. Group Balances: Aggregates expenses and settlements into per-member net balances preserving zero-sum invariant.
 * 5. Simplified Debts: Minimizes transfer count while settling all member positions.
 * 6. User Group Balance: Returns authenticated actor's net balance within a group.
 * 7. User Overall Balance: Aggregates actor's balances across all groups by currency.
 * 8. Mobile API Client: Tests client functions in src/api/balances.ts.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { app } from "../../server/app.js";
import { auth, type AuthUser, type AuthSession } from "../../server/auth/index.js";
import { groupRepository } from "../../server/repositories/group.repository.js";
import { userRepository } from "../../server/repositories/user.repository.js";
import { expenseRepository } from "../../server/repositories/expense.repository.js";
import { settlementRepository } from "../../server/repositories/settlement.repository.js";
import type { Group, GroupMember, User, Expense, ExpenseSplit, Settlement } from "../../server/db/schema/index.js";
import {
  getGroupBalance,
  getGroupSimplifiedDebts,
  getUserGroupBalance,
  getUserOverallBalance,
  type MemberBalanceDetail,
} from "../../src/api/balances.js";

describe("Phase 4.6 — Balances API", () => {
  const mockUserAlice: User = {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Alice Liddell",
    email: "alice@wonderland.com",
    emailVerified: true,
    image: "https://example.com/alice.jpg",
    defaultCurrencyCode: "INR",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  const mockUserBob: User = {
    id: "22222222-2222-2222-2222-222222222222",
    name: "Bob Builder",
    email: "bob@builder.com",
    emailVerified: true,
    image: null,
    defaultCurrencyCode: "INR",
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  };

  const mockUserCharlie: User = {
    id: "33333333-3333-3333-3333-333333333333",
    name: "Charlie Chaplin",
    email: "charlie@chaplin.com",
    emailVerified: true,
    image: null,
    defaultCurrencyCode: "INR",
    createdAt: new Date("2026-01-03T00:00:00.000Z"),
    updatedAt: new Date("2026-01-03T00:00:00.000Z"),
  };

  const mockUserEve: User = {
    id: "44444444-4444-4444-4444-444444444444",
    name: "Eve Outsider",
    email: "eve@outsider.com",
    emailVerified: true,
    image: null,
    defaultCurrencyCode: "INR",
    createdAt: new Date("2026-01-04T00:00:00.000Z"),
    updatedAt: new Date("2026-01-04T00:00:00.000Z"),
  };

  const validGroupId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

  const mockGroup: Group = {
    id: validGroupId,
    name: "Apartment Flatmates",
    description: "Shared living expenses",
    defaultCurrencyCode: "INR",
    createdById: mockUserAlice.id,
    isArchived: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  const mockAliceMembership: GroupMember = {
    id: "mem_alice_001",
    groupId: validGroupId,
    userId: mockUserAlice.id,
    role: "admin",
    joinedAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  const mockBobMembership: GroupMember = {
    id: "mem_bob_002",
    groupId: validGroupId,
    userId: mockUserBob.id,
    role: "member",
    joinedAt: new Date("2026-01-02T00:00:00.000Z"),
  };

  const mockCharlieMembership: GroupMember = {
    id: "mem_charlie_003",
    groupId: validGroupId,
    userId: mockUserCharlie.id,
    role: "member",
    joinedAt: new Date("2026-01-03T00:00:00.000Z"),
  };

  const mockGroupMembersWithProfiles = [
    { member: mockAliceMembership, user: mockUserAlice },
    { member: mockBobMembership, user: mockUserBob },
    { member: mockCharlieMembership, user: mockUserCharlie },
  ];

  function authenticateAs(user: User) {
    vi.spyOn(auth.api, "getSession").mockResolvedValue({
      user: {
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified,
        name: user.name,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      } as unknown as AuthUser,
      session: {
        id: `sess_${user.id}`,
        userId: user.id,
        expiresAt: new Date(Date.now() + 86400000),
        token: `token_${user.id}`,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as unknown as AuthSession,
    });
  }

  beforeEach(() => {
    vi.restoreAllMocks();

    // Default repository mock implementations
    vi.spyOn(groupRepository, "findById").mockImplementation(async (id) => {
      if (id === validGroupId) return mockGroup;
      return null;
    });

    vi.spyOn(groupRepository, "findMembership").mockImplementation(async (gid, uid) => {
      if (gid !== validGroupId) return null;
      if (uid === mockUserAlice.id) return mockAliceMembership;
      if (uid === mockUserBob.id) return mockBobMembership;
      if (uid === mockUserCharlie.id) return mockCharlieMembership;
      return null;
    });

    vi.spyOn(groupRepository, "listMembers").mockImplementation(async (gid) => {
      if (gid === validGroupId) return mockGroupMembersWithProfiles;
      return [];
    });

    vi.spyOn(userRepository, "findById").mockImplementation(async (id) => {
      if (id === mockUserAlice.id) return mockUserAlice;
      if (id === mockUserBob.id) return mockUserBob;
      if (id === mockUserCharlie.id) return mockUserCharlie;
      if (id === mockUserEve.id) return mockUserEve;
      return null;
    });

    vi.spyOn(expenseRepository, "findGroupExpensesWithSplits").mockResolvedValue([]);
    vi.spyOn(settlementRepository, "findGroupSettlementsAll").mockResolvedValue([]);
  });

  // ==========================================================================
  // 1. AUTHENTICATION (401 Unauthorized)
  // ==========================================================================
  describe("1. Authentication Verification", () => {
    it("rejects unauthenticated request to GET group balance with HTTP 401", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue(null);

      const res = await app.request(`/api/v1/groups/${validGroupId}/balance`, {
        method: "GET",
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBeDefined();
      expect(json.error.code).toBe("UNAUTHORIZED");
    });

    it("rejects unauthenticated request to GET simplified debts with HTTP 401", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue(null);

      const res = await app.request(
        `/api/v1/groups/${validGroupId}/balance/simplified`,
        { method: "GET" }
      );

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBeDefined();
      expect(json.error.code).toBe("UNAUTHORIZED");
    });

    it("rejects unauthenticated request to GET user group balance with HTTP 401", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue(null);

      const res = await app.request(`/api/v1/groups/${validGroupId}/balance/me`, {
        method: "GET",
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBeDefined();
    });

    it("rejects unauthenticated request to GET user overall balances with HTTP 401", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValue(null);

      const res = await app.request("/api/v1/users/me/balances", {
        method: "GET",
      });

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json.error).toBeDefined();
    });
  });

  // ==========================================================================
  // 2. AUTHORIZATION & IDOR (403 Forbidden)
  // ==========================================================================
  describe("2. Authorization & IDOR Protection", () => {
    it("rejects non-member (Eve) from accessing group balance with HTTP 403", async () => {
      authenticateAs(mockUserEve);

      const res = await app.request(`/api/v1/groups/${validGroupId}/balance`, {
        method: "GET",
      });

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBeDefined();
      expect(json.error.code).toBe("FORBIDDEN");
    });

    it("rejects non-member (Eve) from accessing group simplified debts with HTTP 403", async () => {
      authenticateAs(mockUserEve);

      const res = await app.request(
        `/api/v1/groups/${validGroupId}/balance/simplified`,
        { method: "GET" }
      );

      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error).toBeDefined();
      expect(json.error.code).toBe("FORBIDDEN");
    });

    it("rejects invalid UUID format for groupId with HTTP 400", async () => {
      authenticateAs(mockUserAlice);

      const res = await app.request("/api/v1/groups/not-a-valid-uuid/balance", {
        method: "GET",
      });

      expect(res.status).toBe(400);
      const json = await res.json();
      expect(json.error).toBeDefined();
    });

    it("returns HTTP 404 when group is not found", async () => {
      authenticateAs(mockUserAlice);

      const nonExistentGroupId = "99999999-9999-9999-9999-999999999999";
      const res = await app.request(
        `/api/v1/groups/${nonExistentGroupId}/balance`,
        { method: "GET" }
      );

      expect(res.status).toBe(404);
    });
  });

  // ==========================================================================
  // 3. GROUP BALANCE CALCULATION
  // ==========================================================================
  describe("3. Group Balance Engine", () => {
    it("returns zero balances for all members when no expenses or settlements exist", async () => {
      authenticateAs(mockUserAlice);

      const res = await app.request(`/api/v1/groups/${validGroupId}/balance`, {
        method: "GET",
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toBeDefined();
      expect(json.data.groupId).toBe(validGroupId);
      expect(json.data.currencyCode).toBe("INR");
      expect(json.data.memberCount).toBe(3);

      for (const member of json.data.balances as MemberBalanceDetail[]) {
        expect(member.paidMinor).toBe(0);
        expect(member.owedMinor).toBe(0);
        expect(member.netBalanceMinor).toBe(0);
      }
    });

    it("calculates exact balances for expenses and preserves zero-sum invariant", async () => {
      authenticateAs(mockUserAlice);

      // Alice pays 3000 INR for lunch, split equally among Alice, Bob, Charlie (1000 each)
      const mockExpense: Expense & { splits: ExpenseSplit[] } = {
        id: "exp_lunch_001",
        groupId: validGroupId,
        description: "Team Lunch",
        amountMinor: 3000,
        currencyCode: "INR",
        payerId: mockUserAlice.id,
        splitMethod: "equal",
        notes: null,
        receiptUrl: null,
        date: new Date("2026-02-01T12:00:00.000Z"),
        categoryId: null,
        createdById: mockUserAlice.id,
        isDeleted: false,
        createdAt: new Date("2026-02-01T12:00:00.000Z"),
        updatedAt: new Date("2026-02-01T12:00:00.000Z"),
        splits: [
          {
            id: "sp_1",
            expenseId: "exp_lunch_001",
            userId: mockUserAlice.id,
            allocatedAmountMinor: 1000,
            percentageBasisPoints: null,
            shares: null,
            createdAt: new Date(),
          },
          {
            id: "sp_2",
            expenseId: "exp_lunch_001",
            userId: mockUserBob.id,
            allocatedAmountMinor: 1000,
            percentageBasisPoints: null,
            shares: null,
            createdAt: new Date(),
          },
          {
            id: "sp_3",
            expenseId: "exp_lunch_001",
            userId: mockUserCharlie.id,
            allocatedAmountMinor: 1000,
            percentageBasisPoints: null,
            shares: null,
            createdAt: new Date(),
          },
        ],
      };

      vi.spyOn(expenseRepository, "findGroupExpensesWithSplits").mockResolvedValue([
        mockExpense,
      ]);

      const res = await app.request(`/api/v1/groups/${validGroupId}/balance`, {
        method: "GET",
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toBeDefined();

      const aliceBal = (json.data.balances as MemberBalanceDetail[]).find(
        (b) => b.userId === mockUserAlice.id
      );
      const bobBal = (json.data.balances as MemberBalanceDetail[]).find(
        (b) => b.userId === mockUserBob.id
      );
      const charlieBal = (json.data.balances as MemberBalanceDetail[]).find(
        (b) => b.userId === mockUserCharlie.id
      );

      // Alice paid 3000, owes 1000 -> net +2000
      expect(aliceBal?.paidMinor).toBe(3000);
      expect(aliceBal?.owedMinor).toBe(1000);
      expect(aliceBal?.netBalanceMinor).toBe(2000);

      // Bob paid 0, owes 1000 -> net -1000
      expect(bobBal?.paidMinor).toBe(0);
      expect(bobBal?.owedMinor).toBe(1000);
      expect(bobBal?.netBalanceMinor).toBe(-1000);

      // Charlie paid 0, owes 1000 -> net -1000
      expect(charlieBal?.paidMinor).toBe(0);
      expect(charlieBal?.owedMinor).toBe(1000);
      expect(charlieBal?.netBalanceMinor).toBe(-1000);

      // Zero-sum invariant: 2000 + (-1000) + (-1000) === 0
      const totalNet = (json.data.balances as MemberBalanceDetail[]).reduce(
        (sum, b) => sum + b.netBalanceMinor,
        0
      );
      expect(totalNet).toBe(0);
    });

    it("correctly factors settlements into net balance calculation", async () => {
      authenticateAs(mockUserAlice);

      // Same 3000 expense by Alice
      const mockExpense: Expense & { splits: ExpenseSplit[] } = {
        id: "exp_lunch_001",
        groupId: validGroupId,
        description: "Team Lunch",
        amountMinor: 3000,
        currencyCode: "INR",
        payerId: mockUserAlice.id,
        splitMethod: "equal",
        notes: null,
        receiptUrl: null,
        date: new Date("2026-02-01T12:00:00.000Z"),
        categoryId: null,
        createdById: mockUserAlice.id,
        isDeleted: false,
        createdAt: new Date("2026-02-01T12:00:00.000Z"),
        updatedAt: new Date("2026-02-01T12:00:00.000Z"),
        splits: [
          {
            id: "sp_1",
            expenseId: "exp_lunch_001",
            userId: mockUserAlice.id,
            allocatedAmountMinor: 1000,
            percentageBasisPoints: null,
            shares: null,
            createdAt: new Date(),
          },
          {
            id: "sp_2",
            expenseId: "exp_lunch_001",
            userId: mockUserBob.id,
            allocatedAmountMinor: 1000,
            percentageBasisPoints: null,
            shares: null,
            createdAt: new Date(),
          },
          {
            id: "sp_3",
            expenseId: "exp_lunch_001",
            userId: mockUserCharlie.id,
            allocatedAmountMinor: 1000,
            percentageBasisPoints: null,
            shares: null,
            createdAt: new Date(),
          },
        ],
      };

      // Bob settles 1000 INR to Alice
      const mockSettlement: Settlement = {
        id: "set_bob_to_alice_001",
        groupId: validGroupId,
        payerId: mockUserBob.id,
        receiverId: mockUserAlice.id,
        amountMinor: 1000,
        currencyCode: "INR",
        settledAt: new Date("2026-02-02T10:00:00.000Z"),
        createdById: mockUserBob.id,
        notes: "Paid via UPI",
        createdAt: new Date("2026-02-02T10:00:00.000Z"),
      };

      vi.spyOn(expenseRepository, "findGroupExpensesWithSplits").mockResolvedValue([
        mockExpense,
      ]);
      vi.spyOn(settlementRepository, "findGroupSettlementsAll").mockResolvedValue([
        mockSettlement,
      ]);

      const res = await app.request(`/api/v1/groups/${validGroupId}/balance`, {
        method: "GET",
      });

      expect(res.status).toBe(200);
      const json = await res.json();

      const aliceBal = (json.data.balances as MemberBalanceDetail[]).find(
        (b) => b.userId === mockUserAlice.id
      );
      const bobBal = (json.data.balances as MemberBalanceDetail[]).find(
        (b) => b.userId === mockUserBob.id
      );
      const charlieBal = (json.data.balances as MemberBalanceDetail[]).find(
        (b) => b.userId === mockUserCharlie.id
      );

      // Bob settled his debt -> net is 0
      expect(bobBal?.netBalanceMinor).toBe(0);
      // Alice received 1000 -> net balance decreased to +1000
      expect(aliceBal?.netBalanceMinor).toBe(1000);
      // Charlie still owes 1000 -> net -1000
      expect(charlieBal?.netBalanceMinor).toBe(-1000);

      // Invariant still holds
      expect(
        (aliceBal?.netBalanceMinor ?? 0) +
          (bobBal?.netBalanceMinor ?? 0) +
          (charlieBal?.netBalanceMinor ?? 0)
      ).toBe(0);
    });
  });

  // ==========================================================================
  // 4. DEBT SIMPLIFICATION
  // ==========================================================================
  describe("4. Debt Simplification Endpoint", () => {
    it("returns simplified transfers minimizing settlement hops", async () => {
      authenticateAs(mockUserAlice);

      // Alice paid 3000, Bob owes 1000, Charlie owes 1000
      const mockExpense: Expense & { splits: ExpenseSplit[] } = {
        id: "exp_lunch_001",
        groupId: validGroupId,
        description: "Team Lunch",
        amountMinor: 3000,
        currencyCode: "INR",
        payerId: mockUserAlice.id,
        splitMethod: "equal",
        notes: null,
        receiptUrl: null,
        date: new Date("2026-02-01T12:00:00.000Z"),
        categoryId: null,
        createdById: mockUserAlice.id,
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        splits: [
          {
            id: "sp_1",
            expenseId: "exp_lunch_001",
            userId: mockUserAlice.id,
            allocatedAmountMinor: 1000,
            percentageBasisPoints: null,
            shares: null,
            createdAt: new Date(),
          },
          {
            id: "sp_2",
            expenseId: "exp_lunch_001",
            userId: mockUserBob.id,
            allocatedAmountMinor: 1000,
            percentageBasisPoints: null,
            shares: null,
            createdAt: new Date(),
          },
          {
            id: "sp_3",
            expenseId: "exp_lunch_001",
            userId: mockUserCharlie.id,
            allocatedAmountMinor: 1000,
            percentageBasisPoints: null,
            shares: null,
            createdAt: new Date(),
          },
        ],
      };

      vi.spyOn(expenseRepository, "findGroupExpensesWithSplits").mockResolvedValue([
        mockExpense,
      ]);

      const res = await app.request(
        `/api/v1/groups/${validGroupId}/balance/simplified`,
        { method: "GET" }
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toBeDefined();
      expect(json.data.transferCount).toBe(2);

      // Expect Bob -> Alice 1000 and Charlie -> Alice 1000
      const transfers = json.data.transfers;
      for (const t of transfers) {
        expect(t.toUserId).toBe(mockUserAlice.id);
        expect(t.toUser.name).toBe("Alice Liddell");
        expect(t.amountMinor).toBe(1000);
        expect(t.currencyCode).toBe("INR");
      }
    });

    it("returns 0 transfers when all balances are settled", async () => {
      authenticateAs(mockUserAlice);

      // No expenses -> all balances 0
      const res = await app.request(
        `/api/v1/groups/${validGroupId}/balance/simplified`,
        { method: "GET" }
      );

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toBeDefined();
      expect(json.data.transferCount).toBe(0);
      expect(json.data.transfers).toEqual([]);
    });
  });

  // ==========================================================================
  // 5. USER GROUP BALANCE & OVERALL BALANCE
  // ==========================================================================
  describe("5. Personal Balances", () => {
    it("returns personal balance for authenticated actor within the group", async () => {
      authenticateAs(mockUserBob);

      const mockExpense: Expense & { splits: ExpenseSplit[] } = {
        id: "exp_lunch_001",
        groupId: validGroupId,
        description: "Team Lunch",
        amountMinor: 3000,
        currencyCode: "INR",
        payerId: mockUserAlice.id,
        splitMethod: "equal",
        notes: null,
        receiptUrl: null,
        date: new Date(),
        categoryId: null,
        createdById: mockUserAlice.id,
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        splits: [
          {
            id: "sp_1",
            expenseId: "exp_lunch_001",
            userId: mockUserAlice.id,
            allocatedAmountMinor: 1000,
            percentageBasisPoints: null,
            shares: null,
            createdAt: new Date(),
          },
          {
            id: "sp_2",
            expenseId: "exp_lunch_001",
            userId: mockUserBob.id,
            allocatedAmountMinor: 1000,
            percentageBasisPoints: null,
            shares: null,
            createdAt: new Date(),
          },
          {
            id: "sp_3",
            expenseId: "exp_lunch_001",
            userId: mockUserCharlie.id,
            allocatedAmountMinor: 1000,
            percentageBasisPoints: null,
            shares: null,
            createdAt: new Date(),
          },
        ],
      };

      vi.spyOn(expenseRepository, "findGroupExpensesWithSplits").mockResolvedValue([
        mockExpense,
      ]);

      const res = await app.request(`/api/v1/groups/${validGroupId}/balance/me`, {
        method: "GET",
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toBeDefined();
      expect(json.data.userId).toBe(mockUserBob.id);
      expect(json.data.groupId).toBe(validGroupId);
      expect(json.data.netBalanceMinor).toBe(-1000);
      expect(json.data.paidMinor).toBe(0);
      expect(json.data.owedMinor).toBe(1000);
    });

    it("returns overall personal balance across all active groups on GET /api/v1/users/me/balances", async () => {
      authenticateAs(mockUserBob);

      vi.spyOn(groupRepository, "listByUserId").mockResolvedValue([
        { group: mockGroup, role: "member" },
      ]);

      const mockExpense: Expense & { splits: ExpenseSplit[] } = {
        id: "exp_lunch_001",
        groupId: validGroupId,
        description: "Team Lunch",
        amountMinor: 3000,
        currencyCode: "INR",
        payerId: mockUserAlice.id,
        splitMethod: "equal",
        notes: null,
        receiptUrl: null,
        date: new Date(),
        categoryId: null,
        createdById: mockUserAlice.id,
        isDeleted: false,
        createdAt: new Date(),
        updatedAt: new Date(),
        splits: [
          {
            id: "sp_1",
            expenseId: "exp_lunch_001",
            userId: mockUserAlice.id,
            allocatedAmountMinor: 1000,
            percentageBasisPoints: null,
            shares: null,
            createdAt: new Date(),
          },
          {
            id: "sp_2",
            expenseId: "exp_lunch_001",
            userId: mockUserBob.id,
            allocatedAmountMinor: 1000,
            percentageBasisPoints: null,
            shares: null,
            createdAt: new Date(),
          },
          {
            id: "sp_3",
            expenseId: "exp_lunch_001",
            userId: mockUserCharlie.id,
            allocatedAmountMinor: 1000,
            percentageBasisPoints: null,
            shares: null,
            createdAt: new Date(),
          },
        ],
      };

      vi.spyOn(expenseRepository, "findGroupExpensesWithSplits").mockResolvedValue([
        mockExpense,
      ]);

      const res = await app.request("/api/v1/users/me/balances", {
        method: "GET",
      });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.data).toBeDefined();
      expect(json.data.userId).toBe(mockUserBob.id);
      expect(json.data.balancesByCurrency.INR.netBalanceMinor).toBe(-1000);
    });
  });

  // ==========================================================================
  // 6. MOBILE API CLIENT VERIFICATION
  // ==========================================================================
  describe("6. Mobile API Client Functions", () => {
    it("getGroupBalance invokes correct URL", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            groupId: validGroupId,
            currencyCode: "INR",
            memberCount: 3,
            balances: [],
          },
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await getGroupBalance(validGroupId, { currency: "INR" });
      expect(result.groupId).toBe(validGroupId);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/v1/groups/${validGroupId}/balance?currency=INR`),
        expect.objectContaining({ method: "GET" })
      );
    });

    it("getGroupSimplifiedDebts invokes correct URL", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            groupId: validGroupId,
            currencyCode: "INR",
            transferCount: 0,
            transfers: [],
          },
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await getGroupSimplifiedDebts(validGroupId);
      expect(result.groupId).toBe(validGroupId);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/v1/groups/${validGroupId}/balance/simplified`),
        expect.objectContaining({ method: "GET" })
      );
    });

    it("getUserGroupBalance invokes correct URL", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            userId: mockUserAlice.id,
            groupId: validGroupId,
            currencyCode: "INR",
            paidMinor: 0,
            owedMinor: 0,
            netBalanceMinor: 0,
          },
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await getUserGroupBalance(validGroupId);
      expect(result.groupId).toBe(validGroupId);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/v1/groups/${validGroupId}/balance/me`),
        expect.objectContaining({ method: "GET" })
      );
    });

    it("getUserOverallBalance invokes correct URL", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: {
            userId: mockUserAlice.id,
            balancesByCurrency: {},
          },
        }),
      });
      vi.stubGlobal("fetch", mockFetch);

      const result = await getUserOverallBalance();
      expect(result.userId).toBe(mockUserAlice.id);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/users/me/balances"),
        expect.objectContaining({ method: "GET" })
      );
    });
  });
});
