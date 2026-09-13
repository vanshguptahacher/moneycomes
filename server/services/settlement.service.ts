import {
  ForbiddenError,
  NotFoundError,
  BadRequestError,
} from "../errors/index.js";
import {
  settlementRepository,
  groupRepository,
  userRepository,
  type SettlementRepository,
  type GroupRepository,
  type UserRepository,
} from "../repositories/index.js";
import {
  GROUP_ROLES,
  type Settlement,
} from "../db/schema/index.js";

export interface SafeSettlementUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export interface SettlementDetailResponse {
  id: string;
  groupId: string;
  payerId: string;
  receiverId: string;
  amountMinor: number;
  currencyCode: string;
  settledAt: string;
  createdById: string;
  notes: string | null;
  createdAt: string;
  payer: SafeSettlementUser;
  receiver: SafeSettlementUser;
  createdBy: SafeSettlementUser;
}

export interface SettlementListResponse {
  settlements: SettlementDetailResponse[];
  total: number;
  limit: number;
  offset: number;
}

export interface CreateSettlementInput {
  payerId: string;
  receiverId: string;
  amountMinor: number;
  currencyCode?: string;
  settledAt?: string | Date;
  notes?: string | null;
}

export interface UpdateSettlementInput {
  amountMinor?: number;
  settledAt?: string | Date;
  notes?: string | null;
}

const SUPPORTED_CURRENCIES = new Set(["INR", "USD", "EUR", "GBP", "JPY"]);

interface IdempotencyRecord {
  response: SettlementDetailResponse;
  expiresAt: number;
}

/**
 * Service orchestrating settlement business logic, authorization,
 * financial consistency, and transactional activity logging.
 */
