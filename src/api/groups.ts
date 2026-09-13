import { apiRequest } from "./client.js";

export interface GroupSummary {
  id: string;
  name: string;
  description: string | null;
  defaultCurrencyCode: string;
  createdById: string;
  isArchived: boolean;
  role: string;
  createdAt: string;
  updatedAt: string;
}

export interface GroupDetail {
  id: string;
  name: string;
  description: string | null;
  defaultCurrencyCode: string;
  createdById: string;
  isArchived: boolean;
  role?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GroupMemberUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export interface GroupMember {
  id: string;
  groupId: string;
  role: string;
  joinedAt: string;
  user: GroupMemberUser;
}

export interface CreateGroupInput {
  name: string;
  description?: string | null;
  defaultCurrencyCode?: "INR" | "USD" | "EUR" | "GBP" | "JPY";
  memberUserIds?: string[];
}

export interface UpdateGroupInput {
  name?: string;
  description?: string | null;
  defaultCurrencyCode?: "INR" | "USD" | "EUR" | "GBP" | "JPY";
  isArchived?: boolean;
}

export interface AddGroupMemberInput {
  userId: string;
  role?: "member" | "admin";
}

/**
 * Creates a new group. The current authenticated user is automatically set as the admin creator.
 */
export async function createGroup(input: CreateGroupInput): Promise<GroupDetail> {
  return apiRequest<GroupDetail>("/api/v1/groups", {
    method: "POST",
    body: input,
  });
}

/**
 * Retrieves all active groups for the authenticated user, with optional search query.
 */
export async function getGroups(query?: string): Promise<GroupSummary[]> {
  const endpoint = query?.trim()
    ? `/api/v1/groups?q=${encodeURIComponent(query.trim())}`
    : "/api/v1/groups";

  return apiRequest<GroupSummary[]>(endpoint, {
    method: "GET",
  });
}

/**
 * Retrieves details of a specific group (requires membership).
 */
export async function getGroup(groupId: string): Promise<GroupDetail> {
  return apiRequest<GroupDetail>(`/api/v1/groups/${encodeURIComponent(groupId)}`, {
    method: "GET",
  });
}

/**
 * Updates group attributes (requires admin role).
 */
export async function updateGroup(
  groupId: string,
  updates: UpdateGroupInput
): Promise<GroupDetail> {
  return apiRequest<GroupDetail>(`/api/v1/groups/${encodeURIComponent(groupId)}`, {
    method: "PATCH",
    body: updates,
  });
}

/**
 * Retrieves all members of a group (requires membership).
 */
export async function getGroupMembers(groupId: string): Promise<GroupMember[]> {
  return apiRequest<GroupMember[]>(
    `/api/v1/groups/${encodeURIComponent(groupId)}/members`,
    {
      method: "GET",
    }
  );
}

/**
 * Adds an existing user to a group (requires membership).
 */
export async function addGroupMember(
  groupId: string,
  input: AddGroupMemberInput
): Promise<GroupMember> {
  return apiRequest<GroupMember>(
    `/api/v1/groups/${encodeURIComponent(groupId)}/members`,
    {
      method: "POST",
      body: input,
    }
  );
}

/**
 * Removes a member from a group (voluntary leave or admin removal).
 */
export async function removeGroupMember(
  groupId: string,
  userId: string
): Promise<{ success: boolean; message: string }> {
  return apiRequest<{ success: boolean; message: string }>(
    `/api/v1/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
    }
  );
}
