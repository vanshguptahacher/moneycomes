import { apiRequest } from "./client.js";

export interface SafeNotificationUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  readAt: string | null;
  groupId: string | null;
  expenseId: string | null;
  settlementId: string | null;
  activityId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  actor: SafeNotificationUser | null;
}

export interface ListNotificationsOptions {
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
  type?: string;
}

export interface UnreadCountResponse {
  unreadCount: number;
}

export interface MarkAllAsReadResponse {
  success: boolean;
  updatedCount: number;
}

/**
 * Retrieves notifications for the authenticated user with deterministic ordering and pagination.
 */
export async function getNotifications(
  options: ListNotificationsOptions = {}
): Promise<NotificationItem[]> {
  const params = new URLSearchParams();
  if (options.limit !== undefined) {
    params.set("limit", String(options.limit));
  }
  if (options.offset !== undefined) {
    params.set("offset", String(options.offset));
  }
  if (options.unreadOnly !== undefined) {
    params.set("unreadOnly", String(options.unreadOnly));
  }
  if (options.type) {
    params.set("type", options.type);
  }

  const queryString = params.toString();
  const endpoint = queryString
    ? `/api/v1/notifications?${queryString}`
    : `/api/v1/notifications`;

  return apiRequest<NotificationItem[]>(endpoint, {
    method: "GET",
  });
}

/**
 * Retrieves the count of unread notifications for the authenticated user.
 */
export async function getUnreadNotificationCount(): Promise<UnreadCountResponse> {
  return apiRequest<UnreadCountResponse>("/api/v1/notifications/unread-count", {
    method: "GET",
  });
}

/**
 * Retrieves a single notification by ID.
 */
export async function getNotification(
  notificationId: string
): Promise<NotificationItem> {
  return apiRequest<NotificationItem>(
    `/api/v1/notifications/${encodeURIComponent(notificationId)}`,
    {
      method: "GET",
    }
  );
}

/**
 * Marks a single notification as read.
 */
export async function markNotificationAsRead(
  notificationId: string
): Promise<NotificationItem> {
  return apiRequest<NotificationItem>(
    `/api/v1/notifications/${encodeURIComponent(notificationId)}/read`,
    {
      method: "PATCH",
    }
  );
}

/**
 * Marks a single notification as unread.
 */
export async function markNotificationAsUnread(
  notificationId: string
): Promise<NotificationItem> {
  return apiRequest<NotificationItem>(
    `/api/v1/notifications/${encodeURIComponent(notificationId)}/unread`,
    {
      method: "PATCH",
    }
  );
}

/**
 * Marks all unread notifications as read for the authenticated user.
 */
export async function markAllNotificationsAsRead(): Promise<MarkAllAsReadResponse> {
  return apiRequest<MarkAllAsReadResponse>("/api/v1/notifications/read-all", {
    method: "POST",
  });
}