export class SettlementService {
  private idempotencyCache = new Map<string, IdempotencyRecord>();
  private readonly IDEMPOTENCY_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    private settlementRepo: SettlementRepository = settlementRepository,
    private groupRepo: GroupRepository = groupRepository,
    private userRepo: UserRepository = userRepository
  ) {}

  /**
   * Cleans expired idempotency records.
   */
  private purgeExpiredIdempotency(): void {
    const now = Date.now();
    for (const [key, record] of this.idempotencyCache.entries()) {
      if (now > record.expiresAt) {
        this.idempotencyCache.delete(key);
      }
    }
  }

  /**
   * Helper to resolve safe user profile representation.
   */
  private async getSafeUser(userId: string): Promise<SafeSettlementUser> {
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

  /**
   * Formats a raw database settlement record into a safe, client-facing response.
   */
  private async formatSettlementResponse(
    settlement: Settlement
  ): Promise<SettlementDetailResponse> {
    const [payer, receiver, createdBy] = await Promise.all([
      this.getSafeUser(settlement.payerId),
      this.getSafeUser(settlement.receiverId),
      this.getSafeUser(settlement.createdById),
    ]);

    return {
      id: settlement.id,
      groupId: settlement.groupId ?? "",
      payerId: settlement.payerId,
      receiverId: settlement.receiverId,
      amountMinor: settlement.amountMinor,
      currencyCode: settlement.currencyCode,
      settledAt: settlement.settledAt.toISOString(),
      createdById: settlement.createdById,
      notes: settlement.notes,
      createdAt: settlement.createdAt.toISOString(),
      payer,
      receiver,
      createdBy,
    };
  }

  /**
   * Creates a new settlement within a group.
   * Validates actor membership, payer/receiver membership, positive minor amount,
   * currency code, and records the settlement and activity event atomically.
   */
  async createSettlement(
    actorId: string,
    groupId: string,
    input: CreateSettlementInput,
    idempotencyKey?: string
  ): Promise<SettlementDetailResponse> {
    this.purgeExpiredIdempotency();

    // Idempotency check: if key is supplied, check for identical cached execution
    if (idempotencyKey && idempotencyKey.trim().length > 0) {
      const cacheKey = `${groupId}:${actorId}:${idempotencyKey.trim()}`;
      const cached = this.idempotencyCache.get(cacheKey);
      if (cached && Date.now() < cached.expiresAt) {
        return cached.response;
      }
    }

    // 1. Verify group exists
    const group = await this.groupRepo.findById(groupId);
    if (!group) {
      throw new NotFoundError("Group not found");
    }

    // 2. Verify actor is a member of the group
    const actorMembership = await this.groupRepo.findMembership(groupId, actorId);
    if (!actorMembership) {
      throw new ForbiddenError("You are not a member of this group");
    }

    const { payerId, receiverId, amountMinor, notes, settledAt } = input;

    // 3. Validate payer and receiver
    if (!payerId || typeof payerId !== "string" || !payerId.trim()) {
      throw new BadRequestError("Valid payerId is required");
    }
    if (!receiverId || typeof receiverId !== "string" || !receiverId.trim()) {
      throw new BadRequestError("Valid receiverId is required");
    }

    const cleanPayerId = payerId.trim();
    const cleanReceiverId = receiverId.trim();

    if (cleanPayerId === cleanReceiverId) {
      throw new BadRequestError("Payer and receiver cannot be the same user");
    }

    // 4. Verify both payer and receiver belong to the group
    const [payerMembership, receiverMembership] = await Promise.all([
      this.groupRepo.findMembership(groupId, cleanPayerId),
      this.groupRepo.findMembership(groupId, cleanReceiverId),
    ]);

    if (!payerMembership) {
      throw new BadRequestError(`Payer "${cleanPayerId}" is not a member of this group`);
    }
    if (!receiverMembership) {
      throw new BadRequestError(`Receiver "${cleanReceiverId}" is not a member of this group`);
    }

    // 5. Validate amountMinor (positive safe integer)
    if (
      typeof amountMinor !== "number" ||
      !Number.isSafeInteger(amountMinor) ||
      amountMinor <= 0
    ) {
      throw new BadRequestError(
        "Settlement amount must be a positive safe integer representing minor currency units"
      );
    }

    // 6. Validate currency
    const currencyCode = (input.currencyCode ?? group.defaultCurrencyCode).trim().toUpperCase();
    if (!SUPPORTED_CURRENCIES.has(currencyCode)) {
      throw new BadRequestError(
        `Invalid currency code "${currencyCode}". Supported currencies: INR, USD, EUR, GBP, JPY`
      );
    }

    // 7. Validate settledAt
    let parsedSettledAt: Date = new Date();
    if (settledAt) {
      const d = settledAt instanceof Date ? settledAt : new Date(settledAt);
      if (isNaN(d.getTime())) {
        throw new BadRequestError("Invalid settledAt date format");
      }
      parsedSettledAt = d;
    }

    // 8. Validate notes length
    let cleanNotes: string | null = null;
    if (notes !== undefined && notes !== null) {
      cleanNotes = notes.trim();
      if (cleanNotes.length > 1000) {
        throw new BadRequestError("Notes cannot exceed 1000 characters");
      }
      if (cleanNotes.length === 0) {
        cleanNotes = null;
      }
    }

    // 9. Atomic creation with activity log
    const created = await this.settlementRepo.createWithActivity(
      {
        groupId,
        payerId: cleanPayerId,
        receiverId: cleanReceiverId,
        amountMinor,
        currencyCode,
        settledAt: parsedSettledAt,
        createdById: actorId,
        notes: cleanNotes,
        createdAt: new Date(),
      },
      actorId
    );

    const response = await this.formatSettlementResponse(created);

    // Cache idempotent response if key was provided
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
   * Retrieves a single settlement by ID, verifying group membership and IDOR boundary.
   */
  async getSettlementById(
    actorId: string,
    groupId: string,
    settlementId: string
  ): Promise<SettlementDetailResponse> {
    // 1. Verify actor is a member of the group
    const membership = await this.groupRepo.findMembership(groupId, actorId);
    if (!membership) {
      throw new ForbiddenError("You are not a member of this group");
    }

    // 2. Fetch settlement
    const settlement = await this.settlementRepo.findById(settlementId);
    if (!settlement || settlement.groupId !== groupId) {
      // Return 404 to avoid leaking cross-group existence (IDOR prevention)
      throw new NotFoundError("Settlement not found");
    }

    return this.formatSettlementResponse(settlement);
  }

  /**
   * Lists settlements for a group, enforcing member authorization and pagination.
   */
  async listGroupSettlements(
    actorId: string,
    groupId: string,
    pagination: { limit?: number; offset?: number } = {}
  ): Promise<SettlementListResponse> {
    // 1. Verify actor is a member of the group
    const membership = await this.groupRepo.findMembership(groupId, actorId);
    if (!membership) {
      throw new ForbiddenError("You are not a member of this group");
    }

    const limit = Math.min(Math.max(pagination.limit ?? 20, 1), 100);
    const offset = Math.max(pagination.offset ?? 0, 0);

    // 2. Query repository
    const result = await this.settlementRepo.listByGroupId(groupId, { limit, offset });

    // 3. Format responses
    const formatted = await Promise.all(
      result.settlements.map((s) => this.formatSettlementResponse(s))
    );

    return {
      settlements: formatted,
      total: result.total,
      limit,
      offset,
    };
  }

  /**
   * Updates an existing settlement.
   * Only the creator or a group admin can update a settlement.
   */
  async updateSettlement(
    actorId: string,
    groupId: string,
    settlementId: string,
    updates: UpdateSettlementInput
  ): Promise<SettlementDetailResponse> {
    // 1. Verify group membership
    const membership = await this.groupRepo.findMembership(groupId, actorId);
    if (!membership) {
      throw new ForbiddenError("You are not a member of this group");
    }

    // 2. Verify settlement exists and belongs to this group
    const settlement = await this.settlementRepo.findById(settlementId);
    if (!settlement || settlement.groupId !== groupId) {
      throw new NotFoundError("Settlement not found");
    }

    // 3. Authorize: only creator or group admin can update
    const isCreator = settlement.createdById === actorId;
    const isAdmin = membership.role === GROUP_ROLES.ADMIN;
    if (!isCreator && !isAdmin) {
      throw new ForbiddenError(
        "Only the settlement creator or a group admin can update this settlement"
      );
    }

    const patchData: Partial<typeof settlement> = {};

    // Validate updated amountMinor
    if (updates.amountMinor !== undefined) {
      if (
        typeof updates.amountMinor !== "number" ||
        !Number.isSafeInteger(updates.amountMinor) ||
        updates.amountMinor <= 0
      ) {
        throw new BadRequestError(
          "Settlement amount must be a positive safe integer representing minor currency units"
        );
      }
      patchData.amountMinor = updates.amountMinor;
    }

    // Validate updated settledAt
    if (updates.settledAt !== undefined) {
      const d =
        updates.settledAt instanceof Date
          ? updates.settledAt
          : new Date(updates.settledAt);
      if (isNaN(d.getTime())) {
        throw new BadRequestError("Invalid settledAt date format");
      }
      patchData.settledAt = d;
    }

    // Validate updated notes
    if (updates.notes !== undefined) {
      if (updates.notes === null) {
        patchData.notes = null;
      } else {
        const cleanNotes = updates.notes.trim();
        if (cleanNotes.length > 1000) {
          throw new BadRequestError("Notes cannot exceed 1000 characters");
        }
        patchData.notes = cleanNotes.length > 0 ? cleanNotes : null;
      }
    }

    if (Object.keys(patchData).length === 0) {
      return this.formatSettlementResponse(settlement);
    }

    const updated = await this.settlementRepo.updateWithActivity(
      settlementId,
      patchData,
      actorId
    );

    if (!updated) {
      throw new NotFoundError("Settlement not found");
    }

    return this.formatSettlementResponse(updated);
  }

  /**
   * Deletes an existing settlement atomically.
   * Only the creator or a group admin can delete a settlement.
   */
  async deleteSettlement(
    actorId: string,
    groupId: string,
    settlementId: string
  ): Promise<{ success: boolean; message: string }> {
    // 1. Verify group membership
    const membership = await this.groupRepo.findMembership(groupId, actorId);
    if (!membership) {
      throw new ForbiddenError("You are not a member of this group");
    }

    // 2. Verify settlement exists and belongs to this group
    const settlement = await this.settlementRepo.findById(settlementId);
    if (!settlement || settlement.groupId !== groupId) {
      throw new NotFoundError("Settlement not found");
    }

    // 3. Authorize: only creator or group admin can delete
    const isCreator = settlement.createdById === actorId;
    const isAdmin = membership.role === GROUP_ROLES.ADMIN;
    if (!isCreator && !isAdmin) {
      throw new ForbiddenError(
        "Only the settlement creator or a group admin can delete this settlement"
      );
    }

    const deleted = await this.settlementRepo.deleteWithActivity(
      settlementId,
      groupId,
      actorId
    );

    if (!deleted) {
      throw new NotFoundError("Settlement not found");
    }

    return {
      success: true,
      message: "Settlement deleted successfully",
    };
  }
}

export const settlementService = new SettlementService();
