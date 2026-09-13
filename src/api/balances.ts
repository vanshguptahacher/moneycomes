import { apiRequest } from "./client.js";

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

export interface BalanceQueryOptions {
  currency?: "INR" | "USD" | "EUR" | "GBP" | "JPY";
}

/**
 * Retrieves per-member net balances for a group.
 */
export async function getGroupBalance(
  groupId: string,
  options: BalanceQueryOptions = {}
): Promise<GroupBalanceResponse> {
  const query = options.currency
    ? `?currency=${encodeURIComponent(options.currency)}`
    : "";
  return apiRequest<GroupBalanceResponse>(
    `/api/v1/groups/${encodeURIComponent(groupId)}/balance${query}`,
    { method: "GET" }
  );
}

/**
 * Retrieves simplified debt settlement transfers for a group.
 */
export async function getGroupSimplifiedDebts(
  groupId: string,
  options: BalanceQueryOptions = {}
): Promise<GroupSimplifiedDebtsResponse> {
  const query = options.currency
    ? `?currency=${encodeURIComponent(options.currency)}`
    : "";
  return apiRequest<GroupSimplifiedDebtsResponse>(
    `/api/v1/groups/${encodeURIComponent(groupId)}/balance/simplified${query}`,
    { method: "GET" }
  );
}

/**
 * Retrieves the current user's personal balance within a group.
 */
export async function getUserGroupBalance(
  groupId: string,
  options: BalanceQueryOptions = {}
): Promise<UserPersonalBalanceResponse> {
  const query = options.currency
    ? `?currency=${encodeURIComponent(options.currency)}`
    : "";
  return apiRequest<UserPersonalBalanceResponse>(
    `/api/v1/groups/${encodeURIComponent(groupId)}/balance/me${query}`,
    { method: "GET" }
  );
}

/**
 * Retrieves the current user's aggregate personal balance across all active groups.
 */
export async function getUserOverallBalance(): Promise<OverallBalanceResponse> {
  return apiRequest<OverallBalanceResponse>("/api/v1/users/me/balances", {
    method: "GET",
  });
}
