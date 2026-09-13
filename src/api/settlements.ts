import { apiRequest } from "./client.js";

export interface SafeSettlementUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export interface SettlementDetail {
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

export interface CreateSettlementInput {
  payerId: string;
  receiverId: string;
  amountMinor: number;
  currencyCode?: "INR" | "USD" | "EUR" | "GBP" | "JPY";
  settledAt?: string;
  notes?: string | null;
}

export interface UpdateSettlementInput {
  amountMinor?: number;
  settledAt?: string;
  notes?: string | null;
}

export interface ListSettlementsOptions {
  limit?: number;
  offset?: number;
}

/**
 * Creates a new settlement within a group.
 * Allows optional idempotency key to protect against duplicate network retries.
 */
export async function createSettlement(
  groupId: string,
  input: CreateSettlementInput,
  idempotencyKey?: string
): Promise<SettlementDetail> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  return apiRequest<SettlementDetail>(
    `/api/v1/groups/${encodeURIComponent(groupId)}/settlements`,
    {
      method: "POST",
      body: input,
      headers,
    }
  );
}

/**
 * Retrieves settlements for a specific group with deterministic ordering and pagination.
 */
export async function getGroupSettlements(
  groupId: string,
  options: ListSettlementsOptions = {}
): Promise<SettlementDetail[]> {
  const params = new URLSearchParams();
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  if (options.offset !== undefined) {
    params.set("offset", String(options.offset));
  }

  const queryString = params.toString();
  const endpoint = queryString
    ? `/api/v1/groups/${encodeURIComponent(groupId)}/settlements?${queryString}`
    : `/api/v1/groups/${encodeURIComponent(groupId)}/settlements`;

  return apiRequest<SettlementDetail[]>(endpoint, {
    method: "GET",
  });
}

/**
 * Retrieves details of a specific settlement (verifying group membership & IDOR protection).
 */
export async function getSettlement(
  groupId: string,
  settlementId: string
): Promise<SettlementDetail> {
  return apiRequest<SettlementDetail>(
    `/api/v1/groups/${encodeURIComponent(groupId)}/settlements/${encodeURIComponent(settlementId)}`,
    {
      method: "GET",
    }
  );
}

/**
 * Updates an existing settlement (requires settlement creator or group admin role).
 */
export async function updateSettlement(
  groupId: string,
  settlementId: string,
  updates: UpdateSettlementInput
): Promise<SettlementDetail> {
  return apiRequest<SettlementDetail>(
    `/api/v1/groups/${encodeURIComponent(groupId)}/settlements/${encodeURIComponent(settlementId)}`,
    {
      method: "PATCH",
      body: updates,
    }
  );
}

/**
 * Deletes a settlement atomically (requires settlement creator or group admin role).
 */
export async function deleteSettlement(
  groupId: string,
  settlementId: string
): Promise<{ success: boolean; message: string }> {
  return apiRequest<{ success: boolean; message: string }>(
    `/api/v1/groups/${encodeURIComponent(groupId)}/settlements/${encodeURIComponent(settlementId)}`,
    {
      method: "DELETE",
    }
  );
}
