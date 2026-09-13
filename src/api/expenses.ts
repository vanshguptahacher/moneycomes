import { apiRequest } from "./client.js";

export interface SafeExpenseUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export interface ExpenseSplitDetail {
  id: string;
  expenseId: string;
  userId: string;
  amountMinor: number;
  splitPercentage: number | null;
  splitShares: number | null;
  createdAt: string;
  user?: SafeExpenseUser;
}

export interface ExpenseDetail {
  id: string;
  groupId: string;
  description: string;
  amountMinor: number;
  currencyCode: string;
  paidByUserId: string;
  splitType: "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES";
  date: string;
  category: string | null;
  notes: string | null;
  createdById: string;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
  paidBy?: SafeExpenseUser;
  createdBy?: SafeExpenseUser;
  splits: ExpenseSplitDetail[];
}

export interface ExpenseSplitInput {
  userId: string;
  amountMinor?: number;
  splitPercentage?: number;
  splitShares?: number;
}

export interface CreateExpenseInput {
  description: string;
  amountMinor: number;
  currencyCode?: "INR" | "USD" | "EUR" | "GBP" | "JPY";
  paidByUserId: string;
  splitType?: "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES";
  date?: string;
  category?: string | null;
  notes?: string | null;
  splits?: ExpenseSplitInput[];
}

export interface UpdateExpenseInput {
  description?: string;
  amountMinor?: number;
  currencyCode?: "INR" | "USD" | "EUR" | "GBP" | "JPY";
  paidByUserId?: string;
  splitType?: "EQUAL" | "EXACT" | "PERCENTAGE" | "SHARES";
  date?: string;
  category?: string | null;
  notes?: string | null;
  splits?: ExpenseSplitInput[];
}

export interface ListExpensesOptions {
  limit?: number;
  offset?: number;
}

/**
 * Creates a new expense in a group with split calculations and activity logging.
 * Supports optional idempotency key to prevent duplicate submissions.
 */
export async function createExpense(
  groupId: string,
  input: CreateExpenseInput,
  idempotencyKey?: string
): Promise<ExpenseDetail> {
  const headers: Record<string, string> = {};
  if (idempotencyKey) {
    headers["Idempotency-Key"] = idempotencyKey;
  }

  return apiRequest<ExpenseDetail>(
    `/api/v1/groups/${encodeURIComponent(groupId)}/expenses`,
    {
      method: "POST",
      body: input,
      headers,
    }
  );
}

/**
 * Retrieves expenses for a specific group with deterministic ordering and pagination.
 */
export async function getGroupExpenses(
  groupId: string,
  options: ListExpensesOptions = {}
): Promise<ExpenseDetail[]> {
  const params = new URLSearchParams();
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  if (options.offset !== undefined) {
    params.set("offset", String(options.offset));
  }

  const queryString = params.toString();
  const endpoint = queryString
    ? `/api/v1/groups/${encodeURIComponent(groupId)}/expenses?${queryString}`
    : `/api/v1/groups/${encodeURIComponent(groupId)}/expenses`;

  return apiRequest<ExpenseDetail[]>(endpoint, {
    method: "GET",
  });
}

/**
 * Retrieves a single expense with splits (verifying group membership & IDOR boundary).
 */
export async function getExpense(
  groupId: string,
  expenseId: string
): Promise<ExpenseDetail> {
  return apiRequest<ExpenseDetail>(
    `/api/v1/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expenseId)}`,
    {
      method: "GET",
    }
  );
}

/**
 * Updates an existing expense (requires expense creator or group admin role).
 */
export async function updateExpense(
  groupId: string,
  expenseId: string,
  updates: UpdateExpenseInput
): Promise<ExpenseDetail> {
  return apiRequest<ExpenseDetail>(
    `/api/v1/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expenseId)}`,
    {
      method: "PATCH",
      body: updates,
    }
  );
}

/**
 * Soft-deletes an expense atomically (requires expense creator or group admin role).
 */
export async function deleteExpense(
  groupId: string,
  expenseId: string
): Promise<{ success: boolean; message: string }> {
  return apiRequest<{ success: boolean; message: string }>(
    `/api/v1/groups/${encodeURIComponent(groupId)}/expenses/${encodeURIComponent(expenseId)}`,
    {
      method: "DELETE",
    }
  );
}
