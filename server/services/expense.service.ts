import {
  ForbiddenError,
  NotFoundError,
  BadRequestError,
} from "../errors/index.js";
import {
  expenseRepository,
  groupRepository,
  userRepository,
  notificationRepository,
  type ExpenseRepository,
  type GroupRepository,
  type UserRepository,
  type NotificationRepository,
} from "../repositories/index.js";
import {
  type Expense,
  type ExpenseSplit,
  type NewExpenseSplit,
  NOTIFICATION_TYPES,
} from "../db/schema/index.js";
import {
  make,
  splitEqually,
  splitExactly,
  splitByPercentage,
  splitByShares,
  type CurrencyCode,
  SUPPORTED_CURRENCY_CODES,
  isCurrencyCode,
  MoneyError,
} from "../../src/domain/index.js";

export interface SafeExpenseUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export interface ExpenseSplitResponse {
  id?: string;
  userId: string;
  allocatedAmountMinor: number;
  percentageBasisPoints: number | null;
  shares: number | null;
  user: SafeExpenseUser;
}

export interface ExpenseDetailResponse {
  id: string;
  groupId: string;
  payerId: string;
  createdById: string;
  description: string;
  amountMinor: number;
  currencyCode: string;
  splitMethod: string;
  date: string;
  notes: string | null;
  createdAt: string;
  payer: SafeExpenseUser;
  creator: SafeExpenseUser;
  splits: ExpenseSplitResponse[];
}

export interface ParticipantSplitInput {
  userId: string;
  allocatedAmountMinor?: number;
  amountMinor?: number;
  percentageBasisPoints?: number;
  splitPercentage?: number;
  shares?: number;
  splitShares?: number;
}

export interface CreateExpenseServiceInput {
  payerId?: string;
  paidByUserId?: string;
  description: string;
  amountMinor: number;
  currencyCode?: string;
  splitMethod?: "equal" | "exact" | "percentage" | "shares";
  splitType?: "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES" | "equal" | "exact" | "percentage" | "shares";
  date?: string | Date;
  notes?: string | null;
  category?: string | null;
  participants?: ParticipantSplitInput[];
  splits?: ParticipantSplitInput[];
}

export interface UpdateExpenseServiceInput {
  description?: string;
  amountMinor?: number;
  payerId?: string;
  paidByUserId?: string;
  currencyCode?: string;
  date?: string | Date;
  notes?: string | null;
  category?: string | null;
  splitMethod?: "equal" | "exact" | "percentage" | "shares";
  splitType?: "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES" | "equal" | "exact" | "percentage" | "shares";
  participants?: ParticipantSplitInput[];
  splits?: ParticipantSplitInput[];
}

export interface ListExpensesServiceOptions {
  limit?: number;
  offset?: number;
}

