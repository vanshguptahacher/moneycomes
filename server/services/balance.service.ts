import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
  BadRequestError,
} from "../errors/index.js";
import {
  groupRepository,
  expenseRepository,
  settlementRepository,
  userRepository,
  type GroupRepository,
  type ExpenseRepository,
  type SettlementRepository,
  type UserRepository,
} from "../repositories/index.js";
import {
  make,
  calculateExpenseBalances,
  calculateGroupBalances,
  simplifyDebts,
  type CurrencyCode,
  type GroupBalanceResult,
  type GroupSettlementInput,
  type ExpenseBalanceResult,
} from "../../src/domain/index.js";

export interface SafeBalanceUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export interface MemberBalanceDetail {
  userId: string;
  name: string;
  email: string;
  image: string | null;
  paidMinor: number;
  owedMinor: number;
  netBalanceMinor: number;
  currencyCode: string;
}

export interface GroupBalanceResponse {
  groupId: string;
  currencyCode: string;
  memberCount: number;
  balances: MemberBalanceDetail[];
}

export interface SimplifiedTransferDetail {
  fromUserId: string;
  toUserId: string;
  fromUser: SafeBalanceUser;
  toUser: SafeBalanceUser;
  amountMinor: number;
  currencyCode: string;
}

export interface GroupSimplifiedDebtsResponse {
  groupId: string;
  currencyCode: string;
  transferCount: number;
  transfers: SimplifiedTransferDetail[];
}

export interface UserPersonalBalanceResponse {
  userId: string;
  groupId: string;
  currencyCode: string;
  paidMinor: number;
  owedMinor: number;
  netBalanceMinor: number;
}

export interface OverallBalanceCurrencySummary {
  currencyCode: string;
  paidMinor: number;
  owedMinor: number;
  netBalanceMinor: number;
}

export interface OverallBalanceResponse {
  userId: string;
  balancesByCurrency: Record<string, OverallBalanceCurrencySummary>;
}

const SUPPORTED_CURRENCIES = new Set(["INR", "USD", "EUR", "GBP", "JPY"]);

/**
 * Balance application service orchestrating domain engine calculations,
 * group authorization, and data mapping.
 */
export class BalanceService {
  constructor(
    private groupRepo: GroupRepository = groupRepository,
    private expenseRepo: ExpenseRepository = expenseRepository,
    private settlementRepo: SettlementRepository = settlementRepository,
    private userRepo: UserRepository = userRepository
  ) {}

  /**
   * Helper to verify group existence and user membership.
   */
  private async requireGroupMember(actorId: string, groupId: string) {
    if (!actorId) {
      throw new ForbiddenError("Authenticated actor identity is required");
    }

    const trimmedGroupId = groupId?.trim();
    if (!trimmedGroupId) {
      throw new ValidationError("Group ID is required");
    }

    const group = await this.groupRepo.findById(trimmedGroupId);
    if (!group) {
      throw new NotFoundError(`Group with ID ${trimmedGroupId} was not found`);
    }

    const membership = await this.groupRepo.findMembership(trimmedGroupId, actorId);
    if (!membership) {
      throw new ForbiddenError("You do not have permission to view balances for this group");
    }

    return group;
  }

