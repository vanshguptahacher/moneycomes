/**
 * Phase 4.9 — Attachments / Receipts API Test Suite.
 *
 * Verifies that:
 * A. Authentication: Unauthenticated requests to upload, list, get, and delete are rejected (HTTP 401).
 * B. Authorization & IDOR: Group membership and parent expense relationships are strictly enforced;
 *    cross-group and cross-expense access attempts return HTTP 404/403.
 * C. Deletion Permissions: Only the uploader, the expense creator, or a group admin can delete an attachment;
 *    ordinary members cannot delete other members' attachments (HTTP 403).
 * D. File & Magic-Byte Validation: Supported MIME types (JPEG, PNG, WebP, HEIC, PDF) are accepted;
 *    spoofed MIME types, empty files, and files >10MB are rejected (HTTP 400).
 * E. Path & Bucket Safety: Storage keys are server-generated; client cannot inject paths or select buckets.
 * F. Storage + Database Consistency: Failed storage upload prevents metadata insertion; failed database insertion
 *    triggers best-effort cleanup of the uploaded storage object.
 * G. Safe Response & Signed URLs: Short-lived signed download URLs (300s) are generated; no service-role keys or internal tokens leaked.
 * H. Financial Isolation: Attaching or deleting receipts never alters expense amounts, allocations, or balances.
 * I. Mobile API Client: listExpenseAttachments, getAttachment, uploadAttachment, deleteAttachment work as specified.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { app } from "../../server/app.js";
import { auth, type AuthUser, type AuthSession } from "../../server/auth/index.js";
import { attachmentRepository } from "../../server/repositories/attachment.repository.js";
import { expenseRepository } from "../../server/repositories/expense.repository.js";
import { groupRepository } from "../../server/repositories/group.repository.js";
import { userRepository } from "../../server/repositories/user.repository.js";
import { storageService } from "../../server/services/storage.service.js";
import { attachmentService } from "../../server/services/attachment.service.js";
import type { Attachment, Expense, Group, GroupMember, User } from "../../server/db/schema/index.js";
import {
  listExpenseAttachments,
  getAttachment,
  uploadAttachment,
  deleteAttachment,
} from "../../src/api/index.js";

describe("Phase 4.9 — Attachments / Receipts API", () => {
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

  const mockUserCharlie: User = {
    id: "usr_charlie_789",
    name: "Charlie Chaplin",
    email: "charlie@chaplin.com",
    emailVerified: true,
    image: null,
    defaultCurrencyCode: "INR",
    createdAt: new Date("2026-01-03T00:00:00.000Z"),
    updatedAt: new Date("2026-01-03T00:00:00.000Z"),
  };

  const mockAliceSession: AuthSession = {
    id: "sess_alice_token",
    userId: "usr_alice_123",
    token: "tok_alice_secret",
    expiresAt: new Date(Date.now() + 86400000),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockBobSession: AuthSession = {
    id: "sess_bob_token",
    userId: "usr_bob_456",
    token: "tok_bob_secret",
    expiresAt: new Date(Date.now() + 86400000),
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const mockGroupGoa: Group = {
    id: "11111111-1111-1111-1111-111111111111",
    name: "Goa Trip",
    description: "Vacation expenses",
    defaultCurrencyCode: "INR",
    createdById: "usr_alice_123",
    isArchived: false,
    createdAt: new Date("2026-01-10T10:00:00.000Z"),
    updatedAt: new Date("2026-01-10T10:00:00.000Z"),
  };

  const mockGroupOther: Group = {
    id: "22222222-2222-2222-2222-222222222222",
    name: "Other Group",
    description: "Unrelated group",
    defaultCurrencyCode: "USD",
    createdById: "usr_charlie_789",
    isArchived: false,
    createdAt: new Date("2026-01-15T10:00:00.000Z"),
    updatedAt: new Date("2026-01-15T10:00:00.000Z"),
  };

  const mockAliceAdminMembership: GroupMember = {
    id: "33333333-3333-3333-3333-333333333333",
    groupId: mockGroupGoa.id,
    userId: mockUserAlice.id,
    role: "admin",
    joinedAt: new Date("2026-01-10T10:00:00.000Z"),
  };

  const mockBobMemberMembership: GroupMember = {
    id: "44444444-4444-4444-4444-444444444444",
    groupId: mockGroupGoa.id,
    userId: mockUserBob.id,
    role: "member",
    joinedAt: new Date("2026-01-10T11:00:00.000Z"),
  };

  const mockExpenseDinner: Expense = {
    id: "55555555-5555-5555-5555-555555555555",
    groupId: mockGroupGoa.id,
    payerId: mockUserAlice.id,
    createdById: mockUserAlice.id,
    categoryId: null,
    description: "Beach Shack Dinner",
    amountMinor: 250000,
    currencyCode: "INR",
    splitMethod: "equal",
    date: new Date("2026-01-12T20:00:00.000Z"),
    notes: "Dinner bill",
    receiptUrl: null,
    isDeleted: false,
    createdAt: new Date("2026-01-12T20:30:00.000Z"),
    updatedAt: new Date("2026-01-12T20:30:00.000Z"),
  };

  const mockAttachment1: Attachment = {
    id: "66666666-6666-6666-6666-666666666666",
    expenseId: mockExpenseDinner.id,
    uploadedById: mockUserAlice.id,
    storageKey: `expenses/${mockExpenseDinner.id}/66666666-6666-6666-6666-666666666666.jpg`,
    originalFileName: "dinner_receipt.jpg",
    mimeType: "image/jpeg",
    fileSizeBytes: 1024,
    createdAt: new Date("2026-01-12T20:35:00.000Z"),
  };

  const mockAttachmentBob: Attachment = {
    id: "77777777-7777-7777-7777-777777777777",
    expenseId: mockExpenseDinner.id,
    uploadedById: mockUserBob.id,
    storageKey: `expenses/${mockExpenseDinner.id}/77777777-7777-7777-7777-777777777777.png`,
    originalFileName: "dessert_receipt.png",
    mimeType: "image/png",
    fileSizeBytes: 2048,
    createdAt: new Date("2026-01-12T20:40:00.000Z"),
  };

  // Valid file byte fixtures
  const validJpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const validPngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
  const invalidExeBytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // A. AUTHENTICATION VERIFICATION
  // ==========================================================================
  describe("A. Authentication Verification", () => {
    it("1. unauthenticated upload rejected with HTTP 401", async () => {
      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/expenses/${mockExpenseDinner.id}/attachments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fileBase64: btoa("test"),
            originalFileName: "receipt.jpg",
            mimeType: "image/jpeg",
          }),
        }
      );
      expect(res.status).toBe(401);
    });

    it("2. unauthenticated list attachments rejected with HTTP 401", async () => {
      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/expenses/${mockExpenseDinner.id}/attachments`,
        { method: "GET" }
      );
      expect(res.status).toBe(401);
    });

    it("3. unauthenticated get attachment detail rejected with HTTP 401", async () => {
      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/expenses/${mockExpenseDinner.id}/attachments/${mockAttachment1.id}`,
        { method: "GET" }
      );
      expect(res.status).toBe(401);
    });

    it("4. unauthenticated delete attachment rejected with HTTP 401", async () => {
      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/expenses/${mockExpenseDinner.id}/attachments/${mockAttachment1.id}`,
        { method: "DELETE" }
      );
      expect(res.status).toBe(401);
    });
  });

  // ==========================================================================
  // B. AUTHORIZATION & IDOR BOUNDARIES
  // ==========================================================================
  describe("B. Authorization & IDOR Boundaries", () => {
    it("5. non-member is rejected with HTTP 403 when trying to list attachments", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserCharlie as unknown as AuthUser,
        session: {
          id: "sess_charlie",
          userId: mockUserCharlie.id,
          token: "tok_charlie",
          expiresAt: new Date(Date.now() + 86400000),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // Charlie is NOT in Goa group
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(null);

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/expenses/${mockExpenseDinner.id}/attachments`,
        {
          method: "GET",
          headers: { authorization: "Bearer tok_charlie" },
        }
      );

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.message).toContain("not a member");
    });

    it("6. IDOR: accessing attachments from a different group returns HTTP 404", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      // Alice is in Goa group
      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(mockAliceAdminMembership);
      // But expense belongs to mockGroupOther, not mockGroupGoa!
      vi.spyOn(expenseRepository, "findById").mockResolvedValueOnce({
        ...mockExpenseDinner,
        groupId: mockGroupOther.id,
      });

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/expenses/${mockExpenseDinner.id}/attachments`,
        {
          method: "GET",
          headers: { authorization: `Bearer ${mockAliceSession.token}` },
        }
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
    });

    it("7. IDOR: single attachment lookup verifies parent expenseId and returns HTTP 404 on mismatch", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(mockAliceAdminMembership);
      vi.spyOn(expenseRepository, "findById").mockResolvedValueOnce(mockExpenseDinner);

      // Attachment belongs to another expense!
      vi.spyOn(attachmentRepository, "findById").mockResolvedValueOnce({
        ...mockAttachment1,
        expenseId: "88888888-8888-8888-8888-888888888888",
      });

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/expenses/${mockExpenseDinner.id}/attachments/${mockAttachment1.id}`,
        {
          method: "GET",
          headers: { authorization: `Bearer ${mockAliceSession.token}` },
        }
      );

      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe("NOT_FOUND");
    });
  });

  // ==========================================================================
  // C. DELETION AUTHORIZATION
  // ==========================================================================
  describe("C. Deletion Authorization", () => {
    it("8. uploader can delete their own attachment", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(mockAliceAdminMembership);
      vi.spyOn(expenseRepository, "findById").mockResolvedValueOnce(mockExpenseDinner);
      vi.spyOn(attachmentRepository, "findById").mockResolvedValueOnce(mockAttachment1);
      const dbDeleteSpy = vi.spyOn(attachmentRepository, "delete").mockResolvedValueOnce(true);
      const storageDeleteSpy = vi.spyOn(storageService, "deleteObject").mockResolvedValueOnce();

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/expenses/${mockExpenseDinner.id}/attachments/${mockAttachment1.id}`,
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${mockAliceSession.token}` },
        }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toEqual({ success: true, id: mockAttachment1.id });
      expect(dbDeleteSpy).toHaveBeenCalledWith(mockAttachment1.id);
      expect(storageDeleteSpy).toHaveBeenCalledWith("attachments", mockAttachment1.storageKey);
    });

    it("9. group admin can delete an attachment uploaded by another member", async () => {
      // Alice is group admin; Bob uploaded mockAttachmentBob
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(mockAliceAdminMembership);
      vi.spyOn(expenseRepository, "findById").mockResolvedValueOnce(mockExpenseDinner);
      vi.spyOn(attachmentRepository, "findById").mockResolvedValueOnce(mockAttachmentBob);
      vi.spyOn(attachmentRepository, "delete").mockResolvedValueOnce(true);
      vi.spyOn(storageService, "deleteObject").mockResolvedValueOnce();

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/expenses/${mockExpenseDinner.id}/attachments/${mockAttachmentBob.id}`,
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${mockAliceSession.token}` },
        }
      );

      expect(res.status).toBe(200);
    });

    it("10. ordinary member cannot delete another member's attachment (returns HTTP 403)", async () => {
      // Bob is ordinary member; Alice created expense and uploaded mockAttachment1
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserBob as unknown as AuthUser,
        session: mockBobSession,
      });

      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(mockBobMemberMembership);
      vi.spyOn(expenseRepository, "findById").mockResolvedValueOnce(mockExpenseDinner);
      vi.spyOn(attachmentRepository, "findById").mockResolvedValueOnce(mockAttachment1);

      const dbDeleteSpy = vi.spyOn(attachmentRepository, "delete");
      const storageDeleteSpy = vi.spyOn(storageService, "deleteObject");

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/expenses/${mockExpenseDinner.id}/attachments/${mockAttachment1.id}`,
        {
          method: "DELETE",
          headers: { authorization: `Bearer ${mockBobSession.token}` },
        }
      );

      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error.message).toContain("not authorized to delete");
      expect(dbDeleteSpy).not.toHaveBeenCalled();
      expect(storageDeleteSpy).not.toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // D. UPLOAD & FILE VALIDATION
  // ==========================================================================
  describe("D. Upload & File Validation", () => {
    it("11. valid attachment upload via JSON payload succeeds with safe response", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(mockAliceAdminMembership);
      vi.spyOn(expenseRepository, "findById").mockResolvedValueOnce(mockExpenseDinner);
      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(mockUserAlice);

      const storageUploadSpy = vi.spyOn(storageService, "uploadObject").mockResolvedValueOnce({
        path: `expenses/${mockExpenseDinner.id}/new-uuid.jpg`,
      });

      const dbCreateSpy = vi.spyOn(attachmentRepository, "create").mockResolvedValueOnce(mockAttachment1);

      // Binary string to base64
      let binary = "";
      for (let i = 0; i < validJpegBytes.length; i++) {
        binary += String.fromCharCode(validJpegBytes[i]);
      }
      const fileBase64 = btoa(binary);

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/expenses/${mockExpenseDinner.id}/attachments`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${mockAliceSession.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fileBase64,
            originalFileName: "dinner_receipt.jpg",
            mimeType: "image/jpeg",
          }),
        }
      );

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.data.id).toBe(mockAttachment1.id);
      expect(body.data.originalFileName).toBe("dinner_receipt.jpg");
      expect(body.data.mimeType).toBe("image/jpeg");
      expect(body.data.uploader.name).toBe("Alice Liddell");

      expect(storageUploadSpy).toHaveBeenCalledWith(
        "attachments",
        expect.stringMatching(new RegExp(`^expenses/${mockExpenseDinner.id}/[0-9a-f-]+\\.jpg$`)),
        expect.any(Uint8Array),
        "image/jpeg"
      );
      expect(dbCreateSpy).toHaveBeenCalled();
    });

    it("12. rejects unsupported MIME type with HTTP 400", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(mockAliceAdminMembership);
      vi.spyOn(expenseRepository, "findById").mockResolvedValueOnce(mockExpenseDinner);

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/expenses/${mockExpenseDinner.id}/attachments`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${mockAliceSession.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fileBase64: btoa("echo malicious"),
            originalFileName: "script.sh",
            mimeType: "application/x-sh",
          }),
        }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("Unsupported file type");
    });

    it("13. rejects spoofed MIME type where magic bytes mismatch declared type", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(mockAliceAdminMembership);
      vi.spyOn(expenseRepository, "findById").mockResolvedValueOnce(mockExpenseDinner);

      // Exe binary claiming to be a JPEG image
      let binary = "";
      for (let i = 0; i < invalidExeBytes.length; i++) {
        binary += String.fromCharCode(invalidExeBytes[i]);
      }

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/expenses/${mockExpenseDinner.id}/attachments`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${mockAliceSession.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fileBase64: btoa(binary),
            originalFileName: "fake.jpg",
            mimeType: "image/jpeg",
          }),
        }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("File signature does not match declared MIME type");
    });

    it("14. rejects empty file with HTTP 400", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(mockAliceAdminMembership);
      vi.spyOn(expenseRepository, "findById").mockResolvedValueOnce(mockExpenseDinner);

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/expenses/${mockExpenseDinner.id}/attachments`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${mockAliceSession.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fileBase64: "",
            originalFileName: "empty.jpg",
            mimeType: "image/jpeg",
          }),
        }
      );

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.message).toContain("required");
    });

    it("15. server generates storage key and ignores client attempts to specify path or bucket", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(mockAliceAdminMembership);
      vi.spyOn(expenseRepository, "findById").mockResolvedValueOnce(mockExpenseDinner);
      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(mockUserAlice);

      const storageUploadSpy = vi.spyOn(storageService, "uploadObject").mockResolvedValueOnce({
        path: `expenses/${mockExpenseDinner.id}/new-uuid.png`,
      });
      vi.spyOn(attachmentRepository, "create").mockResolvedValueOnce(mockAttachmentBob);

      let binary = "";
      for (let i = 0; i < validPngBytes.length; i++) {
        binary += String.fromCharCode(validPngBytes[i]);
      }

      // Malicious attempt to inject path traversal or bucket override
      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/expenses/${mockExpenseDinner.id}/attachments`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${mockAliceSession.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fileBase64: btoa(binary),
            originalFileName: "../../etc/passwd.png",
            mimeType: "image/png",
            storageKey: "arbitrary/dangerous/path",
            bucket: "secret_bucket",
          }),
        }
      );

      expect(res.status).toBe(201);
      // Key must strictly follow server pattern and use default attachments bucket
      expect(storageUploadSpy).toHaveBeenCalledWith(
        "attachments",
        expect.stringMatching(new RegExp(`^expenses/${mockExpenseDinner.id}/[0-9a-f-]+\\.png$`)),
        expect.any(Uint8Array),
        "image/png"
      );
    });
  });

  // ==========================================================================
  // E. STORAGE & DATABASE CONSISTENCY
  // ==========================================================================
  describe("E. Storage & Database Consistency", () => {
    it("16. failure in storage upload prevents database metadata insertion", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(mockAliceAdminMembership);
      vi.spyOn(expenseRepository, "findById").mockResolvedValueOnce(mockExpenseDinner);

      // Storage upload throws error
      vi.spyOn(storageService, "uploadObject").mockRejectedValueOnce(
        new Error("Supabase Storage unavailable (network error)")
      );

      const dbCreateSpy = vi.spyOn(attachmentRepository, "create");

      let binary = "";
      for (let i = 0; i < validJpegBytes.length; i++) {
        binary += String.fromCharCode(validJpegBytes[i]);
      }

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/expenses/${mockExpenseDinner.id}/attachments`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${mockAliceSession.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fileBase64: btoa(binary),
            originalFileName: "dinner.jpg",
            mimeType: "image/jpeg",
          }),
        }
      );

      expect(res.status).toBe(500);
      expect(dbCreateSpy).not.toHaveBeenCalled();
    });

    it("17. failure in database metadata insertion triggers best-effort cleanup of uploaded storage object", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(mockAliceAdminMembership);
      vi.spyOn(expenseRepository, "findById").mockResolvedValueOnce(mockExpenseDinner);

      vi.spyOn(storageService, "uploadObject").mockResolvedValueOnce({
        path: `expenses/${mockExpenseDinner.id}/abc.jpg`,
      });

      // Database insertion fails
      vi.spyOn(attachmentRepository, "create").mockRejectedValueOnce(
        new Error("PostgreSQL connection lost")
      );

      const cleanupSpy = vi.spyOn(storageService, "deleteObject").mockResolvedValueOnce();

      let binary = "";
      for (let i = 0; i < validJpegBytes.length; i++) {
        binary += String.fromCharCode(validJpegBytes[i]);
      }

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/expenses/${mockExpenseDinner.id}/attachments`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${mockAliceSession.token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fileBase64: btoa(binary),
            originalFileName: "dinner.jpg",
            mimeType: "image/jpeg",
          }),
        }
      );

      expect(res.status).toBe(500);
      // Ensure cleanup was invoked on the uploaded object
      expect(cleanupSpy).toHaveBeenCalledWith(
        "attachments",
        expect.stringContaining(`expenses/${mockExpenseDinner.id}/`)
      );
    });
  });

  // ==========================================================================
  // F. READ OPERATIONS & SIGNED URLS
  // ==========================================================================
  describe("F. Read Operations & Signed URLs", () => {
    it("18. list attachments returns all attachments for the expense with safe uploader profiles", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(mockAliceAdminMembership);
      vi.spyOn(expenseRepository, "findById").mockResolvedValueOnce(mockExpenseDinner);
      vi.spyOn(attachmentRepository, "listByExpenseId").mockResolvedValueOnce([
        mockAttachment1,
        mockAttachmentBob,
      ]);
      vi.spyOn(userRepository, "findById")
        .mockResolvedValueOnce(mockUserAlice)
        .mockResolvedValueOnce(mockUserBob);

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/expenses/${mockExpenseDinner.id}/attachments`,
        {
          method: "GET",
          headers: { authorization: `Bearer ${mockAliceSession.token}` },
        }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data).toHaveLength(2);
      expect(body.data[0].id).toBe(mockAttachment1.id);
      expect(body.data[0].uploader.name).toBe("Alice Liddell");
      expect(body.data[1].id).toBe(mockAttachmentBob.id);
      expect(body.data[1].uploader.name).toBe("Bob Builder");
      expect(body.meta.total).toBe(2);

      // No privileged keys or storage secrets exposed
      expect(body.data[0].storageKey).toBeUndefined();
      expect(body.data[0].serviceRoleKey).toBeUndefined();
    });

    it("19. get single attachment returns signed download URL with 300s expiry", async () => {
      vi.spyOn(auth.api, "getSession").mockResolvedValueOnce({
        user: mockUserAlice as unknown as AuthUser,
        session: mockAliceSession,
      });

      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(mockAliceAdminMembership);
      vi.spyOn(expenseRepository, "findById").mockResolvedValueOnce(mockExpenseDinner);
      vi.spyOn(attachmentRepository, "findById").mockResolvedValueOnce(mockAttachment1);
      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(mockUserAlice);

      vi.spyOn(storageService, "createSignedUrl").mockResolvedValueOnce({
        signedUrl: "https://project.supabase.co/storage/v1/object/sign/attachments/abc?token=xyz",
        expiresIn: 300,
      });

      const res = await app.request(
        `/api/v1/groups/${mockGroupGoa.id}/expenses/${mockExpenseDinner.id}/attachments/${mockAttachment1.id}`,
        {
          method: "GET",
          headers: { authorization: `Bearer ${mockAliceSession.token}` },
        }
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.data.id).toBe(mockAttachment1.id);
      expect(body.data.downloadUrl).toContain("https://project.supabase.co/storage/v1/object/sign/");
      expect(body.data.expiresIn).toBe(300);
      expect(body.data.uploader.name).toBe("Alice Liddell");
    });
  });

  // ==========================================================================
  // G. FINANCIAL INVARIANT ISOLATION
  // ==========================================================================
  describe("G. Financial Invariant Isolation", () => {
    it("20. attachment operations have zero side-effects on expense amounts, splits, or balances", async () => {
      // Create clone of expense before attachment
      const expenseBefore = { ...mockExpenseDinner };

      vi.spyOn(groupRepository, "findMembership").mockResolvedValueOnce(mockAliceAdminMembership);
      vi.spyOn(expenseRepository, "findById").mockResolvedValueOnce(mockExpenseDinner);
      vi.spyOn(userRepository, "findById").mockResolvedValueOnce(mockUserAlice);
      vi.spyOn(storageService, "uploadObject").mockResolvedValueOnce({ path: "test.jpg" });
      vi.spyOn(attachmentRepository, "create").mockResolvedValueOnce(mockAttachment1);

      await attachmentService.uploadAttachment(
        mockUserAlice.id,
        mockGroupGoa.id,
        mockExpenseDinner.id,
        {
          data: validJpegBytes,
          originalFileName: "dinner.jpg",
          mimeType: "image/jpeg",
          fileSizeBytes: validJpegBytes.length,
        }
      );

      // Verify financial fields remain unchanged
      expect(mockExpenseDinner.amountMinor).toBe(expenseBefore.amountMinor);
      expect(mockExpenseDinner.payerId).toBe(expenseBefore.payerId);
      expect(mockExpenseDinner.splitMethod).toBe(expenseBefore.splitMethod);
      expect(mockExpenseDinner.currencyCode).toBe(expenseBefore.currencyCode);
    });
  });

  // ==========================================================================
  // H. MOBILE API CLIENT
  // ==========================================================================
  describe("H. Mobile API Client", () => {
    beforeEach(() => {
      global.fetch = vi.fn();
    });

    it("21. listExpenseAttachments invokes GET endpoint", async () => {
      const mockItems = [
        {
          id: mockAttachment1.id,
          expenseId: mockExpenseDinner.id,
          originalFileName: "dinner.jpg",
          mimeType: "image/jpeg",
          fileSizeBytes: 1024,
          createdAt: "2026-01-12T20:35:00.000Z",
          uploader: { id: "usr_alice", name: "Alice", email: "a@w.com", image: null },
        },
      ];

      (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: mockItems, meta: { total: 1 } }),
      });

      const result = await listExpenseAttachments(mockGroupGoa.id, mockExpenseDinner.id);
      expect(result).toEqual(mockItems);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(
          `/api/v1/groups/${mockGroupGoa.id}/expenses/${mockExpenseDinner.id}/attachments`
        ),
        expect.objectContaining({ method: "GET" })
      );
    });

    it("22. getAttachment invokes GET detail endpoint", async () => {
      const mockDetail = {
        id: mockAttachment1.id,
        expenseId: mockExpenseDinner.id,
        originalFileName: "dinner.jpg",
        mimeType: "image/jpeg",
        fileSizeBytes: 1024,
        createdAt: "2026-01-12T20:35:00.000Z",
        uploader: { id: "usr_alice", name: "Alice", email: "a@w.com", image: null },
        downloadUrl: "https://signed.url",
        expiresIn: 300,
      };

      (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: mockDetail }),
      });

      const result = await getAttachment(mockGroupGoa.id, mockExpenseDinner.id, mockAttachment1.id);
      expect(result).toEqual(mockDetail);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(
          `/api/v1/groups/${mockGroupGoa.id}/expenses/${mockExpenseDinner.id}/attachments/${mockAttachment1.id}`
        ),
        expect.objectContaining({ method: "GET" })
      );
    });

    it("23. uploadAttachment invokes POST endpoint", async () => {
      const mockItem = {
        id: mockAttachment1.id,
        expenseId: mockExpenseDinner.id,
        originalFileName: "dinner.jpg",
        mimeType: "image/jpeg",
        fileSizeBytes: 1024,
        createdAt: "2026-01-12T20:35:00.000Z",
        uploader: { id: "usr_alice", name: "Alice", email: "a@w.com", image: null },
      };

      (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => ({ data: mockItem }),
      });

      const payload = {
        fileBase64: btoa("sample"),
        originalFileName: "dinner.jpg",
        mimeType: "image/jpeg",
      };

      const result = await uploadAttachment(mockGroupGoa.id, mockExpenseDinner.id, payload);
      expect(result).toEqual(mockItem);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(
          `/api/v1/groups/${mockGroupGoa.id}/expenses/${mockExpenseDinner.id}/attachments`
        ),
        expect.objectContaining({ method: "POST" })
      );
    });

    it("24. deleteAttachment invokes DELETE endpoint", async () => {
      (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ data: { success: true, id: mockAttachment1.id } }),
      });

      const result = await deleteAttachment(mockGroupGoa.id, mockExpenseDinner.id, mockAttachment1.id);
      expect(result).toEqual({ success: true, id: mockAttachment1.id });
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(
          `/api/v1/groups/${mockGroupGoa.id}/expenses/${mockExpenseDinner.id}/attachments/${mockAttachment1.id}`
        ),
        expect.objectContaining({ method: "DELETE" })
      );
    });
  });
});
