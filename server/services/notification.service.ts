import {
  NotFoundError,
  BadRequestError,
} from "../errors/index.js";
import {
  notificationRepository,
  userRepository,
  type NotificationRepository,
  type UserRepository,
  type DbOrTx,
} from "../repositories/index.js";
import {
  type Notification,
  isNotificationType,
  validateNotificationInput,
} from "../db/schema/index.js";

export interface SafeNotificationUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export interface NotificationItemResponse {
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

export interface NotificationListResponse {
  notifications: NotificationItemResponse[];
  total: number;
  limit: number;
  offset: number;
}

export interface ListNotificationServiceOptions {
  limit?: number;
  offset?: number;
  unreadOnly?: boolean;
  type?: string;
}

/**
 * Service orchestrating notifications retrieval, user recipient isolation,
 * IDOR prevention, read state transitions, and safe response serialization.
 */
export class NotificationService {
  constructor(
    private readonly notificationRepo: NotificationRepository = notificationRepository,
    private readonly userRepo: UserRepository = userRepository
  ) {}

  /**
   * Helper to resolve safe actor user profile representation.
   */
  private async getSafeUser(userId: string): Promise<SafeNotificationUser> {
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
   * Helper to serialize a notification record into a safe, client-facing response.
   */
  private formatNotificationResponse(
    notification: Notification,
    actorUser: SafeNotificationUser | null
  ): NotificationItemResponse {
    return {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      isRead: notification.readAt !== null,
      readAt: notification.readAt ? notification.readAt.toISOString() : null,
      groupId: notification.groupId,
      expenseId: notification.expenseId,
      settlementId: notification.settlementId,
      activityId: notification.activityId,
      metadata: (notification.metadata as Record<string, unknown>) ?? {},
      createdAt: notification.createdAt.toISOString(),
      actor: actorUser,
    };
  }

  /**
   * List notifications belonging exclusively to the authenticated user.
   */
  async getUserNotifications(
    actorId: string,
    options: ListNotificationServiceOptions = {}
  ): Promise<NotificationListResponse> {
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const offset = Math.max(options.offset ?? 0, 0);

    if (options.type && !isNotificationType(options.type)) {
      throw new BadRequestError(`Invalid notification type: "${options.type}"`);
    }

    const { notifications: rawList, total } =
      await this.notificationRepo.listByRecipientId(actorId, {
        limit,
        offset,
        unreadOnly: options.unreadOnly,
        type: options.type,
      });

    // Batch resolve distinct actors
    const actorIds = Array.from(
      new Set(
        rawList
          .map((n) => n.actorId)
          .filter((id): id is string => typeof id === "string" && id.length > 0)
      )
    );

    const actorUsers = new Map<string, SafeNotificationUser>();
    await Promise.all(
      actorIds.map(async (id) => {
        const safeUser = await this.getSafeUser(id);
        actorUsers.set(id, safeUser);
      })
    );

    const serialized = rawList.map((notification) => {
      const actorUser = notification.actorId
        ? actorUsers.get(notification.actorId) ?? null
        : null;
      return this.formatNotificationResponse(notification, actorUser);
    });

    return {
      notifications: serialized,
      total,
      limit,
      offset,
    };
  }

  /**
   * Returns the count of unread notifications for the authenticated user.
   */
  async getUnreadCount(actorId: string): Promise<{ unreadCount: number }> {
    const unreadCount = await this.notificationRepo.getUnreadCount(actorId);
    return { unreadCount };
  }

  /**
   * Retrieves a single notification by ID.
   * Prevents IDOR by verifying ownership server-side; returns 404 if not found or belongs to another user.
   */
  async getNotificationById(
    actorId: string,
    notificationId: string
  ): Promise<NotificationItemResponse> {
    const notification = await this.notificationRepo.findById(notificationId);
    if (!notification || notification.recipientId !== actorId) {
      throw new NotFoundError("Notification not found");
    }

    let actorUser: SafeNotificationUser | null = null;
    if (notification.actorId) {
      actorUser = await this.getSafeUser(notification.actorId);
    }

    return this.formatNotificationResponse(notification, actorUser);
  }

  /**
   * Marks a notification as read.
   * Safe and idempotent. Enforces ownership check.
   */
  async markAsRead(
    actorId: string,
    notificationId: string
  ): Promise<NotificationItemResponse> {
    const existing = await this.notificationRepo.findById(notificationId);
    if (!existing || existing.recipientId !== actorId) {
      throw new NotFoundError("Notification not found");
    }

    const updated = await this.notificationRepo.markAsRead(notificationId, actorId);
    const resolved = updated ?? existing;

    let actorUser: SafeNotificationUser | null = null;
    if (resolved.actorId) {
      actorUser = await this.getSafeUser(resolved.actorId);
    }

    return this.formatNotificationResponse(resolved, actorUser);
  }

  /**
   * Marks a notification as unread.
   * Safe and idempotent. Enforces ownership check.
   */
  async markAsUnread(
    actorId: string,
    notificationId: string
  ): Promise<NotificationItemResponse> {
    const existing = await this.notificationRepo.findById(notificationId);
    if (!existing || existing.recipientId !== actorId) {
      throw new NotFoundError("Notification not found");
    }

    const updated = await this.notificationRepo.markAsUnread(notificationId, actorId);
    const resolved = updated ?? existing;

    let actorUser: SafeNotificationUser | null = null;
    if (resolved.actorId) {
      actorUser = await this.getSafeUser(resolved.actorId);
    }

    return this.formatNotificationResponse(resolved, actorUser);
  }

  /**
   * Marks all unread notifications as read for the authenticated user.
   * Safe, idempotent, and executed efficiently in the database.
   */
  async markAllAsRead(
    actorId: string
  ): Promise<{ success: boolean; updatedCount: number }> {
    const updatedCount = await this.notificationRepo.markAllAsRead(actorId);
    return {
      success: true,
      updatedCount,
    };
  }

  /**
   * Server-side notification generator.
   * Validates notification input and persists record.
   */
  async createNotification(
    data: Parameters<typeof validateNotificationInput>[0],
    client?: DbOrTx
  ): Promise<Notification> {
    const validated = validateNotificationInput(data);
    return this.notificationRepo.create(validated, client);
  }
}

export const notificationService = new NotificationService();
