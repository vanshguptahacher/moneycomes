import { apiRequest } from "./client.js";

export interface SafeActivityUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export interface ActivityItem {
  id: string;
  type: string;
  actorId: string;
  groupId: string | null;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  actor: SafeActivityUser;
}

export interface ListActivityOptions {
  limit?: number;
  offset?: number;
  type?: string;
  entityType?: string;
}

/**
 * Retrieves activity events for a specific group with deterministic ordering and pagination.
 */
export async function getGroupActivity(
  groupId: string,
  options: ListActivityOptions = {}
): Promise<ActivityItem[]> {
  const params = new URLSearchParams();
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  if (options.offset !== undefined) {
    params.set("offset", String(options.offset));
  }
  if (options.type) {
    params.set("type", options.type);
  }
  if (options.entityType) {
    params.set("entityType", options.entityType);
  }

  const queryString = params.toString();
  const endpoint = queryString
    ? `/api/v1/groups/${encodeURIComponent(groupId)}/activity?${queryString}`
    : `/api/v1/groups/${encodeURIComponent(groupId)}/activity`;

  return apiRequest<ActivityItem[]>(endpoint, {
    method: "GET",
  });
}

/**
 * Retrieves activity events across all groups where the authenticated user is an active member.
 */
export async function getUserActivity(
  options: ListActivityOptions = {}
): Promise<ActivityItem[]> {
  const params = new URLSearchParams();
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  if (options.offset !== undefined) {
    params.set("offset", String(options.offset));
  }
  if (options.type) {
    params.set("type", options.type);
  }
  if (options.entityType) {
    params.set("entityType", options.entityType);
  }

  const queryString = params.toString();
  const endpoint = queryString
    ? `/api/v1/activity?${queryString}`
    : "/api/v1/activity";

  return apiRequest<ActivityItem[]>(endpoint, {
    method: "GET",
  });
}