export interface ListExpensesServiceResult {
  expenses: ExpenseDetailResponse[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Service orchestrating expense operations, mathematical split invariants,
 * member authorization, idempotency caching, and notification dispatch.
 */
export class ExpenseService {
  private readonly idempotencyCache = new Map<
    string,
    { response: ExpenseDetailResponse; expiresAt: number }
  >();
  private readonly IDEMPOTENCY_TTL_MS = 1000 * 60 * 10; // 10 minutes

  constructor(
    private readonly expenseRepo: ExpenseRepository = expenseRepository,
    private readonly groupRepo: GroupRepository = groupRepository,
    private readonly userRepo: UserRepository = userRepository,
    private readonly notifRepo: NotificationRepository = notificationRepository
  ) {}

  private cleanExpiredIdempotencyKeys() {
    const now = Date.now();
    for (const [key, record] of this.idempotencyCache.entries()) {
      if (now > record.expiresAt) {
        this.idempotencyCache.delete(key);
      }
    }
  }

  private async getSafeUser(userId: string): Promise<SafeExpenseUser> {
    const user = await this.userRepo.findById(userId);
    if (!user) {
      return {
        id: userId,
        name: "Unknown User",
        email: "",
        image: null,
      };
    }
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      image: user.image,
    };
  }

  private async formatExpenseResponse(
    expense: Expense,
    splits: ExpenseSplit[]
  ): Promise<ExpenseDetailResponse> {
    const userIds = Array.from(
      new Set([
        expense.payerId,
        expense.createdById,
        ...splits.map((s) => s.userId),
      ])
    );

    const userMap = new Map<string, SafeExpenseUser>();
    await Promise.all(
      userIds.map(async (id) => {
        const safe = await this.getSafeUser(id);
        userMap.set(id, safe);
      })
    );

    const payer = userMap.get(expense.payerId) ?? {
      id: expense.payerId,
      name: "Unknown User",
      email: "",
      image: null,
    };

    const creator = userMap.get(expense.createdById) ?? {
      id: expense.createdById,
      name: "Unknown User",
      email: "",
      image: null,
    };

    const formattedSplits: ExpenseSplitResponse[] = splits.map((s) => ({
      id: s.id,
      userId: s.userId,
      allocatedAmountMinor: s.allocatedAmountMinor,
      percentageBasisPoints: s.percentageBasisPoints,
      shares: s.shares,
      user: userMap.get(s.userId) ?? {
        id: s.userId,
        name: "Unknown User",
        email: "",
        image: null,
      },
    }));

    return {
      id: expense.id,
      groupId: expense.groupId ?? "",
      payerId: expense.payerId,
      createdById: expense.createdById,
      description: expense.description,
      amountMinor: expense.amountMinor,
      currencyCode: expense.currencyCode,
      splitMethod: expense.splitMethod,
      date: expense.date instanceof Date ? expense.date.toISOString() : String(expense.date),
      notes: expense.notes,
      createdAt: expense.createdAt instanceof Date ? expense.createdAt.toISOString() : String(expense.createdAt),
      payer,
      creator,
      splits: formattedSplits,
    };
  }

  /**
   * Helper to compute participant splits using the authoritative domain engine.
   */
  private computeSplits(
    amountMinor: number,
    currencyCode: CurrencyCode,
    splitMethod: "equal" | "exact" | "percentage" | "shares",
    participants: ParticipantSplitInput[]
  ): Omit<NewExpenseSplit, "expenseId">[] {
    const totalMoney = make(amountMinor, currencyCode);

    if (!participants || participants.length === 0) {
      throw new BadRequestError("At least one participant is required for an expense");
    }

    const participantIds = participants.map((p) => p.userId.trim());
    const uniqueIds = new Set(participantIds);
    if (uniqueIds.size !== participantIds.length) {
      throw new BadRequestError("Duplicate participants are not allowed in an expense");
    }

    try {
      switch (splitMethod) {
        case "equal": {
          const result = splitEqually(totalMoney, participantIds);
          return result.allocations.map((alloc) => ({
            userId: alloc.participantId,
            allocatedAmountMinor: alloc.amount.amountMinor,
            percentageBasisPoints: null,
            shares: null,
            createdAt: new Date(),
          }));
        }

        case "exact": {
          const exactInputs = participants.map((p) => {
            const amt = p.allocatedAmountMinor ?? p.amountMinor;
            if (
              typeof amt !== "number" ||
              !Number.isSafeInteger(amt) ||
              amt < 0
            ) {
              throw new BadRequestError(
                `allocatedAmountMinor for participant ${p.userId} must be a non-negative integer`
              );
            }
            return {
              participantId: p.userId.trim(),
              amount: make(amt, currencyCode),
            };
          });

          const result = splitExactly(totalMoney, exactInputs);
          return result.allocations.map((alloc) => ({
            userId: alloc.participantId,
            allocatedAmountMinor: alloc.amount.amountMinor,
            percentageBasisPoints: null,
            shares: null,
            createdAt: new Date(),
          }));
        }

        case "percentage": {
          const percentageMap = new Map<string, number>();
          const percentageInputs = participants.map((p) => {
            const bps =
              p.percentageBasisPoints ??
              (p.splitPercentage !== undefined ? Math.round(p.splitPercentage * 100) : undefined);
            if (
              typeof bps !== "number" ||
              !Number.isSafeInteger(bps) ||
              bps < 0
            ) {
              throw new BadRequestError(
                `percentageBasisPoints for participant ${p.userId} must be a non-negative integer`
              );
            }
            percentageMap.set(p.userId.trim(), bps);
            return {
              participantId: p.userId.trim(),
              basisPoints: bps,
            };
          });

          const result = splitByPercentage(totalMoney, percentageInputs);
          return result.allocations.map((alloc) => ({
            userId: alloc.participantId,
            allocatedAmountMinor: alloc.amount.amountMinor,
            percentageBasisPoints: percentageMap.get(alloc.participantId) ?? null,
            shares: null,
            createdAt: new Date(),
          }));
        }

        case "shares": {
          const sharesMap = new Map<string, number>();
          const sharesInputs = participants.map((p) => {
            const sh = p.shares ?? p.splitShares;
            if (
              typeof sh !== "number" ||
              !Number.isSafeInteger(sh) ||
              sh <= 0
            ) {
              throw new BadRequestError(
                `shares for participant ${p.userId} must be a positive integer`
              );
            }
            sharesMap.set(p.userId.trim(), sh);
            return {
              participantId: p.userId.trim(),
              shares: sh,
            };
          });

          const result = splitByShares(totalMoney, sharesInputs);
          return result.allocations.map((alloc) => ({
            userId: alloc.participantId,
            allocatedAmountMinor: alloc.amount.amountMinor,
            percentageBasisPoints: null,
            shares: sharesMap.get(alloc.participantId) ?? null,
            createdAt: new Date(),
          }));
        }

        default:
          throw new BadRequestError(`Unsupported split method: "${splitMethod}"`);
      }
    } catch (err: unknown) {
      if (err instanceof MoneyError) {
        throw new BadRequestError(err.message);
      }
      throw err;
    }
  }

  /**
   * Creates a new expense in a group with transactional split calculation and activity logging.
   */
  async createExpense(
    actorId: string,
    groupId: string,
    input: CreateExpenseServiceInput,
    idempotencyKey?: string
  ): Promise<ExpenseDetailResponse> {
    this.cleanExpiredIdempotencyKeys();

    if (idempotencyKey && idempotencyKey.trim().length > 0) {
      const cacheKey = `${groupId}:${actorId}:${idempotencyKey.trim()}`;
      const cached = this.idempotencyCache.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        return cached.response;
      }
    }

    // 1. Verify actor is a member of the group
    const actorMembership = await this.groupRepo.findMembership(groupId, actorId);
    if (!actorMembership) {
      throw new ForbiddenError("You are not a member of this group");
    }

    // 2. Fetch group
    const group = await this.groupRepo.findById(groupId);
    if (!group) {
      throw new NotFoundError("Group not found");
    }

    const effectivePayerId = (input.payerId ?? input.paidByUserId ?? "").trim();
    if (!effectivePayerId) {
      throw new BadRequestError("Payer ID is required");
    }

    // 3. Verify payer is a member of the group
    const payerMembership = await this.groupRepo.findMembership(groupId, effectivePayerId);
    if (!payerMembership) {
      throw new BadRequestError(`Payer "${effectivePayerId}" is not a member of this group`);
    }

    // Normalize split method
    const rawMethod = (input.splitMethod ?? input.splitType ?? "equal").toLowerCase();
    const splitMethod: "equal" | "exact" | "percentage" | "shares" =
      rawMethod === "exact"
        ? "exact"
        : rawMethod === "percentage"
        ? "percentage"
        : rawMethod === "shares"
        ? "shares"
        : "equal";

    // Normalize participants list
    let participants = input.participants ?? input.splits ?? [];
    if (participants.length === 0 && splitMethod === "equal") {
      const allMembers = await this.groupRepo.listMembers(groupId);
      participants = allMembers.map((m) => ({ userId: m.member.userId }));
    }

    if (participants.length === 0) {
      throw new BadRequestError("At least one participant is required for an expense");
    }

    // 4. Verify all participants are members of the group
    await Promise.all(
      participants.map(async (p) => {
        const mem = await this.groupRepo.findMembership(groupId, p.userId.trim());
        if (!mem) {
          throw new BadRequestError(`Participant "${p.userId}" is not a member of this group`);
        }
      })
    );

    const { description, amountMinor, notes } = input;

    // 5. Validate amountMinor
    if (
      typeof amountMinor !== "number" ||
      !Number.isSafeInteger(amountMinor) ||
      amountMinor <= 0
    ) {
      throw new BadRequestError("Expense amount must be a positive safe integer in minor units");
    }

    // 6. Validate currency
    const rawCurrency = (input.currencyCode ?? group.defaultCurrencyCode).trim().toUpperCase();
    if (!isCurrencyCode(rawCurrency)) {
      throw new BadRequestError(
        `Invalid currency code "${rawCurrency}". Supported: ${SUPPORTED_CURRENCY_CODES.join(", ")}`
      );
    }
    const currencyCode: CurrencyCode = rawCurrency;

    // 7. Validate description
    const cleanDesc = description ? description.trim() : "";
    if (!cleanDesc) {
      throw new BadRequestError("Expense description cannot be empty");
    }
    if (cleanDesc.length > 255) {
      throw new BadRequestError("Expense description cannot exceed 255 characters");
    }

    // 8. Compute splits via domain engine
    const splitsToInsert = this.computeSplits(amountMinor, currencyCode, splitMethod, participants);

    // 9. Validate date
    let parsedDate = new Date();
    if (input.date) {
      const d = input.date instanceof Date ? input.date : new Date(input.date);
      if (isNaN(d.getTime())) {
        throw new BadRequestError("Invalid expense date format");
      }
      parsedDate = d;
    }

    // 10. Atomic persistence
    const { expense: created, splits: createdSplits } =
      await this.expenseRepo.createWithSplits(
        {
          groupId,
          payerId: effectivePayerId,
          createdById: actorId,
          description: cleanDesc,
          amountMinor,
          currencyCode,
          splitMethod,
          date: parsedDate,
          notes: notes ? notes.trim() : null,
          isDeleted: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        splitsToInsert,
        actorId
      );

    // 11. Dispatch notifications to affected participants (excluding actor)
    const distinctParticipantIds = Array.from(
      new Set(createdSplits.map((s) => s.userId).filter((id) => id !== actorId))
    );

    const actorUser = await this.getSafeUser(actorId);
    await Promise.all(
      distinctParticipantIds.map(async (recipientId) => {
        try {
          await this.notifRepo.create({
            recipientId,
            actorId,
            groupId,
            expenseId: created.id,
            type: NOTIFICATION_TYPES.EXPENSE_CREATED,
            title: "New Expense Added",
            message: `${actorUser.name} added "${cleanDesc}" in ${group.name}`,
            metadata: {
              amountMinor,
              currencyCode,
            },
            createdAt: new Date(),
          });
        } catch {
          // Non-blocking notification delivery
        }
      })
    );

    // 12. Format response
    const response = await this.formatExpenseResponse(created, createdSplits);

    // 13. Idempotency cache storage
    if (idempotencyKey && idempotencyKey.trim().length > 0) {
      const cacheKey = `${groupId}:${actorId}:${idempotencyKey.trim()}`;
      this.idempotencyCache.set(cacheKey, {
        response,
        expiresAt: Date.now() + this.IDEMPOTENCY_TTL_MS,
      });
    }

    return response;
  }

  /**
   * Retrieves an expense with its splits by ID.
   */
  async getExpenseById(
    actorId: string,
    groupId: string,
    expenseId: string
  ): Promise<ExpenseDetailResponse> {
    const membership = await this.groupRepo.findMembership(groupId, actorId);
    if (!membership) {
      throw new ForbiddenError("You are not a member of this group");
    }

    const result = await this.expenseRepo.findByIdWithSplits(expenseId);
    if (!result || result.expense.groupId !== groupId) {
      throw new NotFoundError("Expense not found");
    }

    return this.formatExpenseResponse(result.expense, result.splits);
  }

  /**
   * Lists active expenses for a group with pagination.
   */
  async listGroupExpenses(
    actorId: string,
    groupId: string,
    options: ListExpensesServiceOptions = {}
  ): Promise<ListExpensesServiceResult> {
    const membership = await this.groupRepo.findMembership(groupId, actorId);
    if (!membership) {
      throw new ForbiddenError("You are not a member of this group");
    }

    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const offset = Math.max(options.offset ?? 0, 0);

    const { expenses: rawExpenses, total } = await this.expenseRepo.listByGroupId(
      groupId,
      { limit, offset }
    );

    const formattedList = await Promise.all(
      rawExpenses.map((e) => this.formatExpenseResponse(e, e.splits))
    );

    return {
      expenses: formattedList,
      total,
      limit,
      offset,
    };
  }

  /**
   * Updates an expense (creator or group admin only).
   */
  async updateExpense(
    actorId: string,
    groupId: string,
    expenseId: string,
    input: UpdateExpenseServiceInput
  ): Promise<ExpenseDetailResponse> {
    const membership = await this.groupRepo.findMembership(groupId, actorId);
    if (!membership) {
      throw new ForbiddenError("You are not a member of this group");
    }

    const existing = await this.expenseRepo.findByIdWithSplits(expenseId);
    if (!existing || existing.expense.groupId !== groupId) {
      throw new NotFoundError("Expense not found");
    }

    const isCreator = existing.expense.createdById === actorId;
    const isAdmin = membership.role === "admin";
    if (!isCreator && !isAdmin) {
      throw new ForbiddenError("You are not authorized to update this expense");
    }

    const updates: Record<string, unknown> = {};

    if (input.description !== undefined) {
      const cleanDesc = input.description.trim();
      if (!cleanDesc) throw new BadRequestError("Description cannot be empty");
      updates.description = cleanDesc;
    }

    if (input.notes !== undefined) {
      updates.notes = input.notes ? input.notes.trim() : null;
    }

    if (input.date !== undefined) {
      const d = input.date instanceof Date ? input.date : new Date(input.date);
      if (isNaN(d.getTime())) throw new BadRequestError("Invalid date format");
      updates.date = d;
    }

    const effectivePayer = input.payerId ?? input.paidByUserId;
    if (effectivePayer !== undefined) {
      const cleanPayer = effectivePayer.trim();
      const payerMem = await this.groupRepo.findMembership(groupId, cleanPayer);
      if (!payerMem) {
        throw new BadRequestError(`Payer "${cleanPayer}" is not a member of this group`);
      }
      updates.payerId = cleanPayer;
    }

    let newSplits: Omit<NewExpenseSplit, "expenseId">[] | undefined;

    // If amount, splitMethod, or participants are updated, recompute splits
    if (
      input.amountMinor !== undefined ||
      input.splitMethod !== undefined ||
      input.splitType !== undefined ||
      input.participants !== undefined ||
      input.splits !== undefined
    ) {
      const amount = input.amountMinor ?? existing.expense.amountMinor;
      if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount <= 0) {
        throw new BadRequestError("Expense amount must be a positive safe integer");
      }
      updates.amountMinor = amount;

      const rawMethod = (input.splitMethod ?? input.splitType ?? existing.expense.splitMethod).toLowerCase();
      const method: "equal" | "exact" | "percentage" | "shares" =
        rawMethod === "exact"
          ? "exact"
          : rawMethod === "percentage"
          ? "percentage"
          : rawMethod === "shares"
          ? "shares"
          : "equal";
      updates.splitMethod = method;

      const currency = existing.expense.currencyCode as CurrencyCode;

      const parts = input.participants ?? input.splits ?? existing.splits.map((s) => ({
        userId: s.userId,
        allocatedAmountMinor: s.allocatedAmountMinor,
        percentageBasisPoints: s.percentageBasisPoints ?? undefined,
        shares: s.shares ?? undefined,
      }));

      newSplits = this.computeSplits(amount, currency, method, parts);
    }

    const updated = await this.expenseRepo.updateWithSplits(
      expenseId,
      updates,
      newSplits,
      actorId
    );

    if (!updated) {
      throw new NotFoundError("Expense not found");
    }

    return this.formatExpenseResponse(updated.expense, updated.splits);
  }

  /**
   * Soft-deletes an expense (creator or group admin only).
   */
  async deleteExpense(
    actorId: string,
    groupId: string,
    expenseId: string
  ): Promise<{ success: boolean; id: string }> {
    const membership = await this.groupRepo.findMembership(groupId, actorId);
    if (!membership) {
      throw new ForbiddenError("You are not a member of this group");
    }

    const existing = await this.expenseRepo.findById(expenseId);
    if (!existing || existing.groupId !== groupId) {
      throw new NotFoundError("Expense not found");
    }

    const isCreator = existing.createdById === actorId;
    const isAdmin = membership.role === "admin";
    if (!isCreator && !isAdmin) {
      throw new ForbiddenError("You are not authorized to delete this expense");
    }

    await this.expenseRepo.softDelete(expenseId, actorId);

    return { success: true, id: expenseId };
  }
}

export const expenseService = new ExpenseService();
