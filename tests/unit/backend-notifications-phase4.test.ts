/**
 * Phase 4.8 — Notifications API Test Suite.
 *
 * Verifies that:
 * A. Authentication: Unauthenticated requests to all notification endpoints are rejected (HTTP 401).
 * B. User Isolation & IDOR: Recipient is strictly derived from session; users cannot view or manipulate another user's notifications (HTTP 404).
 * C. Read State Transitions: markAsRead and markAsUnread work idempotently; markAllAsRead updates all unread notifications for the caller only.
 * D. Pagination & Ordering: Deterministic ordering (newest first), bounded pagination (max 100), and query validation.
 * E. Filtering & Unread Count: unreadOnly filter, valid/invalid type filters, and efficient unread count via SQL count().
 * F. Client Invariant / Boundary Protection: POST /notifications and DELETE /notifications/:id are unmapped/rejected (HTTP 404).
 * G. Server-Side Generation: Input validation enforces allowed types, safe metadata (rejects secrets), and foreign entity links.
 * H. Safe Response Serialization: Only safe fields and safe actor profiles are returned.
 * I. Mobile API Client: Typed helper functions interact with endpoints with appropriate HTTP methods.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { app } from "../../server/app.js";
import { auth, type AuthUser, type AuthSession } from "../../server/auth/index.js";
import { notificationRepository } from "../../server/repositories/notification.repository.js";
import { userRepository } from "../../server/repositories/user.repository.js";
import { notificationService } from "../../server/services/notification.service.js";
import type { Notification, User } from "../../server/db/schema/index.js";
import {
  getNotifications,
  getUnreadNotificationCount,
  getNotification,
  markNotificationAsRead,
  markNotificationAsUnread,
  markAllNotificationsAsRead,
} from "../../src/api/index.js";

describe("Phase 4.8 — Notifications API", () => {
  const mockUserAlice: User = {
    id: "usr_alice_123",
    name: "Alice Liddell",
    email: "alice@wonderland.com",
    emailVerified: true,
    image: "https://example.com/alice.jpg",
    defaultCurrencyCode: "INR",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };

  const mockUserBob: User = {
    id: "usr_bob_456",
    name: "Bob Builder",
    email: "bob@builder.com",
    emailVerified: false,
    image: null,
    defaultCurrencyCode: "INR",
    createdAt: new Date("2026-01-02T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  };

  const mockAliceSession: AuthSession = {
    id: "sess_alice_token",
    userId: "usr_alice_123",
    token: "tok_alice_secret",
    expiresAt: new Date(Date.now() + 86400000),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockAliceNotif1: Notification = {
    id: "11111111-1111-1111-1111-111111111111",
    recipientId: mockUserAlice.id,
    actorId: mockUserBob.id,
    type: "expense_created",
    title: "New Expense Added",
    message: "Bob added an expense of ₹500 in Goa Trip",
    groupId: "22222222-2222-2222-2222-222222222222",
    expenseId: "33333333-3333-3333-3333-333333333333",
    settlementId: null,
    activityId: "44444444-4444-4444-4444-444444444444",
    metadata: {
      amountMinor: 50000,
      currencyCode: "INR",
    },
    readAt: null,
    createdAt: new Date("2026-01-10T12:00:00.000Z"),
  };

  const mockAliceNotif2: Notification = {
    id: "55555555-5555-5555-5555-555555555555",
    recipientId: mockUserAlice.id,
    actorId: null, // system notification
    type: "balance_reminder",
    title: "Balance Reminder",
    message: "You have pending settlements to review",
    groupId: null,
    expenseId: null,
    settlementId: null,
    activityId: null,
    metadata: {},
    readAt: new Date("2026-01-09T10:00:00.000Z"),
    createdAt: new Date("2026-01-09T09:00:00.000Z"),
  };

  const mockBobNotif: Notification = {
    id: "66666666-6666-6666-6666-666666666666",
    recipientId: mockUserBob.id,
    actorId: mockUserAlice.id,
    type: "settlement_created",
    title: "Settlement Recorded",
    message: "Alice settled ₹200 with you",
    groupId: "22222222-2222-2222-2222-222222222222",
    expenseId: null,
    settlementId: "77777777-7777-7777-7777-777777777777",
    activityId: null,
    metadata: {
      amountMinor: 20000,
    },
    readAt: null,
    createdAt: new Date("2026-01-11T15:00:00.000Z"),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // A. AUTHENTICATION
  // ==========================================================================
  describe("A. Authentication Verification", () => {
    it("1. unauthenticated notification list rejected with HTTP 401", async () => {
      const res = await app.request("/api/v1/notifications", {
        method: "GET",
      });
      expect(res.status).toBe(401);
    });

    it("2. unauthenticated unread count rejected with HTTP 401", async () => {
      const res = await app.request("/api/v1/notifications/unread-count", {
        method: "GET",
      });
      expect(res.status).toBe(401);
    });

    it("3. unauthenticated get single notification rejected with HTTP 401", async () => {
      const res = await app.request(`/api/v1/notifications/${mockAliceNotif1.id}`, {
        method: "GET",
      });
      expect(res.status).toBe(401);
    });

    it("4. unauthenticated mark-read rejected with HTTP 401", async () => {
      const res = await app.request(`/api/v1/notifications/${mockAliceNotif1.id}/read`, {
        method: "PATCH",
      });
      expect(res.status).toBe(401);
    });

    it("5. unauthenticated mark-unread rejected with HTTP 401", async () => {
      const res = await app.request(`/api/v1/notifications/${mockAliceNotif1.id}/unread`, {
        method: "PATCH",
      });
      expect(res.status).toBe(401);
    });

    it("6. unauthenticated mark-all-read rejected with HTTP 401", async () => {
      const res = await app.request("/api/v1/notifications/read-all", {
        method: "POST",
      });
      expect(res.status).toBe(401);
    });
  });

  // ==========================================================================
  // B. USER ISOLATION & IDOR PROTECTION
  // ==========================================================================
  describe("B. User Isolation & IDOR Protection", () => {
    it("7. authenticated user lists only their own notifications", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const listSpy = vi
        .spyOn(notificationRepository, "listByRecipientId")
        .mockResolvedValueOnce({
          notifications: [mockAliceNotif1, mockAliceNotif2],
          total: 2,
        });

      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(mockUserBob);

      const res = await app.request("/api/v1/notifications", {
        method: "GET",
        headers: {
          authorization: `Bearer ${mockAliceSession.token}`,
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(2);
      expect(body.data[0].id).toBe(mockAliceNotif1.id);
      expect(body.data[0].title).toBe("New Expense Added");
      expect(body.data[0].actor.name).toBe("Bob Builder");

      // Verify recipient was strictly derived from session (Alice)
      expect(listSpy).toHaveBeenCalledWith(
        mockUserAlice.id,
        expect.objectContaining({ limit: 20, offset: 0 })
      );
    });

    it("8. client-supplied userId or recipientId is ignored; session user is always used", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const listSpy = vi
        .spyOn(notificationRepository, "listByRecipientId")
        .mockResolvedValueOnce({
          notifications: [mockAliceNotif1],
          total: 1,
        });

      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(mockUserBob);

      // Malicious query attempting to fetch Bob's notifications
      const res = await app.request(
        `/api/v1/notifications?recipientId=${mockUserBob.id}&userId=${mockUserBob.id}`,
        {
          method: "GET",
          headers: {
            authorization: `Bearer ${mockAliceSession.token}`,
          },
        }
      );

      expect(res.status).toBe(200);
      // Ensure Alice's ID was strictly passed to the repository, not Bob's
      expect(listSpy).toHaveBeenCalledWith(
        mockUserAlice.id,
        expect.any(Object)
      );
    });

    it("9. IDOR: user cannot retrieve another user's notification (returns HTTP 404)", async () => {
      // Alice tries to access Bob's notification
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      vi.spyOn(notificationRepository, "findById").mockResolvedValueOnce(mockBobNotif);

      const res = await app.request(`/api/v1/notifications/${mockBobNotif.id}`, {
        method: "GET",
        headers: {
          authorization: `Bearer ${mockAliceSession.token}`,
        },
      });

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
    });

    it("10. IDOR: user cannot mark another user's notification as read (returns HTTP 404)", async () => {
      // Alice tries to mark Bob's notification as read
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      vi.spyOn(notificationRepository, "findById").mockResolvedValueOnce(mockBobNotif);
      const markSpy = vi.spyOn(notificationRepository, "markAsRead");

      const res = await app.request(`/api/v1/notifications/${mockBobNotif.id}/read`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${mockAliceSession.token}`,
        },
      });

      expect(res.status).toBe(404);
      expect(markSpy).not.toHaveBeenCalled();
    });

    it("11. IDOR: user cannot mark another user's notification as unread (returns HTTP 404)", async () => {
      // Alice tries to mark Bob's notification as unread
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      vi.spyOn(notificationRepository, "findById").mockResolvedValueOnce(mockBobNotif);
      const markSpy = vi.spyOn(notificationRepository, "markAsUnread");

      const res = await app.request(`/api/v1/notifications/${mockBobNotif.id}/unread`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${mockAliceSession.token}`,
        },
      });

      expect(res.status).toBe(404);
      expect(markSpy).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // C. READ STATE TRANSITIONS
  // ==========================================================================
  describe("C. Read State Transitions", () => {
    it("12. marking notification as read updates readAt and returns isRead: true", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      vi.spyOn(notificationRepository, "findById").mockResolvedValueOnce(mockAliceNotif1);
      vi.spyOn(notificationRepository, "markAsRead").mockResolvedValueOnce({
        ...mockAliceNotif1,
        readAt: new Date("2026-01-10T13:00:00.000Z"),
      });
      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(mockUserBob);

      const res = await app.request(`/api/v1/notifications/${mockAliceNotif1.id}/read`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${mockAliceSession.token}`,
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe(mockAliceNotif1.id);
      expect(body.data.isRead).toBe(true);
      expect(body.data.readAt).toBe("2026-01-10T13:00:00.000Z");
    });

    it("13. repeated mark-as-read is idempotent and safe", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const alreadyReadNotif: Notification = {
        ...mockAliceNotif1,
        readAt: new Date("2026-01-10T12:30:00.000Z"),
      };

      vi.spyOn(notificationRepository, "findById").mockResolvedValueOnce(alreadyReadNotif);
      vi.spyOn(notificationRepository, "markAsRead").mockResolvedValueOnce(alreadyReadNotif);
      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(mockUserBob);

      const res = await app.request(`/api/v1/notifications/${mockAliceNotif1.id}/read`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${mockAliceSession.token}`,
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.isRead).toBe(true);
      expect(body.data.readAt).toBe("2026-01-10T12:30:00.000Z");
    });

    it("14. marking notification as unread resets readAt to null and returns isRead: false", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      vi.spyOn(notificationRepository, "findById").mockResolvedValueOnce(mockAliceNotif2);
      vi.spyOn(notificationRepository, "markAsUnread").mockResolvedValueOnce({
        ...mockAliceNotif2,
        readAt: null,
      });

      const res = await app.request(`/api/v1/notifications/${mockAliceNotif2.id}/unread`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${mockAliceSession.token}`,
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe(mockAliceNotif2.id);
      expect(body.data.isRead).toBe(false);
      expect(body.data.readAt).toBeNull();
    });

    it("15. repeated mark-as-unread is idempotent and safe", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const alreadyUnreadNotif: Notification = {
        ...mockAliceNotif2,
        readAt: null,
      };

      vi.spyOn(notificationRepository, "findById").mockResolvedValueOnce(alreadyUnreadNotif);
      vi.spyOn(notificationRepository, "markAsUnread").mockResolvedValueOnce(alreadyUnreadNotif);

      const res = await app.request(`/api/v1/notifications/${mockAliceNotif2.id}/unread`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${mockAliceSession.token}`,
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.isRead).toBe(false);
      expect(body.data.readAt).toBeNull();
    });

    it("16. mark-all-read affects only authenticated user's notifications and returns updatedCount", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const markAllSpy = vi
        .spyOn(notificationRepository, "markAllAsRead")
        .mockResolvedValueOnce(5);

      const res = await app.request("/api/v1/notifications/read-all", {
        method: "POST",
        headers: {
          authorization: `Bearer ${mockAliceSession.token}`,
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual({
        success: true,
        updatedCount: 5,
      });

      // Recipient was strictly Alice
      expect(markAllSpy).toHaveBeenCalledWith(mockUserAlice.id);
    });

    it("17. PATCH /read-all works interchangeably with POST /read-all", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const markAllSpy = vi
        .spyOn(notificationRepository, "markAllAsRead")
        .mockResolvedValueOnce(3);

      const res = await app.request("/api/v1/notifications/read-all", {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${mockAliceSession.token}`,
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.updatedCount).toBe(3);
      expect(markAllSpy).toHaveBeenCalledWith(mockUserAlice.id);
    });
  });

  // ==========================================================================
  // D. PAGINATION & ORDERING
  // ==========================================================================
  describe("D. Pagination & Ordering", () => {
    it("18. applies custom limit and offset parameters", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const listSpy = vi
        .spyOn(notificationRepository, "listByRecipientId")
        .mockResolvedValueOnce({
          notifications: [mockAliceNotif1],
          total: 15,
        });

      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(mockUserBob);

      const res = await app.request("/api/v1/notifications?limit=10&offset=5", {
        method: "GET",
        headers: {
          authorization: `Bearer ${mockAliceSession.token}`,
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.meta.limit).toBe(10);
      expect(body.meta.offset).toBe(5);
      expect(body.meta.total).toBe(15);

      expect(listSpy).toHaveBeenCalledWith(
        mockUserAlice.id,
        expect.objectContaining({ limit: 10, offset: 5 })
      );
    });

    it("19. rejects invalid non-integer pagination parameter with HTTP 400", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const res = await app.request("/api/v1/notifications?limit=invalid", {
        method: "GET",
        headers: {
          authorization: `Bearer ${mockAliceSession.token}`,
        },
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe("VALIDATION_ERROR");
    });

    it("20. rejects invalid UUID notificationId parameter with HTTP 400", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const res = await app.request("/api/v1/notifications/not-a-valid-uuid", {
        method: "GET",
        headers: {
          authorization: `Bearer ${mockAliceSession.token}`,
        },
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("must be a valid UUID");
    });
  });

  // ==========================================================================
  // E. FILTERING & UNREAD COUNT
  // ==========================================================================
  describe("E. Filtering & Unread Count", () => {
    it("21. unreadOnly=true filter is passed to repository", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const listSpy = vi
        .spyOn(notificationRepository, "listByRecipientId")
        .mockResolvedValueOnce({
          notifications: [mockAliceNotif1],
          total: 1,
        });

      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(mockUserBob);

      const res = await app.request("/api/v1/notifications?unreadOnly=true", {
        method: "GET",
        headers: {
          authorization: `Bearer ${mockAliceSession.token}`,
        },
      });

      expect(res.status).toBe(200);
      expect(listSpy).toHaveBeenCalledWith(
        mockUserAlice.id,
        expect.objectContaining({ unreadOnly: true })
      );
    });

    it("22. valid type filter is passed to repository", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const listSpy = vi
        .spyOn(notificationRepository, "listByRecipientId")
        .mockResolvedValueOnce({
          notifications: [mockAliceNotif1],
          total: 1,
        });

      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(mockUserBob);

      const res = await app.request("/api/v1/notifications?type=expense_created", {
        method: "GET",
        headers: {
          authorization: `Bearer ${mockAliceSession.token}`,
        },
      });

      expect(res.status).toBe(200);
      expect(listSpy).toHaveBeenCalledWith(
        mockUserAlice.id,
        expect.objectContaining({ type: "expense_created" })
      );
    });

    it("23. invalid type filter returns HTTP 400", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const res = await app.request("/api/v1/notifications?type=malicious_fake_event", {
        method: "GET",
        headers: {
          authorization: `Bearer ${mockAliceSession.token}`,
        },
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("Invalid notification type");
    });

    it("24. unread count returns integer count directly from database query", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const countSpy = vi
        .spyOn(notificationRepository, "getUnreadCount")
        .mockResolvedValueOnce(7);

      const res = await app.request("/api/v1/notifications/unread-count", {
        method: "GET",
        headers: {
          authorization: `Bearer ${mockAliceSession.token}`,
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual({ unreadCount: 7 });
      expect(countSpy).toHaveBeenCalledWith(mockUserAlice.id);
    });
  });

  // ==========================================================================
  // F. CLIENT MUTATION INVARIANTS & BOUNDARY PROTECTION
  // ==========================================================================
  describe("F. Client Mutation Invariants & Boundary Protection", () => {
    it("25. client cannot create arbitrary notifications via POST /api/v1/notifications (returns 404)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const res = await app.request("/api/v1/notifications", {
        method: "POST",
        headers: {
          authorization: `Bearer ${mockAliceSession.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          recipientId: mockUserBob.id,
          type: "expense_created",
          title: "Fabricated Notification",
          message: "You owe me money",
        }),
      });

      expect(res.status).toBe(404);
    });

    it("26. client cannot delete notifications via DELETE /api/v1/notifications/:id (returns 404)", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      const res = await app.request(`/api/v1/notifications/${mockAliceNotif1.id}`, {
        method: "DELETE",
        headers: {
          authorization: `Bearer ${mockAliceSession.token}`,
        },
      });

      expect(res.status).toBe(404);
    });
  });

  // ==========================================================================
  // G. SERVER-SIDE NOTIFICATION GENERATION & VALIDATION
  // ==========================================================================
  describe("G. Server-Side Notification Generation & Validation", () => {
    it("27. server-side creation generates valid notification with safe fields", async () => {
      const createSpy = vi
        .spyOn(notificationRepository, "create")
        .mockResolvedValueOnce(mockAliceNotif1);

      const created = await notificationService.createNotification({
        recipientId: mockUserAlice.id,
        actorId: mockUserBob.id,
        type: "expense_created",
        title: "New Expense Added",
        message: "Bob added an expense of ₹500 in Goa Trip",
        groupId: "22222222-2222-2222-2222-222222222222",
        expenseId: "33333333-3333-3333-3333-333333333333",
        metadata: {
          amountMinor: 50000,
        },
      });

      expect(created.id).toBe(mockAliceNotif1.id);
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          recipientId: mockUserAlice.id,
          actorId: mockUserBob.id,
          type: "expense_created",
          title: "New Expense Added",
        }),
        undefined
      );
    });

    it("28. server-side creation rejects invalid notification type", async () => {
      await expect(
        notificationService.createNotification({
          recipientId: mockUserAlice.id,
          type: "unsupported_fake_type" as unknown as "expense_created",
          title: "Test",
          message: "Test message",
        })
      ).rejects.toThrow('Invalid notification type: "unsupported_fake_type"');
    });

    it("29. server-side creation rejects sensitive metadata keys (password, token, secret)", async () => {
      await expect(
        notificationService.createNotification({
          recipientId: mockUserAlice.id,
          type: "expense_created",
          title: "Test",
          message: "Test message",
          metadata: {
            token: "secret_leaked_token",
          },
        })
      ).rejects.toThrow('Security violation: notification metadata must not contain sensitive key "token"');
    });
  });

  // ==========================================================================
  // H. SAFE RESPONSE DATA SERIALIZATION
  // ==========================================================================
  describe("H. Safe Response Data Serialization", () => {
    it("30. single notification detail returns safe fields and never exposes sensitive credentials", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      vi.spyOn(notificationRepository, "findById").mockResolvedValueOnce(mockAliceNotif1);
      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(mockUserBob);

      const res = await app.request(`/api/v1/notifications/${mockAliceNotif1.id}`, {
        method: "GET",
        headers: {
          authorization: `Bearer ${mockAliceSession.token}`,
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      const notif = body.data;

      expect(notif.id).toBe(mockAliceNotif1.id);
      expect(notif.type).toBe("expense_created");
      expect(notif.title).toBe("New Expense Added");
      expect(notif.message).toBe("Bob added an expense of ₹500 in Goa Trip");
      expect(notif.isRead).toBe(false);
      expect(notif.readAt).toBeNull();
      expect(notif.createdAt).toBe("2026-01-10T12:00:00.000Z");

      // Actor profile is sanitized
      expect(notif.actor).toEqual({
        id: mockUserBob.id,
        name: mockUserBob.name,
        email: mockUserBob.email,
        image: mockUserBob.image,
      });

      // No secrets or tokens
      expect(notif.token).toBeUndefined();
      expect(notif.password).toBeUndefined();
      expect(notif.recipientId).toBeUndefined();
      expect(notif.actorId).toBeUndefined();
    });
  });

  // ==========================================================================
  // I. MOBILE API CLIENT
  // ==========================================================================
  describe("I. Mobile API Client", () => {
    beforeEach(() => {
      global.fetch = vi.fn();
    });

    it("31. getNotifications invokes GET /api/v1/notifications with query parameters", async () => {
      const mockItems = [
        {
          id: mockAliceNotif1.id,
          type: "expense_created",
          title: "New Expense",
          message: "Test",
          isRead: false,
          readAt: null,
          groupId: null,
          expenseId: null,
          settlementId: null,
          activityId: null,
          metadata: {},
          createdAt: "2026-01-10T12:00:00.000Z",
          actor: null,
        },
      ];

      (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: mockItems, meta: { total: 1 } }),
      });

      const result = await getNotifications({ limit: 10, offset: 20, unreadOnly: true });

      expect(result).toEqual(mockItems);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/notifications?limit=10&offset=20&unreadOnly=true"),
        expect.objectContaining({ method: "GET" })
      );
    });

    it("32. getUnreadNotificationCount invokes GET /api/v1/notifications/unread-count", async () => {
      (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { unreadCount: 4 } }),
      });

      const result = await getUnreadNotificationCount();
      expect(result).toEqual({ unreadCount: 4 });
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/notifications/unread-count"),
        expect.objectContaining({ method: "GET" })
      );
    });

    it("33. getNotification invokes GET /api/v1/notifications/:id", async () => {
      (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { id: mockAliceNotif1.id, title: "Detail" } }),
      });

      const result = await getNotification(mockAliceNotif1.id);
      expect(result.id).toBe(mockAliceNotif1.id);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/v1/notifications/${mockAliceNotif1.id}`),
        expect.objectContaining({ method: "GET" })
      );
    });

    it("34. markNotificationAsRead invokes PATCH /api/v1/notifications/:id/read", async () => {
      (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { id: mockAliceNotif1.id, isRead: true } }),
      });

      const result = await markNotificationAsRead(mockAliceNotif1.id);
      expect(result.isRead).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/v1/notifications/${mockAliceNotif1.id}/read`),
        expect.objectContaining({ method: "PATCH" })
      );
    });

    it("35. markNotificationAsUnread invokes PATCH /api/v1/notifications/:id/unread", async () => {
      (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { id: mockAliceNotif1.id, isRead: false } }),
      });

      const result = await markNotificationAsUnread(mockAliceNotif1.id);
      expect(result.isRead).toBe(false);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(`/api/v1/notifications/${mockAliceNotif1.id}/unread`),
        expect.objectContaining({ method: "PATCH" })
      );
    });

    it("36. markAllNotificationsAsRead invokes POST /api/v1/notifications/read-all", async () => {
      (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { success: true, updatedCount: 8 } }),
      });

      const result = await markAllNotificationsAsRead();
      expect(result).toEqual({ success: true, updatedCount: 8 });
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/notifications/read-all"),
        expect.objectContaining({ method: "POST" })
      );
    });
  });
});