  /**
   * Computes the internal domain GroupBalanceResult for a group.
   */
  async computeGroupBalanceDomain(
    groupId: string,
    requestedCurrency?: string
  ): Promise<{
    domainResult: GroupBalanceResult;
    userMap: Map<string, SafeBalanceUser>;
    activeCurrency: CurrencyCode;
  }> {
    const group = await this.groupRepo.findById(groupId);
    if (!group) {
      throw new NotFoundError(`Group with ID ${groupId} was not found`);
    }

    const activeCurrency = (
      requestedCurrency || group.defaultCurrencyCode
    ).toUpperCase() as CurrencyCode;

    if (!SUPPORTED_CURRENCIES.has(activeCurrency)) {
      throw new BadRequestError(`Unsupported currency code: ${activeCurrency}`);
    }

    // 1. Fetch group members with user profiles
    const memberProfiles = await this.groupRepo.listMembers(groupId);
    const userMap = new Map<string, SafeBalanceUser>();

    for (const mp of memberProfiles) {
      userMap.set(mp.user.id, {
        id: mp.user.id,
        name: mp.user.name,
        email: mp.user.email,
        image: mp.user.image ?? null,
      });
    }

    // 2. Fetch all active expenses with splits
    const allExpenses = await this.expenseRepo.findGroupExpensesWithSplits(groupId);
    const filteredExpenses = allExpenses.filter(
      (e) => e.currencyCode === activeCurrency
    );

    // 3. Fetch all settlements
    const allSettlements = await this.settlementRepo.findGroupSettlementsAll(groupId);
    const filteredSettlements = allSettlements.filter(
      (s) => s.currencyCode === activeCurrency
    );

    // Collect any extra user IDs referenced in expenses/settlements not currently in group members
    const memberIdSet = new Set(memberProfiles.map((m) => m.user.id));
    for (const exp of filteredExpenses) {
      memberIdSet.add(exp.payerId);
      for (const split of exp.splits) {
        memberIdSet.add(split.userId);
      }
    }
    for (const st of filteredSettlements) {
      memberIdSet.add(st.payerId);
      memberIdSet.add(st.receiverId);
    }

    // Lookup any missing user profiles
    for (const uid of memberIdSet) {
      if (!userMap.has(uid)) {
        const u = await this.userRepo.findById(uid);
        if (u) {
          userMap.set(u.id, {
            id: u.id,
            name: u.name,
            email: u.email,
            image: u.image ?? null,
          });
        } else {
          userMap.set(uid, {
            id: uid,
            name: "Unknown Member",
            email: "",
            image: null,
          });
        }
      }
    }

    const memberIds = Array.from(memberIdSet);
    if (memberIds.length === 0) {
      memberIds.push(group.createdById);
    }

    // 4. Map expenses to domain ExpenseBalanceResult
    const expenseResults: ExpenseBalanceResult[] = [];
    for (const exp of filteredExpenses) {
      if (!exp.splits || exp.splits.length === 0) continue;
      const totalMoney = make(exp.amountMinor, activeCurrency);
      const allocations = exp.splits.map((s) => ({
        participantId: s.userId,
        amount: make(s.allocatedAmountMinor, activeCurrency),
      }));

      try {
        const res = calculateExpenseBalances({
          total: totalMoney,
          payerId: exp.payerId,
          allocations,
        });
        expenseResults.push(res);
      } catch {
        // Skip malformed expense records
      }
    }

    // 5. Map settlements to domain GroupSettlementInput
    const settlementInputs: GroupSettlementInput[] = [];
    for (const st of filteredSettlements) {
      if (st.payerId === st.receiverId || st.amountMinor <= 0) continue;
      settlementInputs.push({
        payerId: st.payerId,
        receiverId: st.receiverId,
        amount: make(st.amountMinor, activeCurrency),
      });
    }

    // 6. Compute group balance via domain engine
    const domainResult = calculateGroupBalances({
      groupId,
      currency: activeCurrency,
      members: memberIds,
      expenses: expenseResults,
      settlements: settlementInputs,
    });

    return { domainResult, userMap, activeCurrency };
  }

  /**
   * Retrieves net balance breakdown for all members of a group.
   */
  async getGroupBalance(
    actorId: string,
    groupId: string,
    requestedCurrency?: string
  ): Promise<GroupBalanceResponse> {
    await this.requireGroupMember(actorId, groupId);
    const { domainResult, userMap, activeCurrency } = await this.computeGroupBalanceDomain(
      groupId,
      requestedCurrency
    );

    const balances: MemberBalanceDetail[] = domainResult.balances.map((mb) => {
      const user = userMap.get(mb.userId) ?? {
        id: mb.userId,
        name: "Unknown Member",
        email: "",
        image: null,
      };

      return {
        userId: mb.userId,
        name: user.name,
        email: user.email,
        image: user.image,
        paidMinor: mb.paid.amountMinor,
        owedMinor: mb.owed.amountMinor,
        netBalanceMinor: mb.netBalance.amountMinor,
        currencyCode: activeCurrency,
      };
    });

    return {
      groupId,
      currencyCode: activeCurrency,
      memberCount: balances.length,
      balances,
    };
  }

  /**
   * Retrieves simplified debt transfer list for a group.
   */
  async getGroupSimplifiedDebts(
    actorId: string,
    groupId: string,
    requestedCurrency?: string
  ): Promise<GroupSimplifiedDebtsResponse> {
    await this.requireGroupMember(actorId, groupId);
    const { domainResult, userMap, activeCurrency } = await this.computeGroupBalanceDomain(
      groupId,
      requestedCurrency
    );

    if (domainResult.balances.length === 0) {
      return {
        groupId,
        currencyCode: activeCurrency,
        transferCount: 0,
        transfers: [],
      };
    }

    const simplifiedResult = simplifyDebts(domainResult);

    const transfers: SimplifiedTransferDetail[] = simplifiedResult.transfers.map((t) => {
      const fromUser = userMap.get(t.fromUserId) ?? {
        id: t.fromUserId,
        name: "Unknown Member",
        email: "",
        image: null,
      };
      const toUser = userMap.get(t.toUserId) ?? {
        id: t.toUserId,
        name: "Unknown Member",
        email: "",
        image: null,
      };

      return {
        fromUserId: t.fromUserId,
        toUserId: t.toUserId,
        fromUser,
        toUser,
        amountMinor: t.amount.amountMinor,
        currencyCode: activeCurrency,
      };
    });

    return {
      groupId,
      currencyCode: activeCurrency,
      transferCount: transfers.length,
      transfers,
    };
  }

  /**
   * Retrieves personal balance for the authenticated user within a group.
   */
  async getUserGroupBalance(
    actorId: string,
    groupId: string,
    requestedCurrency?: string
  ): Promise<UserPersonalBalanceResponse> {
    await this.requireGroupMember(actorId, groupId);
    const groupBalance = await this.getGroupBalance(actorId, groupId, requestedCurrency);
    const myBalance = groupBalance.balances.find((b) => b.userId === actorId);

    return {
      userId: actorId,
      groupId,
      currencyCode: groupBalance.currencyCode,
      paidMinor: myBalance?.paidMinor ?? 0,
      owedMinor: myBalance?.owedMinor ?? 0,
      netBalanceMinor: myBalance?.netBalanceMinor ?? 0,
    };
  }

  /**
   * Retrieves aggregate personal balance for the user across all their active groups.
   */
  async getUserOverallBalance(actorId: string): Promise<OverallBalanceResponse> {
    if (!actorId) {
      throw new ForbiddenError("Authenticated actor identity is required");
    }

    const memberships = await this.groupRepo.listByUserId(actorId, false);
    const balancesByCurrency: Record<string, OverallBalanceCurrencySummary> = {};

    for (const m of memberships) {
      const g = m.group;
      try {
        const { domainResult, activeCurrency } = await this.computeGroupBalanceDomain(g.id);
        const myBal = domainResult.balances.find((b) => b.userId === actorId);
        if (myBal) {
          if (!balancesByCurrency[activeCurrency]) {
            balancesByCurrency[activeCurrency] = {
              currencyCode: activeCurrency,
              paidMinor: 0,
              owedMinor: 0,
              netBalanceMinor: 0,
            };
          }
          balancesByCurrency[activeCurrency].paidMinor += myBal.paid.amountMinor;
          balancesByCurrency[activeCurrency].owedMinor += myBal.owed.amountMinor;
          balancesByCurrency[activeCurrency].netBalanceMinor += myBal.netBalance.amountMinor;
        }
      } catch {
        // Skip inaccessible group
      }
    }

    return {
      userId: actorId,
      balancesByCurrency,
    };
  }
}

export const balanceService = new BalanceService();
